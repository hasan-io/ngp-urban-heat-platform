import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { cn } from "@/utils/cn";
import { getDataset, type Dataset } from "@/data/engine";
import type { Year } from "@/data/nagpur";
import { MLProvider } from "@/ml/context";
import { Footer, TopNav } from "@/components/Chrome";
import { loadLiveDataset, normalizeBaseUrl } from "@/data/live";
import { LanguageProvider } from "@/i18n";
import Overview from "@/views/Overview";
import ScenarioLab from "@/views/ScenarioLab";
import Explore from "@/views/Explore";
import Insights from "@/views/Insights";
import type { AreaKey } from "@/data/boundaries";
import { getDistrictDataset } from "@/data/districts";

const Methodology = lazy(() => import("@/views/Methodology"));
const HardwareSimulation = lazy(() => import("@/views/HardwareSimulation"));

export type UhiLayer = "lst" | "ndvi" | "ndbi" | "dlst" | "hotspot" | "islands" | "outlook";
export type Basemap = "dark" | "streets" | "satellite";
export type InspectMode = "zones" | "inspect";
export interface InspectedPixel { cell: number; lat: number; lon: number }
export type ViewKey = "home" | "explore" | "planning" | "hardware" | "insights" | "methodology";

export interface DataSourceState {
  status: "demo" | "loading" | "live" | "error";
  baseUrl: string;
  error?: string;
  progress?: { done: number; total: number; label: string };
}

interface AppState {
  view: ViewKey;
  setView: (v: ViewKey) => void;
  year: Year;
  setYear: (y: Year) => void;
  ds: Dataset;
  selectedArea: AreaKey;
  setSelectedArea: (a: AreaKey) => void;
  selectedLayer: UhiLayer;
  setSelectedLayer: (v: UhiLayer) => void;
  selectedBasemap: Basemap;
  setSelectedBasemap: (v: Basemap) => void;
  opacity: number;
  setOpacity: (v: number) => void;
  showZones: boolean;
  setShowZones: (v: boolean) => void;
  showLandmarks: boolean;
  setShowLandmarks: (v: boolean) => void;
  showZoneLabels: boolean;
  setShowZoneLabels: (v: boolean) => void;
  selectedZoneA: number | null;
  setSelectedZoneA: (v: number | null) => void;
  selectedZoneB: number | null;
  setSelectedZoneB: (v: number | null) => void;
  inspectMode: InspectMode;
  setInspectMode: (v: InspectMode) => void;
  inspectedPixel: InspectedPixel | null;
  setInspectedPixel: (v: InspectedPixel | null) => void;
  view3d: boolean;
  setView3d: (v: boolean) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  playbackRate: number;
  setPlaybackRate: (v: number) => void;
  scenarioZoneId: string;
  setScenarioZoneId: (v: string) => void;
  scenarioBaseline: "2024" | "2030";
  setScenarioBaseline: (v: "2024" | "2030") => void;
  vegetationChange: number;
  setVegetationChange: (v: number) => void;
  builtUpChange: number;
  setBuiltUpChange: (v: number) => void;
  dataSource: DataSourceState;
  connectLive: (baseUrl: string) => Promise<void>;
  useDemo: () => void;
}

const LS_KEY = "nagpur-uhi.service-url";
const YEAR_KEY = "nagpur-uhi.selected-year";

const Ctx = createContext<AppState | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("AppContext missing");
  return c;
};

