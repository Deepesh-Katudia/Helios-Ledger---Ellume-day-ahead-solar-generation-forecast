"""Training-set preparation, metrics, and time-based validation schemes."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import config as C
from .clean import MEASUREMENT_FLAGS, apply_performance_check, clean_train, fit_derate
from .features import build_features, fit_cloud_attenuation
from .load import impute_forecast, load_raw
from .models import Blend, LGBMClearSkyIndex, LGBMTwoStagePOA, PhysicsCloud, SeasonalClimatology, YesterdayPersistence
from .solar import solar_features


@dataclass(frozen=True)
class Prepared:
    base: pd.DataFrame         # rule-flagged history (no fitted QC parameters)
    frame: pd.DataFrame        # fully cleaned with QC fitted on all history (final model, exports)
    solar: pd.DataFrame
    report: dict


@dataclass(frozen=True)
class FoldResult:
    results: dict              # per model: metrics vs. the available-plant (clean) target
    exports: dict              # per model: metrics vs. actual exports, outages included
    preds: pd.DataFrame        # test-window predictions, one column per model
    frame: pd.DataFrame        # the fold's cleaned frame (QC fitted on its training rows)


def prepare_train() -> Prepared:
    raw, load_report = load_raw(C.TRAIN_CSV, has_target=True)
    raw, imputed = impute_forecast(raw)
    solar = solar_features(raw.index)
    base, frame, clean_report, _ = clean_train(raw, solar)
    return Prepared(base, frame, solar, {"load": load_report, "forecast_imputed": imputed, "clean": clean_report})


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


def export_mask(frame: pd.DataFrame, solar: pd.DataFrame) -> pd.Series:
    """Daylight hours with a trustworthy *recorded export*, including outages and curtailment.

    Only data errors (missing, spikes, frozen meter, conflicting duplicates) are dropped.
    Scoring here shows what the available-plant forecast costs against real exports.
    """
    return (solar["cs_poa"] > C.DAYLIGHT_POA_WM2) & ~frame["row_missing"] & ~frame[MEASUREMENT_FLAGS].any(axis=1)


def complete_days(scored: pd.Series, daylight: pd.Series) -> pd.Index:
    """Days on which every daylight hour is scored: only these have a true daily energy."""
    lit = scored[daylight]
    full = lit.groupby(lit.index.normalize()).all()
    return full.index[full]


def metrics(y: np.ndarray, p: np.ndarray, index: pd.DatetimeIndex, full_days: pd.Index) -> dict:
    err = p - y
    hourly = pd.DataFrame({"y": y, "p": p}, index=index)
    daily = hourly.groupby(index.normalize()).sum() / 1000  # MWh
    daily = daily[daily.index.isin(full_days)]
    return {
        "n_hours": int(len(y)),
        "mae_kw": float(np.mean(np.abs(err))),
        "rmse_kw": float(np.sqrt(np.mean(err**2))),
        "bias_kw": float(np.mean(err)),
        "nmae_pct": float(np.mean(np.abs(err)) / C.AC_CAPACITY_KW * 100),
        "nrmse_pct": float(np.sqrt(np.mean(err**2)) / C.AC_CAPACITY_KW * 100),
        # Over complete days only; partial days would understate daily energy.
        "daily_energy_mae_mwh": float(np.mean(np.abs(daily.p - daily.y))) if len(daily) else None,
        "n_complete_days": int(len(daily)),
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


def run_fold(prep: Prepared, train_mask: pd.Series, test_mask: pd.Series) -> FoldResult:
    """Fit every model on `train_mask` rows, predict `test_mask` rows.

    Everything fitted is fitted inside the fold so nothing from the test window leaks:
    the QC derate that decides which hours are "clean", the cloud curve, the plant derate
    and the models themselves.
    """
    base, solar = prep.base, prep.solar
    qc_derate = fit_derate(base, train_mask & base["pre_ok"])
    frame = apply_performance_check(base, solar, qc_derate)
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
    daylight = (solar["cs_poa"] > C.DAYLIGHT_POA_WM2)[test_mask]

    scored = eval_mask(frame, solar)[test_mask]
    y = frame.loc[test_mask, "ac_clean"][scored].to_numpy()
    days = complete_days(scored, daylight)
    results = {name: metrics(y, preds.loc[scored, name].to_numpy(), preds.index[scored], days) for name in preds}

    exp = export_mask(frame, solar)[test_mask]
    y_exp = frame.loc[test_mask, C.TARGET].clip(0, C.AC_CAPACITY_KW)[exp].to_numpy()
    days_exp = complete_days(exp, daylight)
    exports = {name: metrics(y_exp, preds.loc[exp, name].to_numpy(), preds.index[exp], days_exp) for name in preds}
    return FoldResult(results, exports, preds, frame)


def seasonal_holdout(prep: Prepared) -> FoldResult:
    """Primary scheme: hold out Jul-Aug 2024, the seasonal twin of the Jul-Aug 2025 test."""
    idx = prep.frame.index
    test = (idx >= C.VALID_START) & (idx < C.VALID_END)
    return run_fold(prep, pd.Series(~test, index=idx), pd.Series(test, index=idx))


def forward_holdout(prep: Prepared) -> FoldResult:
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
        res = run_fold(prep, ~test, test).results
        for model, m in res.items():
            rows.append({"month": str(month), "model": model, **m})
    return pd.DataFrame(rows)
