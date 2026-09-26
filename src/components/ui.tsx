import type { ReactNode } from "react";
import { cn } from "@/utils/cn";
import { RAMPS, rampGradient, type LayerKey } from "@/data/colors";
import { YEARS, type Year } from "@/data/nagpur";

export function Card({ title, subtitle, right, children, className, bodyClassName }: {
  title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-slate-200 bg-white shadow-md hover:shadow-lg transition-shadow", className)}>
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

export function KPI({ label, value, sub, tone = "neutral", icon }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: "neutral" | "hot" | "green" | "violet" | "sky" | "amber"; icon?: ReactNode;
}) {
  const tones: Record<string, { bg: string; border: string; text: string }> = {
    neutral: { bg: "#F8FAFC", border: "#E2E8F0", text: "#1E293B" },
    hot: { bg: "#FEF3C7", border: "#FDE68A", text: "#92400E" },
    green: { bg: "#ECFDF5", border: "#D1FAE5", text: "#065F46" },
    violet: { bg: "#F3E8FF", border: "#E9D5FF", text: "#5B21B6" },
    sky: { bg: "#EFF6FF", border: "#BFE7FF", text: "#0369A1" },
    amber: { bg: "#FFFBEB", border: "#FEE2A5", text: "#92400E" },
  };

  const t = tones[tone];
  return (
    <div 
      className="rounded-lg border p-3 transition-all hover:shadow-sm"
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

export function SectionHeader({ n, title, purpose, why, children }: { n: number; title: string; purpose: string; why: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 text-sm font-bold text-white shadow-lg">{n}</span>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h2>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-slate-700">{purpose}</p>
        <p className="mt-1 max-w-3xl text-xs text-slate-600"><span className="font-semibold text-slate-700">Why it matters:</span> {why}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Legend({ layer, className, compact }: { layer: LayerKey; className?: string; compact?: boolean }) {
  const r = RAMPS[layer];
  return (
    <div className={cn("text-xs text-slate-600", className)}>
      {!compact && <p className="mb-2 font-semibold text-slate-700">{r.label}</p>}
      <div className="h-2.5 w-full rounded-full shadow-sm" style={{ background: rampGradient(layer) }} />
      <div className="mt-1.5 flex justify-between tabular-nums text-[11px] font-medium text-slate-600">
        {r.ticks.map((t) => (
          <span key={t}>{t}{r.unit}</span>
        ))}
      </div>
    </div>
  );
}

export function Pill({ children, tone = "slate", className }: { children: ReactNode; tone?: "slate" | "green" | "red" | "amber" | "violet" | "sky" | "orange"; className?: string }) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    green: "bg-emerald-100 text-emerald-700 border-emerald-300",
    red: "bg-red-100 text-red-700 border-red-300",
    amber: "bg-amber-100 text-amber-700 border-amber-300",
    violet: "bg-violet-100 text-violet-700 border-violet-300",
    sky: "bg-sky-100 text-sky-700 border-sky-300",
    orange: "bg-orange-100 text-orange-700 border-orange-300",
  };
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", tones[tone], className)}>{children}</span>;
}

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
            "rounded-md font-semibold transition-all",
            size === "sm" ? "px-3 py-1.5 text-xs" : "px-2 py-1 text-[11px]",
            o.value === value 
              ? "bg-orange-500 text-white shadow-md" 
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-50",
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

export function Slider({ label, value, min, max, step = 1, onChange, format, accent = "#f97316" }: {
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
        style={{ background: `linear-gradient(90deg, ${accent} ${pct}%, rgba(203,213,225,0.3) ${pct}%)` }}
      />
    </label>
  );
}

export function Stat({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 py-2 text-xs last:border-0">
      <span className="text-slate-600 font-medium">{label}</span>
      <span className={cn("font-bold tabular-nums text-slate-900", tone)}>{value}</span>
    </div>
  );
}

export function Formula({ children }: { children: ReactNode }) {
  return <code className="rounded-md bg-slate-100 px-2.5 py-1 font-mono text-xs text-orange-700 border border-slate-200">{children}</code>;
}

export const chartTheme = {
  grid: "rgba(100,116,139,0.15)",
  axis: "#64748b",
  tooltip: { background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, fontSize: 12, shadow: "0 4px 12px rgba(15, 23, 42, 0.1)" },
};