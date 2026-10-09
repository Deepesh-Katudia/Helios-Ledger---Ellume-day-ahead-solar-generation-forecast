"""Reproduce everything: clean -> validate -> fit final model -> predictions.csv -> exports.

    python run_all.py            # full run incl. 18-fold leave-one-month-out (~2-4 min)
    python run_all.py --fast     # skip the 18-fold CV
"""
from __future__ import annotations

import argparse
import logging
import time

import pandas as pd

from pipeline import config as C
from pipeline.evaluate import forward_holdout, leave_one_month_out, prepare_train, seasonal_holdout
from pipeline.export import (
    export_data_quality,
    export_feature_importance,
    export_physics_diagnostics,
    export_summary,
    export_test,
    export_validation,
)
from pipeline.figures import make_figures
from pipeline.predict import forecast_test, write_submission

log = logging.getLogger("helios")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fast", action="store_true", help="skip leave-one-month-out CV")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("matplotlib").setLevel(logging.WARNING)
    t0 = time.time()

    prep = prepare_train()
    log.info("Cleaned training data: %d/%d rows usable", prep.report["clean"]["rows_train_ok"], len(prep.frame))

    seasonal = seasonal_holdout(prep)
    forward = forward_holdout(prep)
    lomo = pd.DataFrame(columns=["month", "model"]) if args.fast else leave_one_month_out(prep)
    log.info("Validation done")
    for name, m in seasonal[0].items():
        log.info("  Jul-Aug 2024 hold-out | %-45s MAE %6.1f kW  RMSE %6.1f kW", name, m["mae_kw"], m["rmse_kw"])

    fc = forecast_test(prep)
    write_submission(fc)
    log.info("Wrote %s", C.PREDICTIONS_CSV)

    export_data_quality(prep)
    export_physics_diagnostics(prep)
    leaderboard = export_validation(prep, seasonal, forward, lomo)
    export_test(fc)
    export_feature_importance(fc)
    export_summary(leaderboard, fc, prep)
    make_figures(prep, seasonal, lomo, fc)
    log.info("Exports + figures written. Total %.0fs", time.time() - t0)


if __name__ == "__main__":
    main()
