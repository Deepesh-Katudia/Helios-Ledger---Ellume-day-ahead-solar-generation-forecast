"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { fmt } from "@/lib/format";
import { CountUp, EASE_OUT_EXPO, SplitTitle } from "./motion";

export interface HeroStat {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  label: string;
  note: string;
}

// Fixed (not random) so server and client render identical markup.
const MOTES = Array.from({ length: 18 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  delay: (i * 1.7) % 12,
  duration: 10 + ((i * 5) % 9),
  drift: ((i % 5) - 2) * 25,
  size: 2 + (i % 3),
}));

interface HeroProps {
  /** Mean forecast kW by hour 0-23 over the test period, and the clear-sky ceiling. */
  profile: { hour: number; pred: number; clearsky: number }[];
  stats: HeroStat[];
}

const W = 1000;
const H = 420;
const BASE = 360; // horizon y
const MAX_KW = 10_000;

function toPath(values: number[], close: boolean): string {
  const step = W / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(BASE - (v / MAX_KW) * 300).toFixed(1)}`);
  return `M${pts.join(" L")}${close ? ` L${W},${BASE} L0,${BASE} Z` : ""}`;
}

export function Hero({ profile, stats }: HeroProps) {
  const reduce = useReducedMotion();
  const pred = profile.map((p) => p.pred);
  const clear = profile.map((p) => p.clearsky);
  const peak = Math.max(...pred);
  const arc = `M40,${BASE} Q${W / 2},-60 ${W - 40},${BASE}`;
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const textY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -90]);
  const chartY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 60]);
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, reduce ? 1 : 0.2]);

  return (
    <header ref={ref} className="relative overflow-hidden border-b rule">
      {/* dawn glow */}
      <div
        aria-hidden
        className="dawn pointer-events-none absolute inset-x-0 bottom-0 h-[75%]"
        style={{ background: "radial-gradient(60% 70% at 50% 100%, var(--c-sun-soft), transparent 70%)" }}
      />
      {!reduce && (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {MOTES.map((m, i) => (
            <span
              key={i}
              className="mote"
              style={{ left: `${m.left}%`, width: m.size, height: m.size, animationDelay: `${m.delay}s`, animationDuration: `${m.duration}s`, ["--drift" as string]: `${m.drift}px` }}
            />
          ))}
        </div>
      )}
      <nav aria-label="Main" className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-8">
        <a href="#top" className="flex items-center gap-2 text-sm tracking-wide text-ink">
          <span aria-hidden className="inline-block h-3 w-3 rounded-full bg-sun shadow-[0_0_18px_var(--c-sun)]" />
          <span className="display text-lg">Helios Ledger</span>
        </a>
        <ul className="hidden gap-6 text-sm text-ink-2 md:flex">
          {[
            ["#data", "Data forensics"],
            ["#method", "Method"],
            ["#results", "Results"],
            ["#failures", "Failures"],
            ["#forecast", "Forecast"],
          ].map(([href, label]) => (
            <li key={href}>
              <a className="transition-colors hover:text-sun" href={href}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div id="top" className="relative z-10 mx-auto grid max-w-7xl gap-10 px-4 pb-16 pt-10 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:pb-24 lg:pt-16">
        <motion.div style={{ y: textY, opacity: fade }}>
          <motion.p
            initial={reduce ? false : { opacity: 0, letterSpacing: "0.6em" }}
            animate={{ opacity: 1, letterSpacing: "0.3em" }}
            transition={{ duration: 1.4, ease: EASE_OUT_EXPO }}
            className="num mb-6 text-xs uppercase tracking-[0.3em] text-sun">Ellume · Day-ahead generation forecast</motion.p>
          <h1 className="display text-[clamp(2.6rem,6.5vw,5.6rem)] font-light leading-[0.95] text-ink">
            <SplitTitle text="Promising the grid" />
            <br />
            <SplitTitle text="" accent="tomorrow’s" accentClassName="font-normal text-sun" after="sun." />
          </h1>
          <motion.p
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.5, ease: EASE_OUT_EXPO }}
            className="mt-8 max-w-xl text-lg leading-relaxed text-ink-2">
            Every afternoon a 10&nbsp;MW plant in Tumakuru must tell the grid what it will export, hour by hour, tomorrow. All we know
            about tomorrow is an imperfect weather forecast. This is the ledger of how that forecast is turned into kilowatts, and an audit
            of where it goes wrong.
          </motion.p>
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.75, ease: EASE_OUT_EXPO }}
            className="mt-10 flex flex-wrap gap-3"
          >
            <a href="#results" className="shine rounded-full bg-sun px-6 py-3 text-sm font-medium text-[#0d0b09] transition hover:shadow-[0_0_30px_var(--c-sun)] active:translate-y-px">
              See the results
            </a>
            <a href="#failures" className="rounded-full border rule px-6 py-3 text-sm text-ink transition hover:border-sun hover:text-sun">
              Where it failed →
            </a>
          </motion.div>
        </motion.div>

        <motion.figure className="relative" style={{ y: chartY }} initial={reduce ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.4, ease: EASE_OUT_EXPO }}>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Average forecast day for Jul–Aug 2025, peaking at ${fmt(peak)} kW`}>
            <defs>
              <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--c-sun)" stopOpacity="0.55" />
                <stop offset="1" stopColor="var(--c-sun)" stopOpacity="0" />
              </linearGradient>
              <radialGradient id="sunGlow">
                <stop offset="0" stopColor="var(--c-sun)" stopOpacity="1" />
                <stop offset="0.4" stopColor="var(--c-sun)" stopOpacity="0.35" />
                <stop offset="1" stopColor="var(--c-sun)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <path d={arc} fill="none" stroke="var(--c-line)" strokeDasharray="2 8" strokeWidth="2" />
            <path d={toPath(clear, false)} fill="none" stroke="var(--c-muted)" strokeDasharray="6 6" strokeWidth="1.5" />
            <motion.path
              d={toPath(pred, true)}
              fill="url(#fill)"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1.6, delay: 0.8 }}
            />
            <motion.path
              d={toPath(pred, false)}
              fill="none"
              stroke="var(--c-sun)"
              strokeWidth="3"
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 2.2, ease: [0.16, 1, 0.3, 1] }}
            />
            <line x1="0" x2={W} y1={BASE} y2={BASE} stroke="var(--c-ink-2)" strokeWidth="1" />
            {!reduce && (
              <circle r="46" fill="url(#sunGlow)">
                <animateMotion dur="9s" repeatCount="indefinite" path={arc} keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
              </circle>
            )}
            {[6, 12, 18].map((h) => (
              <text key={h} x={(h / 23) * W} y={BASE + 28} textAnchor="middle" className="num" fill="var(--c-muted)" fontSize="14">
                {String(h).padStart(2, "0")}:00
              </text>
            ))}
          </svg>
          <figcaption className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
            <span>
              <span className="mr-2 inline-block h-0.5 w-5 bg-sun align-middle" />
              mean forecast day, Jul–Aug 2025
            </span>
            <span>
              <span className="mr-2 inline-block w-5 border-t border-dashed border-muted align-middle" />
              clear-sky ceiling
            </span>
          </figcaption>
        </motion.figure>
      </div>

      <dl className="relative z-10 mx-auto grid max-w-7xl grid-cols-2 border-t rule lg:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 1 + i * 0.12, ease: EASE_OUT_EXPO }}
            key={s.label} className={`px-4 py-6 sm:px-8 ${i > 0 ? "lg:border-l rule" : ""} ${i % 2 === 1 ? "border-l rule lg:border-l" : ""} ${i > 1 ? "border-t rule lg:border-t-0" : ""}`}>
            <dt className="text-xs uppercase tracking-[0.2em] text-muted">{s.label}</dt>
            <dd className="mt-2 text-3xl text-ink sm:text-4xl">
              <CountUp value={s.value} decimals={s.decimals} prefix={s.prefix} suffix={s.suffix} />
            </dd>
            <dd className="mt-1 text-xs text-ink-2">{s.note}</dd>
          </motion.div>
        ))}
      </dl>
    </header>
  );
}
