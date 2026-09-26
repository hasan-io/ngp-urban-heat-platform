import { useEffect, useRef, useState } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, ChevronDown, ClipboardList, Compass, Database, Download, FileJson, FileSpreadsheet, FlaskConical, HelpCircle, Home, Loader2, Map as MapIcon, Plug, Printer, RefreshCw, X } from "lucide-react";
import { useApp, type ViewKey } from "@/App";
import { exportAnalysisJson, exportZonesCsv, exportZonesGeoJson } from "@/data/decision";
import { probeService, type ServiceInfo } from "@/data/live";
import { cn } from "@/utils/cn";

export const APP_VERSION = "1.2.0";

const NAV: { key: ViewKey; label: string; icon: typeof Home }[] = [
  { key: "home", label: "Home", icon: Home },
  { key: "explore", label: "Analysis / Explore", icon: Compass },
  { key: "planning", label: "Scenario Lab", icon: FlaskConical },
  { key: "insights", label: "Insights & Reports", icon: ClipboardList },
  { key: "methodology", label: "Methods & Validation", icon: BookOpen },
];

// ------------------------------------------------------------------ data source badge + dialog
export function DataSourceBadge({ onClick }: { onClick: () => void }) {
  const { ds, dataSource } = useApp();
  const live = ds.source === "live";
  const busy = dataSource.status === "loading";
  return (
    <button onClick={onClick} className={cn("flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium transition", live ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15" : "border-amber-400/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15")} title="Data source settings">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className={cn("h-2 w-2 rounded-full", live ? "bg-emerald-400" : "bg-amber-400")} />}
      <span className="hidden sm:inline">{busy ? "Loading live data…" : live ? ds.label : "Demonstration dataset"}</span>
      <span className="sm:hidden">{live ? "Live" : "Demo"}</span>
      <ChevronDown className="h-3 w-3 opacity-60" />
    </button>
  );
}

export function DataSourceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ds, dataSource, connectLive, useDemo } = useApp();
  const [url, setUrl] = useState(dataSource.baseUrl || "http://localhost:8000");
  const [probe, setProbe] = useState<{ state: "idle" | "testing" | "ok" | "fail"; info?: ServiceInfo; error?: string }>({ state: "idle" });
  useEffect(() => { if (open) setProbe({ state: "idle" }); }, [open]);
  if (!open) return null;

  const test = async () => {
    setProbe({ state: "testing" });
    try { setProbe({ state: "ok", info: await probeService(url) }); }
    catch (e) { setProbe({ state: "fail", error: (e as Error).message }); }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-950 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <div className="flex items-center gap-2"><Database className="h-4 w-4 text-sky-300" /><h3 className="text-sm font-semibold text-white">Data source</h3></div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          {/* current */}
          <div className={cn("rounded-xl border p-4", ds.source === "live" ? "border-emerald-400/30 bg-emerald-500/5" : "border-amber-400/30 bg-amber-500/5")}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Currently loaded</p>
            <p className="mt-1 text-sm font-semibold text-white">{ds.label}</p>
            <ul className="mt-2 space-y-1 text-[11px] text-slate-300">
              <li>Grid {ds.h} × {ds.w} cells · {ds.cellAreaKm2 < 0.05 ? `${Math.round(Math.sqrt(ds.cellAreaKm2) * 1000)} m` : `${(Math.sqrt(ds.cellAreaKm2) * 1000).toFixed(0)} m`} · {ds.years[0]}–{ds.years[ds.years.length - 1]}</li>
              <li>Source: {ds.meta.serviceSource ?? ds.source}{ds.meta.fetchedAt ? ` · fetched ${new Date(ds.meta.fetchedAt).toLocaleString()}` : ""}</li>
              {ds.meta.baseUrl && <li className="truncate">Service: {ds.meta.baseUrl}</li>}
            </ul>
            {ds.source === "demo" && (
              <p className="mt-3 flex gap-2 text-[11px] leading-relaxed text-amber-200/90"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />Demonstration composites are model-generated and calibrated to Nagpur's geography. They exercise every feature of the platform but must not be used for operational decisions.</p>
            )}
            {ds.source === "live" && <button onClick={() => { useDemo(); onClose(); }} className="mt-3 text-[11px] font-medium text-slate-400 hover:text-white">Switch back to demonstration dataset</button>}
          </div>
          {/* connect */}
          <div className="rounded-xl border border-white/10 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Connect the data service</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">Point the interface at a running <code className="text-slate-200">nagpur_uhi</code> service (Python · FastAPI). It publishes Landsat 8/9 + Sentinel-2 composites for the same AOI and years.</p>
            <label className="mt-3 block text-[11px] text-slate-400">Service URL
              <input value={url} onChange={(e) => { setUrl(e.target.value); setProbe({ state: "idle" }); }} placeholder="https://uhi.nagpur.example/api" className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 font-mono text-xs text-white outline-none focus:border-sky-400/60" />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={test} disabled={probe.state === "testing"} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-50">{probe.state === "testing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Test connection</button>
              <button onClick={() => { void connectLive(url); onClose(); }} disabled={probe.state !== "ok"} className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"><Plug className="h-3.5 w-3.5" /> Connect & load</button>
            </div>
            {probe.state === "ok" && probe.info && (
              <div className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3 text-[11px] text-emerald-100">
                <p className="flex items-center gap-1.5 font-semibold"><CheckCircle2 className="h-3.5 w-3.5" /> Service reachable · contract OK</p>
                <p className="mt-1 text-emerald-200/80">Grid {probe.info.shape[0]} × {probe.info.shape[1]} · source {probe.info.source} · years {probe.info.years[0]}–{probe.info.years[probe.info.years.length - 1]}{probe.info.gridResM ? ` · ${probe.info.gridResM} m` : ""}</p>
                <p className="mt-0.5 text-emerald-200/80">Quality: {Object.entries(probe.info.quality).map(([y, q]) => `${y} ${q.quality}`).join(" · ") || "n/a"}</p>
              </div>
            )}
            {probe.state === "fail" && (
              <div className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-[11px] text-red-100">
                <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> Could not connect</p>
                <p className="mt-1 break-words text-red-200/80">{probe.error}</p>
                <p className="mt-1 text-red-200/60">Start the service with <code>python -m nagpur_uhi serve --port 8000</code> (CORS is enabled by default) and make sure the URL is reachable from this browser.</p>
              </div>
            )}
            {dataSource.status === "error" && probe.state === "idle" && <p className="mt-3 text-[11px] text-red-300">Last attempt failed: {dataSource.error}</p>}
          </div>
        </div>
        <div className="border-t border-white/8 px-5 py-3 text-[11px] text-slate-500">
          Contract: <code className="text-slate-400">GET /api/summary · /api/raster/{"{lst|ndvi|ndbi|water}"}/{"{year}"} · /api/scenes</code> · AOI 78.94–79.22 °E, 21.02–21.26 °N · years 2019–2024. Service documentation: python/README.md in the platform repository.
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ export menu
export function ExportMenu() {
  const { ds } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const items = [
    { icon: FileSpreadsheet, label: "Zone statistics (CSV)", hint: "All years · HVI · interventions", run: () => exportZonesCsv(ds) },
    { icon: MapIcon, label: "Zones with attributes (GeoJSON)", hint: "Open in QGIS / ArcGIS", run: () => exportZonesGeoJson(ds) },
    { icon: FileJson, label: "Full analysis (JSON)", hint: "City stats · regression · trends · register", run: () => exportAnalysisJson(ds) },
    { icon: Printer, label: "Print / save as PDF", hint: "Current page, print layout", run: () => window.print() },
  ];
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10"><Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">Export</span><ChevronDown className="h-3 w-3 opacity-60" /></button>
      {open && (
        <div className="absolute right-0 z-[600] mt-1 w-72 overflow-hidden rounded-xl border border-white/10 bg-slate-950 shadow-2xl">
          {items.map((it) => (
            <button key={it.label} onClick={() => { it.run(); setOpen(false); }} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-white/5">
              <it.icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span><span className="block text-xs font-medium text-white">{it.label}</span><span className="block text-[10px] text-slate-500">{it.hint}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ header + top navigation
export function TopNav() {
  const { view, setView } = useApp();
  const [dlg, setDlg] = useState(false);
  return (
    <div className="uhi-light">
      <header className="no-print sticky top-0 z-[700] border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1700px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
          {/* brand — clean text, no logo graphic */}
          <div className="min-w-0 shrink-0">
            <p className="truncate text-[15px] font-semibold leading-tight tracking-tight text-slate-900">Nagpur UHI Platform</p>
            <p className="truncate text-[11px] leading-tight text-slate-500">Urban Heat Island Analysis</p>
          </div>

          {/* navigation — centred, comfortably sized */}
          <nav className="order-3 flex w-full items-center gap-1.5 overflow-x-auto border-t border-slate-100 pt-2 lg:order-none lg:w-auto lg:flex-1 lg:justify-center lg:border-t-0 lg:pt-0">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = view === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setView(item.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium transition",
                    active ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <Icon className={cn("h-4 w-4", active ? "text-white" : "text-slate-400")} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* actions */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <DataSourceBadge onClick={() => setDlg(true)} />
            <ExportMenu />
            <button onClick={() => setView("methodology")} className="hidden items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 md:flex" title="Methods & validation"><HelpCircle className="h-3.5 w-3.5" /> Methods</button>
          </div>
        </div>
      </header>
      <DataSourceDialog open={dlg} onClose={() => setDlg(false)} />
    </div>
  );
}

// ------------------------------------------------------------------ footer
export function Footer() {
  const { ds, setView } = useApp();
  return (
    <footer className="mt-8 border-t border-white/8 bg-slate-950/60 px-4 py-6 text-[11px] text-slate-500 sm:px-6">
      <div className="mx-auto grid max-w-[1500px] gap-6 md:grid-cols-4">
        <div>
          <p className="text-xs font-semibold text-slate-300">Smart Geospatial Platform · Nagpur</p>
          <p className="mt-1 leading-relaxed">Urban heat intelligence for planners: satellite-derived surface temperature, vegetation and built-up dynamics, hotspot detection and what-if scenarios — designed to support the city's Heat Action Plan cycle.</p>
          <p className="mt-2">v{APP_VERSION} · {ds.source === "live" ? "live data" : "demonstration data"} · <button onClick={() => setView("methodology")} className="text-slate-400 hover:text-white">Methods & Validation</button></p>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-300">Data sources & licences</p>
          <ul className="mt-1 space-y-0.5 leading-relaxed">
            <li>Landsat 8/9 Collection 2 — USGS / NASA, public domain</li>
            <li>Copernicus Sentinel-2 — ESA, CC BY-SA 3.0 IGO</li>
            <li>Basemaps — © OpenStreetMap contributors (ODbL), © CARTO, Esri World Imagery</li>
            <li>Population — indicative ward-level estimates; replace with Census tables</li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-300">Interpretation</p>
          <ul className="mt-1 space-y-0.5 leading-relaxed">
            <li>LST is land-surface temperature at satellite overpass (~10:30 IST), not air temperature.</li>
            <li>IMD heat-wave criteria (plains): max ≥ 40 °C with +4.5 °C departure, or ≥ 45 °C absolute.</li>
            <li>Model outputs are decision support with stated uncertainty, not regulatory measurements.</li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-300">Status</p>
          <ul className="mt-1 space-y-0.5 leading-relaxed">
            <li className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Interface: operational</li>
            <li className="flex items-center gap-1.5"><span className={cn("h-1.5 w-1.5 rounded-full", ds.source === "live" ? "bg-emerald-400" : "bg-amber-400")} />Data service: {ds.source === "live" ? "connected" : "not connected (demo)"}</li>
            <li className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Model runtime: in-browser</li>
          </ul>
          <p className="mt-2">© {new Date().getFullYear()} Nagpur UHI Platform team. Built for urban resilience.</p>
        </div>
      </div>
    </footer>
  );
}