export default function App() {
  const [view, setView] = useState<ViewKey>("home");
  const [year, setYear] = useState<Year>(() => {
    const saved = Number(localStorage.getItem(YEAR_KEY));
    return ([2019, 2020, 2021, 2022, 2023, 2024] as number[]).includes(saved) ? saved as Year : 2024;
  });
  const [ds, setDs] = useState<Dataset>(() => getDataset());
  const [dataSource, setDataSource] = useState<DataSourceState>({ status: "demo", baseUrl: localStorage.getItem(LS_KEY) ?? "" });
  const [selectedArea, setSelectedArea] = useState<AreaKey>("nagpur");
  const [selectedLayer, setSelectedLayer] = useState<UhiLayer>("lst");
  const [selectedBasemap, setSelectedBasemap] = useState<Basemap>("streets");
  const [opacity, setOpacity] = useState(0.72);
  const [showZones, setShowZones] = useState(true);
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [showZoneLabels, setShowZoneLabels] = useState(false);
  const [selectedZoneA, setSelectedZoneA] = useState<number | null>(8);
  const [selectedZoneB, setSelectedZoneB] = useState<number | null>(4);
  const [inspectMode, setInspectMode] = useState<InspectMode>("zones");
  const [inspectedPixel, setInspectedPixel] = useState<InspectedPixel | null>(null);
  const [view3d, setView3d] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [scenarioZoneId, setScenarioZoneId] = useState("besa");
  const [scenarioBaseline, setScenarioBaseline] = useState<"2024" | "2030">("2024");
  const [vegetationChange, setVegetationChange] = useState(20);
  const [builtUpChange, setBuiltUpChange] = useState(0);

  const activeDs = useMemo(() => {
    if (selectedArea === "nagpur") return ds;
    return getDistrictDataset(selectedArea) ?? ds;
  }, [selectedArea, ds]);

  const connectLive = useCallback(async (baseUrl: string) => {
    const base = normalizeBaseUrl(baseUrl);
    setDataSource({ status: "loading", baseUrl: base });
    try {
      const live = await loadLiveDataset(base, (done, total, label) => setDataSource((d) => ({ ...d, progress: { done, total, label } })));
      localStorage.setItem(LS_KEY, base);
      setDs(live);
      setDataSource({ status: "live", baseUrl: base });
    } catch (e) {
      setDataSource({ status: "error", baseUrl: base, error: (e as Error).message });
    }
  }, []);

  const useDemo = useCallback(() => {
    localStorage.removeItem(LS_KEY);
    setDs(getDataset());
    setDataSource({ status: "demo", baseUrl: "" });
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) void connectLive(saved).catch(() => undefined);
  }, [connectLive]);

  useEffect(() => {
    localStorage.setItem(YEAR_KEY, String(year));
  }, [year]);

  const state = useMemo<AppState>(() => ({
    view, setView, year, setYear,
    ds: activeDs,
    selectedArea, setSelectedArea,
    selectedLayer, setSelectedLayer, selectedBasemap, setSelectedBasemap, opacity, setOpacity,
    showZones, setShowZones, showLandmarks, setShowLandmarks, showZoneLabels, setShowZoneLabels,
    selectedZoneA, setSelectedZoneA, selectedZoneB, setSelectedZoneB, inspectMode, setInspectMode,
    inspectedPixel, setInspectedPixel, view3d, setView3d, playing, setPlaying, playbackRate, setPlaybackRate,
    scenarioZoneId, setScenarioZoneId, scenarioBaseline, setScenarioBaseline, vegetationChange, setVegetationChange, builtUpChange, setBuiltUpChange,
    dataSource, connectLive, useDemo,
  }), [
    view, year, activeDs, selectedArea,
    selectedLayer, selectedBasemap, opacity, showZones, showLandmarks, showZoneLabels,
    selectedZoneA, selectedZoneB, inspectMode, inspectedPixel, view3d, playing, playbackRate,
    scenarioZoneId, scenarioBaseline, vegetationChange, builtUpChange, dataSource, connectLive, useDemo,
  ]);

  return (
    <LanguageProvider>
      <Ctx.Provider value={state}>
        <MLProvider key={activeDs.id} ds={activeDs} year={year}>
          <div className={cn("flex h-full min-h-screen flex-col", "uhi-light bg-white")}>
            <TopNav />

            <main className="flex min-w-0 flex-1 flex-col">
              {dataSource.status === "loading" && (
                <div className="no-print border-b border-emerald-400/20 bg-emerald-500/10 px-4 py-1.5 text-[11px] text-emerald-100 sm:px-6">
                  Loading live composites from {dataSource.baseUrl}{dataSource.progress ? ` · ${dataSource.progress.label} (${dataSource.progress.done}/${dataSource.progress.total})` : "…"}
                </div>
              )}
              {dataSource.status === "error" && (
                <div className="no-print flex items-center justify-between gap-3 border-b border-amber-400/20 bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-100 sm:px-6">
                  <span>Data service unavailable ({dataSource.error}). Showing the demonstration dataset.</span>
                  <button onClick={() => setDataSource((d) => ({ ...d, status: "demo" }))} className="shrink-0 text-amber-200 hover:text-white">dismiss</button>
                </div>
              )}
              <div className="flex-1">
                <Suspense fallback={<div className="flex h-96 items-center justify-center text-sm text-slate-400">Loading…</div>}>
                  {view === "home" && <Overview />}
                  {view === "explore" && <Explore />}
                  {view === "planning" && <ScenarioLab />}
                  {view === "hardware" && <HardwareSimulation />}
                  {view === "insights" && <Insights />}
                  {view === "methodology" && <Methodology />}
                </Suspense>
              </div>
              {view === "insights" || view === "methodology" ? <Footer /> : null}
            </main>
          </div>
        </MLProvider>
      </Ctx.Provider>
    </LanguageProvider>
  );
}