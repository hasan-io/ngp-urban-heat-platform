import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import {
  ArrowDownToLine, ClipboardList, FileText, Info,
  Lightbulb, Loader2, Mic, Printer, ShieldCheck, ThermometerSun, X,
} from "lucide-react";
import { useApp } from "@/App";
import GuidedTour, { type TourStep } from "@/components/GuidedTour";
import StaticChartSnapshot from "@/components/StaticChartSnapshot";
import { Pill, YearPicker } from "@/components/ui";
import { priorityRegister } from "@/data/decision";
import { drawOverlays } from "@/components/RasterCanvas";
import { diffRaster, fmt, type Dataset } from "@/data/engine";
import { BOUNDS, type Year } from "@/data/nagpur";
import { qualityFor } from "@/data/catalog";
import { rasterToImageData, rampCss, rampGradient, RAMPS, type LayerKey } from "@/data/colors";
import { uhiApi } from "@/api/client";
import type { InsightsResponse, ReportResponse, ScatterResponse, TrendResponse, HotspotRanking } from "@/api/types";
import { cn } from "@/utils/cn";

const TOUR_KEY = "nagpur-uhi.insights-tour-v1";
const VOICE_MODULE_URL = "https://nagpur-netra-voice-module.vercel.app/";
const INSIGHTS_TOUR: TourStep[] = [
  { target: "insights-findings", text: "Start with the key findings: a short reading of heat exposure, vegetation and built-up change for the selected season." },
  { target: "insights-rankings", text: "Compare priority zones by mean and peak temperature, persistence, area and severity." },
  { target: "insights-trends", text: "Review the six-season record to see whether heat, vegetation and built-up indicators are changing." },
  { target: "insights-recommendations", text: "Recommendations connect the measured signals to practical planning actions and target areas." },
  { target: "insights-report", text: "Generate a print-ready report containing the maps, charts, rankings and provenance for the selected season." },
];

interface ReportSnapshot {
  report: ReportResponse;
  year: Year;
  dataset: Dataset;
  insights: InsightsResponse;
  hotspots: HotspotRanking[];
  trends: TrendResponse;
  ndviScatter: ScatterResponse;
  ndbiScatter: ScatterResponse;
  seasonal: SeasonalResponse;
}

interface SeasonalResponse {
  zoneId?: string | null;
  series: { year: Year; lst: number; ndvi: number; ndbi: number }[];
  uhiIntensity: { year: Year; intensity: number }[];
  seasons: { season: string; available: boolean; meanLst?: number | null; meanUhiIntensity?: number | null; note?: string }[];
}

const toneIcon = { hot: ThermometerSun, green: Lightbulb, violet: ClipboardList, sky: ShieldCheck };
const toneAccent = {
  hot: "border-l-[#FF6B35]",
  green: "border-l-[#10B981]",
  violet: "border-l-[#A78BFA]",
  sky: "border-l-sky-400",
};
const toneClass = {
  hot: "text-[#C2410C]",
  green: "text-emerald-700",
  violet: "text-violet-700",
  sky: "text-sky-700",
};
const severityTone = (s: string): "red" | "orange" | "amber" =>
  s === "Critical" ? "red" : s === "High" ? "orange" : "amber";

