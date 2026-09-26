import type { ReactNode } from "react";
import { BrainCircuit, Check, Loader2 } from "lucide-react";
import { STAGE_LABELS, useML, type StageKey } from "@/ml/context";
import { cn } from "@/utils/cn";

/** Small provenance tag: which method produced the number next to it. */
export function Method({ kind, children, className }: { kind: "ml" | "stat" | "physics" | "cv"; children?: ReactNode; className?: string }) {
  const tones = {
    ml: "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200",
    cv: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
    stat: "border-sky-400/30 bg-sky-500/10 text-sky-200",
    physics: "border-amber-400/30 bg-amber-500/10 text-amber-200",
  };
  const label = { ml: "ML", cv: "validated", stat: "statistical", physics: "physics" }[kind];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider", tones[kind], className)}>
      {kind === "ml" && <BrainCircuit className="h-3 w-3" />}
      {kind === "cv" && <Check className="h-3 w-3" />}
      {children ?? label}
    </span>
  );
}

/** Placeholder rendered while a model is still training. */
export function MLPending({ stage, height = 160, className }: { stage: StageKey; height?: number; className?: string }) {
  const ml = useML();
  const s = ml.status[stage];
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-slate-950/40 text-xs text-slate-400", className)} style={{ height }}>
      <Loader2 className="h-4 w-4 animate-spin text-fuchsia-400" />
      <span>{s === "running" ? "Training" : "Queued"} · {STAGE_LABELS[stage]}</span>
    </div>
  );
}

/** Compact status strip for the sidebar footer. */
export function MLStatus() {
  const ml = useML();
  const stages = Object.keys(ml.status) as StageKey[];
  return (
    <div className="rounded-xl border border-white/8 bg-slate-900/60 p-3 text-[11px] text-slate-400">
      <div className="flex items-center gap-2 text-slate-200">
        <BrainCircuit className="h-3.5 w-3.5 text-fuchsia-400" />
        <span className="font-medium">Model runtime</span>
        <span className={cn("ml-auto rounded-md px-1.5 py-0.5 font-semibold", ml.ready ? "bg-emerald-500/20 text-emerald-200" : "bg-fuchsia-500/20 text-fuchsia-200")}>{ml.ready ? "ready" : `${Math.round(ml.progress * 100)}%`}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-indigo-500 transition-all" style={{ width: `${ml.progress * 100}%` }} /></div>
      <ul className="mt-2 space-y-1">
        {stages.map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            {ml.status[k] === "done" ? <Check className="h-3 w-3 text-emerald-400" /> : ml.status[k] === "running" ? <Loader2 className="h-3 w-3 animate-spin text-fuchsia-400" /> : <span className="h-3 w-3 rounded-full border border-white/15" />}
            <span className={cn(ml.status[k] === "done" ? "text-slate-300" : "text-slate-500")}>{STAGE_LABELS[k]}</span>
            {ml.timing[k] != null && <span className="ml-auto tabular-nums text-slate-600">{(ml.timing[k]! / 1000).toFixed(1)}s</span>}
          </li>
        ))}
      </ul>
      <p className="mt-2 leading-relaxed text-slate-500">Models train in-browser on the analysis cube; the Python service (<code className="text-slate-400">nagpur_uhi</code>) runs the same pipeline at production scale.</p>
    </div>
  );
}
