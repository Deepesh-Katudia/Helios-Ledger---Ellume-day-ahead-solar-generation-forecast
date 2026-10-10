"use client";

// Animation primitives. All of them respect prefers-reduced-motion and animate only
// transform/opacity, so they stay on the compositor even with many charts on the page.
import { animate, motion, MotionConfig, useInView, useScroll, useSpring } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent, type ReactNode } from "react";

export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Hydration-safe reduced-motion flag. The server cannot know the preference, so during
 * hydration this reports `false` (matching the server HTML) and only then switches to the
 * real value. motion's own useReducedMotion returns null on the server but true on a
 * reduced-motion client, which made the first client render differ from the server's.
 */
export function useReducedMotionSafe(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}

/** Root provider: honour the OS setting for every motion component (skips transforms). */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

interface RevealProps {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}

/** Fade + rise once when scrolled into view. */
export function Reveal({ children, delay = 0, y = 28, className }: RevealProps) {
  const reduce = useReducedMotionSafe();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.9, delay, ease: EASE_OUT_EXPO }}
    >
      {children}
    </motion.div>
  );
}

interface StaggerProps {
  children: ReactNode[];
  className?: string;
  itemClassName?: string;
  as?: "div" | "ol" | "ul";
  step?: number;
}

/** Children reveal one after another. */
export function Stagger({ children, className, itemClassName, as = "div", step = 0.08 }: StaggerProps) {
  const reduce = useReducedMotionSafe();
  const Container = motion[as];
  const Item = as === "div" ? motion.div : motion.li;
  return (
    <Container
      className={className}
      initial={reduce ? false : "hidden"}
      whileInView="show"
      viewport={{ once: true, margin: "-60px" }}
      variants={{ show: { transition: { staggerChildren: step } } }}
    >
      {children.map((child, i) => (
        <Item
          key={i}
          className={itemClassName}
          variants={{ hidden: { opacity: 0, y: 24, scale: 0.98 }, show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.7, ease: EASE_OUT_EXPO } } }}
        >
          {child}
        </Item>
      ))}
    </Container>
  );
}

interface SplitTitleProps {
  text: string;
  accent?: string;
  accentClassName?: string;
  after?: string;
}

/** Headline that rises word by word from behind a mask. */
export function SplitTitle({ text, accent, accentClassName = "text-sun", after = "" }: SplitTitleProps) {
  const reduce = useReducedMotionSafe();
  const words = [
    ...text.split(" ").filter(Boolean).map((w) => ({ w, accent: false })),
    ...(accent ? accent.split(" ").map((w) => ({ w, accent: true })) : []),
    ...after.split(" ").filter(Boolean).map((w) => ({ w, accent: false })),
  ];
  return (
    <motion.span
      initial={reduce ? false : "hidden"}
      whileInView="show"
      viewport={{ once: true, margin: "-60px" }}
      variants={{ show: { transition: { staggerChildren: 0.05 } } }}
      aria-label={[text, accent, after].filter(Boolean).join(" ")}
    >
      {words.map(({ w, accent: isAccent }, i) => (
        <span key={i} aria-hidden className="inline-block overflow-hidden pb-[0.08em] align-bottom">
          <motion.span
            className={`inline-block ${isAccent ? `italic ${accentClassName}` : ""}`}
            variants={{ hidden: { y: "105%" }, show: { y: "0%", transition: { duration: 0.9, ease: EASE_OUT_EXPO } } }}
          >
            {w}
            {i < words.length - 1 ? " " : ""}
          </motion.span>
        </span>
      ))}
    </motion.span>
  );
}

interface CountUpProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}

/** Number that counts up from zero the first time it is seen. */
export function CountUp({ value, decimals = 0, prefix = "", suffix = "", duration = 1.8 }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotionSafe();
  const format = (v: number) => `${prefix}${v.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;

  useEffect(() => {
    if (!inView || !ref.current) return;
    if (reduce) {
      ref.current.textContent = format(value);
      return;
    }
    const controls = animate(0, value, {
      duration,
      ease: EASE_OUT_EXPO,
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = format(v);
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, value, reduce]);

  return (
    <span ref={ref} className="num">
      {format(reduce ? value : 0)}
    </span>
  );
}

/** Thin solar-gradient bar tracking reading progress. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 });
  return (
    <motion.div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[60] h-[3px] origin-left"
      style={{ scaleX, background: "linear-gradient(90deg, var(--c-ember), var(--c-sun), #ffe08a)" }}
    />
  );
}

interface LazyMountProps {
  children: ReactNode;
  height: number | string;
  className?: string;
}

/**
 * Mount heavy children (charts) only when they approach the viewport. Saves the
 * initial render and lets Recharts play its draw-in animation when the reader arrives.
 */
export function LazyMount({ children, height, className }: LazyMountProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "200px 0px" });
  return (
    <div ref={ref} className={className} style={{ height }}>
      {inView ? children : <div className="h-full w-full animate-pulse rounded-xl bg-bg-2/60" />}
    </div>
  );
}

interface SpotlightProps {
  children: ReactNode;
  className?: string;
}

/** Card whose border and surface catch a soft sunlight following the pointer. */
export function Spotlight({ children, className = "" }: SpotlightProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => setActive(false)}
      className={`spotlight ${className}`}
      data-active={active}
      style={{ "--mx": "50%", "--my": "50%" } as CSSProperties}
    >
      {children}
    </div>
  );
}

interface TickerProps {
  items: string[];
}

/** Endless ledger tape of facts under the hero. Pure CSS transform animation. */
export function Ticker({ items }: TickerProps) {
  const row = (
    <div className="flex shrink-0 items-center gap-10 pr-10">
      {items.map((t) => (
        <span key={t} className="flex items-center gap-10 whitespace-nowrap">
          <span>{t}</span>
          <span aria-hidden className="text-sun">✦</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className="ticker relative overflow-hidden border-b rule py-3 text-xs uppercase tracking-[0.25em] text-ink-2" aria-label={items.join(". ")}>
      <div aria-hidden className="ticker-track flex w-max">
        {row}
        {row}
      </div>
    </div>
  );
}

interface GrowBarProps {
  ratio: number;
  className?: string;
}

/** Horizontal bar that grows from the left when it scrolls into view. */
export function GrowBar({ ratio, className = "" }: GrowBarProps) {
  const reduce = useReducedMotionSafe();
  return (
    <motion.span
      className={`block origin-left ${className}`}
      initial={reduce ? false : { scaleX: 0 }}
      whileInView={{ scaleX: ratio }}
      style={reduce ? { scaleX: ratio } : undefined}
      viewport={{ once: true }}
      transition={{ duration: 1.2, ease: EASE_OUT_EXPO }}
    />
  );
}
