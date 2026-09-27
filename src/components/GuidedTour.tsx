import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Keyboard, Sparkles, X } from "lucide-react";
import { useI18n } from "@/i18n";
import { cn } from "@/utils/cn";

export interface TourStep {
  target: string;
  text: string;
  /** Optional bold heading shown above the description. */
  title?: string;
}

/**
 * Compact five-step spotlight tour.
 *
 * Features:
 * - Animated progress bar + dot indicators
 * - Step title, numbered badge, "Step X of Y" label
 * - Arrow pointer that anchors to the highlighted element
 * - Keyboard navigation: ← back, → / Enter next, Esc skip
 * - Auto-flips above/below target based on available space
 * - Smooth fade + scale entrance per step
 * - Orange accent across all interactive elements
 */
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
  const { t } = useI18n();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [visible, setVisible] = useState(false);

  /* -------- entrance animation per step -------- */
  useEffect(() => {
    if (step === null) { setVisible(false); return; }
    setVisible(false);
    const timer = window.setTimeout(() => setVisible(true), 30);
    return () => window.clearTimeout(timer);
  }, [step]);

  /* -------- measure + track the highlighted element -------- */
  useEffect(() => {
    if (step === null || !steps[step]) { setRect(null); return; }
    const target = steps[step].target;

    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
      if (el) setRect(el.getBoundingClientRect());
      else setRect(null);
    };

    const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });

    measure();
    const settle = window.setTimeout(measure, 420);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step, steps]);

  /* -------- keyboard navigation -------- */
  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        try { localStorage.setItem(storageKey, "1"); } catch { /* ignore */ }
        onSkip();
      } else if (e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        if (step === steps.length - 1) {
          try { localStorage.setItem(storageKey, "1"); } catch { /* ignore */ }
          onSkip();
        } else {
          onNext();
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (step > 0) onBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, steps.length, onBack, onNext, onSkip, storageKey]);

  /* -------- layout: place the card above or below the target -------- */
  const layout = useMemo(() => {
    if (!rect || typeof window === "undefined") return null;
    const CARD_W = 356;
    const CARD_H = 260; // estimated; only used for direction + clamping
    const GAP = 14;

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const placeBelow = spaceBelow >= CARD_H + GAP || spaceBelow >= spaceAbove;

    const rawTop = placeBelow ? rect.bottom + GAP : rect.top - CARD_H - GAP;
    const top = Math.min(Math.max(12, rawTop), Math.max(12, window.innerHeight - CARD_H - 12));

    const rawLeft = rect.left + rect.width / 2 - CARD_W / 2;
    const left = Math.min(Math.max(12, rawLeft), Math.max(12, window.innerWidth - CARD_W - 12));

    // arrow X position relative to the card's left edge
    const arrowX = Math.min(
      Math.max(24, rect.left + rect.width / 2 - left - 10),
      CARD_W - 44,
    );

    return { top, left, arrowX, placeBelow };
  }, [rect]);

  if (step === null || !steps[step] || !rect || !layout) return null;

  const current = steps[step];
  const last = step === steps.length - 1;
  const progress = ((step + 1) / steps.length) * 100;

  const complete = () => {
    try { localStorage.setItem(storageKey, "1"); } catch { /* ignore */ }
    onSkip();
  };

  /* -------- backdrop strips (leave a "hole" over the target) -------- */
  const strips: CSSProperties[] = [
    { top: 0, left: 0, right: 0, height: Math.max(0, rect.top) },
    { top: rect.bottom, left: 0, right: 0, bottom: 0 },
    { top: rect.top, left: 0, width: Math.max(0, rect.left), height: rect.height },
    { top: rect.top, left: rect.right, right: 0, height: rect.height },
  ];

  return (
    <>
      {/* backdrop */}
      {strips.map((style, i) => (
        <div
          key={i}
          className="fixed z-[900] bg-slate-900/55 backdrop-blur-[1.5px] transition-opacity duration-200"
          style={style}
        />
      ))}

      {/* spotlight ring with soft glow */}
      <div
        className="pointer-events-none fixed z-[901] rounded-xl border-2 border-[#FF6B35] transition-all duration-300 ease-out"
        style={{
          top: rect.top - 4,
          left: rect.left - 4,
          width: rect.width + 8,
          height: rect.height + 8,
          boxShadow: "0 0 0 5px rgba(255,107,53,0.20), 0 0 30px 4px rgba(255,107,53,0.35)",
        }}
      />
      {/* animated pulse ring */}
      <div
        className="pointer-events-none fixed z-[901] animate-pulse rounded-xl border-2 border-[#FF6B35]/50"
        style={{
          top: rect.top - 10,
          left: rect.left - 10,
          width: rect.width + 20,
          height: rect.height + 20,
        }}
      />

      {/* tooltip wrapper — arrow lives here so it can escape the card's overflow */}
      <div
        className="fixed z-[902] w-[356px] max-w-[calc(100vw-24px)]"
        style={{ top: layout.top, left: layout.left }}
      >
        {/* pointer arrow */}
        {layout.placeBelow ? (
          <div
            className="absolute -top-[9px] h-0 w-0 border-l-[10px] border-r-[10px] border-b-[10px] border-l-transparent border-r-transparent border-b-white"
            style={{ left: layout.arrowX }}
            aria-hidden
          />
        ) : (
          <div
            className="absolute -bottom-[9px] h-0 w-0 border-l-[10px] border-r-[10px] border-t-[10px] border-l-transparent border-r-transparent border-t-white"
            style={{ left: layout.arrowX }}
            aria-hidden
          />
        )}

        {/* card */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("common.stepOf", { n: step + 1, total: steps.length })}
          className={cn(
            "overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.22)] transition-all duration-200 ease-out",
            visible ? "scale-100 opacity-100" : "translate-y-1 scale-[0.98] opacity-0",
          )}
        >
          {/* progress bar */}
          <div className="h-1 w-full overflow-hidden bg-slate-100">
            <div
              className="h-full bg-[#FF6B35] transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="p-4">
            {/* header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#FF6B35] text-[11px] font-bold text-white shadow-sm">
                  {step + 1}
                </span>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {t("common.stepOf", { n: step + 1, total: steps.length })}
                </p>
              </div>
              <button
                onClick={complete}
                aria-label={t("common.close")}
                className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* dot indicators */}
            <div className="mt-2 flex items-center gap-1">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    i === step
                      ? "w-5 bg-[#FF6B35]"
                      : i < step
                        ? "w-1.5 bg-[#FF6B35]/40"
                        : "w-1.5 bg-slate-200",
                  )}
                />
              ))}
            </div>

            {/* content */}
            <div className="mt-3">
              {current.title && (
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <Sparkles className="h-3.5 w-3.5 text-[#FF6B35]" />
                  {current.title}
                </h3>
              )}
              <p className={cn("text-sm leading-relaxed text-slate-700", current.title && "mt-1")}>
                {current.text}
              </p>
            </div>

            {/* keyboard hint */}
            <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-400">
              <Keyboard className="h-3 w-3" />
              <span className="flex flex-wrap items-center gap-1">
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[9px] text-slate-600">←</kbd>
                <span>/</span>
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[9px] text-slate-600">→</kbd>
                <span>{t("common.next")}</span>
                <span className="mx-0.5">·</span>
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[9px] text-slate-600">Esc</kbd>
                <span>{t("common.skip")}</span>
              </span>
            </div>

            {/* actions */}
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <button
                onClick={complete}
                className="text-xs font-medium text-slate-500 transition hover:text-slate-800"
              >
                {t("common.skip")}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={onBack}
                  disabled={step === 0}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-3 w-3" />
                  {t("common.back")}
                </button>
                <button
                  onClick={last ? complete : onNext}
                  className="flex items-center gap-1 rounded-lg bg-[#FF6B35] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#e85a28]"
                >
                  {last ? t("common.finish") : t("common.next")}
                  {!last && <ChevronRight className="h-3 w-3" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}