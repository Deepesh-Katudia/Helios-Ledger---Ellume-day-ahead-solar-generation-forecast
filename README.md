# Helios Ledger

Day-ahead hourly generation forecast for a 10 MW solar PV plant in Tumakuru, Karnataka. This is the Ellume AI Engineer take-home.

- **`outputs/predictions.csv`**: the submission. 1,488 rows of `timestamp,predicted_ac_power_kw`.
- **[`APPROACH.md`](APPROACH.md)**: the approach note. It covers the reasoning, validation, benchmarks, weaknesses and next steps.
- **`pipeline/`**: the code that reproduces the predictions.
- **`web/`**: a Next.js site that presents the work interactively (data forensics, leaderboard, forecast explorer, failure cases).

## Reproduce the predictions

Requires Python 3.12.

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows   (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
python run_all.py               # ~20 s; writes outputs/predictions.csv, outputs/*.json, outputs/figures/*.png
pytest                          # 17 tests
```

The run is deterministic. `outputs/predictions.csv` should hash to md5 `30289ea36df116466e3999ffee9394fb`.

`python run_all.py --fast` skips the 18-fold leave-one-month-out cross-validation.

## Run the site

Requires Node 20+.

```bash
cd web
npm install
npm run dev                     # http://localhost:3000
```

The site reads only the JSON that `run_all.py` writes to `web/public/data/`. It has no backend and no database, so every number on it comes from the pipeline.

## Layout

```
ellume_forecast_task/   task files, untouched (PROBLEM.md, DATASET.md, data/)
pipeline/
  config.py             every constant and threshold
  load.py               parsing: 2 timestamp formats, duplicates, gaps, sentinels
  clean.py              physics-aware QC: MW→kW fix, outages, frozen meters, spikes, PR check
  solar.py              pvlib geometry, clear-sky, PVWatts chain
  features.py           forecast-time features only (no leakage)
  models.py             persistence, climatology, physics, LightGBM, two-stage, final blend
  evaluate.py           metrics + seasonal / forward / leave-one-month-out validation
  predict.py            final fit, submission contract checks
  export.py, figures.py JSON for the site, PNGs for the note
run_all.py              one command, end to end
tests/                  unit tests
outputs/                predictions.csv, metrics JSON, figures
web/                    Next.js 16 + Tailwind 4 + Recharts
```

## Results at a glance

These are daylight scores on the Jul–Aug 2024 hold-out, the seasonal twin of the test, on **available-plant** hours (the plant running and metering correctly).

| Model | MAE kW | RMSE kW | nMAE |
|---|---|---|---|
| Yesterday persistence | 1002 | 1501 | 10.0 % |
| Seasonal climatology | 1070 | 1676 | 10.7 % |
| Physics (clear-sky × cloud → PVWatts) | 492 | 652 | 4.9 % |
| LightGBM (clear-sky index) | 519 | 700 | 5.2 % |
| **Final: ½ physics + ½ LightGBM** | **495** | **660** | **4.9 %** |

**The submission forecasts an available plant.** Scored against actual exports including the 12–16 Aug 2024 outage, the final model's MAE is 840 kW, with a +228 kW over-forecast bias. A weather forecast can't see a breaker trip; APPROACH.md §7.3 discusses this.

APPROACH.md §5–6 explains why the final model is a blend, and why LightGBM alone wins in the dry season but not in the monsoon.

## Walkthrough outline (for the recording)

1. **Problem (1 min).** The day-ahead nomination. The inputs are forecasts only, and the geometry is free.
2. **Data forensics (3 min).** Site §02. Cover the MW-logging episode and why those days are fixed rather than dropped, the outage policy ("forecast for an available plant"), the frozen meter and the stuck pyranometer. Show `clean.py`.
3. **Physics (2 min).** Site §03. Clear-sky index framing, the shading and soiling residuals, `solar.py`.
4. **Validation and results (3 min).** Site §04. The three schemes, the two regimes, and the leave-one-month-out chart. Then the day-of-year mistake and how I corrected it.
5. **Failure case (2 min).** Site §05, 11 Aug 2024: forecast 91 % cloud, 77 % of clear-sky delivered, an 11.4 MWh under-forecast. The plant model was fine; the input forecast was wrong.
6. **Test forecast and next steps (1 min).** Site §06–07.
