"use client";

import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "./ChartTooltip";
import { LazyMount } from "./motion";
import { Card } from "./Section";
import { MODELS, type Metrics } from "@/lib/data";
import { fmt, monthLabel } from "@/lib/format";

interface Scheme {
  id: string;
  label: string;
  why: string;
  results: Record<string, Metrics>;
  /** Same models scored against recorded exports, outages included. */
  exports?: Record<string, Metrics>;
}

type Target = "available" | "exports";

interface LeaderboardProps {
  schemes: Scheme[];
  lomo: { month: string; model: string; mae_kw: number }[];
}

export function Leaderboard({ schemes, lomo }: LeaderboardProps) {
  const [schemeId, setSchemeId] = useState(schemes[0].id);
  const scheme = schemes.find((s) => s.id === schemeId) ?? schemes[0];
  const [targetPick, setTarget] = useState<Target>("available");
  const target: Target = scheme.exports ? targetPick : "available";
  const table = target === "exports" && scheme.exports ? scheme.exports : scheme.results;
  const rows = MODELS.map((m) => ({ meta: m, r: table[m.name] })).filter((x) => x.r);
  const anyRow = rows[0]?.r;
  const maxMae = Math.max(...rows.map((x) => x.r.mae_kw));
  const best = Math.min(...rows.map((x) => x.r.mae_kw));

  const [shown, setShown] = useState<string[]>(["b0", "b1", "m1", "m3"]);
  const lomoWide = useMemo(() => {
    const byMonth = new Map<string, Record<string, number | string>>();
    for (const r of lomo) {
      const meta = MODELS.find((m) => m.name === r.model);
      if (!meta) continue;
      const row = byMonth.get(r.month) ?? { month: r.month };
      byMonth.set(r.month, { ...row, [meta.key]: r.mae_kw });
    }
    return [...byMonth.values()];
  }, [lomo]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Validation scheme">
        {schemes.map((s) => (
          <button key={s.id} className="chip" aria-pressed={s.id === schemeId} onClick={() => setSchemeId(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <p className="max-w-3xl text-sm text-ink-2">{scheme.why}</p>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs uppercase tracking-[0.2em] text-muted">Scored against</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Scoring target">
          <button className="chip" aria-pressed={target === "available"} onClick={() => setTarget("available")}>
            Available plant (clean hours)
          </button>
          <button className="chip" aria-pressed={target === "exports"} disabled={!scheme.exports} onClick={() => setTarget("exports")} title={scheme.exports ? undefined : "Not computed for this scheme"}>
            Actual exports, incl. outages
          </button>
        </div>
      </div>
      <p className="max-w-3xl text-xs leading-relaxed text-muted">
        {target === "available"
          ? "What the model is built for: hours when the plant was available and metering correctly. Outages, curtailment and data faults are excluded."
          : "Every daylight hour with a trustworthy meter reading, including STOP/PARTIAL outages and curtailment. Only data errors (spikes, frozen meter, missing) are dropped. The gap to the other table is what outages cost a weather-only forecast."}
        {anyRow ? ` ${fmt(anyRow.n_hours)} hours scored; daily energy over ${anyRow.n_complete_days} complete days.` : ""}
      </p>

      <Card className="overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b rule text-left text-xs uppercase tracking-[0.15em] text-muted">
              <th className="px-5 py-4 font-normal">Model</th>
              <th className="w-[34%] px-5 py-4 font-normal">Daylight MAE</th>
              <th className="px-5 py-4 text-right font-normal">RMSE</th>
              <th className="px-5 py-4 text-right font-normal">nMAE</th>
              <th className="px-5 py-4 text-right font-normal">Bias</th>
              <th className="px-5 py-4 text-right font-normal" title="Mean absolute error of daily energy, over days on which every daylight hour is scored">
                Daily energy MAE<sup className="ml-0.5 normal-case">*</sup>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ meta, r }) => {
              const final = meta.key === "m3";
              return (
                <tr key={meta.key} className={`border-b rule last:border-0 ${final ? "bg-[var(--c-sun-soft)]" : ""}`}>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
                      <div>
                        <div className={final ? "text-sun" : "text-ink"}>{meta.short}</div>
                        <div className="text-xs text-muted">{meta.role}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-2 flex-1 rounded-full bg-bg-2">
                        <motion.div
                          className="h-2 origin-left rounded-full"
                          style={{ background: meta.color }}
                          initial={{ scaleX: 0 }}
                          whileInView={{ scaleX: r.mae_kw / maxMae }}
                          animate={{ scaleX: r.mae_kw / maxMae }}
                          viewport={{ once: true }}
                          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
                        />
                      </div>
                      <span className={`num w-20 text-right ${r.mae_kw === best ? "text-good" : "text-ink"}`}>{fmt(r.mae_kw)} kW</span>
                    </div>
                  </td>
                  <td className="num px-5 py-4 text-right text-ink-2">{fmt(r.rmse_kw)}</td>
                  <td className="num px-5 py-4 text-right text-ink-2">{fmt(r.nmae_pct, 1)}%</td>
                  <td className={`num px-5 py-4 text-right ${r.bias_kw < 0 ? "text-sky" : "text-ember"}`}>
                    {r.bias_kw > 0 ? "+" : ""}
                    {fmt(r.bias_kw)}
                  </td>
                  <td className="num px-5 py-4 text-right text-ink-2">{r.daily_energy_mae_mwh == null ? "—" : `${fmt(r.daily_energy_mae_mwh, 1)} MWh`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t rule px-5 py-3 text-xs text-muted">* Complete days only: days on which every daylight hour is scored. Partial days would understate daily energy.</p>
      </Card>

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 className="display text-xl text-ink">Error by month: the monsoon is a different problem</h3>
            <p className="mt-2 max-w-2xl text-sm text-ink-2">
              Leave-one-month-out: each month is forecast by models trained on the other 17. In the dry season LightGBM is two to four
              times better than physics. In the shaded monsoon months every method converges near 500&nbsp;kW, the floor set by the
              cloud forecast itself.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Models shown">
            {MODELS.filter((m) => m.key !== "persistence").map((m) => (
              <button
                key={m.key}
                className="chip"
                aria-pressed={shown.includes(m.key)}
                onClick={() => setShown((s) => (s.includes(m.key) ? s.filter((k) => k !== m.key) : [...s, m.key]))}
              >
                {m.short}
              </button>
            ))}
          </div>
        </div>
        <LazyMount height={320} className="mt-6">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lomoWide} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 6" vertical={false} />
              <ReferenceArea x1="2024-06" x2="2024-09" fill="var(--c-sky)" fillOpacity={0.05} label={{ value: "monsoon", position: "insideTop", fill: "var(--c-sky)", fontSize: 11 }} />
              <XAxis dataKey="month" tickFormatter={monthLabel} />
              <YAxis width={48} />
              <Tooltip content={<ChartTooltip labelFormat={monthLabel} />} />
              <Legend wrapperStyle={{ display: "none" }} />
              {MODELS.filter((m) => shown.includes(m.key)).map((m) => (
                <Line key={m.key} dataKey={m.key} name={m.short} stroke={m.color} strokeWidth={m.key === "m3" ? 3 : 1.6} dot={{ r: 2.5 }} animationDuration={1400} animationEasing="ease-out" />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </LazyMount>
      </Card>
    </div>
  );
}