/** Reusable orange section header used consistently across the page. */
function SectionHead({ title, subtitle, right }: { title: string; subtitle: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-col gap-2 rounded-r-lg border-l-4 border-[#FF6B35] bg-[#f9fafb] py-3 pr-4 pl-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="mt-0.5 text-xs text-slate-600">{subtitle}</p>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Report Figure (raster with legend + caption)                              */
/* -------------------------------------------------------------------------- */
function ReportFigure({ ds, year, metric, title, caption, values }: {
  ds: Dataset; year: Year; metric: "lst" | "ndvi" | "ndbi" | "dlst" | "hotspot"; title: string; caption: string; values?: Float32Array | Uint8Array;
}) {
  const raster = values ?? (metric === "hotspot" ? ds.hotCount : metric === "dlst" ? ds.rasters[year].lst : ds.rasters[year][metric]);
  const dataUrl = useMemo(() => {
    const img = rasterToImageData(ds, raster, metric, { alpha: 1 });
    const scale = 3;
    const source = document.createElement("canvas");
    source.width = img.width; source.height = img.height;
    source.getContext("2d")!.putImageData(img, 0, 0);
    const target = document.createElement("canvas");
    target.width = img.width * scale; target.height = img.height * scale;
    const ctx = target.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(source, 0, 0, target.width, target.height);
    drawOverlays(ctx, target.width, target.height, { showZones: true, showLabels: true, labelKinds: ["industry", "city", "water"], scale: 1.1, light: true });
    return target.toDataURL("image/png");
  }, [ds, raster, metric]);
  return (
    <figure className="uhi-report-figure min-w-0">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5">
        <img src={dataUrl} alt={`${title}, ${year}`} className="block aspect-[7/6] w-full object-contain" />
      </div>
      <ReportRasterLegend metric={metric} />
      <figcaption className="mt-2">
        <p className="text-[12px] font-semibold text-slate-800">{title}</p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{caption}</p>
      </figcaption>
    </figure>
  );
}

function ReportRasterLegend({ metric }: { metric: LayerKey }) {
  const r = RAMPS[metric];
  return (
    <div className="mt-1.5 px-1">
      <div className="h-2 rounded-sm" style={{ background: rampGradient(metric) }} />
      <div className="mt-0.5 flex justify-between gap-1 text-[8px] tabular-nums text-slate-500">
        {r.ticks.map((v) => <span key={v}>{v}{r.unit}</span>)}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Report Trend Figures                                                       */
/* -------------------------------------------------------------------------- */
function ReportTrendFigures({ snapshot, onReady }: { snapshot: ReportSnapshot; onReady: (id: string) => void }) {
  const { trends, year } = snapshot;
  const rows = trends.city;
  const projections = trends.projection;
  const lastObs = rows[rows.length - 1];
  const lastYear = lastObs?.year ?? year;
  const combined = [
    ...rows.map((r) => ({ year: r.year, observed: r.lst, projected: undefined as number | undefined })),
    ...projections.filter((r) => r.year > lastYear).map((r) => ({ year: r.year, observed: undefined as number | undefined, projected: r.lst })),
  ];
  const indexRows = [
    ...rows.map((r) => ({ year: r.year, ndvi: r.ndvi, ndbi: r.ndbi, ndviProjection: undefined as number | undefined, ndbiProjection: undefined as number | undefined })),
    ...Array.from({ length: Math.max(0, 2030 - lastYear) }, (_, i) => {
      const y = lastYear + 1 + i;
      const ndviTrend = snapshot.dataset.trends.ndvi;
      const ndbiTrend = snapshot.dataset.trends.ndbi;
      return {
        year: y,
        ndvi: undefined as number | undefined,
        ndbi: undefined as number | undefined,
        ndviProjection: ndviTrend.intercept + ndviTrend.slope * y,
        ndbiProjection: ndbiTrend.intercept + ndbiTrend.slope * y,
      };
    }),
  ];
  const bounds = new Map(projections.map((p) => [p.year, p]));
  const lstWithBand = combined.map((r) => {
    const b = bounds.get(r.year);
    return { ...r, low: b?.lo, high: b?.hi };
  });
  return (
    <div className="grid grid-cols-2 gap-4">
      <figure className="uhi-report-figure min-w-0">
        <StaticChartSnapshot id={`report-lst-trend-${snapshot.report.id}`} alt="City mean LST trajectory" onReady={onReady} className="h-[230px] rounded-lg border border-slate-200 bg-white p-2">
          <ResponsiveContainer>
            <ComposedChart data={lstWithBand} margin={{ left: 2, right: 14, top: 12, bottom: 4 }}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="year" stroke="#64748b" fontSize={10} tickLine={false} />
              <YAxis stroke="#64748b" fontSize={10} tickLine={false} domain={["auto", "auto"]} unit="°" />
              <Tooltip formatter={(v) => `${Number(v).toFixed(2)} °C`} />
              <Area isAnimationActive={false} dataKey="high" name="Upper outlook band" stroke="none" fill="#fed7aa" fillOpacity={0.4} />
              <Area isAnimationActive={false} dataKey="low" name="Lower outlook band" stroke="none" fill="#ffffff" fillOpacity={1} />
              <Line isAnimationActive={false} dataKey="observed" name="Observed city mean" stroke="#FF6B35" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
              <Line isAnimationActive={false} dataKey="projected" name="Linear outlook" stroke="#d97706" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />
              <ReferenceLine x={lastYear} stroke="#94a3b8" strokeDasharray="3 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </StaticChartSnapshot>
        <figcaption className="mt-2">
          <p className="text-[12px] font-semibold text-slate-800">City-mean LST trajectory</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
            Observed pre-monsoon composites with the platform's linear outlook and available uncertainty band. Selected report season: {year}.
          </p>
        </figcaption>
      </figure>
      <figure className="uhi-report-figure min-w-0">
        <StaticChartSnapshot id={`report-index-trend-${snapshot.report.id}`} alt="Vegetation and built-up trajectory" onReady={onReady} className="h-[230px] rounded-lg border border-slate-200 bg-white p-2">
          <ResponsiveContainer>
            <LineChart data={indexRows} margin={{ left: 2, right: 14, top: 12, bottom: 4 }}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="year" stroke="#64748b" fontSize={10} tickLine={false} />
              <YAxis yAxisId="ndvi" stroke="#10B981" fontSize={10} tickLine={false} domain={["auto", "auto"]} />
              <YAxis yAxisId="ndbi" orientation="right" stroke="#A78BFA" fontSize={10} tickLine={false} domain={["auto", "auto"]} />
              <Tooltip />
              <Line isAnimationActive={false} yAxisId="ndvi" dataKey="ndvi" name="NDVI observed" stroke="#10B981" strokeWidth={2} dot={{ r: 2.5 }} />
              <Line isAnimationActive={false} yAxisId="ndbi" dataKey="ndbi" name="NDBI observed" stroke="#A78BFA" strokeWidth={2} dot={{ r: 2.5 }} />
              <Line isAnimationActive={false} yAxisId="ndvi" dataKey="ndviProjection" name="NDVI linear outlook" stroke="#10B981" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />
              <Line isAnimationActive={false} yAxisId="ndbi" dataKey="ndbiProjection" name="NDBI linear outlook" stroke="#A78BFA" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />
              <ReferenceLine x={lastYear} stroke="#94a3b8" strokeDasharray="3 3" />
            </LineChart>
          </ResponsiveContainer>
        </StaticChartSnapshot>
        <figcaption className="mt-2">
          <p className="text-[12px] font-semibold text-slate-800">Vegetation and built-up trajectory</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
            NDVI and NDBI seasonal city means; dashed segments are linear extrapolations from the existing six-season trend.
          </p>
        </figcaption>
      </figure>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Report Scatter Figure                                                      */
/* -------------------------------------------------------------------------- */
function ReportScatterFigure({ data, title, xLabel, reportId, onReady }: {
  data: ScatterResponse; title: string; xLabel: string; reportId: string; onReady: (id: string) => void;
}) {
  const xs = data.points.map((p) => p.x);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return (
    <figure className="uhi-report-figure min-w-0">
      <StaticChartSnapshot id={`report-scatter-${data.x}-${reportId}`} alt={title} onReady={onReady} className="h-[220px] rounded-lg border border-slate-200 bg-white p-2">
        {data.points.length ? (
          <ResponsiveContainer>
            <ScatterChart margin={{ left: 2, right: 14, top: 10, bottom: 4 }}>
              <CartesianGrid stroke="#e2e8f0" />
              <XAxis type="number" dataKey="x" name={xLabel} domain={["auto", "auto"]} stroke="#64748b" fontSize={10} tickLine={false} />
              <YAxis type="number" dataKey="y" name="LST" unit="°C" domain={["auto", "auto"]} stroke="#64748b" fontSize={10} tickLine={false} />
              <ZAxis range={[14, 14]} />
              <Tooltip formatter={(v, name) => [name === "y" ? `${Number(v).toFixed(2)} °C` : Number(v).toFixed(3), name === "y" ? "LST" : xLabel]} />
              <ReferenceLine
                segment={[{ x: lo, y: data.intercept + data.slope * lo }, { x: hi, y: data.intercept + data.slope * hi }]}
                stroke="#64748b" strokeWidth={2} strokeDasharray="5 3"
              />
              <Scatter data={data.points} isAnimationActive={false}>
                {data.points.map((p, i) => <Cell key={i} fill={rampCss("lst", p.y)} fillOpacity={0.55} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center text-xs leading-relaxed text-slate-500">
            No scatter observations were returned for this index and season.
          </div>
        )}
      </StaticChartSnapshot>
      <figcaption className="mt-2">
        <p className="text-[12px] font-semibold text-slate-800">{title}</p>
        <p className="mt-0.5 font-mono text-[10px] text-slate-600">
          {data.equation} · r² = {data.r2.toFixed(3)} · slope = {data.slope.toFixed(2)} °C / index unit · n = {data.points.length.toLocaleString()}
        </p>
      </figcaption>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/*  Report Seasonal Figure                                                     */
/* -------------------------------------------------------------------------- */
function ReportSeasonalFigure({ seasonal, reportId, onReady }: {
  seasonal: SeasonalResponse; reportId: string; onReady: (id: string) => void;
}) {
  const rows = seasonal.uhiIntensity ?? [];
  if (!rows.length) {
    return (
      <figure className="uhi-report-figure mt-5">
        <div className="flex h-[220px] items-center justify-center rounded-lg border border-slate-200 bg-white px-8 text-center text-xs leading-relaxed text-slate-500">
          The active service did not return seasonal urban/peri-urban contrast values. No seasonal series is inferred for this report.
        </div>
        <figcaption className="mt-2">
          <p className="text-[12px] font-semibold text-slate-800">Pre-monsoon UHI contrast</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
            No service-reported seasonal contrast was available for this generated report.
          </p>
        </figcaption>
      </figure>
    );
  }
  return (
    <figure className="uhi-report-figure mt-5">
      <StaticChartSnapshot id={`report-seasonal-${reportId}`} alt="Pre-monsoon UHI contrast" onReady={onReady} className="h-[220px] rounded-lg border border-slate-200 bg-white p-2">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ left: 2, right: 14, top: 10, bottom: 4 }}>
            <CartesianGrid stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="year" stroke="#64748b" fontSize={10} tickLine={false} />
            <YAxis stroke="#64748b" fontSize={10} tickLine={false} unit="°" />
            <Tooltip formatter={(v) => `${Number(v).toFixed(2)} °C`} />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <Line isAnimationActive={false} dataKey="intensity" name="Reported seasonal contrast" stroke="#FF6B35" strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </StaticChartSnapshot>
      <figcaption className="mt-2">
        <p className="text-[12px] font-semibold text-slate-800">Pre-monsoon UHI contrast</p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
          Seasonal contrast reported by the active service. The current image archive contains pre-monsoon composites; monsoon and winter composites are not available.
        </p>
      </figcaption>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/*  Report Preview (scientific document — keeps navy print theme)              */
/* -------------------------------------------------------------------------- */
function ReportPreview({ snapshot, onClose }: { snapshot: ReportSnapshot; onClose: () => void }) {
  const { report, year, dataset: ds, insights, hotspots, ndviScatter, ndbiScatter } = snapshot;
  const c = ds.city[year];
  const c0 = ds.city[2019];
  const quality = qualityFor(ds).find((v) => v.year === year);
  const delta = useMemo(() => diffRaster(ds, "lst", 2019, 2024), [ds]);
  const source = ds.meta.serviceSource || (ds.source === "live" ? ds.meta.baseUrl || "Connected raster service" : "Synthetic calibrated demonstration composite");
  const period = report.period || `${ds.years[0]}–${ds.years[ds.years.length - 1]} · pre-monsoon composites, selected season ${year}`;
  const reportSection = (part: string) => report.sections.find((s) => s.heading.toLowerCase().includes(part.toLowerCase()));
  const intro = reportSection("Executive summary")?.body || `The ${year} pre-monsoon composite records a city-mean land-surface temperature of ${c.lstMean.toFixed(1)} °C.`;
  const methodNote = reportSection("method")?.body;
  const generated = report.generatedAt;
  const [readyCharts, setReadyCharts] = useState<Set<string>>(() => new Set());
  const expectedCharts = snapshot.seasonal.uhiIntensity?.length ? 5 : 4;
  const figuresReady = readyCharts.size >= expectedCharts;
  const markChartReady = useCallback((id: string) => setReadyCharts((current) => {
    if (current.has(id)) return current;
    const next = new Set(current);
    next.add(id);
    return next;
  }), []);
  useEffect(() => setReadyCharts(new Set()), [report.id]);
  const exportPdf = () => {
    if (!figuresReady) return;
    const title = document.title;
    document.title = `Nagpur_UHI_Assessment_${year}_${report.id}`;
    window.print();
    window.setTimeout(() => { document.title = title; }, 800);
  };
  const persistentArea = ds.hotCount.filter((v) => v >= 5).length * ds.cellAreaKm2;

  useEffect(() => {
    document.body.classList.add("uhi-report-print-mode");
    return () => document.body.classList.remove("uhi-report-print-mode");
  }, []);

  return (
    <div className="uhi-report-modal fixed inset-0 z-[1000] overflow-y-auto bg-slate-100 p-3 sm:p-6 print:static print:overflow-visible print:bg-white print:p-0">
      <div className="no-print sticky top-0 z-10 mx-auto mb-4 flex max-w-[1040px] items-center justify-between rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-[#FF6B35]" />
          <div>
            <p className="text-sm font-semibold text-slate-900">Report preview</p>
            <p className="text-[11px] text-slate-500">Print-ready scientific assessment · {report.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!figuresReady && (
            <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" />Preparing figures {readyCharts.size}/{expectedCharts}
            </span>
          )}
          <button
            onClick={exportPdf}
            disabled={!figuresReady}
            className="flex items-center gap-1.5 rounded-lg bg-[#FF6B35] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#e85a28] disabled:cursor-wait disabled:opacity-50"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" /> Export PDF
          </button>
          <button
            onClick={() => figuresReady && window.print()}
            disabled={!figuresReady}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50"
          >
            <Printer className="h-3.5 w-3.5" /> Print
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50"
            aria-label="Close report"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <article className="uhi-report-sheet mx-auto max-w-[1040px] border border-slate-200 bg-white px-6 py-8 text-slate-800 shadow-sm sm:px-12 sm:py-12 print:max-w-none print:border-0 print:px-0 print:py-0 print:shadow-none">
        {/* cover and provenance */}
        <header className="uhi-report-page-start border-b-2 border-[#17365d] pb-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#315a82]">Nagpur Urban Heat Island Analysis Platform</p>
          <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight tracking-tight text-[#142c48]">
            Urban Heat Island Assessment<br />
            <span className="text-[#315a82]">{year} Pre-monsoon Report</span>
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600">
            A satellite-based assessment of surface heat exposure, vegetation and built-up patterns, persistent hotspots, and planning-relevant change across Nagpur.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-3 border-t border-slate-200 pt-4 text-xs sm:grid-cols-4">
            <div><p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Report ID</p><p className="mt-1 font-medium text-slate-800">{report.id}</p></div>
            <div><p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Generated</p><p className="mt-1 font-medium text-slate-800">{generated}</p></div>
            <div><p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Analysis period</p><p className="mt-1 font-medium text-slate-800">{period}</p></div>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Study area / grid</p>
              <p className="mt-1 font-medium text-slate-800">Nagpur · {ds.h} × {ds.w} cells · {Math.round(Math.sqrt(ds.cellAreaKm2) * 1000)} m</p>
              <p className="text-[8px] text-slate-500">{BOUNDS.west.toFixed(2)}–{BOUNDS.east.toFixed(2)}°E · {BOUNDS.south.toFixed(2)}–{BOUNDS.north.toFixed(2)}°N · WGS 84</p>
            </div>
          </div>
        </header>

        {/* Executive summary */}
        <section className="uhi-report-section mt-7">
          <h2 className="uhi-report-h2"><span>01</span> Executive Summary</h2>
          <p className="mt-3 text-[13px] leading-[1.75] text-slate-700">{intro}</p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Mean LST", `${c.lstMean.toFixed(1)} °C`, `${c.lstMean - c0.lstMean >= 0 ? "+" : ""}${(c.lstMean - c0.lstMean).toFixed(2)} °C since 2019`],
              ["Maximum LST", `${c.lstMax.toFixed(1)} °C`, "highest valid mapped cell"],
              ["NDVI mean", c.ndviMean.toFixed(3), `${(c.ndviMean - c0.ndviMean >= 0 ? "+" : "")}${(c.ndviMean - c0.ndviMean).toFixed(3)} since 2019`],
              ["NDBI mean", c.ndbiMean.toFixed(3), `${(c.ndbiMean - c0.ndbiMean >= 0 ? "+" : "")}${(c.ndbiMean - c0.ndbiMean).toFixed(3)} since 2019`],
            ].map(([label, value, note]) => (
              <div key={label} className="border-l-2 border-[#315a82] bg-slate-50 px-3 py-2.5">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-[#17365d]">{value}</p>
                <p className="mt-0.5 text-[10px] text-slate-500">{note}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Key findings */}
        <section className="uhi-report-section mt-8">
          <h2 className="uhi-report-h2"><span>02</span> Key Findings</h2>
          <div className="mt-3 space-y-3">
            {insights.findings.map((f, i) => (
              <div key={f.title} className="grid grid-cols-[28px_1fr] gap-2 border-b border-slate-100 pb-3 last:border-0">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#eaf0f6] text-[10px] font-semibold text-[#315a82]">{i + 1}</span>
                <div>
                  <h3 className="text-[12px] font-semibold text-slate-800">{f.title}</h3>
                  <p className="mt-1 text-[11px] leading-[1.7] text-slate-600">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* hotspot table */}
        <section className="uhi-report-section uhi-report-page-start mt-8">
          <h2 className="uhi-report-h2"><span>03</span> Priority Hotspots & Zone Ranking</h2>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
            Zones are ranked by zone-mean land-surface temperature for {year}. Persistence is the share of zone land that fell within the annual top decile in at least five of the six seasons. Severity is an exposure indicator, not an air-temperature health threshold.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="uhi-report-table w-full table-fixed border-collapse text-[10px]">
              <colgroup>
                <col style={{ width: "5%" }} /><col style={{ width: "29%" }} /><col style={{ width: "11%" }} />
                <col style={{ width: "11%" }} /><col style={{ width: "13%" }} /><col style={{ width: "11%" }} />
                <col style={{ width: "12%" }} /><col style={{ width: "8%" }} />
              </colgroup>
              <thead>
                <tr className="border-y border-slate-300 bg-slate-50 text-[9px] uppercase tracking-wider text-slate-600">
                  <th className="px-2 py-2 text-center font-semibold">Rank</th>
                  <th className="px-2 py-2 text-left font-semibold">Planning zone</th>
                  <th className="px-2 py-2 text-right font-semibold">Mean LST</th>
                  <th className="px-2 py-2 text-right font-semibold">Peak LST</th>
                  <th className="px-2 py-2 text-right font-semibold">ΔLST 19–24</th>
                  <th className="px-2 py-2 text-right font-semibold">Persistent</th>
                  <th className="px-2 py-2 text-right font-semibold">Area</th>
                  <th className="px-2 py-2 text-center font-semibold">Severity</th>
                </tr>
              </thead>
              <tbody>
                {hotspots.map((h) => {
                  const z = ds.zones.find((v) => v.zone.id === h.zoneId);
                  return (
                    <tr key={h.zoneId} className="border-b border-slate-200">
                      <td className="px-2 py-2 text-center tabular-nums text-slate-500">{h.rank}</td>
                      <td className="px-2 py-2 text-left font-medium text-slate-800">{h.zone}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{h.temperature.toFixed(1)} °C</td>
                      <td className="px-2 py-2 text-right tabular-nums">{h.peakTemperature.toFixed(1)} °C</td>
                      <td className="px-2 py-2 text-right tabular-nums">{z ? `${z.dLst >= 0 ? "+" : ""}${z.dLst.toFixed(1)} °C` : "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{(h.persistence * 100).toFixed(0)}%</td>
                      <td className="px-2 py-2 text-right tabular-nums">{h.areaKm2.toFixed(1)} km²</td>
                      <td className="px-2 py-2 text-center">{h.severity}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* LST and change figures */}
        <section className="uhi-report-section uhi-report-page-start mt-8">
          <h2 className="uhi-report-h2"><span>04</span> Land Surface Temperature & Change</h2>
          <p className="mt-2 text-[11px] leading-[1.7] text-slate-600">
            Land-surface temperature (LST) is the radiometric temperature of the surface at satellite overpass. It is distinct from air temperature and is used here to identify material and land-cover heat patterns.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-5">
            <ReportFigure ds={ds} year={year} metric="lst" title={`LST composite — ${year}`} caption={`Surface-temperature raster for the selected pre-monsoon season. City mean ${c.lstMean.toFixed(1)} °C; mapped maximum ${c.lstMax.toFixed(1)} °C. Water is shown separately from valid land pixels.`} />
            <ReportFigure ds={ds} year={2024} metric="dlst" values={delta} title="Temperature change — 2024 minus 2019" caption={`Per-cell seasonal LST difference. City-mean change: ${(ds.city[2024].lstMean - ds.city[2019].lstMean >= 0 ? "+" : "")}${(ds.city[2024].lstMean - ds.city[2019].lstMean).toFixed(2)} °C. Blue denotes cooling and red denotes warming.`} />
          </div>
        </section>

        {/* vegetation and built-up */}
        <section className="uhi-report-section uhi-report-page-start mt-8">
          <h2 className="uhi-report-h2"><span>05</span> Vegetation & Built-up Dynamics</h2>
          <p className="mt-2 text-[11px] leading-[1.7] text-slate-600">
            NDVI describes relative vegetation greenness; NDBI highlights relative built-up / impervious response. These spectral indices are indicators, not cadastral land-use classifications. Compare their spatial patterns with the temperature surface and field information.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-5">
            <ReportFigure ds={ds} year={year} metric="ndvi" title={`Vegetation index (NDVI) — ${year}`} caption={`City mean NDVI ${c.ndviMean.toFixed(3)}; area above NDVI 0.40 is ${c.greenAreaKm2.toFixed(1)} km². Higher values generally indicate stronger vegetation response.`} />
            <ReportFigure ds={ds} year={year} metric="ndbi" title={`Built-up index (NDBI) — ${year}`} caption={`City mean NDBI ${c.ndbiMean.toFixed(3)}; area above NDBI 0.10 is ${c.builtAreaKm2.toFixed(1)} km². Positive values tend to indicate impervious surfaces.`} />
          </div>
        </section>

        {/* hotspot map and trends */}
        <section className="uhi-report-section uhi-report-page-start mt-8">
          <h2 className="uhi-report-h2"><span>06</span> Persistent Hotspots & Temporal Trends</h2>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
            {persistentArea.toFixed(1)} km² stayed in the annual top temperature decile in at least five of six seasons. Trend lines use the actual annual city means and the current platform trend projection.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-5">
            <ReportFigure ds={ds} year={year} metric="hotspot" title="Hotspot persistence — 2019–2024" caption="Count of seasons in which each cell falls in that season's hottest land-surface temperature decile. Highest persistence indicates structural heat exposure." />
            <div>
              <p className="mb-1 text-[10px] text-slate-500">Seasonal contrast values are returned by the selected backend.</p>
              <ReportSeasonalFigure seasonal={snapshot.seasonal} reportId={report.id} onReady={markChartReady} />
            </div>
          </div>
          <div className="mt-5"><ReportTrendFigures snapshot={snapshot} onReady={markChartReady} /></div>
        </section>

        {/* relationships */}
        <section className="uhi-report-section uhi-report-page-start mt-8">
          <h2 className="uhi-report-h2"><span>07</span> Index–Temperature Relationships</h2>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
            Pixel samples are drawn from valid land cells for the selected year. The dashed line is the least-squares fit; correlation is an association and should not be interpreted as proof of causation.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-5">
            <ReportScatterFigure data={ndviScatter} title={`NDVI vs LST — ${year}`} xLabel="NDVI" reportId={report.id} onReady={markChartReady} />
            <ReportScatterFigure data={ndbiScatter} title={`NDBI vs LST — ${year}`} xLabel="NDBI" reportId={report.id} onReady={markChartReady} />
          </div>
        </section>

        {/* recommendations and method */}
        <section className="uhi-report-section uhi-report-page-start mt-8">
          <h2 className="uhi-report-h2"><span>08</span> Planning Implications</h2>
          <div className="mt-3 space-y-3">
            {insights.recommendations.map((r, i) => (
              <div key={r.title} className="grid grid-cols-[28px_1fr] gap-2 border-b border-slate-100 pb-3 last:border-0">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#eaf0f6] text-[10px] font-semibold text-[#315a82]">{i + 1}</span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[12px] font-semibold text-slate-800">{r.title}</h3>
                    <span className="text-[9px] font-semibold uppercase tracking-wider text-[#315a82]">{r.priority}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-[1.7] text-slate-600">{r.body}</p>
                  <p className="mt-1 text-[10px] text-slate-500">Focus areas: {r.zones.join(" · ")}</p>
                </div>
              </div>
            ))}
          </div>

          <h2 className="uhi-report-h2 mt-7"><span>09</span> Data Quality & Limitations</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Composite quality", quality?.quality ?? "Not reported"],
              ["Spatial completeness", quality ? `${quality.completeness.toFixed(1)}%` : "Not reported"],
              ["Usable observations", quality ? String(quality.used + quality.partial) : "Not reported"],
              ["Residual cloud", quality ? `${quality.compositeCloud.toFixed(1)}%` : "Not reported"],
            ].map(([label, value]) => (
              <div key={label} className="border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[8px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
                <p className="mt-1 text-[11px] font-semibold text-slate-800">{value}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-slate-600">
            LST is a satellite-overpass surface measurement, not ambient air temperature. Landsat thermal observations are coarser than the displayed analysis grid; seasonal medians suppress single-day extremes; mixed pixels at the analysis resolution blur boundaries. Zone population estimates are indicative. Trend projections extend the short 2019–2024 record and do not forecast weather, policy or future development.
          </p>

          <h2 className="uhi-report-h2 mt-7"><span>10</span> Methodology & Interpretation</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="border-l-2 border-[#315a82] bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">NDVI</p>
              <p className="mt-1 font-mono text-[11px] text-slate-800">(NIR − Red) / (NIR + Red)</p>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-600">Relative vegetation greenness; Landsat B5/B4, Sentinel-2 B8/B4.</p>
            </div>
            <div className="border-l-2 border-[#315a82] bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">NDBI</p>
              <p className="mt-1 font-mono text-[11px] text-slate-800">(SWIR1 − NIR) / (SWIR1 + NIR)</p>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-600">Relative built-up response; Landsat B6/B5, Sentinel-2 B11/B8.</p>
            </div>
            <div className="border-l-2 border-[#315a82] bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">LST</p>
              <p className="mt-1 text-[11px] text-slate-800">Collection-2 Level-2 surface temperature, or emissivity-corrected single-channel retrieval.</p>
              <p className="mt-1 font-mono text-[9px] text-slate-700">LST = BT / [1 + (λ·BT/ρ)·ln ε] − 273.15</p>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-600">LST is satellite-overpass surface temperature, not ambient air temperature or an IMD health-warning value.</p>
            </div>
            <div className="border-l-2 border-[#315a82] bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Analysis & validation</p>
              <p className="mt-1 text-[11px] text-slate-800">Seasonal median composites · hotspot components · OLS trends · spatial-block ML validation.</p>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-600">The report follows the active data service's hotspot threshold and persistence definition.</p>
            </div>
            <div className="border-l-2 border-[#315a82] bg-slate-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">UHI & change</p>
              <p className="mt-1 text-[11px] text-slate-800">UHI contrast is the service-reported urban-reference versus peri-urban-reference surface-temperature difference; temporal change is later composite minus earlier composite.</p>
              <p className="mt-1 font-mono text-[9px] text-slate-700">ΔLST = LST(year₂) − LST(year₁)</p>
            </div>
          </div>
          {methodNote && <p className="mt-3 border-l-2 border-slate-300 pl-3 text-[10px] leading-relaxed text-slate-600">Service method note: {methodNote}</p>}

          <div className="mt-4 border-t border-slate-200 pt-3">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Selected methodological references</h3>
            <ol className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 pl-4 text-[9px] leading-relaxed text-slate-500">
              <li className="list-decimal">USGS, Landsat Collection 2 Level-2 Science Product Guide — surface reflectance, surface temperature and QA_PIXEL.</li>
              <li className="list-decimal">ESA, Sentinel-2 Level-2A Algorithm Theoretical Basis Document — Sen2Cor scene classification.</li>
              <li className="list-decimal">Sobrino, J. A. et al. (2004), Land surface temperature retrieval from Landsat TM 5, <i>Remote Sensing of Environment</i> 90, 434–440.</li>
              <li className="list-decimal">Zha, Y. et al. (2003), Use of normalized difference built-up index in automatically mapping urban areas, <i>IJRS</i> 24, 583–594.</li>
              <li className="list-decimal">Getis, A. &amp; Ord, J. K. (1992), The analysis of spatial association by use of distance statistics, <i>Geographical Analysis</i> 24, 189–206.</li>
              <li className="list-decimal">Roberts, D. R. et al. (2017), Cross-validation strategies for data with temporal, spatial and hierarchical structure, <i>Ecography</i> 40, 913–929.</li>
            </ol>
          </div>
        </section>

        {/* provenance footer */}
        <footer className="uhi-report-section mt-8 border-t-2 border-[#17365d] pt-4">
          <p className="text-[9px] leading-relaxed text-slate-500">
            <span className="font-semibold text-slate-600">Data Source:</span> {source} ·{" "}
            <span className="font-semibold text-slate-600">Dataset:</span> {ds.label} ({ds.h} × {ds.w} grid; {Math.round(Math.sqrt(ds.cellAreaKm2) * 1000)} m) ·{" "}
            <span className="font-semibold text-slate-600">Analysis Period:</span> {period} ·{" "}
            <span className="font-semibold text-slate-600">Generated:</span> {generated}
          </p>
          {ds.meta.note && <p className="mt-1 text-[9px] leading-relaxed text-slate-500">Dataset note: {ds.meta.note}</p>}
          {quality && (
            <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
              Composite quality: {quality.quality} · {quality.completeness.toFixed(1)}% spatial completeness ·{" "}
              {quality.used + quality.partial} usable observations · {quality.compositeCloud.toFixed(1)}% residual cloud.
            </p>
          )}
          <p className="mt-2 text-[9px] leading-relaxed text-slate-500">
            Surface-temperature analysis is decision support and is not a substitute for ground measurements. Validate priority areas through ward-level surveys before capital planning.
          </p>
        </footer>
      </article>
      <div className="no-print mx-auto mt-3 max-w-[1040px] text-right">
        <button
          onClick={onClose}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Close preview
        </button>
      </div>
    </div>
  );
}

/* ========================================================================== */
/*  Main Insights page                                                        */
/* ========================================================================== */
export default function Insights() {
  const { ds, year, setYear, setView, setScenarioZoneId } = useApp();
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [hotspots, setHotspots] = useState<HotspotRanking[]>([]);
  const [trends, setTrends] = useState<TrendResponse | null>(null);
  const [seasonal, setSeasonal] = useState<SeasonalResponse | null>(null);
  const [scatter, setScatter] = useState<{ ndvi: ScatterResponse | null; ndbi: ScatterResponse | null }>({ ndvi: null, ndbi: null });
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [reportSnapshot, setReportSnapshot] = useState<ReportSnapshot | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);
  const tourStarted = useRef(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      uhiApi.insights(year),
      uhiApi.topHotspots(year, 18),
      uhiApi.trends(),
      uhiApi.scatter("ndvi-lst", year),
      uhiApi.scatter("ndbi-lst", year),
      uhiApi.seasonalPatterns(),
    ])
      .then(([i, h, t, ndvi, ndbi, season]) => {
        if (alive) {
          setInsights(i.data);
          setHotspots(h.data);
          setTrends(t.data);
          setScatter({ ndvi: ndvi.data, ndbi: ndbi.data });
          setSeasonal(season.data as SeasonalResponse);
        }
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [year]);

  useEffect(() => {
    if (tourStarted.current) return;
    tourStarted.current = true;
    if (!localStorage.getItem(TOUR_KEY)) {
      const t = window.setTimeout(() => setTourStep(0), 700);
      return () => window.clearTimeout(t);
    }
  }, []);

  const register = useMemo(() => priorityRegister(ds), [ds]);
  const rows = trends?.city ?? ds.years.map((y) => ({ year: y, lst: ds.city[y].lstMean, ndvi: ds.city[y].ndviMean, ndbi: ds.city[y].ndbiMean }));
  const rankings = hotspots.length
    ? hotspots
    : register.map((r, i) => ({
        rank: i + 1,
        zoneId: r.zone.zone.id,
        zone: r.zone.zone.name,
        temperature: r.zone.byYear[year].lst,
        peakTemperature: r.zone.byYear[year].lst + 1,
        severity: r.tier === "Critical" ? "Critical" as const : r.tier === "High" ? "High" as const : "Moderate" as const,
        persistence: r.zone.persistentFrac,
        areaKm2: r.zone.areaKm2,
      }));

  const generate = async () => {
    setGenerating(true);
    setReportError(null);
    try {
      const requestedYear = year;
      const [r, i, h, t, ndvi, ndbi, season] = await Promise.all([
        uhiApi.report(requestedYear),
        insights ? Promise.resolve({ data: insights }) : uhiApi.insights(requestedYear),
        hotspots.length ? Promise.resolve({ data: hotspots }) : uhiApi.topHotspots(requestedYear, 18),
        trends ? Promise.resolve({ data: trends }) : uhiApi.trends(),
        scatter.ndvi ? Promise.resolve({ data: scatter.ndvi }) : uhiApi.scatter("ndvi-lst", requestedYear),
        scatter.ndbi ? Promise.resolve({ data: scatter.ndbi }) : uhiApi.scatter("ndbi-lst", requestedYear),
        seasonal ? Promise.resolve({ data: seasonal }) : uhiApi.seasonalPatterns(),
      ]);
      setReport(r.data);
      setReportSnapshot({
        report: r.data,
        year: requestedYear,
        dataset: ds,
        insights: i.data,
        hotspots: h.data,
        trends: t.data,
        ndviScatter: ndvi.data,
        ndbiScatter: ndbi.data,
        seasonal: season.data as SeasonalResponse,
      });
      setPreviewOpen(true);
    } catch (e) {
      setReportError((e as Error).message || "Could not generate report.");
    } finally {
      setGenerating(false);
    }
  };

  const finishTour = () => { localStorage.setItem(TOUR_KEY, "1"); setTourStep(null); };

  const priorityAccent = (p: string) =>
    p === "Immediate" ? "border-l-[#FF6B35]"
    : p === "Near term" ? "border-l-amber-500"
    : "border-l-emerald-500";
  const priorityChip = (p: string) =>
    p === "Immediate"
      ? "bg-orange-50 text-[#C2410C] border-orange-200"
      : p === "Near term"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : "bg-emerald-50 text-emerald-800 border-emerald-200";

  const hviColor = (tier: string) =>
    tier === "Critical" ? "#C2410C" : tier === "High" ? "#EA580C" : tier === "Moderate" ? "#B45309" : "#334155";

  return (
    <div className="uhi-light mx-auto max-w-[1500px] space-y-6 bg-white p-4 sm:p-6">
      {/* ---------- page title and report action ---------- */}
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#C2410C]">Evidence &amp; decision support</p>
          <div className="mt-1 flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-[#FF6B35]" />
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Insights &amp; Reports</h1>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Findings, hotspot priorities, seasonal trends and planning recommendations for the selected pre-monsoon composite.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <YearPicker value={year} onChange={setYear} />
          <button
            onClick={() => setTourStep(0)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <Info className="h-3.5 w-3.5" /> How it works
          </button>
          <button
            onClick={() => void generate()}
            disabled={generating}
            className="flex items-center gap-2 rounded-xl bg-[#FF6B35] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e85a28] disabled:opacity-60"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            {generating ? "Generating…" : "Generate Report"}
          </button>
        </div>
      </header>

      {/* ---------- voice assistant callout ---------- */}
      <section>
        <div className="flex flex-col gap-4 rounded-2xl border-2 border-[#FF6B35] bg-gradient-to-r from-orange-50 via-orange-50/40 to-white p-5 shadow-[0_2px_8px_rgba(255,107,53,0.10)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#FF6B35] text-white shadow-md">
              <Mic className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 sm:text-lg">Have any doubts? Ask here</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 sm:text-sm">
                Tap and ask — get instant voice answers about Nagpur's heat data, hotspots and planning recommendations in your own language.
              </p>
            </div>
          </div>
          <a
            href={VOICE_MODULE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#FF6B35] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e85a28] hover:shadow-md"
          >
            <Mic className="h-4 w-4" /> Tap and Ask
          </a>
        </div>
      </section>

      {/* ---------- findings ---------- */}
      <section data-tour="insights-findings" className="scroll-mt-24">
        <SectionHead
          title="Key findings"
          subtitle="Current evidence, interpreted for the selected season"
          right={<Pill tone="slate">{year} · {ds.source === "live" ? "connected data" : "demonstration data"}</Pill>}
        />
        <div className="grid gap-3 xl:grid-cols-2">
          {(insights?.findings ?? []).map((f, i) => {
            const Icon = toneIcon[f.tone];
            return (
              <article
                key={f.title}
                className={cn(
                  "border-l-2 bg-white px-4 py-3 shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-shadow duration-200 hover:shadow-[0_4px_12px_rgba(15,23,42,0.10)]",
                  toneAccent[f.tone],
                )}
              >
                <div className="flex items-start gap-2.5">
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", toneClass[f.tone])} />
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] font-semibold tabular-nums text-slate-400">0{i + 1}</span>
                      <h3 className="text-sm font-semibold text-slate-900">{f.title}</h3>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600">{f.body}</p>
                  </div>
                </div>
              </article>
            );
          })}
          {!insights && <p className="py-6 text-sm text-slate-500">Loading findings…</p>}
        </div>
      </section>

      {/* ---------- rankings + quality ---------- */}
      <section className="grid gap-4 scroll-mt-24 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <SectionHead
            title="Hotspot ranking"
            subtitle="Ranked by zone-mean LST · persistence and severity retain their source values."
            right={<Pill tone="orange">{rankings.length} zones</Pill>}
          />
          <div data-tour="insights-rankings" className="max-h-[560px] overflow-auto rounded-xl border border-slate-200 scroll-mt-24">
            <table className="w-full min-w-[760px] table-fixed text-xs">
              <colgroup>
                <col style={{ width: "5%" }} /><col style={{ width: "30%" }} /><col style={{ width: "12%" }} />
                <col style={{ width: "12%" }} /><col style={{ width: "13%" }} /><col style={{ width: "10%" }} />
                <col style={{ width: "10%" }} /><col style={{ width: "8%" }} />
              </colgroup>
              <thead className="sticky top-0 z-[1] bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-2 py-2 text-center font-semibold">#</th>
                  <th className="px-2 py-2 text-left font-semibold">Zone</th>
                  <th className="px-2 py-2 text-right font-semibold">Mean LST</th>
                  <th className="px-2 py-2 text-right font-semibold">Peak</th>
                  <th className="px-2 py-2 text-right font-semibold">Persistent</th>
                  <th className="px-2 py-2 text-right font-semibold">Area</th>
                  <th className="px-2 py-2 text-center font-semibold">Severity</th>
                  <th className="px-2 py-2 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rankings.map((h) => {
                  const isTop3 = h.rank <= 3;
                  return (
                    <tr key={h.zoneId} className="transition-colors hover:bg-slate-50">
                      <td className="px-2 py-2 text-center">
                        <span
                          className={cn(
                            "inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold tabular-nums",
                            isTop3 ? "bg-orange-100 text-[#C2410C]" : "text-slate-500",
                          )}
                        >
                          {h.rank}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-left">
                        <span className="block truncate font-medium text-slate-900">{h.zone}</span>
                        <span className="text-[10px] text-slate-500">Priority zone</span>
                      </td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums text-[#C2410C]">{fmt.temp(h.temperature)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-red-700">{fmt.temp(h.peakTemperature)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-700">{(h.persistence * 100).toFixed(0)}%</td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-600">{h.areaKm2.toFixed(1)} km²</td>
                      <td className="px-2 py-2 text-center">
                        <Pill tone={severityTone(h.severity)}>{h.severity}</Pill>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          onClick={() => { setScenarioZoneId(h.zoneId); setView("planning"); }}
                          className="whitespace-nowrap text-[10px] font-semibold text-[#FF6B35] transition hover:text-[#e85a28]"
                        >
                          View →
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="border-t border-slate-200 pt-4 xl:border-l xl:border-t-0 xl:pl-4">
          <SectionHead title="Data quality" subtitle={`Selected season · ${year}`} />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-slate-600">Composite coverage</span>
            <span className="text-sm font-semibold text-slate-900">{insights?.quality.completeness.toFixed(1) ?? "—"}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-[#FF6B35]" style={{ width: `${insights?.quality.completeness ?? 0}%` }} />
          </div>
          <dl className="mt-3 divide-y divide-slate-100 text-xs">
            <div className="flex justify-between py-2"><dt className="text-slate-500">Status</dt><dd className="font-medium text-slate-800">{insights?.quality.label ?? "Checking"}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-slate-500">Usable scenes</dt><dd className="font-medium text-slate-800">{insights?.quality.clearScenes ?? "—"}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-slate-500">Residual cloud</dt><dd className="font-medium text-slate-800">{insights?.quality.residualCloud.toFixed(1) ?? "—"}%</dd></div>
          </dl>
          <p className="mt-3 rounded-r-lg border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-[10px] leading-relaxed text-slate-700">
            LST is surface temperature at satellite overpass, not ambient air temperature or a health-warning threshold.
          </p>
        </aside>
      </section>

      {/* ---------- trends ---------- */}
      <section data-tour="insights-trends" className="scroll-mt-24">
        <SectionHead
          title="Seasonal patterns & trends"
          subtitle="Pre-monsoon composites available in the current archive; projections are clearly separated from observations."
        />
        <div className="grid gap-4 xl:grid-cols-3">
          <figure className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-shadow duration-200 hover:shadow-[0_4px_12px_rgba(15,23,42,0.10)]">
            <figcaption>
              <h3 className="text-sm font-semibold text-slate-900">City-mean LST</h3>
              <p className="text-[11px] text-slate-500">Observed 2019–2024, linear projection through 2030</p>
            </figcaption>
            <div className="mt-2 h-56">
              <ResponsiveContainer>
                <AreaChart
                  data={[...rows, ...(trends?.projection.filter((r) => r.year > 2024).map((r) => ({ year: r.year, lst: undefined, projection: r.lst })) ?? [])]}
                  margin={{ left: -8, right: 8, top: 8 }}
                >
                  <defs>
                    <linearGradient id="insightsLstFill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#FF6B35" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#FF6B35" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="year" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} unit="°" domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
                    formatter={(v) => `${Number(v).toFixed(2)} °C`}
                  />
                  <Area type="monotone" dataKey="lst" name="Observed" stroke="#FF6B35" fill="url(#insightsLstFill)" strokeWidth={2.4} />
                  <Line type="linear" dataKey="projection" name="Projected" stroke="#d97706" strokeDasharray="5 4" strokeWidth={1.8} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </figure>

          <figure className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-shadow duration-200 hover:shadow-[0_4px_12px_rgba(15,23,42,0.10)]">
            <figcaption>
              <h3 className="text-sm font-semibold text-slate-900">Vegetation &amp; built-up</h3>
              <p className="text-[11px] text-slate-500">NDVI and NDBI mean direction across the same seasons</p>
            </figcaption>
            <div className="mt-2 h-56">
              <ResponsiveContainer>
                <LineChart data={rows} margin={{ left: -8, right: 8, top: 8 }}>
                  <CartesianGrid stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="year" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis yAxisId="v" stroke="#10B981" fontSize={11} tickLine={false} domain={["auto", "auto"]} />
                  <YAxis yAxisId="b" orientation="right" stroke="#A78BFA" fontSize={11} tickLine={false} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} />
                  <Line yAxisId="v" dataKey="ndvi" name="NDVI" stroke="#10B981" strokeWidth={2.4} dot={{ r: 2.5 }} />
                  <Line yAxisId="b" dataKey="ndbi" name="NDBI" stroke="#A78BFA" strokeWidth={2.4} dot={{ r: 2.5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </figure>

          <figure className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-shadow duration-200 hover:shadow-[0_4px_12px_rgba(15,23,42,0.10)]">
            <figcaption>
              <h3 className="text-sm font-semibold text-slate-900">Reported UHI contrast</h3>
              <p className="text-[11px] text-slate-500">Seasonal contrast from the active data service</p>
            </figcaption>
            {seasonal?.uhiIntensity?.length ? (
              <div className="mt-2 h-56">
                <ResponsiveContainer>
                  <LineChart data={seasonal.uhiIntensity} margin={{ left: -8, right: 8, top: 8 }}>
                    <CartesianGrid stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="year" stroke="#64748b" fontSize={11} tickLine={false} />
                    <YAxis stroke="#64748b" fontSize={11} tickLine={false} unit="°C" />
                    <ReferenceLine y={0} stroke="#94a3b8" />
                    <Tooltip
                      contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}
                      formatter={(v) => `${Number(v).toFixed(2)} °C`}
                    />
                    <Line type="monotone" dataKey="intensity" name="Service-reported contrast" stroke="#FF6B35" strokeWidth={2.4} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="mt-2 flex h-56 items-center justify-center rounded-lg border border-dashed border-slate-200 px-6 text-center text-xs text-slate-500">
                Seasonal contrast is not available in the connected service response.
              </div>
            )}
            {seasonal?.seasons && (
              <p className="mt-2 text-[10px] text-slate-500">
                Available: {seasonal.seasons.filter((s) => s.available).map((s) => s.season).join(", ") || "not reported"}. Unavailable seasons are not inferred.
              </p>
            )}
          </figure>
        </div>
      </section>

      {/* ---------- recommendations ---------- */}
      <section data-tour="insights-recommendations" className="scroll-mt-24">
        <SectionHead
          title="Planning recommendations"
          subtitle="Actions aligned to measured zone conditions; priorities are indicative planning guidance."
        />
        <div className="grid gap-3 lg:grid-cols-3">
          {(insights?.recommendations ?? []).map((r, i) => (
            <article
              key={r.title}
              className={cn(
                "border-l-2 bg-white px-4 py-3 shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-shadow duration-200 hover:shadow-[0_4px_12px_rgba(15,23,42,0.10)]",
                priorityAccent(r.priority),
              )}
            >
              <div className="flex items-start gap-3">
                <span className="text-[10px] font-semibold tabular-nums text-slate-400">0{i + 1}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xs font-semibold text-slate-900">{r.title}</h3>
                    <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider", priorityChip(r.priority))}>
                      {r.priority}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">{r.body}</p>
                  <p className="mt-2 text-[10px] text-slate-500">Focus: {r.zones.join(" · ")}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ---------- priority action register (HVI) ---------- */}
      <section className="border-t border-slate-200 pt-4">
        <SectionHead
          title="Priority action register"
          subtitle="Exposure-weighted HVI: surface heat, persistence, trend, canopy deficit and population density."
        />
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {register.slice(0, 8).map((r) => (
            <article
              key={r.zone.zone.id}
              className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-shadow duration-200 hover:shadow-[0_4px_12px_rgba(15,23,42,0.10)]"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-slate-900">{r.zone.zone.short}</p>
                <Pill tone={r.tier === "Critical" ? "red" : r.tier === "High" ? "orange" : r.tier === "Moderate" ? "amber" : "green"}>
                  {r.tier}
                </Pill>
              </div>
              <p className="mt-2 text-lg font-bold tabular-nums" style={{ color: hviColor(r.tier) }}>
                HVI {r.hvi.toFixed(0)}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{r.intervention}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---------- generate report CTA ---------- */}
      <section data-tour="insights-report" className="scroll-mt-24">
        <div className="flex flex-col gap-3 rounded-r-lg border-l-4 border-[#FF6B35] bg-[#f9fafb] py-4 pr-4 pl-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Generate a scientific report</h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Print-ready assessment with source figures, captions, rankings, trends, interpretation and dataset provenance.
            </p>
            {reportError && <p className="mt-1 text-xs text-red-700">{reportError}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            {report && (
              <button
                onClick={() => setPreviewOpen(true)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                View Report
              </button>
            )}
            <button
              onClick={() => void generate()}
              disabled={generating}
              className="flex items-center gap-1.5 rounded-lg bg-[#FF6B35] px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#e85a28] disabled:opacity-60"
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              {generating ? "Generating…" : "Generate Report"}
            </button>
          </div>
        </div>
      </section>

      {reportSnapshot && previewOpen && <ReportPreview snapshot={reportSnapshot} onClose={() => setPreviewOpen(false)} />}
      <GuidedTour
        steps={INSIGHTS_TOUR}
        step={tourStep}
        onBack={() => setTourStep((s) => (s === null ? null : Math.max(0, s - 1)))}
        onNext={() =>
          setTourStep((s) =>
            s === null ? null : s + 1 >= INSIGHTS_TOUR.length ? (localStorage.setItem(TOUR_KEY, "1"), null) : s + 1,
          )
        }
        onSkip={finishTour}
        storageKey={TOUR_KEY}
      />
    </div>
  );
}