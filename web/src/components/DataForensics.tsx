"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { ChartTooltip } from "./ChartTooltip";
import { LazyMount } from "./motion";
import { dayLabel, fmt } from "@/lib/format";

type Point = Record<string, number | string | null>;

export interface ForensicCase {
  key: string;
  label: string;
  count: string;
  title: string;
  verdict: string;
  action: "Fixed" | "Excluded" | "Sensor dropped";
  series?: Point[];
  lines?: { key: string; name: string; color: string; axis: "kw" | "poa" }[];
  points?: { t: string; ac_raw: number; poa: number }[];
}

interface DataForensicsProps {
  cases: ForensicCase[];
}

const ACTION_COLOR: Record<ForensicCase["action"], string> = {
  Fixed: "var(--c-good)",
  Excluded: "var(--c-bad)",
  "Sensor dropped": "var(--c-sky)",
};

export function DataForensics({ cases }: DataForensicsProps) {
  const [active, setActive] = useState(cases[0].key);
  const c = cases.find((x) => x.key === active) ?? cases[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div role="tablist" aria-label="Data faults" className="relative isolate flex flex-col gap-2">
        {cases.map((x) => (
          <button
            key={x.key}
            role="tab"
            aria-selected={x.key === active}
            onClick={() => setActive(x.key)}
            className={`group relative rounded-xl border px-4 py-3 text-left transition ${
              x.key === active ? "border-sun" : "rule hover:border-muted hover:bg-surface/50"
            }`}
          >
            {x.key === active && (
              <motion.span layoutId="forensic-tab" className="absolute inset-0 -z-10 rounded-xl bg-surface shadow-[0_0_30px_-12px_var(--c-sun)]" transition={{ type: "spring", stiffness: 380, damping: 32 }} />
            )}
            <span className="flex items-baseline justify-between gap-3">
              <span className={`text-sm ${x.key === active ? "text-ink" : "text-ink-2"}`}>{x.label}</span>
              <span className="num text-xs text-sun">{x.count}</span>
            </span>
          </button>
        ))}
      </div>

      <div role="tabpanel" className="relative isolate overflow-hidden rounded-2xl border rule bg-surface p-5 sm:p-7">
        <AnimatePresence mode="wait">
        <motion.div key={c.key} initial={{ opacity: 0, y: 14, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="display max-w-xl text-2xl text-ink">{c.title}</h3>
          <span className="num rounded-full border px-3 py-1 text-xs" style={{ color: ACTION_COLOR[c.action], borderColor: ACTION_COLOR[c.action] }}>
            {c.action}
          </span>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2">{c.verdict}</p>

        <LazyMount height={288} className="mt-6">
          <ResponsiveContainer width="100%" height="100%">
            {c.points ? (
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="2 6" />
                <XAxis type="number" dataKey="poa" name="POA" unit=" W/m²" domain={[0, 1100]} />
                <YAxis type="number" dataKey="ac_raw" name="AC" unit=" kW" width={70} tickFormatter={(v: number) => fmt(v / 1000, 0) + "k"} />
                <ZAxis range={[60, 60]} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<ChartTooltip />} />
                <Scatter data={c.points} fill="var(--c-bad)" name="spike" />
              </ScatterChart>
            ) : (
              <LineChart data={c.series} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="2 6" vertical={false} />
                <XAxis dataKey="t" tickFormatter={dayLabel} interval={23} minTickGap={20} />
                <YAxis yAxisId="kw" width={56} domain={[(m: number) => Math.min(0, m), "auto"]} allowDecimals={false} tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${fmt(v / 1000, 0)}k` : fmt(v, 0))} />
                <YAxis yAxisId="poa" orientation="right" width={44} hide={!c.lines?.some((l) => l.axis === "poa")} />
                <Tooltip content={<ChartTooltip unit="" />} />
                {c.lines?.map((l) => (
                  <Line key={l.key} yAxisId={l.axis} dataKey={l.key} name={l.name} stroke={l.color} dot={false} strokeWidth={l.axis === "poa" ? 1.2 : 2} strokeDasharray={l.axis === "poa" ? "4 3" : undefined} connectNulls={false} animationDuration={1400} animationEasing="ease-out" />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </LazyMount>
        {c.lines && (
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
            {c.lines.map((l) => (
              <span key={l.key} className="flex items-center gap-2">
                <span className="inline-block h-0.5 w-5" style={{ background: l.color }} />
                {l.name}
              </span>
            ))}
          </div>
        )}
        </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
