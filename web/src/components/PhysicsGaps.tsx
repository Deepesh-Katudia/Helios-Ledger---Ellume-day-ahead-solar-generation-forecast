"use client";

import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "./ChartTooltip";
import { Card } from "./Section";
import { monthLabel } from "@/lib/format";

interface PhysicsGapsProps {
  byHour: { hour: number; resid_kw: number }[];
  byMonth: { month: string; resid_kw: number; rain_mm: number }[];
}

const tone = (v: number) => (v < -100 ? "var(--c-bad)" : v > 0 ? "var(--c-good)" : "var(--c-muted)");

export function PhysicsGaps({ byHour, byMonth }: PhysicsGapsProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <h3 className="display text-xl text-ink">Mornings and evenings come up short</h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          Actual minus textbook PVWatts, <em>given the measured irradiance</em>. At low sun the plant loses about 280&nbsp;kW the model
          doesn&rsquo;t expect, consistent with row-to-row shading and angle-of-incidence losses on a fixed 15° array.
        </p>
        <div className="mt-5 h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byHour} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 6" vertical={false} />
              <XAxis dataKey="hour" tickFormatter={(h: number) => `${String(h).padStart(2, "0")}h`} />
              <YAxis width={48} />
              <ReferenceLine y={0} stroke="var(--c-ink-2)" />
              <Tooltip content={<ChartTooltip labelFormat={(h) => `${h}:00–${Number(h) + 1}:00 IST`} />} cursor={{ fill: "var(--c-sun-soft)" }} />
              <Bar dataKey="resid_kw" name="actual − physics" radius={[3, 3, 3, 3]}>
                {byHour.map((d) => (
                  <Cell key={d.hour} fill={tone(d.resid_kw)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <h3 className="display text-xl text-ink">Dry months run dirty, the monsoon washes the panels</h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          The same residual by month, against rainfall. A deficit of up to about 250&nbsp;kW builds through the dry Oct–May season and vanishes once the rains
          arrive: the signature of soiling. Good news for a Jul–Aug test period, and a reason to let a learned model correct the physics.
        </p>
        <div className="mt-5 h-60">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={byMonth} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 6" vertical={false} />
              <XAxis dataKey="month" tickFormatter={monthLabel} interval={2} />
              <YAxis yAxisId="kw" width={48} />
              <YAxis yAxisId="rain" orientation="right" width={40} />
              <ReferenceLine yAxisId="kw" y={0} stroke="var(--c-ink-2)" />
              <Tooltip content={<ChartTooltip unit="" labelFormat={monthLabel} />} cursor={{ fill: "var(--c-sun-soft)" }} />
              <Bar yAxisId="kw" dataKey="resid_kw" name="actual − physics (kW)" radius={[3, 3, 3, 3]}>
                {byMonth.map((d) => (
                  <Cell key={d.month} fill={tone(d.resid_kw)} />
                ))}
              </Bar>
              <Line yAxisId="rain" dataKey="rain_mm" name="rain (mm)" stroke="var(--c-sky)" dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
