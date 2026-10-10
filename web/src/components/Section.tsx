"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { EASE_OUT_EXPO, Reveal, Spotlight } from "./motion";

interface SectionProps {
  id: string;
  index: string;
  kicker: string;
  title: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
}

/** Editorial section: a numbered ledger entry with a big serif title. */
export function Section({ id, index, kicker, title, lede, children }: SectionProps) {
  const reduce = useReducedMotion();
  const view = { once: true, margin: "-80px" } as const;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-8 border-b rule">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-28">
        <div className="grid gap-6 lg:grid-cols-[180px_1fr]">
          <div>
            <motion.p
              className="num text-xs uppercase tracking-[0.3em] text-muted"
              initial={reduce ? false : { opacity: 0, x: -16 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={view}
              transition={{ duration: 0.8, ease: EASE_OUT_EXPO }}
            >
              <span className="text-sun">§{index}</span>
              <span className="mx-2">·</span>
              {kicker}
            </motion.p>
            <motion.span
              aria-hidden
              className="mt-4 block h-px w-24 origin-left bg-sun"
              initial={reduce ? false : { scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={view}
              transition={{ duration: 1.2, delay: 0.2, ease: EASE_OUT_EXPO }}
            />
          </div>
          <div>
            <motion.h2
              id={`${id}-title`}
              className="display max-w-4xl text-[clamp(2rem,4.4vw,3.6rem)] font-light leading-[1.02] text-ink"
              initial={reduce ? false : { opacity: 0, y: 40, clipPath: "inset(0 0 100% 0)" }}
              whileInView={{ opacity: 1, y: 0, clipPath: "inset(0 0 -10% 0)" }}
              viewport={view}
              transition={{ duration: 1.1, ease: EASE_OUT_EXPO }}
            >
              {title}
            </motion.h2>
            {lede && (
              <Reveal delay={0.15} y={18}>
                <div className="mt-6 max-w-3xl text-lg leading-relaxed text-ink-2">{lede}</div>
              </Reveal>
            )}
          </div>
        </div>
        <Reveal delay={0.1} className="mt-14">
          {children}
        </Reveal>
      </div>
    </section>
  );
}

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = "" }: CardProps) {
  return (
    <Spotlight className={`rounded-2xl border rule bg-surface p-5 transition-[transform,box-shadow] duration-500 hover:-translate-y-0.5 hover:shadow-[0_24px_60px_-30px_var(--c-sun)] sm:p-7 ${className}`}>
      {children}
    </Spotlight>
  );
}
