export const fmt = (v: number | null | undefined, digits = 0) =>
  v == null || Number.isNaN(v) ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const pct = (v: number, digits = 1) => `${fmt(v, digits)}%`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2024-07-14 06:00" -> "14 Jul" */
export const dayLabel = (t: string) => `${Number(t.slice(8, 10))} ${MONTHS[Number(t.slice(5, 7)) - 1]}`;

/** "2024-07" -> "Jul ’24" */
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ’${m.slice(2, 4)}`;

export const hourLabel = (t: string) => t.slice(11, 13);
