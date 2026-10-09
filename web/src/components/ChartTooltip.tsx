"use client";

import { fmt } from "@/lib/format";

interface Item {
  name?: string | number;
  value?: number | string | (number | string)[];
  color?: string;
  dataKey?: string | number;
}

interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: Item[];
  unit?: string;
  labelFormat?: (label: string) => string;
}

export function ChartTooltip({ active, payload, label, unit = "kW", labelFormat }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border rule bg-bg-2/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <p className="num mb-1 text-muted">{labelFormat ? labelFormat(String(label)) : label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="num flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-ink-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="text-ink">
            {typeof p.value === "number" ? fmt(p.value, Math.abs(p.value) < 10 ? 2 : 0) : String(p.value ?? "—")} {unit}
          </span>
        </p>
      ))}
    </div>
  );
}
