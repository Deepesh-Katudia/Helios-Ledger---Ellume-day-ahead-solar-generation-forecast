import { Stagger } from "./motion";
import { Card } from "./Section";
import { fmt } from "@/lib/format";
import type { Metrics } from "@/lib/data";

interface MetricGuideProps {
  /** Final model on the Jul–Aug 2024 hold-out; used for the worked examples. */
  final: Metrics;
  /** 1 − RMSE(final) / RMSE(climatology). */
  skill: number;
  capacityKw: number;
}

interface Entry {
  name: string;
  plain: string;
  example: string;
  goal: string;
}

/** Plain-language glossary for every score on the page, with the final model's own numbers as examples. */
export function MetricGuide({ final, skill, capacityKw }: MetricGuideProps) {
  const under = final.bias_kw < 0;
  const entries: Entry[] = [
    {
      name: "MAE · average miss",
      plain: "For each hour, how far the forecast was from what the plant actually produced, ignoring whether it was too high or too low. Then averaged.",
      example: `Ours is ${fmt(final.mae_kw)} kW: a typical daylight hour is off by about that much.`,
      goal: "Lower is better",
    },
    {
      name: "nMAE · average miss as a %",
      plain: `The same average miss, shown as a share of the plant's maximum output (${fmt(capacityKw)} kW). Makes plants of different sizes comparable.`,
      example: `${fmt(final.nmae_pct, 1)}% means a typical hour is off by about ${fmt(final.nmae_pct, 0)} kW for every 100 kW the plant could make.`,
      goal: "Lower is better",
    },
    {
      name: "RMSE · punishes big misses",
      plain: "Like MAE, but a large miss counts much more than several small ones. If RMSE is well above MAE, a few hours went badly wrong.",
      example: `Ours is ${fmt(final.rmse_kw)} kW vs an MAE of ${fmt(final.mae_kw)} kW: mostly steady, with some bad hours.`,
      goal: "Lower is better",
    },
    {
      name: "Bias · too high or too low?",
      plain: "The average miss with its direction kept. Positive means the forecast promised more than the plant delivered; negative means it promised less.",
      example: `Ours is ${final.bias_kw > 0 ? "+" : ""}${fmt(final.bias_kw)} kW: on average it ${under ? "promises a little less than the plant delivers" : "slightly over-promises"}.`,
      goal: "Closer to 0 is better",
    },
    {
      name: "Daily energy MAE · whole-day miss",
      plain: "Adds up each day's forecast and each day's actual output, and measures how far apart the two totals are. Hourly misses in opposite directions cancel out here.",
      example:
        final.daily_energy_mae_mwh == null
          ? "Not available for this scheme."
          : `Ours is ${fmt(final.daily_energy_mae_mwh, 1)} MWh a day, about ${fmt((final.daily_energy_mae_mwh * 1000) / capacityKw, 1)} hours of the plant running flat out.`,
      goal: "Lower is better",
    },
    {
      name: "Skill · better than a simple guess",
      plain: "How much smaller our RMSE is than a naive forecast that just says “a typical day for this month, at this hour”. 0% means no better than that guess, and 100% would be perfect.",
      example: `Ours is ${fmt(skill * 100, 0)}%: its RMSE is ${fmt(skill * 100, 0)}% smaller than the naive guess’s.`,
      goal: "Higher is better",
    },
  ];

  return (
    <Card className="mb-6">
      <h3 className="display text-xl text-ink">How to read these numbers</h3>
      <p className="mt-2 max-w-3xl text-sm text-ink-2">
        Every score compares the forecast with what the plant actually produced, hour by hour, during daylight. kW is power at a moment; MWh is
        energy over time (1&nbsp;MWh = 1,000&nbsp;kW for one hour). The examples use the final forecast&rsquo;s results on the Jul–Aug 2024 test run.
      </p>
      <Stagger className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((e) => (
          <div key={e.name} className="flex h-full flex-col rounded-xl border rule p-4">
            <p className="text-sm text-sun">{e.name}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{e.plain}</p>
            <p className="mt-3 text-sm leading-relaxed text-ink">{e.example}</p>
            <p className="num mt-auto pt-3 text-xs uppercase tracking-[0.15em] text-muted">{e.goal}</p>
          </div>
        ))}
      </Stagger>
    </Card>
  );
}
