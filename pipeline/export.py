"""Export every number and series the approach note and the website show.

The site reads only these JSON files, so what you see there is exactly what the
pipeline computed.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from . import config as C
from .evaluate import Prepared, eval_mask, fit_physics
from .features import build_features
from .models import LGB_FEATURES
from .predict import Forecast
from .solar import ac_from_poa

FINAL = "M3 final blend (M1 + B1)"
WORST_DAYS = 3


def _dump(name: str, obj) -> None:
    C.WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    C.OUT_DIR.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, indent=1, default=_json_default, allow_nan=False)
    (C.WEB_DATA_DIR / f"{name}.json").write_text(text)
    (C.OUT_DIR / f"{name}.json").write_text(text)


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, (pd.Timestamp,)):
        return o.strftime("%Y-%m-%d %H:%M")
    raise TypeError(type(o))


def _num(v, nd=1):
    return None if v is None or (isinstance(v, float) and np.isnan(v)) else round(float(v), nd)


def export_data_quality(prep: Prepared) -> None:
    f = prep.frame

    def window(a, b, cols):
        w = f.loc[a:b, cols]
        return [{"t": ts.strftime("%Y-%m-%d %H:%M"), **{c: _num(w.at[ts, c]) for c in cols}} for ts in w.index]

    examples = {
        "mw_logging": {
            "title": "SCADA logged MW instead of kW for 26 days",
            "series": window("2024-07-11", "2024-07-16 23:00", ["ac_raw", "ac_power_kw", "measured_poa_wm2"]),
        },
        "stuck_poa": {
            "title": "Pyranometer frozen at 412.6 W/m² (power still valid)",
            "series": window("2024-08-24", "2024-08-28 23:00", ["ac_raw", "measured_poa_wm2"]),
        },
        "ac_flatline": {
            "title": "AC meter held at 2,187.44 kW for ~40 hours",
            "series": window("2024-09-17", "2024-09-20 23:00", ["ac_raw", "measured_poa_wm2"]),
        },
        "outage": {
            "title": "Five-day STOP outage under full sun",
            "series": window("2024-08-11", "2024-08-17 23:00", ["ac_raw", "measured_poa_wm2"]),
        },
    }
    spikes = f.loc[f["flag_spike"], ["ac_raw", "measured_poa_wm2"]]
    examples["spikes"] = {
        "title": "Meter spikes above the 10 MW inverter limit",
        "points": [{"t": t.strftime("%Y-%m-%d %H:%M"), "ac_raw": _num(r.ac_raw), "poa": _num(r.measured_poa_wm2)} for t, r in spikes.iterrows()],
    }
    _dump("data_quality", {**prep.report, "examples": examples})


def export_physics_diagnostics(prep: Prepared) -> None:
    """Residual of textbook PVWatts vs actual, given *measured* POA: what physics misses."""
    f, s = prep.frame, prep.solar
    _, derate = fit_physics(f, s, pd.Series(True, index=f.index))
    m = f["train_ok"] & f["measured_poa_wm2"].between(20, C.POA_MAX_WM2)
    x = f[m]
    oracle = ac_from_poa(x["measured_poa_wm2"].to_numpy(), x["measured_ambient_temp_c"].fillna(x["forecast_temp_c"]).to_numpy(), x["forecast_wind_ms"].to_numpy(), derate)
    resid = x["ac_clean"] - oracle
    by_hour = resid.groupby(x.index.hour).mean()
    by_month = resid.groupby(x.index.to_period("M")).mean()
    rain = f["rainfall_mm"].groupby(f.index.to_period("M")).sum()
    _dump(
        "physics_diagnostics",
        {
            "derate": round(derate, 4),
            "by_hour": [{"hour": int(h), "resid_kw": _num(v)} for h, v in by_hour.items()],
            "by_month": [{"month": str(mo), "resid_kw": _num(v), "rain_mm": _num(rain.get(mo, 0))} for mo, v in by_month.items()],
        },
    )


def export_validation(prep: Prepared, seasonal: tuple, forward: tuple, lomo: pd.DataFrame) -> dict:
    f, s = prep.frame, prep.solar
    res, preds = seasonal
    scored = eval_mask(f, s).reindex(preds.index)
    series = []
    for ts in preds.index:
        row = {"t": ts.strftime("%Y-%m-%d %H:%M"), "actual": _num(f.at[ts, "ac_clean"]), "scored": bool(scored[ts]), "cloud": _num(f.at[ts, "forecast_cloud_cover"], 3), "poa": _num(f.at[ts, "measured_poa_wm2"])}
        row.update({name: _num(preds.at[ts, name]) for name in preds.columns})
        series.append(row)

    # Worst days for the final model, by absolute daily energy error on scored hours.
    sc = preds[scored]
    err = (sc[FINAL] - f.loc[sc.index, "ac_clean"]).abs()
    daily_err = err.groupby(sc.index.normalize()).sum() / 1000
    worst = []
    for day in daily_err.sort_values(ascending=False).index[:WORST_DAYS]:
        d = day.strftime("%Y-%m-%d")
        lit = sc.index[sc.index.normalize() == day]
        kt = (f.loc[lit, "measured_poa_wm2"] / s.loc[lit, "cs_poa"]).clip(0, 1.3)
        worst.append(
            {
                "date": d,
                "abs_energy_error_mwh": _num(daily_err[day], 2),
                "actual_mwh": _num(f.loc[lit, "ac_clean"].sum() / 1000, 2),
                "pred_mwh": _num(sc.loc[lit, FINAL].sum() / 1000, 2),
                "forecast_cloud_mean": _num(f.loc[lit, "forecast_cloud_cover"].mean(), 3),
                "realised_clear_sky_index": _num(kt.mean(), 3),
                "rain_mm": _num(f.loc[d, "rainfall_mm"].sum()),
            }
        )
    leaderboard = {
        "seasonal_holdout": {"label": "Hold-out Jul–Aug 2024 (seasonal twin of test)", "results": res},
        "forward_holdout": {"label": "Train 2024 → forecast Jan–Jun 2025", "results": forward[0]},
        "lomo_mean": {
            "label": "Leave-one-month-out (18 folds), mean",
            "results": {} if lomo.empty else lomo.groupby("model")[["mae_kw", "rmse_kw", "nmae_pct", "bias_kw", "daily_energy_mae_mwh"]].mean().to_dict("index"),
        },
        "lomo_by_month": lomo.to_dict("records"),
    }
    _dump("leaderboard", leaderboard)
    _dump("validation_series", {"models": list(preds.columns), "final": FINAL, "series": series, "worst_days": worst})
    return leaderboard


def export_test(fc: Forecast) -> None:
    p = fc.predictions
    _dump(
        "test_predictions",
        {
            "cloud_params": {"a": round(fc.cloud_params[0], 4), "b": round(fc.cloud_params[1], 4)},
            "derate": round(fc.derate, 4),
            "series": [
                {"t": r.timestamp[:16], "pred": r.predicted_ac_power_kw, "m1": r.m1_kw, "b1": r.b1_kw, "clearsky": r.clearsky_ac_kw, "cloud": r.forecast_cloud_cover}
                for r in p.itertuples()
            ],
            "report": fc.report,
        },
    )


def export_feature_importance(fc: Forecast) -> None:
    booster = fc.model.m1.model_.booster_
    gain = booster.feature_importance(importance_type="gain")
    total = gain.sum()
    items = sorted(({"feature": f, "gain_pct": round(float(g / total * 100), 2)} for f, g in zip(LGB_FEATURES, gain)), key=lambda d: -d["gain_pct"])
    _dump("feature_importance", items)


def export_summary(leaderboard: dict, fc: Forecast, prep: Prepared) -> None:
    sh = leaderboard["seasonal_holdout"]["results"]
    lomo = leaderboard["lomo_mean"]["results"]
    final, b0 = sh[FINAL], sh["B0 seasonal climatology"]
    p = fc.predictions
    _dump(
        "summary",
        {
            "final_model": FINAL,
            "seasonal_holdout": final,
            "skill_vs_climatology_rmse": round(1 - final["rmse_kw"] / b0["rmse_kw"], 3),
            "lomo_final_mae_kw": round(lomo[FINAL]["mae_kw"], 1) if FINAL in lomo else None,
            "test_total_mwh": round(float(p["predicted_ac_power_kw"].sum()) / 1000, 1),
            "test_days": int(len(p) / 24),
            "test_mean_daylight_cloud": round(float(p.loc[p["clearsky_ac_kw"] > 0, "forecast_cloud_cover"].mean()), 3),
            "rows_flagged_unusable": int((~prep.frame["train_ok"]).sum()),
            "rows_total": int(len(prep.frame)),
        },
    )
