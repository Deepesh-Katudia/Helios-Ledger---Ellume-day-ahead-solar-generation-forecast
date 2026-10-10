import { DataForensics, type ForensicCase } from "@/components/DataForensics";
import { Explorer } from "@/components/Explorer";
import { Hero, type HeroStat } from "@/components/Hero";
import { GrowBar, ScrollProgress, Stagger, Ticker } from "@/components/motion";
import { Leaderboard } from "@/components/Leaderboard";
import { PhysicsGaps } from "@/components/PhysicsGaps";
import { Card, Section } from "@/components/Section";
import { TestForecast } from "@/components/TestForecast";
import { WorstDays } from "@/components/WorstDays";
import { importance, leaderboard, PLANT, physics, quality, summary, testForecast, validationSeries, worstDays, type WorstDay } from "@/lib/data";
import { fmt } from "@/lib/format";

function meanProfile() {
  const sums = Array.from({ length: 24 }, (_, hour) => ({ hour, pred: 0, clearsky: 0, n: 0 }));
  for (const p of testForecast.series) {
    const h = Number(p.t.slice(11, 13));
    sums[h] = { ...sums[h], pred: sums[h].pred + p.pred, clearsky: sums[h].clearsky + p.clearsky, n: sums[h].n + 1 };
  }
  return sums.map((s) => ({ hour: s.hour, pred: s.pred / s.n, clearsky: s.clearsky / s.n }));
}

function storyFor(d: WorstDay): string {
  const cloud = fmt(d.forecast_cloud_mean * 100);
  const sun = fmt(d.realised_clear_sky_index * 100);
  const rain = d.rain_mm > 0 ? ` and ${fmt(d.rain_mm, 1)} mm of rain fell` : "";
  const base = `The day-ahead forecast said ${cloud}% cloud through daylight hours; the pyranometer recorded ${sun}% of clear-sky irradiance${rain}. Every model is anchored on that cloud number, so when the forecast is wrong, all of them are wrong together, in the same direction.`;
  const extra: Record<string, string> = {
    "2024-08-11":
      " This is the typical monsoon failure: thick-looking but bright high overcast. Note the gap at 09:00, a 17 MW meter spike the cleaning stage removed from scoring.",
    "2024-07-16":
      " This day sits inside the 26-day MW-logging episode. That the rescaled actuals line up so cleanly with measured irradiance is a useful check that the ×1000 fix is right.",
    "2024-07-31": " The forecast expected broken cloud; the day came up fully clear. The miss is in the input forecast, not in the plant model.",
  };
  return base + (extra[d.date] ?? "");
}

