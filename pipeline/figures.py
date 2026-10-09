"""Static PNG figures referenced by APPROACH.md."""
from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from . import config as C
from .evaluate import Prepared
from .export import FINAL
from .predict import Forecast

SUN = "#f59e0b"
INK = "#1f2937"
SKY = "#3b82f6"
GREY = "#9ca3af"


def _save(fig, name: str) -> None:
    C.FIG_DIR.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(C.FIG_DIR / name, dpi=130)
    plt.close(fig)


def fig_mw_logging(prep: Prepared) -> None:
    w = prep.frame.loc["2024-07-10":"2024-07-17 23:00"]
    fig, ax = plt.subplots(2, 1, figsize=(10, 5), sharex=True)
    ax[0].plot(w.index, w["ac_raw"], color=GREY, label="raw ac_power_kw")
    ax[0].set_ylabel("raw value"); ax[0].legend(); ax[0].set_title("SCADA switched to MW on 14 Jul 2024: raw vs. rescaled")
    ax[1].plot(w.index, w["ac_power_kw"], color=SUN, label="after x1000 fix")
    ax[1].set_ylabel("kW"); ax[1].legend()
    _save(fig, "01_mw_logging.png")


def fig_flags(prep: Prepared) -> None:
    flags = prep.report["clean"]["flags"]
    fig, ax = plt.subplots(figsize=(8, 3.5))
    names = list(flags)
    ax.barh([n.replace("flag_", "") for n in names], [flags[n] for n in names], color=SUN)
    ax.set_xlabel("hours flagged"); ax.set_title("Quality flags raised on the training record")
    _save(fig, "02_quality_flags.png")


def fig_lomo(lomo: pd.DataFrame) -> None:
    if lomo.empty:
        return
    piv = lomo.pivot(index="month", columns="model", values="mae_kw")
    fig, ax = plt.subplots(figsize=(11, 4.5))
    for col in piv.columns:
        if col.startswith("Ref"):
            continue
        ax.plot(piv.index, piv[col], marker="o", lw=2.5 if col == FINAL else 1.2, label=col)
    ax.axvspan("2024-06", "2024-09", color=SKY, alpha=0.08)
    ax.set_ylabel("daylight MAE (kW)"); ax.set_title("Leave-one-month-out error by month (shaded: 2024 monsoon)")
    ax.tick_params(axis="x", rotation=60); ax.legend(fontsize=8)
    _save(fig, "03_lomo_by_month.png")


def fig_validation_week(prep: Prepared, seasonal: tuple) -> None:
    _, preds = seasonal
    w = preds.loc["2024-07-20":"2024-07-27 23:00"]
    actual = prep.frame.loc[w.index, "ac_clean"]
    fig, ax = plt.subplots(figsize=(11, 4))
    ax.plot(w.index, actual, color=INK, lw=2, label="actual (clean)")
    ax.plot(w.index, w[FINAL], color=SUN, lw=2, label=FINAL)
    ax.plot(w.index, w["B0 seasonal climatology"], color=GREY, ls="--", label="B0 climatology")
    ax2 = ax.twinx(); ax2.fill_between(w.index, prep.frame.loc[w.index, "forecast_cloud_cover"], color=SKY, alpha=0.12)
    ax2.set_ylim(0, 1); ax2.set_ylabel("forecast cloud")
    ax.set_ylabel("kW"); ax.legend(loc="upper left", fontsize=8); ax.set_title("A validation week in the 2024 monsoon")
    _save(fig, "04_validation_week.png")


def fig_worst_day(prep: Prepared, seasonal: tuple) -> None:
    _, preds = seasonal
    f = prep.frame
    sc = preds.index[f.loc[preds.index, "train_ok"]]
    err = (preds.loc[sc, FINAL] - f.loc[sc, "ac_clean"]).abs().groupby(sc.normalize()).sum()
    day = err.idxmax().strftime("%Y-%m-%d")
    w = preds.loc[day]
    fig, ax = plt.subplots(figsize=(9, 4))
    ax.plot(w.index.hour, f.loc[w.index, "ac_clean"], color=INK, lw=2, marker="o", label="actual")
    ax.plot(w.index.hour, w[FINAL], color=SUN, lw=2, marker="o", label="forecast")
    ax.plot(w.index.hour, f.loc[w.index, "measured_poa_wm2"] * 10, color=SKY, ls=":", label="measured POA x10")
    ax2 = ax.twinx(); ax2.bar(w.index.hour, f.loc[w.index, "forecast_cloud_cover"], color=GREY, alpha=0.25); ax2.set_ylim(0, 1); ax2.set_ylabel("forecast cloud")
    ax.set_xlabel("hour (IST)"); ax.set_ylabel("kW"); ax.legend(loc="upper left", fontsize=8)
    ax.set_title(f"Worst validation day: {day}")
    _save(fig, "05_worst_day.png")


def fig_test(fc: Forecast) -> None:
    p = fc.predictions.assign(t=pd.to_datetime(fc.predictions["timestamp"]))
    daily = p.groupby(p["t"].dt.normalize())[["predicted_ac_power_kw", "clearsky_ac_kw"]].sum() / 1000
    fig, ax = plt.subplots(figsize=(11, 4))
    ax.bar(daily.index, daily["clearsky_ac_kw"], color=GREY, alpha=0.3, label="clear-sky ceiling")
    ax.bar(daily.index, daily["predicted_ac_power_kw"], color=SUN, label="forecast")
    ax.set_ylabel("MWh / day"); ax.legend(); ax.set_title("Test period forecast: daily energy, Jul–Aug 2025")
    _save(fig, "06_test_daily_energy.png")


def make_figures(prep: Prepared, seasonal: tuple, lomo: pd.DataFrame, fc: Forecast) -> None:
    fig_mw_logging(prep)
    fig_flags(prep)
    fig_lomo(lomo)
    fig_validation_week(prep, seasonal)
    fig_worst_day(prep, seasonal)
    fig_test(fc)
