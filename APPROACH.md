# Helios Ledger: approach note

**Task.** Turn a day-ahead weather forecast (cloud cover, temperature, wind, humidity) into an hourly AC-power forecast for a 10 MW AC / 12.5 MWp fixed-tilt PV plant in Tumakuru, for every hour of Jul–Aug 2025.

**Submission.** `outputs/predictions.csv`, produced by `python run_all.py` (about 20 s, deterministic; md5 `30289ea36df116466e3999ffee9394fb`).

**Headline.**
- On a hold-out of Jul–Aug 2024 (the same season one year earlier), the final model has a daylight MAE of **495 kW (4.9 % of capacity)**, an RMSE of 660 kW, and a daily-energy MAE of 4.9 MWh over the 46 days on which every daylight hour is scored.
- These are **available-plant** scores: hours when the plant was running and metering correctly. Against what the plant *actually exported*, including the 12–16 Aug outage, the same forecast scores 840 kW MAE with a +228 kW over-forecast bias (§7.3). The submission is an available-plant forecast; that distinction is deliberate and runs through this note.
- That is a **61 % RMSE improvement on seasonal climatology**.
- In the monsoon, the error is mostly inherited from the cloud forecast, not added by the model.

This note is in the order I actually worked: data, then physics, then benchmarks, then learning, then the decisions that changed along the way.

---

## 1. Reading the problem before the data

Three things in `PROBLEM.md` and `DATASET.md` shaped everything that followed.

1. **Only the forecast columns exist for tomorrow.** Every `measured_*` column, `rainfall_mm` and `status` is after-the-fact. They are useful for cleaning the target and fitting physical constants, but they can never be model inputs. Using them would be leakage that a random train/test split would happily reward.
2. **The geometry is free.** Latitude, longitude, tilt, azimuth, albedo and the temperature coefficient are given, so the sun's position and the clear-sky irradiance on the panel are known *exactly* for any future hour. Spending model capacity learning "it's dark at night and peaks at noon" is waste. The model should learn only **how far below the physical ceiling the weather pulls output**.
3. **The training file is "an unprocessed export… no cleaning or validation".** That is an invitation. I treated cleaning as the first modelling decision, not a chore.

The test period is Jul–Aug 2025, the south-west monsoon. Two consequences followed:
- Validation has to rehearse the monsoon, not the year on average.
- I checked the input distribution early. Mean daylight forecast cloud in the test is **0.80**, against 0.70 in Jul–Aug 2024 and 0.38 across the whole training set. The test is cloudier than anything the model has seen, so extrapolation behaviour matters.

## 2. Data forensics (`pipeline/load.py`, `pipeline/clean.py`)

I profiled every column before writing any model, and asked of each anomaly: *is this a formatting problem, a recoverable error, or a real event the weather can't explain?* Each rule writes a boolean flag column, so every decision is auditable. The flags are plotted on the site and in `outputs/figures/02_quality_flags.png`.

### Formatting problems (fixed in `load.py`)

| Finding | Count | Decision |
|---|---|---|
| Two timestamp formats (`YYYY-MM-DD HH:MM:SS` and `DD-MM-YYYY HH:MM`) | 389 rows | Parse each with an **explicit** format. Letting pandas infer would silently swap day and month for dates like `12-03-2024`. |
| Rows not in time order | n/a | Sorted |
| Duplicate timestamps | 36 extra rows, **12 with conflicting AC values** | Exact duplicates dropped. Conflicting ones keep their (identical) forecast but the target is marked unreliable: there's no principled way to choose between 6,043 and 5,667 kW. |
| Missing hours | 186 | Reindexed to a full hourly grid. Missing forecast values are time-interpolated; missing targets stay missing. |
| Missing values spelled `""`, `NA`, `null` | ~240 per measured column | Read as NaN |
| Sentinels `-999` and `9999` | 7 columns, including 14 in `forecast_wind_ms` | **Exact-match** replacement. My first version used `>= 9999`, which also deleted genuine readings of 9,999.x kW at the inverter clip and hid the real spikes. A test now pins this down. |
| `test.csv` is dirty too | 14 blanks, 5 `-999` temperatures | The same parsing and interpolation runs on test. A model that only works on clean input would fail silently here. |