export default function Home() {
  const sh = summary.seasonal_holdout;
  const shExports = leaderboard.seasonal_holdout.exports?.[summary.final_model];
  const flags = quality.clean.flags;
  const load = quality.load;
  const ex = quality.examples;

  const cases: ForensicCase[] = [
    {
      key: "mw",
      label: "Unit switch: kW → MW",
      count: `${quality.clean.mw_rescaled_days.length} days`,
      title: ex.mw_logging.title,
      verdict:
        "From 14 Jul to 8 Aug 2024 the historian wrote AC power in MW. AC per W/m² of irradiance drops from about 10.5 to 0.011. These are the most valuable days in the file, the seasonal twin of the test period, so they are rescaled ×1000 rather than thrown away.",
      action: "Fixed",
      series: ex.mw_logging.series.map((r) => ({ ...r, ac_power_kw: r.ac_power_kw !== r.ac_raw ? r.ac_power_kw : null })),
      lines: [
        { key: "ac_raw", name: "raw ac_power_kw", color: "var(--c-bad)", axis: "kw" },
        { key: "ac_power_kw", name: "rescaled ×1000 (MW days only)", color: "var(--c-sun)", axis: "kw" },
        { key: "measured_poa_wm2", name: "measured POA (W/m²)", color: "var(--c-sky)", axis: "poa" },
      ],
    },
    {
      key: "outage",
      label: "Outages under full sun",
      count: `${fmt(flags.flag_outage_status)} h`,
      title: ex.outage.title,
      verdict:
        "STOP and PARTIAL hours (and STANDBY in daylight) are availability events, not weather. A weather forecast cannot predict a breaker trip, so these hours are excluded from the training target. The forecast is explicitly for an available plant.",
      action: "Excluded",
      series: ex.outage.series,
      lines: [
        { key: "ac_raw", name: "AC (kW)", color: "var(--c-sun)", axis: "kw" },
        { key: "measured_poa_wm2", name: "measured POA (W/m²)", color: "var(--c-sky)", axis: "poa" },
      ],
    },
    {
      key: "flat",
      label: "Frozen AC meter",
      count: `${fmt(flags.flag_ac_flatline)} h`,
      title: ex.ac_flatline.title,
      verdict:
        "Identical two-decimal readings in consecutive hours, through night and day: the historian is holding the last value. The first reading is kept; the held copies are excluded.",
      action: "Excluded",
      series: ex.ac_flatline.series,
      lines: [
        { key: "ac_raw", name: "AC (kW)", color: "var(--c-sun)", axis: "kw" },
        { key: "measured_poa_wm2", name: "measured POA (W/m²)", color: "var(--c-sky)", axis: "poa" },
      ],
    },
    {
      key: "poa",
      label: "Stuck pyranometer",
      count: `${fmt(flags.flag_poa_stuck)} h`,
      title: ex.stuck_poa.title,
      verdict:
        "Irradiance reads 412.6 W/m² for three days, including midnight. The power data is fine, so only the sensor value is dropped. Irradiance is used to fit physics constants and to sanity-check power, never as a model input.",
      action: "Sensor dropped",
      series: ex.stuck_poa.series,
      lines: [
        { key: "ac_raw", name: "AC (kW)", color: "var(--c-sun)", axis: "kw" },
        { key: "measured_poa_wm2", name: "measured POA (W/m²)", color: "var(--c-sky)", axis: "poa" },
      ],
    },
    {
      key: "spike",
      label: "Meter spikes > 10 MW",
      count: `${fmt(flags.flag_spike)} h`,
      title: ex.spikes.title,
      verdict:
        "Readings up to 26.9 MW from a plant whose inverters cap at 10 MW. Values within 2% of the rating are real clipping and kept; anything above is excluded. A performance-ratio check against physics catches a further " +
        `${fmt(flags.flag_pr_anomaly)} subtler anomalies.`,
      action: "Excluded",
      points: ex.spikes.points,
    },
  ];

  const schemes = [
    {
      id: "seasonal",
      label: "Hold-out Jul–Aug 2024",
      why: "Primary scheme. The test is Jul–Aug 2025 monsoon, so the most honest rehearsal holds out the same two months a year earlier and trains on everything else.",
      results: leaderboard.seasonal_holdout.results,
      exports: leaderboard.seasonal_holdout.exports,
    },
    {
      id: "lomo",
      label: "Leave-one-month-out ×18",
      why: "Every month forecast in turn by a model that never saw it. It shows how skill varies with season, and keeps one monsoon in training, as in the real test.",
      results: leaderboard.lomo_mean.results,
    },
    {
      id: "forward",
      label: "Train 2024 → H1 2025",
      why: "Strictly out-of-time: nothing from the future leaks in. A dry-season test, where learned models shine.",
      results: leaderboard.forward_holdout.results,
      exports: leaderboard.forward_holdout.exports,
    },
  ];

  const steps = [
    ["Load", "Two timestamp formats, 36 duplicates, 186 missing hours, −999 / 9999 sentinels, blank / NA / null strings."],
    ["Clean", "Unit fix, outage, flatline, spike and performance-ratio rules. Every decision is a flag column, auditable and plotted above."],
    ["Physics", "pvlib solar position at the hour midpoint, Ineichen clear-sky, transposition to the 15° south-facing array."],
    ["B1", "Clear-sky POA × (1 − a·cloudᵇ), fitted on training data, then PVWatts with −0.35 %/°C and 10 MW clipping."],
    ["M1", "LightGBM learns the clear-sky index of AC power: how far below its ceiling the weather pulls the plant."],
    ["M3", "Final: ½ B1 + ½ M1. Physics extrapolates safely into an unusually cloudy test; ML fixes what physics misses."],
  ];

  const hero: HeroStat[] = [
    { value: sh.nmae_pct, decimals: 1, suffix: "%", label: "nMAE, monsoon hold-out", note: `${fmt(sh.mae_kw)} kW daylight error · available-plant hours` },
    { value: Math.round(summary.skill_vs_climatology_rmse * 100), suffix: "%", label: "RMSE skill", note: "improvement over seasonal climatology" },
    { value: summary.rows_flagged_unusable, label: "Hours quarantined", note: `of ${fmt(summary.rows_total)}; cleaned, not guessed` },
    { value: Math.round(summary.test_total_mwh), suffix: " MWh", label: "Forecast, Jul–Aug 2025", note: `${summary.test_days} days · mean daylight cloud ${fmt(summary.test_mean_daylight_cloud * 100)}%` },
  ];

  const tape = [
    `${fmt(load.rows_raw)} raw rows audited`,
    `${quality.clean.mw_rescaled_days.length} days logged in MW, rescaled ×1000`,
    "26.9 MW spike on a 10 MW plant",
    `${fmt(sh.nmae_pct, 1)}% nMAE in the monsoon`,
    "pyranometer frozen at 412.6 W/m²",
    "forecast 91% cloud · delivered 77% of clear-sky",
    `${fmt(summary.test_total_mwh)} MWh promised for Jul–Aug 2025`,
    "18 leave-one-month-out folds",
  ];

  return (
    <main>
      <ScrollProgress />
      <Hero profile={meanProfile()} stats={hero} />
      <Ticker items={tape} />

      <Section
        id="brief"
        index="01"
        kicker="The brief"
        title={
          <>
            One plant, one imperfect forecast, <em className="text-sun">1,488 promises</em>.
          </>
        }
        lede="Inputs are four day-ahead forecast fields: cloud cover, temperature, wind and humidity. Plant sensors exist only in the past. Everything the model uses must be knowable the afternoon before. One scoping decision runs through everything below: this is a forecast of what an available plant will export. A weather model cannot see a breaker trip, so outages are scored separately."
      >
        <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Asset", PLANT.location, PLANT.coords],
            ["Capacity", `${PLANT.dc} DC · ${PLANT.ac} AC`, "DC/AC 1.25: clips on bright days"],
            ["Array", PLANT.array, PLANT.tech],
            ["Task", "Jul–Aug 2025, hourly", "Train Jan 2024 – Jun 2025 · IST, hour-beginning"],
          ].map(([k, v, n]) => (
            <Card key={k}>
              <p className="num text-xs uppercase tracking-[0.2em] text-muted">{k}</p>
              <p className="display mt-3 text-xl text-ink">{v}</p>
              <p className="mt-2 text-sm text-ink-2">{n}</p>
            </Card>
          ))}
        </Stagger>
      </Section>

      <Section
        id="data"
        index="02"
        kicker="Data forensics"
        title={
          <>
            The historian was <em className="text-ember">lying</em>, in five distinct ways.
          </>
        }
        lede={
          <>
            The training file is an unprocessed export: {fmt(load.non_iso_timestamps)} timestamps in a second format, {load.duplicate_rows_removed} duplicates
            ({load.conflicting_duplicates} with conflicting values), {load.missing_hours} missing hours, and sentinels in seven columns. The test file has blanks
            and −999s too. Each fault below was found by reasoning from physics: a 10 MW plant cannot export 26 MW, and power should track irradiance.
          </>
        }
      >
        <DataForensics cases={cases} />
        <p className="mt-6 text-sm text-muted">
          Result: {fmt(quality.clean.daylight_rows_train_ok)} of {fmt(quality.clean.daylight_rows_total)} daylight hours are kept as clean training targets. Fitted
          plant derate {fmt(quality.clean.derate_fitted, 3)}.
        </p>
      </Section>

      <Section
        id="method"
        index="03"
        kicker="Method"
        title={
          <>
            Physics sets the ceiling; learning reads the <em className="text-sky">clouds</em>.
          </>
        }
        lede="The sun's position is known exactly for any future hour. So the model doesn't learn the shape of a day; it learns the clear-sky index, the fraction of the physical ceiling that tomorrow's weather lets through."
      >
        <Stagger as="ol" step={0.1} className="grid gap-px overflow-hidden rounded-2xl border rule bg-[var(--c-line)] sm:grid-cols-2 lg:grid-cols-3" itemClassName="group bg-surface p-6 transition-colors duration-300 hover:bg-bg-2">
          {steps.map(([name, text], i) => (
            <div key={name}>
              <p className="num text-xs text-sun">
                0{i + 1}
                <span aria-hidden className="ml-3 inline-block h-px w-6 origin-left scale-x-50 bg-sun align-middle transition-transform duration-500 group-hover:scale-x-[2.5]" />
              </p>
              <p className="display mt-2 text-2xl text-ink transition-transform duration-500 group-hover:translate-x-1">{name}</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{text}</p>
            </div>
          ))}
        </Stagger>

        <div className="mt-14">
          <h3 className="display text-3xl font-light text-ink">What textbook physics misses</h3>
          <p className="mt-3 max-w-3xl text-ink-2">
            Running PVWatts on the <em>measured</em> irradiance (a perfect weather forecast) still leaves systematic error. These two plant
            behaviours are why a learned correction beats pure physics in most months.
          </p>
          <div className="mt-8">
            <PhysicsGaps byHour={physics.by_hour} byMonth={physics.by_month} />
          </div>
        </div>

        <Card className="mt-6">
          <h3 className="display text-xl text-ink">What M1 listens to</h3>
          <p className="mt-2 text-sm text-ink-2">Share of LightGBM split gain. Cloud and its interaction with humidity carry three-quarters of the signal; season is the next most useful input.</p>
          <ul className="mt-5 space-y-2">
            {importance.slice(0, 8).map((f) => (
              <li key={f.feature} className="grid grid-cols-[160px_1fr_56px] items-center gap-3 text-sm sm:grid-cols-[220px_1fr_64px]">
                <span className="num truncate text-ink-2">{f.feature}</span>
                <span className="h-2 rounded-full bg-bg-2">
                  <GrowBar ratio={f.gain_pct / importance[0].gain_pct} className="h-2 rounded-full bg-ember" />
                </span>
                <span className="num text-right text-ink">{fmt(f.gain_pct, 1)}%</span>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section
        id="results"
        index="04"
        kicker="Validation"
        title={
          <>
            Benchmarked against what an operator would do <em className="text-sun">anyway</em>.
          </>
        }
        lede="Six forecasts, three time-respecting validation schemes, no random splits. Scored on clean daylight hours only: night is trivially zero, and outages are not a weather question."
      >
        <Leaderboard schemes={schemes} lomo={leaderboard.lomo_by_month} />
        {shExports && (
          <Card className="mt-6 border-[var(--c-bad)]/40">
            <div className="grid gap-6 md:grid-cols-[1.3fr_1fr] md:items-center">
              <div>
                <p className="num text-xs uppercase tracking-[0.2em] text-bad">Available plant ≠ actual exports</p>
                <h3 className="display mt-2 text-2xl text-ink">What outages cost a weather-only forecast</h3>
                <p className="mt-3 text-sm leading-relaxed text-ink-2">
                  Every score above is on available-plant hours. Scored instead against what the plant really exported in Jul–Aug 2024, including the
                  five-day STOP outage on 12–16 Aug, the same final forecast&rsquo;s error rises sharply and turns into an over-forecast. Nothing in a
                  weather forecast predicts a breaker trip. In operations this forecast would be combined with an availability plan, such as
                  maintenance schedules or known derates.
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-4">
                <div className="rounded-xl border rule p-4">
                  <dt className="text-xs text-muted">Available plant</dt>
                  <dd className="num mt-1 text-2xl text-ink">{fmt(sh.mae_kw)} kW</dd>
                  <dd className="num text-xs text-ink-2">bias {fmt(sh.bias_kw)} kW</dd>
                </div>
                <div className="rounded-xl border border-[var(--c-bad)]/50 p-4">
                  <dt className="text-xs text-muted">Actual exports</dt>
                  <dd className="num mt-1 text-2xl text-bad">{fmt(shExports.mae_kw)} kW</dd>
                  <dd className="num text-xs text-ink-2">bias +{fmt(shExports.bias_kw)} kW</dd>
                </div>
              </dl>
            </div>
          </Card>
        )}
        <div className="mt-6">
          <Explorer series={validationSeries} />
        </div>
      </Section>

      <Section
        id="failures"
        index="05"
        kicker="Where it failed"
        title={
          <>
            The worst days are the forecast&rsquo;s <em className="text-ember">bright surprises</em>.
          </>
        }
        lede="The three largest daily misses in the hold-out are all under-forecasts: the weather forecast predicted heavy monsoon cloud, and the sky was brighter than promised. The fix is not a cleverer plant model. It's better information about the cloud."
      >
        <WorstDays days={worstDays.map((d) => ({ ...d, story: storyFor(d) }))} series={validationSeries} />
      </Section>

      <Section
        id="forecast"
        index="06"
        kicker="The ledger"
        title={
          <>
            Jul–Aug 2025: <em className="text-sun">{fmt(summary.test_total_mwh)} MWh</em> promised.
          </>
        }
        lede={`The test period is the cloudiest stretch in the record: mean daylight forecast cloud is ${fmt(summary.test_mean_daylight_cloud * 100)}%, against 70% in Jul–Aug 2024. That's why the submitted forecast keeps physics in the blend: it extrapolates sensibly where the trees have little data. These are available-plant numbers: any outage or curtailment in Jul–Aug 2025 will make actual exports fall short of them.`}
      >
        <TestForecast series={testForecast.series} />
      </Section>

      <Section id="limits" index="07" kicker="Honest limits" title="What would make it better.">
        <Stagger className="grid gap-4 md:grid-cols-2">
          {[
            ["Weakest where it matters", "Monsoon error (~5% of capacity) is dominated by the cloud forecast, which correlates only about −0.65 with realised irradiance. A single forecast field can't separate bright high overcast from dark convective cloud."],
            ["One monsoon of history", "Every monsoon conclusion rests on Jun–Sep 2024 and Jun 2025. The cloud → irradiance mapping is regime dependent, and one season is thin evidence for it."],
            ["Point forecast only", "The grid cares about risk. Next: quantile models (P10/P50/P90) and conformal calibration on the monsoon hold-out."],
            ["Next steps", "Ensemble weather forecasts or satellite-derived irradiance, cloud type and level if available, explicit soiling and shading terms, and online bias correction from the last few days of actuals."],
          ].map(([k, v]) => (
            <Card key={k}>
              <p className="display text-xl text-ink">{k}</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{v}</p>
            </Card>
          ))}
        </Stagger>
      </Section>

      <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-10 text-xs text-muted sm:px-8">
        <span className="display text-base text-ink-2">Helios Ledger</span>
        <span>Every number on this page is generated by <code className="num text-ink-2">python run_all.py</code>.</span>
      </footer>
    </main>
  );
}
