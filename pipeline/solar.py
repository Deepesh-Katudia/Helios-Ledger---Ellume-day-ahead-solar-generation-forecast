"""Deterministic solar geometry and clear-sky physics (pvlib).

Everything here is known *exactly* for any future hour, so it is the backbone of the
forecast: the model only has to learn how far below clear-sky the weather pulls output.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pvlib

from . import config as C

_LOCATION = pvlib.location.Location(C.LATITUDE, C.LONGITUDE, C.TIMEZONE, C.ALTITUDE_M)


def hour_midpoints(index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    """Timestamps are hour-beginning means; evaluate geometry at the hour's midpoint."""
    return index.tz_localize(C.TIMEZONE) + pd.Timedelta(minutes=30)


def solar_features(index: pd.DatetimeIndex) -> pd.DataFrame:
    """Solar position, clear-sky irradiance and clear-sky plane-of-array for each hour."""
    times = hour_midpoints(index)
    pos = _LOCATION.get_solarposition(times)
    cs = _LOCATION.get_clearsky(times, model="ineichen")
    poa = pvlib.irradiance.get_total_irradiance(
        surface_tilt=C.TILT_DEG,
        surface_azimuth=C.AZIMUTH_DEG,
        solar_zenith=pos["apparent_zenith"],
        solar_azimuth=pos["azimuth"],
        dni=cs["dni"],
        ghi=cs["ghi"],
        dhi=cs["dhi"],
        albedo=C.ALBEDO,
    )
    aoi = pvlib.irradiance.aoi(C.TILT_DEG, C.AZIMUTH_DEG, pos["apparent_zenith"], pos["azimuth"])
    out = pd.DataFrame(
        {
            "sun_elevation": pos["apparent_elevation"].to_numpy(),
            "sun_azimuth": pos["azimuth"].to_numpy(),
            "aoi": aoi.to_numpy(),
            "cs_ghi": cs["ghi"].to_numpy(),
            "cs_poa": poa["poa_global"].fillna(0).clip(lower=0).to_numpy(),
        },
        index=index,
    )
    # pvlib evaluates the midpoint only; hours where the sun is up for part of the hour
    # but below the horizon at the midpoint still produce a little power. Keep them as is.
    return out


def cell_temperature(poa: np.ndarray, temp_air: np.ndarray, wind: np.ndarray) -> np.ndarray:
    """Faiman cell-temperature model (default open-rack-ish coefficients)."""
    return np.asarray(pvlib.temperature.faiman(poa, temp_air, wind))


def ac_from_poa(poa: np.ndarray, temp_air: np.ndarray, wind: np.ndarray, derate: float) -> np.ndarray:
    """PVWatts-style DC -> AC with temperature loss and inverter clipping.

    `derate` lumps soiling, wiring, mismatch and inverter efficiency; it is fitted on
    clean data rather than assumed.
    """
    poa = np.clip(np.nan_to_num(poa), 0, None)
    t_cell = cell_temperature(poa, temp_air, wind)
    dc = C.DC_CAPACITY_KW * poa / 1000.0 * (1 + C.GAMMA_PDC * (t_cell - 25.0))
    return np.clip(dc * derate, 0, C.AC_CAPACITY_KW)
