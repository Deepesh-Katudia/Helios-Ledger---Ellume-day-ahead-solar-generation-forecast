"""Training-set preparation, metrics, and time-based validation schemes."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import config as C
from .clean import clean_train, fit_derate
from .features import build_features, fit_cloud_attenuation
from .load import impute_forecast, load_raw
from .models import Blend, LGBMClearSkyIndex, LGBMTwoStagePOA, PhysicsCloud, SeasonalClimatology, YesterdayPersistence
from .solar import solar_features


@dataclass(frozen=True)
class Prepared:
    frame: pd.DataFrame        # cleaned training frame
    solar: pd.DataFrame
    report: dict


def prepare_train() -> Prepared:
    raw, load_report = load_raw(C.TRAIN_CSV, has_target=True)
    raw, imputed = impute_forecast(raw)
    solar = solar_features(raw.index)
    frame, clean_report, _ = clean_train(raw, solar)
    return Prepared(frame, solar, {"load": load_report, "forecast_imputed": imputed, "clean": clean_report})


def poa_mask(frame: pd.DataFrame) -> pd.Series:
    """Rows usable for learning irradiance (plant availability irrelevant)."""
    return frame["measured_poa_wm2"].between(0, C.POA_MAX_WM2) & ~frame["row_missing"]


def fit_physics(frame: pd.DataFrame, solar: pd.DataFrame, mask: pd.Series) -> tuple[tuple[float, float], float]:
    """Fit the two physical constants (cloud attenuation, plant derate) on training rows only."""
    m = mask & poa_mask(frame) & (solar["cs_poa"] > 200)
    kt = (frame.loc[m, "measured_poa_wm2"] / solar.loc[m, "cs_poa"]).clip(0, 1.3)
    cloud_params = fit_cloud_attenuation(frame.loc[m, "forecast_cloud_cover"], kt, solar.loc[m, "cs_poa"])
    derate = fit_derate(frame, mask & frame["train_ok"])
    return cloud_params, derate


def eval_mask(frame: pd.DataFrame, solar: pd.DataFrame) -> pd.Series:
    """Score on clean, daylight hours: night is trivially zero and would flatter every model."""
    return frame["train_ok"] & (solar["cs_poa"] > C.DAYLIGHT_POA_WM2)


def metrics(y: np.ndarray, p: np.ndarray, index: pd.DatetimeIndex) -> dict:
    err = p - y
    daily = pd.DataFrame({"y": y, "p": p}, index=index).groupby(index.normalize()).sum() / 1000  # MWh
    return {
        "n_hours": int(len(y)),
        "mae_kw": float(np.mean(np.abs(err))),
        "rmse_kw": float(np.sqrt(np.mean(err**2))),
        "bias_kw": float(np.mean(err)),
        "nmae_pct": float(np.mean(np.abs(err)) / C.AC_CAPACITY_KW * 100),
        "nrmse_pct": float(np.sqrt(np.mean(err**2)) / C.AC_CAPACITY_KW * 100),
        "daily_energy_mae_mwh": float(np.mean(np.abs(daily.p - daily.y))),
    }


def make_models(derate: float) -> list:
    return [
        YesterdayPersistence(),
        SeasonalClimatology(),
        PhysicsCloud(),
        LGBMClearSkyIndex(),
        LGBMTwoStagePOA(),
        Blend(),
    ]


def run_fold(prep: Prepared, train_mask: pd.Series, test_mask: pd.Series) -> tuple[dict, pd.DataFrame]:
    """Fit every model on `train_mask` rows, predict `test_mask` rows.

    Physics constants are re-fitted inside the fold so nothing from the test window leaks.
    """
    frame, solar = prep.frame, prep.solar
    cloud_params, derate = fit_physics(frame, solar, train_mask)
    feats = build_features(frame, solar, cloud_params, derate)
    fit_ok = train_mask & frame["train_ok"]
    fit_poa = train_mask & poa_mask(frame)
    preds = pd.DataFrame(index=frame.index[test_mask])
    for model in make_models(derate):
        if isinstance(model, LGBMTwoStagePOA):
            model.fit(frame, feats, fit_poa, fit_ok)
        else:
            model.fit(frame, feats, fit_ok)
        preds[model.name] = model.predict(frame, feats.loc[test_mask])
    scored = eval_mask(frame, solar)[test_mask]
    y = frame.loc[test_mask, "ac_clean"][scored].to_numpy()
    results = {name: metrics(y, preds.loc[scored, name].to_numpy(), preds.index[scored]) for name in preds}
    return results, preds


def seasonal_holdout(prep: Prepared) -> tuple[dict, pd.DataFrame]:
    """Primary scheme: hold out Jul-Aug 2024, the seasonal twin of the Jul-Aug 2025 test."""
    idx = prep.frame.index
    test = (idx >= C.VALID_START) & (idx < C.VALID_END)
    return run_fold(prep, pd.Series(~test, index=idx), pd.Series(test, index=idx))


def forward_holdout(prep: Prepared) -> tuple[dict, pd.DataFrame]:
    """Strictly out-of-time: train on 2024 only, forecast H1 2025."""
    idx = prep.frame.index
    test = idx >= "2025-01-01"
    return run_fold(prep, pd.Series(~test, index=idx), pd.Series(test, index=idx))


def leave_one_month_out(prep: Prepared) -> pd.DataFrame:
    """Blocked CV by calendar month: shows how error varies with season/cloudiness."""
    idx = prep.frame.index
    rows = []
    for month in idx.to_period("M").unique():
        test = pd.Series(idx.to_period("M") == month, index=idx)
        res, _ = run_fold(prep, ~test, test)
        for model, m in res.items():
            rows.append({"month": str(month), "model": model, **m})
    return pd.DataFrame(rows)
