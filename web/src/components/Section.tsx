import type { ReactNode } from "react";

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
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-8 border-b rule">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 lg:py-28">
        <div className="grid gap-6 lg:grid-cols-[180px_1fr]">
          <p className="num text-xs uppercase tracking-[0.3em] text-muted">
            <span className="text-sun">§{index}</span>
            <span className="mx-2">·</span>
            {kicker}
          </p>
          <div>
            <h2 id={`${id}-title`} className="display max-w-4xl text-[clamp(2rem,4.4vw,3.6rem)] font-light leading-[1.02] text-ink">
              {title}
            </h2>
            {lede && <div className="mt-6 max-w-3xl text-lg leading-relaxed text-ink-2">{lede}</div>}
          </div>
        </div>
        <div className="mt-14">{children}</div>
      </div>
    </section>
  );
}

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = "" }: CardProps) {
  return <div className={`rounded-2xl border rule bg-surface p-5 sm:p-7 ${className}`}>{children}</div>;
}
