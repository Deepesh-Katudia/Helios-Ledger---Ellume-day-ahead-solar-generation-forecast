"""Fit the final model on all clean history and forecast the test period."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import config as C
from .evaluate import Prepared, fit_physics
from .features import build_features
from .load import impute_forecast, load_raw
from .models import Blend, PhysicsCloud
from .solar import solar_features


@dataclass(frozen=True)
class Forecast:
    predictions: pd.DataFrame   # timestamp, predicted_ac_power_kw (+ components for the site)
    feats: pd.DataFrame
    model: Blend
    cloud_params: tuple[float, float]
    derate: float
    report: dict


def forecast_test(prep: Prepared) -> Forecast:
    frame, solar = prep.frame, prep.solar
    everything = pd.Series(True, index=frame.index)
    cloud_params, derate = fit_physics(frame, solar, everything)
    train_feats = build_features(frame, solar, cloud_params, derate)
    model = Blend().fit(frame, train_feats, frame["train_ok"])

    raw_test, test_report = load_raw(C.TEST_CSV, has_target=False)
    test, imputed = impute_forecast(raw_test)
    test_feats = build_features(test, solar_features(test.index), cloud_params, derate)
    pred = model.predict(test, test_feats)

    out = pd.DataFrame(
        {
            "timestamp": test.index.strftime("%Y-%m-%d %H:%M:%S"),
            "predicted_ac_power_kw": np.round(pred, 2),
            "m1_kw": np.round(model.m1.predict(test, test_feats), 2),
            "b1_kw": np.round(PhysicsCloud().predict(test, test_feats), 2),
            "clearsky_ac_kw": np.round(test_feats["ac_clearsky"].to_numpy(), 2),
            "forecast_cloud_cover": test["forecast_cloud_cover"].round(3).to_numpy(),
        }
    )
    report = {"test_load": test_report, "test_forecast_imputed": imputed}
    return Forecast(out, test_feats, model, cloud_params, derate, report)


def validate_submission(sub: pd.DataFrame) -> None:
    """Hard checks against the submission contract in PROBLEM.md."""
    expected = pd.read_csv(C.TEST_CSV, usecols=["timestamp"], dtype=str)["timestamp"]
    assert list(sub.columns) == ["timestamp", "predicted_ac_power_kw"], sub.columns
    assert len(sub) == len(expected) == 1488, len(sub)
    assert (sub["timestamp"].to_numpy() == expected.to_numpy()).all(), "timestamps differ from test.csv"
    assert sub["predicted_ac_power_kw"].notna().all(), "NaN predictions"
    assert sub["predicted_ac_power_kw"].between(0, C.AC_CAPACITY_KW).all(), "out of physical range"


def write_submission(fc: Forecast) -> pd.DataFrame:
    sub = fc.predictions[["timestamp", "predicted_ac_power_kw"]]
    validate_submission(sub)
    C.OUT_DIR.mkdir(parents=True, exist_ok=True)
    sub.to_csv(C.PREDICTIONS_CSV, index=False, lineterminator="\n")
    C.WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    sub.to_csv(C.WEB_DATA_DIR / "predictions.csv", index=False, lineterminator="\n")
    return sub
