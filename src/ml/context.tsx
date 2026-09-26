// Shared ML runtime: models are trained once (in the background, after first paint) and every
// component reads from the same results — Overview KPIs, Index Analysis, Temporal, Scenario Lab.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Dataset } from "@/data/engine";
import type { Year } from "@/data/nagpur";
import { forecast, heatIslands, landCover, trainLstModels, type ForecastResult, type IslandResult, type LandCoverResult, type LstModelResult } from "./pipeline";

export type StageKey = "lst" | "islands" | "landcover" | "forecast";
export type StageStatus = "queued" | "running" | "done";

export interface MLState {
  lst: LstModelResult | null;          // LST models for the current analysis year
  islands: IslandResult | null;
  landcover: LandCoverResult | null;
  forecast: ForecastResult | null;
  status: Record<StageKey, StageStatus>;
  timing: Partial<Record<StageKey, number>>;
  progress: number;                    // 0..1
  ready: boolean;                      // every stage finished
  year: Year;
}

const Ctx = createContext<MLState | null>(null);

const STAGES: { key: StageKey; label: string }[] = [
  { key: "lst", label: "LST models (OLS · RF · GBM)" },
  { key: "islands", label: "Heat islands (DBSCAN)" },
  { key: "landcover", label: "Land cover (k-means)" },
  { key: "forecast", label: "2030 forecast (GBM + trend)" },
];
export const STAGE_LABELS = Object.fromEntries(STAGES.map((s) => [s.key, s.label])) as Record<StageKey, string>;

export function MLProvider({ ds, year, children }: { ds: Dataset; year: Year; children: ReactNode }) {
  const [lst, setLst] = useState<LstModelResult | null>(null);
  const [islands, setIslands] = useState<IslandResult | null>(null);
  const [landcover, setLandcover] = useState<LandCoverResult | null>(null);
  const [fc, setFc] = useState<ForecastResult | null>(null);
  const [status, setStatus] = useState<Record<StageKey, StageStatus>>({ lst: "queued", islands: "queued", landcover: "queued", forecast: "queued" });
  const [timing, setTiming] = useState<Partial<Record<StageKey, number>>>({});
  const started = useRef(false);
  const lstCache = useRef(new Map<Year, LstModelResult>()).current;

  // Static stages — run once, sequentially, yielding to the event loop between stages so the UI stays responsive.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const run = async () => {
      const step = async <T,>(key: StageKey, fn: () => T, set: (v: T) => void) => {
        setStatus((s) => ({ ...s, [key]: "running" }));
        await new Promise((r) => setTimeout(r, 30));
        const t0 = performance.now();
        const v = fn();
        set(v);
        setTiming((t) => ({ ...t, [key]: performance.now() - t0 }));
        setStatus((s) => ({ ...s, [key]: "done" }));
      };
      await step("lst", () => { const r = trainLstModels(ds, year); lstCache.set(year, r); return r; }, setLst);
      await step("islands", () => heatIslands(ds, 4, 1.5, 4), setIslands);
      await step("landcover", () => landCover(ds, 5), setLandcover);
      await step("forecast", () => forecast(ds, 2030), setFc);
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Year-dependent stage — retrain the LST models when the analysis year changes (cached per year).
  useEffect(() => {
    if (status.lst === "queued") return; // initial run handles the first year
    const hit = lstCache.get(year);
    if (hit) { setLst(hit); return; }
    let cancelled = false;
    setStatus((s) => ({ ...s, lst: "running" }));
    const id = setTimeout(() => {
      const t0 = performance.now();
      const r = trainLstModels(ds, year);
      lstCache.set(year, r);
      if (cancelled) return;
      setLst(r);
      setTiming((t) => ({ ...t, lst: performance.now() - t0 }));
      setStatus((s) => ({ ...s, lst: "done" }));
    }, 30);
    return () => { cancelled = true; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const value = useMemo<MLState>(() => {
    const done = Object.values(status).filter((s) => s === "done").length;
    return { lst: lst && lst.year === year ? lst : null, islands, landcover, forecast: fc, status, timing, progress: done / STAGES.length, ready: done === STAGES.length, year };
  }, [lst, islands, landcover, fc, status, timing, year]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useML(): MLState {
  const c = useContext(Ctx);
  if (!c) throw new Error("MLProvider missing");
  return c;
}
