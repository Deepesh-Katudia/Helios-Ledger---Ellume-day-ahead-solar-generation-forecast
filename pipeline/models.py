"""Forecast models, from naive benchmarks to the final learned model.

All models share one interface:
    fit(frame, feats, mask)  -> self
    predict(frame, feats)    -> np.ndarray of AC kW for every row of `feats`
where `frame` is the cleaned frame (targets available only for training rows) and
`mask` selects the training rows.
"""
from __future__ import annotations

import lightgbm as lgb
import numpy as np
import pandas as pd

from . import config as C

CLIM_WINDOW_DAYS = 30
KT_CLIP = (0.0, 1.3)

LGB_PARAMS = dict(
    objective="regression",
    learning_rate=0.03,
    n_estimators=400,
    num_leaves=7,
    min_child_samples=100,
    subsample=0.8,
    subsample_freq=1,
    colsample_bytree=0.8,
    reg_lambda=1.0,
    random_state=C.SEED,
    deterministic=True,
    force_col_wise=True,
    n_jobs=1,
    verbose=-1,
)

LGB_FEATURES = [
    "forecast_cloud_cover",
    "forecast_temp_c",
    "forecast_wind_ms",
    "forecast_humidity_pct",
    "sun_elevation",
    "sun_azimuth",
    "aoi",
    "cs_poa",
    "cloud_lag1",
    "cloud_lead1",
    "cloud_roll3",
    "cloud_day_mean",
    "cloud_day_std",
    "cloud_day_max",
    "humidity_x_cloud",
    "poa_phys",
    "doy_sin",
    "doy_cos",
]
# Day-of-year stays in: the forecast's cloud -> irradiance mapping is regime dependent
# (monsoon "90% cloud" still lets ~75% of clear-sky through), and season is the only
# forecast-time signal of regime. Removing it cost ~15 kW MAE in every validation scheme.

PLANT_FEATURES = ["poa", "sun_elevation", "aoi", "forecast_temp_c", "forecast_wind_ms"]


def _night(feats: pd.DataFrame) -> np.ndarray:
    return (feats["cs_poa"] <= 0).to_numpy()


def _finish(pred: np.ndarray, feats: pd.DataFrame) -> np.ndarray:
    out = np.clip(np.nan_to_num(pred), 0, C.AC_CAPACITY_KW)
    out[_night(feats)] = 0.0
    return out


class SeasonalClimatology:
    """B0: mean clean output at the same clock hour within +/-30 days of the year.

    Knows the season and the time of day, nothing about tomorrow's weather.
    """

    name = "B0 seasonal climatology"

    def fit(self, frame, feats, mask):
        y = frame.loc[mask, "ac_clean"]
        idx = y.index
        table_sum = np.zeros((24, 366))
        table_n = np.zeros((24, 366))
        np.add.at(table_sum, (idx.hour, idx.dayofyear - 1), y.to_numpy())
        np.add.at(table_n, (idx.hour, idx.dayofyear - 1), 1)
        kernel = np.ones(2 * CLIM_WINDOW_DAYS + 1)
        wrap = lambda t: np.concatenate([t[:, -CLIM_WINDOW_DAYS:], t, t[:, :CLIM_WINDOW_DAYS]], axis=1)
        s = np.apply_along_axis(lambda r: np.convolve(r, kernel, "valid"), 1, wrap(table_sum))
        n = np.apply_along_axis(lambda r: np.convolve(r, kernel, "valid"), 1, wrap(table_n))
        self.table_ = np.divide(s, n, out=np.zeros_like(s), where=n > 0)
        return self

    def predict(self, frame, feats):
        idx = feats.index
        return _finish(self.table_[idx.hour, idx.dayofyear - 1], feats)


class YesterdayPersistence:
    """Reference only: yesterday's actual at the same hour.

    Not usable for the real test (no actuals exist) and optimistic, since at issue time
    (D-1 afternoon) yesterday's evening is not yet known. Included because it is the
    benchmark every operator instinctively compares against.
    """

    name = "Ref yesterday persistence"

    def fit(self, frame, feats, mask):
        return self

    def predict(self, frame, feats):
        prev = frame[C.TARGET].clip(lower=0).shift(24).reindex(feats.index)
        return _finish(prev.to_numpy(), feats)


