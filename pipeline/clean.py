"""Physics-aware quality control of the plant record.

Philosophy: we forecast what the plant exports *when it is available and metering
correctly*, because no weather forecast can predict a breaker trip. So rows that are not
"weather-driven normal operation" are excluded from the training target, never imputed.
The one exception is the MW-logging episode, which is a recoverable unit error and is fixed.

Each rule writes a boolean flag column so the decisions are auditable (and plotted on
the site).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config as C
from .solar import ac_from_poa

AVAILABILITY_LOSS_STATUSES = {"STOP", "PARTIAL"}


def _run_lengths(values: pd.Series) -> pd.Series:
    """Length of the run of identical consecutive values each element belongs to."""
    run_id = (values != values.shift()).cumsum()
    return values.groupby(run_id).transform("size")


def _position_in_run(values: pd.Series) -> pd.Series:
    run_id = (values != values.shift()).cumsum()
    return values.groupby(run_id).cumcount()


def fix_mw_logging(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    """Detect days where SCADA logged AC in MW instead of kW, and rescale x1000.

    A normal plant exports ~10 kW per W/m2 of POA; MW-logged days sit at ~0.01. We call a
    day MW-logged when several daylight hours show that 1000x deficit while still
    producing a small positive value (an outage would read 0 or negative instead).
    """
    out = df.copy()
    ratio = out[C.TARGET] / out["measured_poa_wm2"]
    suspect = (
        (out["measured_poa_wm2"] > C.DAYLIGHT_POA_WM2 * 2)
        & (out[C.TARGET] > 0)
        & (ratio < C.MW_RATIO_MAX)
    )
    day = out.index.normalize()
    mw_days = suspect.groupby(day).sum()
    mw_days = set(mw_days[mw_days >= C.MW_DAY_MIN_HOURS].index)
    # Within MW days, positive daytime values are MW; small night negatives are left alone
    # (they are clamped to zero later anyway).
    in_mw_day = pd.Series(day.isin(mw_days), index=out.index)
    fix = in_mw_day & (out[C.TARGET] > 0) & (out[C.TARGET] < C.AC_CAPACITY_KW / 1000 * 1.1)
    out.loc[fix, C.TARGET] = out.loc[fix, C.TARGET] * 1000
    return out, fix


def flag_stuck_poa(df: pd.DataFrame) -> pd.Series:
    """Pyranometer frozen at one value (e.g. 412.6 W/m2 for three days in Aug 2024)."""
    poa = df["measured_poa_wm2"]
    return (poa > 0) & (_run_lengths(poa.round(2)) >= C.FLATLINE_MIN_RUN)


def flag_ac_flatline(df: pd.DataFrame) -> pd.Series:
    """Daytime AC repeating an identical 2-dp value: historian 'last value hold'.

    The first value of the run is genuine; the held copies are not.
    """
    ac = df[C.TARGET].round(2)
    held = (ac > 100) & (_run_lengths(ac) >= 2) & (_position_in_run(ac) > 0)
    return held


def fit_derate(df: pd.DataFrame, usable: pd.Series) -> float:
    """Fit the lumped DC->AC derate from measured POA on clean, unclipped hours."""
    m = usable & df["measured_poa_wm2"].between(300, 1100) & (df[C.TARGET] < 0.95 * C.AC_CAPACITY_KW)
    no_derate = ac_from_poa(
        df.loc[m, "measured_poa_wm2"].to_numpy(),
        df.loc[m, "measured_ambient_temp_c"].fillna(df.loc[m, "forecast_temp_c"]).to_numpy(),
        df.loc[m, "forecast_wind_ms"].to_numpy(),
        derate=1.0,
    )
    return float(np.median(df.loc[m, C.TARGET].to_numpy() / no_derate))


def clean_train(df: pd.DataFrame, solar: pd.DataFrame) -> tuple[pd.DataFrame, dict, float]:
    """Return (frame with `ac_clean`, `train_ok` and flag columns, report, fitted derate)."""
    out = df.copy()
    out["ac_raw"] = out[C.TARGET]
    out, mw_fixed = fix_mw_logging(out)
    out["flag_mw_rescaled"] = mw_fixed

    out["flag_poa_stuck"] = flag_stuck_poa(out)
    out.loc[out["flag_poa_stuck"], "measured_poa_wm2"] = np.nan
    out.loc[out["measured_poa_wm2"] > C.POA_MAX_WM2, "measured_poa_wm2"] = np.nan

    out["flag_target_missing"] = out[C.TARGET].isna()
    out["flag_spike"] = out[C.TARGET] > C.AC_CAPACITY_KW * C.AC_SPIKE_TOLERANCE
    out["flag_ac_flatline"] = flag_ac_flatline(out)
    out["flag_dup_conflict"] = out["dup_conflict"]
    daylight = solar["cs_poa"] > C.DAYLIGHT_POA_WM2
    status = out["status"].fillna("BLANK")
    out["flag_outage_status"] = status.isin(AVAILABILITY_LOSS_STATUSES) | (
        (status == "STANDBY") & daylight & (out["measured_poa_wm2"] > C.PR_MIN_POA_WM2)
    )

    hard_flags = ["flag_target_missing", "flag_spike", "flag_ac_flatline", "flag_dup_conflict", "flag_outage_status"]
    pre_ok = ~out[hard_flags].any(axis=1)
    derate = fit_derate(out, pre_ok)

    expected = ac_from_poa(
        out["measured_poa_wm2"].to_numpy(),
        out["measured_ambient_temp_c"].fillna(out["forecast_temp_c"]).to_numpy(),
        out["forecast_wind_ms"].to_numpy(),
        derate,
    )
    pr = out[C.TARGET] / pd.Series(expected, index=out.index).replace(0, np.nan)
    checkable = out["measured_poa_wm2"] > C.PR_MIN_POA_WM2
    out["performance_ratio"] = pr.where(checkable)
    # Unflagged-by-status hours that still under/over-perform the physics model by a wide
    # margin: undeclared curtailment, string outages, or metering faults.
    out["flag_pr_anomaly"] = checkable & ~pr.between(C.PR_LOW, C.PR_HIGH)

    all_flags = hard_flags + ["flag_pr_anomaly"]
    out["train_ok"] = ~out[all_flags].any(axis=1) & ~out["row_missing"]
    out["ac_clean"] = out[C.TARGET].clip(lower=0, upper=C.AC_CAPACITY_KW)
    # Night: the plant draws a few kW of standby power; forecasting that is pointless noise.
    out.loc[~daylight & (solar["sun_elevation"] < 0), "ac_clean"] = 0.0
    out.loc[~out["train_ok"], "ac_clean"] = np.nan

    report = {
        "derate_fitted": round(derate, 4),
        "flags": {f: int(out[f].sum()) for f in all_flags + ["flag_mw_rescaled", "flag_poa_stuck"]},
        "mw_rescaled_days": sorted({str(d.date()) for d in out.index[mw_fixed].normalize()}),
        "rows_train_ok": int(out["train_ok"].sum()),
        "daylight_rows_train_ok": int((out["train_ok"] & daylight).sum()),
        "daylight_rows_total": int(daylight.sum()),
    }
    return out, report, derate
