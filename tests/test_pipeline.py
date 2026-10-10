"""Unit tests for the parsing/cleaning rules and the submission contract."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from pipeline import config as C
from pipeline.clean import fix_mw_logging, flag_ac_flatline, flag_stuck_poa
from pipeline.load import _null_sentinels, load_raw, parse_timestamps
from pipeline.predict import validate_submission
from pipeline.solar import ac_from_poa, solar_features


def test_parse_timestamps_handles_both_formats_without_month_day_swap():
    raw = pd.Series(["2024-03-12 09:00:00", "12-03-2024 09:00"])
    parsed = parse_timestamps(raw)
    assert (parsed == pd.Timestamp("2024-03-12 09:00")).all()


def test_parse_timestamps_rejects_garbage():
    with pytest.raises(ValueError):
        parse_timestamps(pd.Series(["yesterday"]))


def test_sentinels_are_exact_matches_only():
    df = pd.DataFrame({"ac_power_kw": [-999.0, 9999.0, 9999.5, 10000.0, 5.0]})
    out, counts = _null_sentinels(df, ["ac_power_kw"])
    assert counts["ac_power_kw"] == 2
    assert out["ac_power_kw"].isna().tolist() == [True, True, False, False, False]
    assert df["ac_power_kw"].notna().all(), "input must not be mutated"


def _hourly(values: dict, start="2024-07-14 06:00") -> pd.DataFrame:
    n = len(next(iter(values.values())))
    return pd.DataFrame(values, index=pd.date_range(start, periods=n, freq="h"))


def test_mw_logging_day_is_rescaled_but_outage_is_not():
    poa = [300.0, 500.0, 700.0, 600.0]
    mw_day = _hourly({"measured_poa_wm2": poa, "ac_power_kw": [3.1, 5.2, 7.3, 6.2]})
    outage = _hourly({"measured_poa_wm2": poa, "ac_power_kw": [0.0, 0.0, -4.0, 0.0]}, start="2024-08-12 06:00")
    out, fixed = fix_mw_logging(pd.concat([mw_day, outage]))
    assert fixed.sum() == 4
    assert out["ac_power_kw"].iloc[:4].tolist() == [3100.0, 5200.0, 7300.0, 6200.0]
    assert out["ac_power_kw"].iloc[4:].tolist() == [0.0, 0.0, -4.0, 0.0]


def test_flatline_keeps_first_value_and_flags_held_copies():
    df = _hourly({"ac_power_kw": [1500.0, 2187.44, 2187.44, 2187.44, 3000.0]})
    assert flag_ac_flatline(df).tolist() == [False, False, True, True, False]


def test_stuck_poa_needs_three_identical_positive_readings():
    df = _hourly({"measured_poa_wm2": [412.6, 412.6, 412.6, 0.0, 0.0, 0.0, 300.0]})
    assert flag_stuck_poa(df).tolist() == [True, True, True, False, False, False, False]


def test_ac_model_clips_at_inverter_rating_and_is_zero_in_dark():
    ac = ac_from_poa(np.array([0.0, 1200.0]), np.array([25.0, 25.0]), np.array([2.0, 2.0]), derate=1.0)
    assert ac[0] == 0
    assert ac[1] == C.AC_CAPACITY_KW


def test_solar_geometry_peaks_near_local_noon():
    idx = pd.date_range("2024-03-20", periods=24, freq="h")
    sol = solar_features(idx)
    assert sol["cs_poa"].idxmax().hour in (11, 12)
    assert sol.loc[sol.index.hour == 0, "cs_poa"].iloc[0] == 0


def test_test_file_loads_with_expected_rows():
    df, report = load_raw(C.TEST_CSV, has_target=False)
    assert len(df) == 1488
    assert report["sentinels"]["forecast_temp_c"] > 0  # -999s exist in test too


def _valid_submission() -> pd.DataFrame:
    ts = pd.read_csv(C.TEST_CSV, usecols=["timestamp"], dtype=str)["timestamp"]
    return pd.DataFrame({"timestamp": ts, "predicted_ac_power_kw": 1000.0})


def test_submission_contract_accepts_valid_frame():
    validate_submission(_valid_submission())


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.iloc[:-1],
        lambda d: d.assign(predicted_ac_power_kw=-1.0),
        lambda d: d.assign(predicted_ac_power_kw=np.nan),
        lambda d: d.rename(columns={"predicted_ac_power_kw": "pred"}),
    ],
)
def test_submission_contract_rejects_bad_frames(mutate):
    with pytest.raises(AssertionError):
        validate_submission(mutate(_valid_submission()))


def test_written_predictions_satisfy_contract():
    if not C.PREDICTIONS_CSV.exists():
        pytest.skip("run run_all.py first")
    validate_submission(pd.read_csv(C.PREDICTIONS_CSV, dtype={"timestamp": str}))


def test_fold_qc_derate_is_fitted_without_test_rows(monkeypatch):
    """The QC derate deciding which hours are 'clean' must never see the test window."""
    import pipeline.evaluate as E

    prep = E.prepare_train()
    idx = prep.base.index
    test = pd.Series((idx >= C.VALID_START) & (idx < C.VALID_END), index=idx)
    seen = []

    class Stop(Exception):
        pass

    def spy(df, usable):
        seen.append(usable.copy())
        raise Stop

    monkeypatch.setattr(E, "fit_derate", spy)
    with pytest.raises(Stop):
        E.run_fold(prep, ~test, test)
    assert not (seen[0] & test).any()


def test_complete_days_excludes_partially_scored_days():
    from pipeline.evaluate import complete_days

    idx = pd.date_range("2024-07-01 06:00", periods=4, freq="h").append(pd.date_range("2024-07-02 06:00", periods=4, freq="h"))
    daylight = pd.Series(True, index=idx)
    scored = pd.Series([True] * 4 + [True, False, True, True], index=idx)
    assert list(complete_days(scored, daylight)) == [pd.Timestamp("2024-07-01")]
