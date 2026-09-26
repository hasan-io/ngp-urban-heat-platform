import type { ReactNode } from "react";
import { cn } from "@/utils/cn";
import { RAMPS, rampGradient, type LayerKey } from "@/data/colors";
import { YEARS, type Year } from "@/data/nagpur";

/* -------------------------------------------------------------------------- */
/*  Card                                                                      */
/* -------------------------------------------------------------------------- */
export function Card({ title, subtitle, right, children, className, bodyClassName }: {
  title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-slate-200 bg-white",
        // Design system: shadow 0 2px 8px rgba(0,0,0,0.08), hover 0 4px 12px, smooth 0.2s
        "shadow-[0_2px_8px_rgba(15,23,42,0.08)] transition-shadow duration-200 ease-out hover:shadow-[0_4px_12px_rgba(15,23,42,0.12)]",
        className,
      )}
    >
      {(title || right) && (
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4">
          <div>
            {title && <h3 className="text-base font-semibold tracking-tight text-slate-900">{title}</h3>}
            {subtitle && <p className="mt-1 text-xs text-slate-600">{subtitle}</p>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  KPI                                                                       */
/* -------------------------------------------------------------------------- */
export function KPI({ label, value, sub, tone = "neutral", icon }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: "neutral" | "hot" | "green" | "violet" | "sky" | "amber"; icon?: ReactNode;
}) {
  const tones: Record<string, { bg: string; border: string; text: string }> = {
    neutral: { bg: "#F8FAFC", border: "#E2E8F0", text: "#0f172a" },
    hot: { bg: "#FFF7ED", border: "#FED7AA", text: "#C2410C" },
    green: { bg: "#ECFDF5", border: "#D1FAE5", text: "#065F46" },
    violet: { bg: "#F5F3FF", border: "#E9D5FF", text: "#6D28D9" },
    sky: { bg: "#EFF6FF", border: "#BFDBFE", text: "#0369A1" },
    amber: { bg: "#FFFBEB", border: "#FDE68A", text: "#92400E" },
  };
  const t = tones[tone];
  return (
    <div
      className="rounded-lg border p-3 transition-all hover:shadow-[0_2px_8px_rgba(15,23,42,0.06)]"
      style={{ backgroundColor: t.bg, borderColor: t.border }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{label}</p>
        {icon && <span className="opacity-90">{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums" style={{ color: t.text }}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-slate-600">{sub}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  SectionHeader — 4px orange left border + light background                 */
/*  Applied on Index Analysis and any numbered section.                       */
/* -------------------------------------------------------------------------- */
export function SectionHeader({ n, title, purpose, why, children }: {
  n: number; title: string; purpose: string; why: string; children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-r-xl border-l-4 border-[#FF6B35] bg-[#f9fafb] py-4 pr-4 pl-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FF6B35] text-sm font-bold text-white shadow-sm">
            {n}
          </span>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h2>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-slate-700">{purpose}</p>
        <p className="mt-1 max-w-3xl text-xs text-slate-600">
          <span className="font-semibold text-slate-700">Why it matters:</span> {why}
        </p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Legend — clean readable gradient with tick marks                          */
/* -------------------------------------------------------------------------- */
export function Legend({ layer, className, compact }: { layer: LayerKey; className?: string; compact?: boolean }) {
  const r = RAMPS[layer];
  return (
    <div className={cn("text-xs text-slate-600", className)}>
      {!compact && <p className="mb-2 font-semibold text-slate-700">{r.label}</p>}
      <div className="h-2.5 w-full rounded-full shadow-sm ring-1 ring-slate-200" style={{ background: rampGradient(layer) }} />
      <div className="relative mt-1.5">
        {/* Tick marks at labeled intervals */}
        <div className="absolute -top-[3px] left-0 right-0 flex justify-between">
          {r.ticks.map((t) => (
            <span key={t} className="h-1.5 w-px bg-slate-400/70" aria-hidden />
          ))}
        </div>
        <div className="flex justify-between pt-1 tabular-nums text-[11px] font-medium text-slate-600">
          {r.ticks.map((t) => (
            <span key={t}>{t}{r.unit}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Pill                                                                      */
/* -------------------------------------------------------------------------- */
export function Pill({ children, tone = "slate", className }: {
  children: ReactNode;
  tone?: "slate" | "green" | "red" | "amber" | "violet" | "sky" | "orange";
  className?: string;
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    red: "bg-red-50 text-red-700 border-red-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
    sky: "bg-sky-50 text-sky-700 border-sky-200",
    // Orange uses the primary accent tone exactly
    orange: "bg-orange-50 text-[#C2410C] border-orange-200",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", tones[tone], className)}>
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Segmented — selected state is always orange (#FF6B35)                     */
/* -------------------------------------------------------------------------- */
export function Segmented<T extends string | number>({ options, value, onChange, size = "sm" }: {
  options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; size?: "sm" | "xs";
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md font-semibold transition-all duration-150",
            size === "sm" ? "px-3 py-1.5 text-xs" : "px-2 py-1 text-[11px]",
            o.value === value
              ? "bg-[#FF6B35] text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function YearPicker({ value, onChange }: { value: Year; onChange: (y: Year) => void }) {
  return <Segmented options={YEARS.map((y) => ({ value: y, label: y }))} value={value} onChange={onChange} />;
}

/* -------------------------------------------------------------------------- */
/*  Slider                                                                    */
/* -------------------------------------------------------------------------- */
export function Slider({ label, value, min, max, step = 1, onChange, format, accent = "#FF6B35" }: {
  label: ReactNode; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; accent?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-slate-700 font-medium">{label}</span>
        <span className="font-bold tabular-nums text-slate-900">{format ? format(value) : value}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="range-input w-full"
        style={{ background: `linear-gradient(90deg, ${accent} ${pct}%, rgba(203,213,225,0.4) ${pct}%)` }}
      />
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/*  Stat                                                                      */
/* -------------------------------------------------------------------------- */
export function Stat({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 py-2 text-xs last:border-0">
      <span className="text-slate-600 font-medium">{label}</span>
      <span className={cn("font-bold tabular-nums text-slate-900", tone)}>{value}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Formula — monospace chip                                                  */
/* -------------------------------------------------------------------------- */
export function Formula({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs text-[#C2410C]">
      {children}
    </code>
  );
}

/* -------------------------------------------------------------------------- */
/*  Chart theme — soft grid lines (#e2e8f0), readable axis, light tooltip     */
/* -------------------------------------------------------------------------- */
export const chartTheme = {
  grid: "#e2e8f0",
  axis: "#64748b",
  tooltip: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    fontSize: 12,
    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.10)",
  } as const,
};