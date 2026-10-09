"""Feature construction from information available the afternoon before delivery.

Only forecast columns and deterministic solar geometry are allowed in here: anything
measured on site would be leakage, because it does not exist for tomorrow.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config as C
from .solar import ac_from_poa

CLOUD = "forecast_cloud_cover"


def _daily_daylight_stats(cloud: pd.Series, daylight: pd.Series) -> pd.DataFrame:
    day = cloud.index.normalize()
    lit = cloud.where(daylight)
    grouped = lit.groupby(day)
    stats = pd.DataFrame(
        {
            "cloud_day_mean": grouped.transform("mean"),
            "cloud_day_std": grouped.transform("std"),
            "cloud_day_max": grouped.transform("max"),
        },
        index=cloud.index,
    )
    return stats


def build_features(df: pd.DataFrame, solar: pd.DataFrame, cloud_params: tuple[float, float], derate: float) -> pd.DataFrame:
    """Return the model feature matrix (one row per hour)."""
    cloud = df[CLOUD]
    daylight = solar["cs_poa"] > C.DAYLIGHT_POA_WM2
    feats = pd.DataFrame(index=df.index)
    feats[C.FORECAST_COLS] = df[C.FORECAST_COLS]
    feats[["sun_elevation", "sun_azimuth", "aoi", "cs_ghi", "cs_poa"]] = solar[
        ["sun_elevation", "sun_azimuth", "aoi", "cs_ghi", "cs_poa"]
    ]
    # Cloud forecasts are noisy hour-to-hour; neighbouring hours and the day's character
    # (a uniformly grey monsoon day vs. a broken-cloud day) carry extra signal.
    feats["cloud_lag1"] = cloud.shift(1).fillna(cloud)
    feats["cloud_lead1"] = cloud.shift(-1).fillna(cloud)
    feats["cloud_roll3"] = cloud.rolling(3, center=True, min_periods=1).mean()
    feats = feats.join(_daily_daylight_stats(cloud, daylight))
    feats["humidity_x_cloud"] = df["forecast_humidity_pct"] / 100 * cloud
    feats["hour"] = df.index.hour
    doy = df.index.dayofyear
    feats["doy_sin"] = np.sin(2 * np.pi * doy / 365.25)
    feats["doy_cos"] = np.cos(2 * np.pi * doy / 365.25)

    a, b = cloud_params
    feats["poa_phys"] = solar["cs_poa"] * (1 - a * cloud.clip(0, 1) ** b)
    feats["ac_clearsky"] = ac_from_poa(solar["cs_poa"].to_numpy(), df["forecast_temp_c"].to_numpy(), df["forecast_wind_ms"].to_numpy(), derate)
    feats["ac_phys"] = ac_from_poa(feats["poa_phys"].to_numpy(), df["forecast_temp_c"].to_numpy(), df["forecast_wind_ms"].to_numpy(), derate)
    return feats


def fit_cloud_attenuation(cloud: pd.Series, kt_poa: pd.Series, weight: pd.Series) -> tuple[float, float]:
    """Fit Kasten-Czeplak-style  POA/POA_clear = 1 - a * cloud^b  by weighted least squares."""
    from scipy.optimize import curve_fit

    ok = cloud.notna() & kt_poa.notna() & weight.notna()
    (a, b), _ = curve_fit(
        lambda c, a, b: 1 - a * np.power(c, b),
        cloud[ok].to_numpy(),
        kt_poa[ok].to_numpy(),
        p0=(0.75, 3.4),
        sigma=1 / np.sqrt(weight[ok].to_numpy()),
        bounds=([0, 0.2], [1.0, 8.0]),
    )
    return float(a), float(b)
