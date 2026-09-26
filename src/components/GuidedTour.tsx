import { useEffect, useState, type CSSProperties } from "react";
import { cn } from "@/utils/cn";

export interface TourStep { target: string; text: string }

/** Compact five-step spotlight tour, consistent with the Scenario Lab walkthrough. */
export default function GuidedTour({
  steps, step, onBack, onNext, onSkip, storageKey,
}: {
  steps: TourStep[];
  step: number | null;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  storageKey: string;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (step === null || !steps[step]) { setRect(null); return; }
    const target = steps[step].target;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
      if (el) setRect(el.getBoundingClientRect());
    };
    const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    measure();
    const t = window.setTimeout(measure, 420);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.clearTimeout(t); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [step, steps]);

  if (step === null || !steps[step] || !rect) return null;
  const last = step === steps.length - 1;
  const below = rect.bottom + 230 < window.innerHeight;
  const top = below ? Math.min(rect.bottom + 14, window.innerHeight - 230) : Math.max(12, rect.top - 224);
  const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - 356));
  const strips: CSSProperties[] = [
    { top: 0, left: 0, right: 0, height: Math.max(0, rect.top) },
    { top: rect.bottom, left: 0, right: 0, bottom: 0 },
    { top: rect.top, left: 0, width: Math.max(0, rect.left), height: rect.height },
    { top: rect.top, left: rect.right, right: 0, height: rect.height },
  ];
  const complete = () => { localStorage.setItem(storageKey, "1"); onSkip(); };

  return (
    <>
      {strips.map((style, i) => <div key={i} className="fixed z-[900] bg-[rgba(15,23,42,0.55)]" style={style} />)}
      <div className="pointer-events-none fixed z-[901] rounded-xl border-2 border-orange-500" style={{ top: rect.top - 3, left: rect.left - 3, width: rect.width + 6, height: rect.height + 6, boxShadow: "0 0 0 5px rgba(249,115,22,0.25)" }} />
      <div className="fixed z-[902] w-[344px] max-w-[calc(100vw-24px)] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl" style={{ top, left }}>
        <div className="flex items-center justify-between"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Step {step + 1} of {steps.length}</p><div className="flex gap-1">{steps.map((_, i) => <span key={i} className={cn("h-1.5 w-1.5 rounded-full", i <= step ? "bg-blue-600" : "bg-slate-200")} />)}</div></div>
        <p className="mt-2 text-sm leading-relaxed text-slate-800">{steps[step].text}</p>
        <div className="mt-4 flex items-center justify-between"><button onClick={complete} className="text-xs font-medium text-slate-500 hover:text-slate-700">Skip Tour</button><div className="flex items-center gap-2"><button onClick={onBack} disabled={step === 0} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Back</button><button onClick={last ? complete : onNext} className="rounded-lg bg-[#0f172a] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1e293b]">{last ? "Finish" : "Next"}</button></div></div>
      </div>
    </>
  );
}