class PhysicsCloud:
    """B1: clear-sky POA attenuated by forecast cloud, then a PVWatts plant model."""

    name = "B1 physics (clear-sky x cloud)"

    def fit(self, frame, feats, mask):
        return self

    def predict(self, frame, feats):
        return _finish(feats["ac_phys"].to_numpy(), feats)


class LGBMClearSkyIndex:
    """M1: gradient boosting on the *clear-sky index of AC power*.

    Dividing by the clear-sky AC removes the deterministic diurnal/seasonal shape, so the
    trees only learn how weather pulls output below its ceiling. Weighting by the clear-sky
    AC squared makes the loss equivalent to squared error in kW.
    """

    name = "M1 LightGBM (AC clear-sky index)"

    def fit(self, frame, feats, mask):
        m = mask & (feats["ac_clearsky"] > 50)
        kt = (frame.loc[m, "ac_clean"] / feats.loc[m, "ac_clearsky"]).clip(*KT_CLIP)
        w = feats.loc[m, "ac_clearsky"] ** 2
        self.model_ = lgb.LGBMRegressor(**LGB_PARAMS).fit(feats.loc[m, LGB_FEATURES], kt, sample_weight=w / w.mean())
        return self

    def predict(self, frame, feats):
        kt = np.clip(self.model_.predict(feats[LGB_FEATURES]), *KT_CLIP)
        return _finish(kt * feats["ac_clearsky"].to_numpy(), feats)


class LGBMTwoStagePOA:
    """M2: learn tomorrow's *irradiance* from the forecast, then a learned plant curve.

    Stage 1 (weather): forecast -> clear-sky index of POA. Measured POA stays valid during
    outages, curtailment and the MW-logging episode, so it learns from more weather.
    Stage 2 (plant): POA + sun geometry + temperature -> AC, fitted on clean hours. This
    replaces textbook PVWatts, which misses low-sun shading/IAM losses and soiling.
    """

    name = "M2 LightGBM two-stage (POA -> plant curve)"

    def fit(self, frame, feats, mask_poa, mask_ok):
        m = mask_poa & (feats["cs_poa"] > C.DAYLIGHT_POA_WM2)
        kt = (frame.loc[m, "measured_poa_wm2"] / feats.loc[m, "cs_poa"]).clip(*KT_CLIP)
        w = feats.loc[m, "cs_poa"] ** 2
        self.weather_ = lgb.LGBMRegressor(**LGB_PARAMS).fit(feats.loc[m, LGB_FEATURES], kt, sample_weight=w / w.mean())

        p = mask_ok & mask_poa & (feats["cs_poa"] > C.DAYLIGHT_POA_WM2)
        plant_x = feats.loc[p].assign(poa=frame.loc[p, "measured_poa_wm2"])[PLANT_FEATURES]
        self.plant_ = lgb.LGBMRegressor(**LGB_PARAMS).fit(plant_x, frame.loc[p, "ac_clean"])
        return self

    def predict_poa(self, feats):
        kt = np.clip(self.weather_.predict(feats[LGB_FEATURES]), *KT_CLIP)
        return kt * feats["cs_poa"].to_numpy()

    def predict(self, frame, feats):
        plant_x = feats.assign(poa=self.predict_poa(feats))[PLANT_FEATURES]
        return _finish(self.plant_.predict(plant_x), feats)


class Blend:
    """M3 (final): equal-weight average of M1 (learned) and B1 (physics).

    In the monsoon regime every model is limited by cloud-forecast error (~5% of capacity
    MAE) and B1/M1 make partly independent mistakes. Physics extrapolates safely into the
    test period, which is cloudier than any month in training; M1 corrects plant-specific
    effects (low-sun shading, temperature) that textbook physics misses. Weights are fixed
    at 0.5 rather than tuned, to avoid overfitting five validation months.
    """

    name = "M3 final blend (M1 + B1)"

    def __init__(self):
        self.m1 = LGBMClearSkyIndex()
        self.b1 = PhysicsCloud()

    def fit(self, frame, feats, mask):
        self.m1.fit(frame, feats, mask)
        return self

    def predict(self, frame, feats):
        return 0.5 * self.m1.predict(frame, feats) + 0.5 * self.b1.predict(frame, feats)
