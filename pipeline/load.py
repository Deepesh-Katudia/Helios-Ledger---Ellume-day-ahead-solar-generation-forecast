"""Read the raw CSVs into a tidy, hourly, time-indexed frame.

Handles everything that is a *format* problem (timestamps, NA spellings, sentinels,
duplicates, gaps). Anything that is a *physics* problem lives in clean.py.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config as C


def parse_timestamps(raw: pd.Series) -> pd.Series:
    """Parse the two timestamp spellings found in the historian export.

    Explicit formats only: `DD-MM-YYYY` must never be guessed as `MM-DD-YYYY`.
    """
    parsed = pd.Series(pd.NaT, index=raw.index, dtype="datetime64[ns]")
    for fmt in C.TIMESTAMP_FORMATS:
        attempt = pd.to_datetime(raw.str.strip(), format=fmt, errors="coerce")
        parsed = parsed.fillna(attempt)
    unparsed = parsed.isna()
    if unparsed.any():
        raise ValueError(f"Unparseable timestamps: {raw[unparsed].head().tolist()}")
    return parsed


def _null_sentinels(df: pd.DataFrame, cols: list[str]) -> tuple[pd.DataFrame, dict]:
    """Replace -999 / 9999 sentinels with NaN. Returns new frame and per-column counts."""
    out = df.copy()
    counts = {}
    for col in cols:
        # Exact matches only: 9,999.x kW is a genuine reading at the inverter clip.
        bad = out[col].isin([C.SENTINEL_LOW, C.SENTINEL_HIGH])
        counts[col] = int(bad.sum())
        out.loc[bad, col] = np.nan
    return out, counts


def _dedupe(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Collapse duplicate timestamps.

    Exact duplicates are dropped. Duplicates whose target disagrees cannot be resolved,
    so the hour is kept (forecast inputs agree) but its target is marked unreliable.
    """
    dup_mask = df.index.duplicated(keep=False)
    groups = df[dup_mask].groupby(level=0)
    conflicting = [ts for ts, g in groups if g[C.TARGET].nunique(dropna=True) > 1] if C.TARGET in df else []
    out = df[~df.index.duplicated(keep="first")].copy()
    if C.TARGET in out:
        out["dup_conflict"] = out.index.isin(conflicting)
    stats = {"duplicate_rows_removed": int(dup_mask.sum() - groups.ngroups), "conflicting_duplicates": len(conflicting)}
    return out, stats


def load_raw(path, has_target: bool) -> tuple[pd.DataFrame, dict]:
    """Load one file. Returns (frame indexed by hour-beginning timestamp, report dict)."""
    df = pd.read_csv(path, na_values=C.NA_STRINGS, keep_default_na=False, dtype={"timestamp": str})
    report = {"rows_raw": len(df)}
    is_iso = df["timestamp"].str.match(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$")
    report["non_iso_timestamps"] = int((~is_iso).sum())
    df.index = parse_timestamps(df.pop("timestamp"))
    df.index.name = "timestamp"
    report["was_sorted"] = bool(df.index.is_monotonic_increasing)
    df = df.sort_index(kind="stable")

    numeric = [c for c in C.FORECAST_COLS + C.MEASURED_COLS if c in df]
    report["missing_values"] = {c: int(df[c].isna().sum()) for c in numeric}
    df, report["sentinels"] = _null_sentinels(df, numeric)
    df, report["forecast_out_of_bounds"] = _null_out_of_bounds(df)

    if has_target:
        df["status"] = df["status"].str.strip().str.upper().replace("", np.nan)
        report["status_counts"] = df["status"].fillna("BLANK").value_counts().to_dict()
        df, dup = _dedupe(df)
        report.update(dup)
        full = pd.date_range(df.index.min(), df.index.max(), freq="h", name="timestamp")
        present = df.index
        report["missing_hours"] = int(len(full.difference(present)))
        df = df.reindex(full)
        df["dup_conflict"] = df["dup_conflict"].astype("boolean").fillna(False).astype(bool)
        df["row_missing"] = ~full.isin(present)
    report["rows_clean_grid"] = len(df)
    return df, report


def _null_out_of_bounds(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    out = df.copy()
    counts = {}
    for col, (lo, hi) in C.FORECAST_BOUNDS.items():
        bad = (out[col] < lo) | (out[col] > hi)
        counts[col] = int(bad.sum())
        out.loc[bad, col] = np.nan
    return out, counts


def impute_forecast(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Fill gaps in forecast inputs by time interpolation (short gaps, smooth fields).

    Applied identically to train and test, because test.csv also has blanks and -999s.
    """
    out = df.copy()
    filled = {}
    for col in C.FORECAST_COLS:
        n = int(out[col].isna().sum())
        out[col] = out[col].interpolate(method="time", limit_direction="both")
        filled[col] = n
    return out, filled
