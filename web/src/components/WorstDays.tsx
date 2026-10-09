"use client";

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "./ChartTooltip";
import { Card } from "./Section";
import type { ValPoint, WorstDay } from "@/lib/data";
import { dayLabel, fmt, hourLabel } from "@/lib/format";

interface WorstDaysProps {
  days: (WorstDay & { story: string })[];
  series: ValPoint[];
}

export function WorstDays({ days, series }: WorstDaysProps) {
  const [active, setActive] = useState(days[0].date);
  const day = days.find((d) => d.date === active) ?? days[0];
  const hours = series
    .filter((p) => p.t.startsWith(day.date))
    .map((p) => ({ ...p, cloudPct: p.cloud == null ? null : p.cloud * 100, poa10: p.poa == null ? null : p.poa * 10 }));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <div className="flex flex-col gap-3">
        {days.map((d, i) => (
          <button
            key={d.date}
            onClick={() => setActive(d.date)}
            aria-pressed={d.date === active}
            className={`rounded-2xl border p-5 text-left transition ${d.date === active ? "border-bad bg-surface" : "rule hover:border-muted"}`}
          >
            <div className="flex items-baseline justify-between">
              <span className="num text-xs uppercase tracking-[0.2em] text-muted">Miss #{i + 1}</span>
              <span className="num text-sm text-bad">{d.pred_mwh - d.actual_mwh > 0 ? "+" : ""}{fmt(d.pred_mwh - d.actual_mwh, 1)} MWh</span>
            </div>
            <p className="display mt-2 text-2xl text-ink">{dayLabel(d.date + " 00:00")} 2024</p>
            <div className="num mt-3 grid grid-cols-3 gap-2 text-xs">
              <span className="text-ink-2">
                forecast cloud
                <br />
                <span className="text-base text-sky">{fmt(d.forecast_cloud_mean * 100)}%</span>
              </span>
              <span className="text-ink-2">
                realised sun
                <br />
                <span className="text-base text-sun">{fmt(d.realised_clear_sky_index * 100)}%</span>
              </span>
              <span className="text-ink-2">
                rain
                <br />
                <span className="text-base text-ink">{fmt(d.rain_mm, 1)} mm</span>
              </span>
            </div>
          </button>
        ))}
      </div>

      <Card>
        <h3 className="display text-2xl text-ink">
          Forecast {fmt(day.pred_mwh, 1)} MWh, delivered {fmt(day.actual_mwh, 1)} MWh
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">{day.story}</p>
        <div className="mt-6 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={hours} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 6" vertical={false} />
              <XAxis dataKey="t" tickFormatter={hourLabel} interval={2} />
              <YAxis yAxisId="kw" width={52} domain={[0, 10000]} tickFormatter={(v: number) => `${v / 1000}k`} />
              <YAxis yAxisId="cloud" orientation="right" width={36} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<ChartTooltip unit="" labelFormat={(t) => `${t.slice(11)} IST`} />} />
              <Bar yAxisId="cloud" dataKey="cloudPct" name="forecast cloud %" fill="var(--c-sky)" fillOpacity={0.1} isAnimationActive={false} />
              <Line yAxisId="kw" dataKey="poa10" name="measured POA ×10" stroke="var(--c-sky)" strokeDasharray="3 3" dot={false} isAnimationActive={false} />
              <Line yAxisId="kw" dataKey="actual" name="Actual kW" stroke="var(--c-ink)" strokeWidth={2.4} dot={{ r: 2 }} isAnimationActive={false} />
              <Line yAxisId="kw" dataKey="m3" name="Forecast kW" stroke="var(--c-sun)" strokeWidth={2.4} dot={{ r: 2 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
