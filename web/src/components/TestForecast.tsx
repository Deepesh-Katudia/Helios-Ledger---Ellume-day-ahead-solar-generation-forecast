"use client";

import { useMemo, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "./ChartTooltip";
import { Card } from "./Section";
import type { TestPoint } from "@/lib/data";
import { dayLabel, fmt, hourLabel } from "@/lib/format";

interface TestForecastProps {
  series: TestPoint[];
}

export function TestForecast({ series }: TestForecastProps) {
  const daily = useMemo(() => {
    const m = new Map<string, { day: string; pred: number; clearsky: number }>();
    for (const p of series) {
      const d = p.t.slice(0, 10);
      const row = m.get(d) ?? { day: d, pred: 0, clearsky: 0 };
      m.set(d, { day: d, pred: row.pred + p.pred / 1000, clearsky: row.clearsky + p.clearsky / 1000 });
    }
    return [...m.values()];
  }, [series]);
  const [day, setDay] = useState(daily[0].day);
  const hours = series.filter((p) => p.t.startsWith(day)).map((p) => ({ ...p, cloudPct: p.cloud * 100 }));
  const sel = daily.find((d) => d.day === day)!;

  const downloadHref = "/data/predictions.csv";

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="num text-xs uppercase tracking-[0.2em] text-muted">Submission · 1,488 hours</p>
            <h3 className="display mt-1 text-2xl text-ink">Daily energy, against the clear-sky ceiling</h3>
          </div>
          <a href={downloadHref} className="chip" download>
            predictions.csv ↓
          </a>
        </div>
        <p className="mt-2 text-sm text-ink-2">Click a day to open its hourly forecast.</p>
        <div className="mt-6 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={-14} onClick={(e) => e?.activeLabel && setDay(String(e.activeLabel))}>
              <CartesianGrid strokeDasharray="2 6" vertical={false} />
              <XAxis dataKey="day" tickFormatter={(d: string) => dayLabel(d + " 00:00")} interval={6} />
              <YAxis width={44} unit="" />
              <Tooltip content={<ChartTooltip unit="MWh" labelFormat={(d) => dayLabel(d + " 00:00")} />} cursor={{ fill: "var(--c-sun-soft)" }} />
              <Bar dataKey="clearsky" name="clear-sky ceiling" fill="var(--c-line)" barSize={14} isAnimationActive={false} />
              <Bar dataKey="pred" name="forecast" barSize={14} isAnimationActive={false} className="cursor-pointer">
                {daily.map((d) => (
                  <Cell key={d.day} fill={d.day === day ? "var(--c-ember)" : "var(--c-sun)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="display text-2xl text-ink">{dayLabel(day + " 00:00")} 2025</h3>
          <p className="num text-sm text-ink-2">
            {fmt(sel.pred, 1)} MWh forecast · {fmt((sel.pred / sel.clearsky) * 100)}% of clear-sky
          </p>
        </div>
        <div className="mt-6 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={hours} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 6" vertical={false} />
              <XAxis dataKey="t" tickFormatter={hourLabel} interval={2} />
              <YAxis yAxisId="kw" width={52} domain={[0, 10000]} tickFormatter={(v: number) => `${v / 1000}k`} />
              <YAxis yAxisId="cloud" orientation="right" width={36} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip content={<ChartTooltip unit="" labelFormat={(t) => `${t.slice(11)} IST`} />} />
              <Area yAxisId="cloud" dataKey="cloudPct" name="forecast cloud %" fill="var(--c-sky)" fillOpacity={0.05} stroke="var(--c-sky)" strokeOpacity={0.45} strokeWidth={1} isAnimationActive={false} />
              <Line yAxisId="kw" dataKey="clearsky" name="clear-sky AC" stroke="var(--c-muted)" strokeDasharray="5 5" dot={false} isAnimationActive={false} />
              <Line yAxisId="kw" dataKey="b1" name="B1 physics" stroke="var(--c-sky)" dot={false} strokeWidth={1.2} isAnimationActive={false} />
              <Line yAxisId="kw" dataKey="m1" name="M1 LightGBM" stroke="var(--c-ember)" dot={false} strokeWidth={1.2} isAnimationActive={false} />
              <Line yAxisId="kw" dataKey="pred" name="Submitted (M3)" stroke="var(--c-sun)" strokeWidth={3} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
