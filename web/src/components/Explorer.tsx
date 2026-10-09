"use client";

import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "./ChartTooltip";
import { Card } from "./Section";
import { MODELS, type ModelKey, type ValPoint } from "@/lib/data";
import { dayLabel, fmt } from "@/lib/format";

interface ExplorerProps {
  series: ValPoint[];
}

const WINDOW_DAYS = 5;

export function Explorer({ series }: ExplorerProps) {
  const days = useMemo(() => [...new Set(series.map((p) => p.t.slice(0, 10)))], [series]);
  const [start, setStart] = useState(Math.max(0, days.indexOf("2024-07-22")));
  const [shown, setShown] = useState<ModelKey[]>(["b0", "m3"]);
  const window = useMemo(() => {
    const keep = new Set(days.slice(start, start + WINDOW_DAYS));
    return series.filter((p) => keep.has(p.t.slice(0, 10))).map((p) => ({ ...p, cloudPct: p.cloud == null ? null : p.cloud * 100 }));
  }, [series, days, start]);

  const energy = (key: "actual" | ModelKey) =>
    window.reduce((s, p) => (p.actual == null ? s : s + ((p[key] as number | null) ?? 0)), 0) / 1000;

  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="num text-xs uppercase tracking-[0.2em] text-muted">Hold-out · Jul–Aug 2024</p>
          <h3 className="display mt-1 text-2xl text-ink">
            {dayLabel(days[start])} – {dayLabel(days[Math.min(start + WINDOW_DAYS - 1, days.length - 1)])}
          </h3>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Models shown">
          {MODELS.map((m) => (
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

      <label className="mt-6 block">
        <span className="sr-only">Window start day</span>
        <input
          type="range"
          min={0}
          max={days.length - WINDOW_DAYS}
          value={start}
          onChange={(e) => setStart(Number(e.target.value))}
          className="w-full accent-[var(--c-sun)]"
        />
      </label>

      <div className="mt-4 h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={window} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 6" vertical={false} />
            <XAxis dataKey="t" tickFormatter={dayLabel} interval={23} />
            <YAxis yAxisId="kw" width={52} domain={[0, 10000]} tickFormatter={(v: number) => `${v / 1000}k`} />
            <YAxis yAxisId="cloud" orientation="right" width={36} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip content={<ChartTooltip unit="" labelFormat={(t) => `${dayLabel(t)} · ${t.slice(11)} IST`} />} />
            <Area yAxisId="cloud" dataKey="cloudPct" name="forecast cloud %" fill="var(--c-sky)" fillOpacity={0.05} stroke="var(--c-sky)" strokeOpacity={0.45} strokeWidth={1} isAnimationActive={false} />
            <Line yAxisId="kw" dataKey="actual" name="Actual" stroke="var(--c-ink)" strokeWidth={2.4} dot={false} isAnimationActive={false} />
            {MODELS.filter((m) => shown.includes(m.key)).map((m) => (
              <Line key={m.key} yAxisId="kw" dataKey={m.key} name={m.short} stroke={m.color} strokeWidth={m.key === "m3" ? 2.4 : 1.4} dot={false} strokeDasharray={m.key === "m3" ? undefined : "5 4"} isAnimationActive={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 border-t rule pt-5 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">Actual energy</dt>
          <dd className="num text-xl text-ink">{fmt(energy("actual"), 1)} MWh</dd>
        </div>
        {(["m3", "b1", "b0"] as ModelKey[]).map((k) => {
          const m = MODELS.find((x) => x.key === k)!;
          const e = energy(k);
          const err = e - energy("actual");
          return (
            <div key={k}>
              <dt className="text-xs text-muted">{m.short}</dt>
              <dd className="num text-xl" style={{ color: m.color }}>
                {fmt(e, 1)} MWh <span className="text-xs text-ink-2">({err > 0 ? "+" : ""}{fmt(err, 1)})</span>
              </dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}