### Physics problems (`clean.py`)

The key diagnostic was the ratio **AC kW per W/m² of measured plane-of-array irradiance**. For this plant it sits at about 10.5, and anything far from that needs explaining.

- **SCADA logged MW instead of kW for 26 days (14 Jul – 8 Aug 2024).** The ratio drops to 0.011, which is exactly 1000× low, while power still tracks irradiance perfectly. These are the most valuable days in the file because they are the seasonal twin of the test period. Throwing them away would gut the validation set, so they are **rescaled ×1000**. Detection is per day: ≥3 daylight hours with small *positive* power and a ratio < 0.1. An outage reads 0 or negative, so it can't be mistaken for an MW day. Validation later served as a check: one of the worst-forecast days (16 Jul) is inside this window, and its rescaled actuals line up with measured irradiance.
- **Outages and curtailment.** There are 269 hours of STOP, PARTIAL or daylight STANDBY, including a five-day STOP on 12–16 Aug 2024 under full sun. A weather forecast cannot predict a breaker trip, so these hours are **excluded from the target**, never imputed. The forecast is therefore explicitly *for an available plant*: it predicts what the plant would export if it runs normally, not what it will export if it trips. That's the right product for the weather part of a grid nomination, but actual exports will fall short of it whenever there's an outage. §5 scores it both ways and §7.3 quantifies the gap.
- **Frozen AC meter.** For about 40 hours (17–19 Sep 2024) the meter read exactly 2,187.44 kW, at night and at noon alike. The rule: identical two-decimal values in consecutive hours above 100 kW are a historian "last value hold". The first value is kept and the held copies are flagged (47 h).
- **Stuck pyranometer.** On 25–27 Aug 2024 the sensor read 412.6 W/m², including at midnight. This is what had looked like a timestamp shift (irradiance at hour 0) in my first profiling pass. Power was fine on those days, so only the sensor value is dropped.
- **Spikes.** Readings reach 26.9 MW on a 10 MW-AC plant. Values up to 2 % above the rating are kept as real clipping; above that, the hour is excluded (13 h).
- **Performance-ratio check.** After the explicit rules, I compare actual AC with a physics expectation from *measured* irradiance and flag hours outside 0.55–1.30 of it (124 h). This catches undeclared partial outages that the status column misses.
- **Night.** Small negative readings (around −10 kW) are inverter standby consumption. Training and scoring use 0 at night, and the forecast is 0 when the sun is below the horizon.

Net result: **847 of 13,128 hours** are unusable as targets, and 5,518 of 5,943 daylight hours are kept. Timestamp alignment was checked by comparing each week's irradiance-weighted centroid hour with the clear-sky centroid. The median offset is 0.004 h, so there is no clock or time-zone shift.

## 3. Physics backbone (`pipeline/solar.py`)

- `pvlib` solar position is evaluated at the **hour midpoint** (timestamps are hour-beginning means).
- Ineichen clear-sky irradiance at 680 m.
- Isotropic-sky transposition (pvlib default) to the 15° south-facing plane, with albedo 0.2.
- Faiman cell temperature, PVWatts DC with −0.35 %/°C, and a lumped derate **fitted** on clean unclipped hours (0.871) rather than assumed. The result is clipped at 10 MW AC.

Running this chain on *measured* irradiance (a perfect-weather oracle) gives a daylight MAE of **205 kW**. The residual is systematic and physically interpretable (`physics_diagnostics.json`, §03 of the site):

- **About −280 kW at 06–08 h and 16–18 h, and positive at noon.** That's low-sun loss: row-to-row shading and angle-of-incidence reflection, neither of which textbook PVWatts models.
- **About −220 kW in the dry months, rising to ~−250, and ≈0 from Jul to Sep.** The deficit builds through Oct–May and vanishes when the rains come. That is the signature of **soiling** washed off by the monsoon. Good news for a Jul–Aug test, and a strong argument that a learned layer on top of physics will pay off.

## 4. Models and benchmarks (`pipeline/models.py`)

Each model is the benchmark for the next one.

| | Model | Idea |
|---|---|---|
| Ref | Yesterday's persistence | Same hour yesterday. The operator's instinct. It's optimistic, because yesterday evening isn't known when the forecast is issued, and it can't be used on the test set. |
| B0 | Seasonal climatology | Mean clean output at the same hour within ±30 days of the year. Knows the season, ignores tomorrow's weather. |
| B1 | Physics | Clear-sky POA × (1 − a·cloudᵇ), with a = 0.51 and b = 2.43 fitted by weighted least squares (a Kasten–Czeplak form), then the PVWatts chain. |
| M1 | LightGBM | The target is the **clear-sky index of AC power** (AC / clear-sky AC), which removes the deterministic diurnal and seasonal shape. Sample weights of clear-sky AC² make the loss equivalent to squared error in kW. Features (forecast-only plus geometry): cloud, temperature, wind, humidity, cloud lag/lead/3-h mean, the day's mean/std/max daylight cloud, humidity×cloud, sun elevation/azimuth/AOI, clear-sky POA, B1's physical POA, and day-of-year sin/cos. Small, regularised trees (7 leaves, ≥100 samples per leaf, 400 rounds at learning rate 0.03), deterministic seed. |
| M2 | Two-stage | Stage 1 learns tomorrow's *irradiance* (measured POA, which stays valid during outages and the MW episode, so it gets more data). Stage 2 is a learned plant curve (POA + geometry + temperature → AC). |
| **M3** | **Final: ½ B1 + ½ M1** | See §6 |

## 5. Validation (`pipeline/evaluate.py`)

The schemes are time-based only. Random K-fold on hourly weather data leaks through autocorrelation and would make every model look better than it is. Everything fitted is **re-fitted inside every fold, on that fold's training rows only**: the cloud curve, the plant derate, the models, and also the derate behind the performance-ratio QC rule, which decides which hours count as "clean". My first version fitted that QC derate once on all history, which let the validation months influence their own cleaning. I fixed it so the fold's training data alone sets it. In practice the fold derates only range over 0.868–0.874, and the resulting clean-hour mask is identical in all 20 folds, so no score changed. But the leak is gone by construction, and a test (`test_fold_qc_derate_is_fitted_without_test_rows`) keeps it out.

Two scoring targets, both on daylight hours (night is trivially zero and would flatter everyone):
- **Available plant** (primary, the model's purpose): clean hours only. Outages, curtailment and data faults are excluded.
- **Actual exports**: every daylight hour with a trustworthy meter reading, *including* outages and curtailment. Only data errors (missing, spikes, frozen meter, conflicting duplicates) are dropped.

**Daily energy** error is computed only on **complete days**, where every daylight hour is scored. Summing a partially scored day would understate its energy and flatter the metric.

1. **Seasonal hold-out (primary).** Train on everything except Jul–Aug 2024, then forecast Jul–Aug 2024. It's the closest rehearsal of the test. It's harsh, because the only monsoon left in training is June and September.
2. **Leave-one-month-out (18 folds).** Each month is forecast by a model trained on the other 17. It shows how error depends on regime. The monsoon folds keep one monsoon in training, which mirrors the real test.
3. **Forward hold-out.** Train on 2024, forecast Jan–Jun 2025. Strictly out-of-time; mostly dry season.

### Results (daylight MAE / RMSE in kW)

| Model | Jul–Aug 2024 hold-out | LOMO, monsoon months | LOMO, dry months | Forward H1 2025 |
|---|---|---|---|---|
| Persistence | 1002 / 1501 | 1068 / 1683 | 429 / 1273 | 559 / 1569 |
| B0 climatology | 1070 / 1676 | 876 / 1170 | 266 / 370 | 271 / 440 |
| B1 physics | 492 / 652 | 485 / 654 | 342 / 415 | 357 / 458 |
| M1 LightGBM | 519 / 700 | 495 / 679 | **164 / 243** | **200 / 313** |
| M2 two-stage | 523 / 690 | 515 / 700 | 177 / 253 | 213 / 322 |
| **M3 final** | **495 / 660** | **481 / 653** | 227 / 296 | 264 / 356 |

"Monsoon months" means Jun–Sep 2024 and Jun 2025.

### What the table says

- **The year has two regimes, and they want different models.**
  - In the dry season, LightGBM beats physics by a factor of about 2 and beats climatology clearly. It learns the soiling and low-sun effects that physics misses. It even beats the perfect-irradiance physics oracle (205 kW), which shows how much of the dry-season physics error is the plant model rather than the weather.
  - In the monsoon, every sensible model converges on **≈480–520 kW**, and the ranking among them is within noise.
- **In the monsoon, the bottleneck is the input forecast.** With perfect irradiance the physics chain would score 182 kW there, but every forecast-driven model scores about 490. Most of the monsoon error is therefore inherited from the cloud forecast. Forecast cloud correlates with the realised clear-sky index at only −0.6 to −0.8 in monsoon months, and only about −0.1 to −0.2 in clear dry months like Jan and Apr, where cloud rarely matters.
- **Bias.** All models under-forecast the Jul–Aug 2024 hold-out by about 160 kW. The worst days (§8) are all *brighter than forecast*. The LOMO monsoon bias is much smaller (−26 kW for M3) because a monsoon is in training. That supports including Jul–Aug 2024 in the final fit, which is what the final model does.

## 6. How I arrived at the final model, including the wrong turns

1. **First pass, all models.** M1 led overall, but B1 *won* the seasonal hold-out. That surprised me, so I separated the results by month (LOMO) and found the two regimes.
2. **Engineering the physics chain (M2).** I first built M2 with PVWatts as stage 2. It was bad in the dry season, and the oracle analysis showed why: the shading and soiling residuals. Replacing stage 2 with a learned plant curve fixed most of that. But M2 never beat M1, because its irradiance stage inherits the same cloud-forecast noise.
3. **Trying to make ML win the monsoon.**
   - *Monotone constraints* (more cloud → never more power): no meaningful change.
   - *Up-weighting cloudy days* ×3 or ×6: about −2 kW.
   - *Cloud curve fitted only on cloudy days*: 485 → 471 kW for B1, but only on the folds I'd be tuning on.

   None of these was worth the added complexity or the risk of overfitting five validation months. The honest conclusion is that the monsoon is input-limited.
4. **A mistake I corrected.** I removed day-of-year features, reasoning that 18 months of history would let the trees memorise 2024's weather by date. I re-ran all three schemes, and it made M1 **worse everywhere**:
   - seasonal hold-out: 519 → 559 kW
   - LOMO: 256 → 273 kW

   On reflection the reason is physical: the forecast's cloud → irradiance mapping is **regime-dependent**. A monsoon "90 % cloud" still lets through about 75 % of clear-sky irradiance; a winter one does not. Season is the only forecast-time proxy for that regime, so day-of-year went back in.
5. **The final choice: ½ physics + ½ M1.** On the monsoon schemes the blend is best or tied:
   - LOMO monsoon: 481 / 653 kW against B1's 485 / 654
   - hold-out: 495 against B1's 492

   It is clearly worse than M1 in the dry season, which is irrelevant for a Jul–Aug test. I chose it for three reasons:
   - **Extrapolation.** The test is cloudier than any training month. Physics degrades gracefully as cloud rises; trees go flat outside the data they've seen.
   - **Diversification.** B1 and M1 make partly independent errors with different biases, so averaging cuts variance. The blend's RMSE is the best in the monsoon.
   - **No tuning.** The weights are fixed at 0.5, not optimised on five folds.

   If the test period were year-round, I would ship M1 alone, or switch by season.

The final model is re-fitted on **all** clean training data, including the rescaled MW days of Jul–Aug 2024, then applied to `test.csv` after the same parsing and imputation. Output is clipped to [0, 10,000] kW and set to 0 when the sun is down. `validate_submission` asserts the contract before writing: 1,488 rows, timestamps identical to `test.csv`, no NaN, and values within range.

## 7. Where it is weakest

1. **Monsoon days that are brighter than forecast.** This is the dominant error. A single total-cloud-cover number can't distinguish thin, bright high overcast from thick convective cloud. Expect daily errors of 10+ MWh on such days.
2. **One monsoon of history.** Every monsoon conclusion rests on Jun–Sep 2024 and Jun 2025. The regime-dependent cloud mapping in particular is learned from one season.
3. **Availability is assumed, and it costs a lot when it fails.** Outages and curtailment were removed from training, so this forecasts an *available* plant. Scored against actual exports in the Jul–Aug 2024 hold-out:

   | Target | MAE | RMSE | Bias | Daily energy MAE |
   |---|---|---|---|---|
   | Available plant (614 h, 46 complete days) | 495 kW | 660 kW | −166 kW | 4.9 MWh |
   | Actual exports incl. outages (670 h, 51 complete days) | 840 kW | 1,600 kW | +228 kW | 9.4 MWh |

   Most of that gap is the five-day STOP on 12–16 Aug, when the forecast promised several MW and the plant exported nothing. In the dry-season forward hold-out the gap is small (264 → 304 kW) because outages were rare there. A weather model is right to ignore what it can't see. Operationally, though, this forecast needs to be combined with an availability plan before it becomes a nomination, and anyone scoring it against raw exports should expect outage hours to dominate the error.
4. **Point forecast only.** A grid nomination is a risk decision, and there are no quantiles yet.
5. **Clear-sky model.** It uses Ineichen with the default climatological turbidity, not the site's monsoon aerosol. Some of the low-sun residual may be turbidity rather than shading.

## 8. A case where it performed poorly

**11 Aug 2024**, the worst day of the hold-out:
- **Forecast:** 37.7 MWh. **Delivered:** 49.1 MWh, an 11.4 MWh under-forecast. Both are summed over the 10 of 11 daylight hours that were scored; the 09:00 hour was a meter spike and is excluded, so these aren't quite full-day totals.
- **What the forecast said:** 91 % cloud through daylight, with no rain.
- **What happened:** the pyranometer recorded 77 % of clear-sky irradiance, and the plant reached 7.6 MW at noon.
- **Why every model missed:** all of them are anchored on the cloud number, so they missed together and in the same direction. The plant model was fine. Given the measured irradiance, the physics chain tracks the actual curve closely (figure `05_worst_day.png`).

The other two worst days fit the same pattern:
- **16 Jul:** 83 % cloud forecast, 83 % clear-sky delivered, despite 17 mm of rain.
- **31 Jul:** 57 % forecast, fully clear delivered.

The 09:00 gap on 11 Aug is a 17 MW meter spike that the cleaning removed. If it hadn't, it would have dominated that day's score.

## 9. What I would do next

1. **Better information, not a better model.** Ensemble or probabilistic weather forecasts, cloud *type and level* (low/mid/high), forecast irradiance (GHI) if the provider has it, or satellite nowcasts for the intraday update.
2. **Probabilistic output.** LightGBM quantile models (P10/P50/P90), calibrated with conformal prediction on the monsoon folds.
3. **Online bias correction.** Monsoon errors are persistent over days (bright spells cluster). An exponentially weighted correction from the last few days of actuals, as far as they're available at issue time, would target exactly the failure in §8.
4. **Explicit plant terms.** A shading/IAM model from the row geometry, plus a soiling state that resets on rainfall. This would let the physics side carry more of the dry-season load.
5. **Availability forecasting** as a separate model, using maintenance schedules, so the nomination can be adjusted for known outages.

---

## Reproducing

```bash
python -m venv .venv && .venv/Scripts/activate   # or source .venv/bin/activate
pip install -r requirements.txt
python run_all.py            # clean → validate (3 schemes, 18 LOMO folds) → fit → predictions.csv → exports
pytest                       # 17 tests: parsing, cleaning rules, fold leakage, physics sanity, submission contract
```

| Path | Contents |
|---|---|
| `pipeline/config.py` | Every constant and threshold |
| `pipeline/load.py` | Parsing and format repair |
| `pipeline/clean.py` | Physics-aware QC flags |
| `pipeline/solar.py` | pvlib geometry and the PVWatts chain |
| `pipeline/features.py` | Forecast-time features |
| `pipeline/models.py` | All six models |
| `pipeline/evaluate.py` | Metrics and validation schemes |
| `pipeline/predict.py` | Final fit and the submission contract |
| `pipeline/export.py`, `pipeline/figures.py` | JSON for the site, PNGs for this note |
