import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend as RLegend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import {
  AlertTriangle, ArrowRight, BookOpen, Boxes, BrainCircuit, CheckCircle2, ChevronDown, Cloud,
  Database, ExternalLink, GitBranch, Layers, Link2, List, Maximize2, Minimize2, Network,
  Satellite, Scale, ShieldCheck, TrendingUp,
} from "lucide-react";
import { useApp } from "@/App";
import { Method, MLPending } from "@/components/ml-ui";
import RasterCanvas from "@/components/RasterCanvas";
import { Card, Formula, Legend, Pill, chartTheme } from "@/components/ui";
import { rampCss } from "@/data/colors";
import { fmt } from "@/data/engine";
import { useML } from "@/ml/context";
import { cn } from "@/utils/cn";

const MODEL_COLORS: Record<string, string> = { linear: "#94a3b8", rf: "#10B981", gbm: "#FF6B35" };

/* -------------------------------------------------------------------------- */
/*  Table of contents                                                          */
/* -------------------------------------------------------------------------- */
const SECTIONS = [
  { id: "scope", n: "1", title: "Scope & study area", stage: "Context", icon: Satellite },
  { id: "data", n: "2", title: "Data sources & preprocessing", stage: "Data → Pre-processing", icon: Cloud },
  { id: "indices", n: "3", title: "Surface temperature & spectral indices", stage: "Indices", icon: Layers },
  { id: "temporal", n: "4", title: "Change detection & hotspot analysis", stage: "UHI · Temporal analysis", icon: TrendingUp },
  { id: "models", n: "5", title: "Statistical & machine-learning models", stage: "ML / Prediction", icon: BrainCircuit },
  { id: "validation", n: "6", title: "Validation", stage: "Validation", icon: ShieldCheck },
  { id: "hvi", n: "7", title: "Vulnerability index & scenario method", stage: "Prediction → Planning", icon: Scale },
  { id: "uncertainty", n: "8", title: "Uncertainty, limitations & responsible use", stage: "Limitations", icon: AlertTriangle },
  { id: "standards", n: "9", title: "Standards, references & data governance", stage: "Governance", icon: Database },
] as const;

/* The methodology journey — a visual map of the existing sections, not new content. */
const FLOW: { label: string; target: string }[] = [
  { label: "Satellite data", target: "data" },
  { label: "Pre-processing", target: "data" },
  { label: "NDVI / NDBI / LST", target: "indices" },
  { label: "UHI detection", target: "temporal" },
  { label: "Temporal & spatial analysis", target: "temporal" },
  { label: "Prediction / scenario modelling", target: "models" },
  { label: "Validation", target: "validation" },
  { label: "Limitations", target: "uncertainty" },
];

/* -------------------------------------------------------------------------- */
/*  FlowStrip — enhanced with active highlight                                 */
/* -------------------------------------------------------------------------- */
function FlowStrip({ go, active }: { go: (id: string) => void; active: string }) {
  return (
    <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Methodology at a glance</p>
      <div className="mt-2 flex flex-wrap items-center gap-y-2">
        {FLOW.map((s, i) => {
          const isActive = active === s.target;
          return (
            <span key={s.label} className="flex items-center">
              <button
                onClick={() => go(s.target)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[11px] font-medium shadow-sm transition",
                  isActive
                    ? "border-[#FF6B35] bg-orange-50 text-[#C2410C] ring-2 ring-orange-100"
                    : "border-slate-200 bg-white text-slate-700 hover:border-[#FF6B35] hover:text-[#C2410C]",
                )}
              >
                {s.label}
              </button>
              {i < FLOW.length - 1 && <ArrowRight className="mx-1.5 h-3.5 w-3.5 shrink-0 text-slate-300" />}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Collapsible section header                                                 */
/* -------------------------------------------------------------------------- */
function SectionHeader({ n, id, title, icon: Icon, stage, collapsed, onToggle, onCopy, copyState }: {
  n: string; id: string; title: string; icon: typeof Database; stage?: string;
  collapsed: boolean; onToggle: () => void; onCopy: () => void; copyState: boolean;
}) {
  return (
    <div
      id={id}
      className="scroll-mt-24 overflow-hidden rounded-r-xl border-l-4 border-[#FF6B35] bg-[#f9fafb] py-3 pr-3 pl-4 transition-shadow hover:shadow-[0_2px_8px_rgba(15,23,42,0.06)]"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FF6B35] text-xs font-bold text-white shadow-sm">
          {n}
        </span>
        <div className="min-w-0 flex-1">
          {stage && <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C2410C]">{stage}</p>}
          <div className="mt-0.5 flex items-center gap-2.5">
            <Icon className="h-4 w-4 shrink-0 text-slate-500" />
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onCopy}
            aria-label="Copy link to section"
            title="Copy link"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-slate-800"
          >
            {copyState ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Link2 className="h-4 w-4" />}
          </button>
          <button
            onClick={onToggle}
            aria-label={collapsed ? "Expand section" : "Collapse section"}
            title={collapsed ? "Expand" : "Collapse"}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-900"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", collapsed && "-rotate-90")} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  SectionBlock — collapsible wrapper for each section                        */
/* -------------------------------------------------------------------------- */
function SectionBlock({ id, n, title, icon, stage, collapsed, onToggle, onCopy, copyState, children }: {
  id: string; n: string; title: string; icon: typeof Database; stage?: string;
  collapsed: boolean; onToggle: () => void; onCopy: () => void; copyState: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <SectionHeader n={n} id={id} title={title} icon={icon} stage={stage} collapsed={collapsed} onToggle={onToggle} onCopy={onCopy} copyState={copyState} />
      <div
        className={cn(
          "grid transition-all duration-300 ease-out",
          collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-4 pt-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Spec table                                                                 */
/* -------------------------------------------------------------------------- */
function Spec({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-slate-100 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[150px_1fr] gap-3 py-2 sm:grid-cols-[200px_1fr]">
          <dt className="font-medium text-slate-500">{k}</dt>
          <dd className="text-slate-700">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* -------------------------------------------------------------------------- */
/*  Equation box                                                               */
/* -------------------------------------------------------------------------- */
function Eq({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-shadow hover:shadow-[0_4px_12px_rgba(15,23,42,0.10)]">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <div className="mt-2">
        <Formula>{children}</Formula>
      </div>
      {note && <p className="mt-3 text-[11px] leading-relaxed text-slate-600">{note}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Model cards (Section 5)                                                    */
/* -------------------------------------------------------------------------- */
interface ModelCard { icon: typeof Boxes; name: string; role: string; algo: string; features: string; validation: string; usedIn: string[]; caveat: string }
const MODEL_CARDS: ModelCard[] = [
  { icon: GitBranch, name: "LST surface model", role: "Explains and predicts surface temperature from land cover and spatial context", algo: "Gradient-boosted regression trees (200 rounds, depth 4, learning rate 0.08, 64-bin histograms) benchmarked against a 60-tree random forest and ordinary least squares", features: "NDVI, NDBI, 1 km neighbourhood means of both, NDBI texture, water share, distance to water / city centre / arterial road, industrial-land proximity, easting, northing", validation: "Spatial block hold-out (2 km blocks, 22 % of land cells); permutation importance and partial dependence computed on held-out blocks only", usedIn: ["Index Analysis — drivers of surface heat", "Scenario Lab — non-linear intervention response", "Overview — model skill indicator"], caveat: "Tree ensembles do not extrapolate; scenarios that push features outside the observed range fall back to the linear model." },
  { icon: Network, name: "Heat-island segmentation", role: "Converts per-cell hotspot flags into contiguous, nameable heat islands", algo: "DBSCAN, ε = 1.5 cells (≈ 300 m), minPts = 4, applied to cells in the hottest decile in ≥ 4 of 6 seasons", features: "Grid coordinates of persistent-hotspot cells", validation: "Density-based — no cluster count to choose; isolated cells rejected as noise; islands ranked by area and enriched with 2024 statistics and resident estimates", usedIn: ["Temporal Analysis — island catalogue", "Overview — priority islands", "Interactive Map — heat-island layer"], caveat: "ε is resolution-dependent and must be re-tuned for 30 m products." },
  { icon: Boxes, name: "Land-cover clustering", role: "Unsupervised spectral land-cover classes and the 2019 → 2024 transition matrix", algo: "k-means (k = 5, k-means++ seeding) on 2019 + 2024 land cells pooled; water fixed from the QA mask", features: "NDVI, NDBI and their 1 km means (standardised)", validation: "Elbow analysis (k = 2…8); one shared centroid set so both years are directly comparable; classes labelled by NDBI − NDVI ordering", usedIn: ["Temporal Analysis — land-cover transitions"], caveat: "Spectral classes, not cadastral land use; mixed pixels at 200 m blur class boundaries." },
  { icon: TrendingUp, name: "2030 outlook", role: "Spatially explicit projection of surface temperature under current land-cover trajectories", algo: "Hybrid: gradient boosting learns the spatial anomaly LST − cityMean(year) over all seasons; the city mean is extrapolated linearly; NDVI / NDBI projected per cell from their 2019–2024 trends", features: "Same 12 predictors with projected NDVI / NDBI", validation: "Blind back-test — trained on 2019–2023, forecasts 2024; compared with per-cell linear trend and persistence baselines on RMSE, bias and bias-free pattern RMSE", usedIn: ["Temporal Analysis — outlook", "Overview — 2030 indicator", "Interactive Map — outlook layer"], caveat: "Business-as-usual land-cover scenario, not a weather forecast; the ±1σ band reflects season-to-season variability only." },
];

/* -------------------------------------------------------------------------- */
/*  Live validation                                                            */
/* -------------------------------------------------------------------------- */
function LiveValidation() {
  const ml = useML();
  const r = ml.lst;
  if (!r) return <MLPending stage="lst" height={280} />;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card title="Held-out skill by model" subtitle={`Season ${r.year} · ${r.split.nTest.toLocaleString()} test cells in ${r.split.nTestBlocks} of ${r.split.nBlocks} spatial blocks`} right={<Method kind="cv" />}>
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="pb-2 text-left font-medium">Model</th>
              <th className="pb-2 text-right font-medium">R²</th>
              <th className="pb-2 text-right font-medium">RMSE</th>
              <th className="pb-2 text-right font-medium">MAE</th>
              <th className="pb-2 text-right font-medium">Train R²</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {r.models.map((m) => (
              <tr key={m.name} className={cn(m.name === r.best.name && "bg-orange-50/40")}>
                <td className="py-1.5 text-slate-800">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: MODEL_COLORS[m.kind] }} />
                  {m.name}
                  {m.name === r.best.name && <Pill tone="orange" className="ml-2">selected</Pill>}
                </td>
                <td className="py-1.5 text-right tabular-nums text-slate-900">{m.test.r2.toFixed(3)}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-900">{m.test.rmse.toFixed(2)}°</td>
                <td className="py-1.5 text-right tabular-nums text-slate-600">{m.test.mae.toFixed(2)}°</td>
                <td className="py-1.5 text-right tabular-nums text-slate-500">{m.train.r2.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-600">Model selection is automatic (lowest held-out RMSE). A small train–test gap indicates limited over-fitting; the residual ≈ 0.9 °C is consistent with composite and sensor noise.</p>
      </Card>
      <Card title="Predicted vs observed" subtitle={`${r.best.name} on held-out blocks`}>
        <div className="h-60">
          <ResponsiveContainer>
            <ScatterChart margin={{ left: -10, right: 10, top: 10 }}>
              <CartesianGrid stroke={chartTheme.grid} />
              <XAxis type="number" dataKey="obs" name="Observed" unit="°" domain={[30, 50]} stroke={chartTheme.axis} fontSize={11} tickLine={false} />
              <YAxis type="number" dataKey="pred" name="Predicted" unit="°" domain={[30, 50]} stroke={chartTheme.axis} fontSize={11} tickLine={false} />
              <ZAxis range={[12, 12]} />
              <Tooltip contentStyle={chartTheme.tooltip} formatter={(v) => `${Number(v).toFixed(2)} °C`} cursor={{ strokeDasharray: "3 3" }} />
              <ReferenceLine segment={[{ x: 30, y: 30 }, { x: 50, y: 50 }]} stroke="#94a3b8" strokeDasharray="5 4" />
              <Scatter data={r.scatter} isAnimationActive={false}>
                {r.scatter.map((p, i) => <Cell key={i} fill={rampCss("lst", p.obs)} fillOpacity={0.6} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Predictor importance" subtitle="Permutation ΔRMSE on held-out blocks">
        <div className="h-60">
          <ResponsiveContainer>
            <BarChart data={r.permutation.slice(0, 8)} layout="vertical" margin={{ left: 40, right: 20 }}>
              <CartesianGrid stroke={chartTheme.grid} horizontal={false} />
              <XAxis type="number" stroke={chartTheme.axis} fontSize={10} tickLine={false} unit="°" />
              <YAxis type="category" dataKey="label" stroke={chartTheme.axis} fontSize={10} tickLine={false} width={120} />
              <Tooltip contentStyle={chartTheme.tooltip} formatter={(v) => `+${Number(v).toFixed(3)} °C RMSE`} cursor={{ fill: "rgba(15,23,42,0.04)" }} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {r.permutation.slice(0, 8).map((p) => (
                  <Cell
                    key={p.key}
                    fill={p.group === "spectral" ? "#FF6B35" : p.group === "context" ? "#0ea5e9" : p.group === "geography" ? "#A78BFA" : "#94a3b8"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      {(["ndvi", "ndbi"] as const).map((k) => (
        <Card key={k} title={`Response curve · ${k.toUpperCase()}`} subtitle="Partial dependence — mean prediction as one predictor is varied">
          <div className="h-52">
            <ResponsiveContainer>
              <LineChart data={r.pd[k]} margin={{ left: -10, right: 10, top: 10 }}>
                <CartesianGrid stroke={chartTheme.grid} />
                <XAxis dataKey="x" stroke={chartTheme.axis} fontSize={11} tickLine={false} />
                <YAxis stroke={chartTheme.axis} fontSize={11} tickLine={false} domain={["auto", "auto"]} unit="°" tickFormatter={(v) => Number(v).toFixed(0)} />
                <Tooltip contentStyle={chartTheme.tooltip} formatter={(v) => `${Number(v).toFixed(2)} °C`} />
                <RLegend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="linear" name="Linear" stroke={MODEL_COLORS.linear} strokeWidth={2} dot={false} strokeDasharray="5 4" />
                <Line type="monotone" dataKey="rf" name="Random forest" stroke={MODEL_COLORS.rf} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="gbm" name="Gradient boosting" stroke={MODEL_COLORS.gbm} strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[11px] text-slate-600">
            {k === "ndvi"
              ? "Canopy cooling saturates — the first increment of greenness delivers the largest cooling."
              : "Impervious heating steepens beyond NDBI ≈ 0.15 — a threshold the linear baseline cannot represent."}
          </p>
        </Card>
      ))}
      <Card title="Residual map" subtitle="Observed − predicted · positive = hotter than land cover explains">
        <RasterCanvas values={r.residual} layer="dlst" showLabels labelKinds={["industry", "transport"]} />
        <Legend layer="dlst" className="mt-3" />
      </Card>
    </div>
  );
}

function ForecastValidation() {
  const ml = useML();
  const fc = ml.forecast;
  if (!fc) return <MLPending stage="forecast" height={160} />;
  return (
    <Card title="Outlook back-test — forecasting 2024 from 2019–2023" subtitle="The model never saw 2024. Pattern RMSE removes the common seasonal bias and isolates spatial skill." right={<Method kind="cv" />}>
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="pb-2 text-left font-medium">Method</th>
            <th className="pb-2 text-right font-medium">RMSE</th>
            <th className="pb-2 text-right font-medium">Bias</th>
            <th className="pb-2 text-right font-medium">Pattern RMSE</th>
            <th className="pb-2 text-right font-medium">R²</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {fc.backtest.map((b, i) => (
            <tr key={b.name} className={cn(i === 0 && "bg-orange-50/40")}>
              <td className="py-1.5 text-slate-800">
                {b.name}
                {i === 0 && <Pill tone="orange" className="ml-2">selected</Pill>}
              </td>
              <td className="py-1.5 text-right tabular-nums text-slate-900">{b.rmse.toFixed(2)}°</td>
              <td className="py-1.5 text-right tabular-nums text-slate-600">{b.bias > 0 ? "+" : ""}{b.bias.toFixed(2)}°</td>
              <td className="py-1.5 text-right tabular-nums text-emerald-700">{b.patternRmse.toFixed(2)}°</td>
              <td className="py-1.5 text-right tabular-nums text-slate-600">{b.r2.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
        All methods under-predict 2024 because that season carried a heat-wave anomaly not encoded in land cover; the hybrid model leads once the shared bias is removed. Projected city mean 2030:{" "}
        <span className="font-semibold text-slate-800">{fmt.temp(fc.stats.meanTarget)}</span> (± {fc.stats.sigma.toFixed(1)} °C season-to-season).
      </p>
    </Card>
  );
}

/* ========================================================================== */
/*  Page                                                                       */
/* ========================================================================== */
export default function Methodology() {
  const { ds, setView } = useApp();
  const reg = ds.regression[2024];
  const [active, setActive] = useState<string>("scope");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const refs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) {
        refs.current[s.id] = el;
        obs.observe(el);
      }
    });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const scrollTop = window.scrollY;
      const height = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(height > 0 ? Math.min(100, (scrollTop / height) * 100) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const collapseAll = () => setCollapsed(new Set(SECTIONS.map((s) => s.id)));
  const expandAll = () => setCollapsed(new Set());

  const copyLink = async (id: string) => {
    try {
      const url = `${window.location.origin}${window.location.pathname}#${id}`;
      await navigator.clipboard.writeText(url);
      setCopied(id);
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const commonSectionProps = (id: string) => ({
    collapsed: collapsed.has(id),
    onToggle: () => toggle(id),
    onCopy: () => void copyLink(id),
    copyState: copied === id,
  });

  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      {/* ---------- reading progress bar ---------- */}
      <div className="fixed inset-x-0 top-0 z-[750] h-0.5 bg-slate-100">
        <div className="h-full bg-[#FF6B35] transition-[width] duration-150 ease-out" style={{ width: `${progress}%` }} />
      </div>

      {/* ---------- header ---------- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#C2410C]">Technical documentation</p>
          <div className="mt-1 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FF6B35] text-white shadow-sm">
              <BookOpen className="h-4 w-4" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Methods & Validation</h1>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Technical documentation for the Nagpur Urban Heat Intelligence platform — data provenance, processing specifications, the statistical and machine-learning methods behind each module, how they are validated, and how results should (and should not) be used.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Pill tone="slate">Document v1.2 · {new Date().getFullYear()}</Pill>
            <Pill tone="sky">Landsat 8/9 C2-L2 · Sentinel-2 L2A</Pill>
            <Pill tone="green">Spatially cross-validated</Pill>
            <Pill tone="orange">{ds.source === "live" ? "Live data" : "Demonstration data"}</Pill>
          </div>
        </div>
        <button
          onClick={() => setView("home")}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
        >
          ← Back to home
        </button>
      </div>

      <FlowStrip go={go} active={active} />

      {/* ---------- mobile section dots ---------- */}
      <div className="no-print mt-3 flex gap-1 overflow-x-auto pb-1 xl:hidden">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => go(s.id)}
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums transition",
              active === s.id
                ? "border-[#FF6B35] bg-[#FF6B35] text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
            )}
            aria-label={s.title}
          >
            {s.n}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[250px_1fr]">
        {/* ---------- TOC ---------- */}
        <nav className="no-print hidden xl:block">
          <div className="sticky top-20 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
            <div className="flex items-center justify-between px-2 pb-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Methodology flow</p>
              <span className="text-[10px] tabular-nums text-slate-400">{progress.toFixed(0)}%</span>
            </div>

            <div className="mb-2 flex gap-1 px-1">
              <button
                onClick={expandAll}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 transition hover:bg-slate-50"
                title="Expand all sections"
              >
                <Maximize2 className="h-3 w-3" /> Expand all
              </button>
              <button
                onClick={collapseAll}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 transition hover:bg-slate-50"
                title="Collapse all sections"
              >
                <Minimize2 className="h-3 w-3" /> Collapse all
              </button>
            </div>

            <ul className="space-y-0.5">
              {SECTIONS.map((s, i) => {
                const Icon = s.icon;
                const isActive = active === s.id;
                return (
                  <li key={s.id} className="relative">
                    {i < SECTIONS.length - 1 && (
                      <span className="absolute left-[17px] top-8 h-[calc(100%-14px)] w-px bg-slate-200" aria-hidden />
                    )}
                    <button
                      onClick={() => go(s.id)}
                      className={cn(
                        "flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs transition",
                        isActive
                          ? "bg-orange-50 font-medium text-[#C2410C] ring-1 ring-orange-100"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                      )}
                    >
                      <span
                        className={cn(
                          "relative z-[1] flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                          isActive ? "bg-[#FF6B35] text-white" : "bg-slate-100 text-slate-500",
                        )}
                      >
                        {s.n}
                      </span>
                      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", isActive ? "text-[#FF6B35]" : "text-slate-400")} />
                      <span className="min-w-0 leading-tight">{s.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>

        {/* ---------- body ---------- */}
        <div className="uhi-method-body min-w-0 space-y-6">
          {/* 1 · Scope */}
          <SectionBlock n="1" id="scope" title="Scope & study area" icon={Satellite} stage="Context" {...commonSectionProps("scope")}>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Purpose">
                <p className="text-xs leading-relaxed text-slate-700">
                  The platform quantifies the surface urban heat island of Nagpur — India's hottest large city, with pre-monsoon maxima regularly above 45 °C — and turns it into planning evidence: where heat concentrates, how fast it is growing, what drives it, and which interventions cool which neighbourhoods at what cost. It is designed to support the annual Heat Action Plan cycle of the Nagpur Municipal Corporation and allied departments.
                </p>
                <ul className="mt-3 space-y-1 text-xs text-slate-700">
                  {[
                    "Decision users: urban planning, environment, public health, smart-city cell",
                    "Decision horizon: annual plan updates; 5-year land-use outlook",
                    "Spatial unit: 200 m analysis cells aggregated to 18 planning zones",
                    "Temporal unit: one pre-monsoon composite per year, 2019–2024",
                  ].map((t) => (
                    <li key={t} className="flex gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      {t}
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="Study area specification">
                <Spec
                  rows={[
                    ["Area of interest", "78.94 – 79.22 °E, 21.02 – 21.26 °N (≈ 29 × 27 km)"],
                    ["Coverage", "NMC limits plus MIHAN, Hingna MIDC, Koradi and the southern growth corridors"],
                    ["Reference system", "WGS 84 (EPSG:4326) for products; UTM 44N (EPSG:32644) for processing"],
                    ["Analysis grid", `${ds.h} × ${ds.w} cells · ${Math.round(Math.sqrt(ds.cellAreaKm2) * 1000)} m · ${ds.cellAreaKm2.toFixed(3)} km² per cell`],
                    ["Planning zones", "18 polygons aligned to recognisable neighbourhoods and land-use character"],
                    ["Season window", "1 March – 31 May (clearest skies, peak surface heating, pre-monsoon)"],
                    ["Population", "Indicative ward-level estimates per zone; replace with Census tables for statutory use"],
                  ]}
                />
              </Card>
            </div>
          </SectionBlock>

          {/* 2 · Data */}
          <SectionBlock n="2" id="data" title="Data sources & preprocessing" icon={Cloud} stage="Satellite data → Pre-processing" {...commonSectionProps("data")}>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Satellite inputs">
                <Spec
                  rows={[
                    ["Thermal & optical", "Landsat 8 OLI/TIRS and Landsat 9 OLI-2/TIRS-2, Collection 2 Level-2 (surface reflectance + surface temperature), WRS-2 path 144 / row 045, 16-day revisit each"],
                    ["Optical (high-res)", "Copernicus Sentinel-2A/2B MSI Level-2A (Sen2Cor), tile 44QLJ, 5-day combined revisit"],
                    ["Bands used", "Landsat B4 (red), B5 (NIR), B6 (SWIR1), ST_B10 (surface temperature), QA_PIXEL · Sentinel-2 B4, B8, B11, SCL"],
                    ["Access", "STAC catalogues (Microsoft Planetary Computer) or Google Earth Engine; AOI windows read from Cloud-Optimised GeoTIFFs"],
                    ["Licences", "Landsat: USGS/NASA public domain · Sentinel-2: ESA, CC BY-SA 3.0 IGO"],
                  ]}
                />
              </Card>
              <Card title="Processing specification">
                <Spec
                  rows={[
                    ["Cloud & shadow masking", "Landsat QA_PIXEL bits 0–5 (fill, dilated cloud, cirrus, cloud, shadow, snow); Sentinel-2 SCL classes 0, 1, 3, 8, 9, 10, 11"],
                    ["Mask dilation", "1 pixel (3 × 3) — thin cloud edges bias surface temperature low"],
                    ["Scene screening", "> 45 % AOI cloud rejected; 20–45 % used with masking; < 20 % used in full"],
                    ["Radiometry", "Collection-2 scale factors: SR = DN × 2.75e-5 − 0.2; ST = DN × 3.418e-3 + 149 K"],
                    ["Co-registration", "Native UTM 44N grids warped to the common WGS 84 analysis grid (average resampling for indices, nearest for QA); tie-point RMSE ≈ 0.3 px"],
                    ["Compositing", "Per-cell median of all clear observations in the season; observation-count layer retained; cells with < 3 clear observations flagged"],
                    ["Water mask", "QA water flag / SCL class 6 majority across the season (stable water bodies)"],
                  ]}
                />
              </Card>
            </div>

            <Card title="Data source" subtitle="Acquisition platforms used by the data service — official portals for independent verification">
              <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { name: "Microsoft Planetary Computer", role: "Primary STAC catalogue (collections landsat-c2-l2 · sentinel-2-l2a)", url: "https://planetarycomputer.microsoft.com" },
                  { name: "Google Earth Engine", role: "Alternative acquisition back-end (server-side compositing)", url: "https://earthengine.google.com" },
                  { name: "USGS · Landsat missions", role: "Landsat 8/9 mission & Collection-2 product documentation", url: "https://www.usgs.gov/landsat-missions" },
                  { name: "Copernicus Data Space", role: "Sentinel-2 mission data & Level-2A products (ESA)", url: "https://dataspace.copernicus.eu" },
                ].map((s) => (
                  <div
                    key={s.name}
                    className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 transition-shadow hover:shadow-[0_2px_8px_rgba(15,23,42,0.06)]"
                  >
                    <p className="font-semibold text-slate-800">
                      <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Source:</span>
                      {s.name}
                    </p>
                    <p className="mt-1 leading-relaxed text-slate-600">{s.role}</p>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 font-medium text-[#C2410C] underline decoration-orange-200 underline-offset-2 transition hover:text-[#FF6B35]"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {s.url.replace("https://", "")}
                    </a>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
                Current session:{" "}
                <span className="font-medium text-slate-800">
                  {ds.source === "live" ? `live data service (${ds.meta.serviceSource ?? "connected"})` : "demonstration composites (model-generated, calibrated to Nagpur's geography)"}
                </span>
                . The links above identify where the operational satellite inputs originate; they do not imply certification or approval of this platform.
              </p>
            </Card>

            <Card title="Data quality indicators exposed in the interface" subtitle="Every composite carries its own provenance">
              <div className="grid gap-3 text-xs sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="font-semibold text-slate-900">Scene availability</p>
                  <p className="mt-1 text-slate-600">Count of acquisitions per sensor and season, with used / partially masked / rejected status.</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="font-semibold text-slate-900">Residual cloud & completeness</p>
                  <p className="mt-1 text-slate-600">Share of the AOI with ≥ 3 clear observations and the estimated residual cloud fraction after compositing.</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="font-semibold text-slate-900">Prediction confidence</p>
                  <p className="mt-1 text-slate-600">Blends composite completeness, residual cloud and model fit into a High / Medium / Low indicator shown beside model outputs.</p>
                </div>
              </div>
            </Card>
          </SectionBlock>

          {/* 3 · Indices */}
          <SectionBlock n="3" id="indices" title="Surface temperature & spectral indices" icon={Layers} stage="Pre-processing → Indices" {...commonSectionProps("indices")}>
            <div className="grid gap-3 lg:grid-cols-3">
              <Eq label="Vegetation index" note="Chlorophyll absorbs red and reflects near-infrared; values above ≈ 0.4 indicate closed canopy. Landsat (B5 − B4)/(B5 + B4); Sentinel-2 (B8 − B4)/(B8 + B4).">
                NDVI = (NIR − Red) / (NIR + Red)
              </Eq>
              <Eq label="Built-up index" note="Impervious surfaces reflect more shortwave-infrared than near-infrared; positive values flag roofs, tarmac and bare concrete. Landsat (B6 − B5)/(B6 + B5); Sentinel-2 (B11 − B8)/(B11 + B8).">
                NDBI = (SWIR1 − NIR) / (SWIR1 + NIR)
              </Eq>
              <Eq label="Land-surface temperature" note="Primary route: Collection-2 Level-2 surface temperature (atmospherically and emissivity corrected by USGS). Fallback single-channel chain: DN → radiance → brightness temperature → NDVI-threshold emissivity (ε) → LST.">
                LST = BT / (1 + (λ·BT/ρ)·ln ε) − 273.15
              </Eq>
            </div>
            <Card title="Interpretation notes">
              <ul className="space-y-1.5 text-xs text-slate-700">
                {[
                  "LST is the radiometric temperature of the surface at satellite overpass (~10:30 IST), typically 5–15 °C above shaded air temperature on hot surfaces; it is the correct variable for material and land-cover decisions, not for health thresholds defined on air temperature.",
                  "Seasonal medians suppress single-day weather; inter-annual differences therefore mix land-cover change with season-scale climate anomalies, which the outlook model separates explicitly.",
                  "Thresholds used for area statistics: hot > 42 °C LST, green NDVI > 0.40, built-up NDBI > 0.10; the hottest decile (top 10 %) of land cells defines annual hotspots.",
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                    {t}
                  </li>
                ))}
              </ul>
            </Card>
          </SectionBlock>

          {/* 4 · Temporal */}
          <SectionBlock n="4" id="temporal" title="Change detection & hotspot analysis" icon={TrendingUp} stage="Indices → UHI detection · Temporal analysis" {...commonSectionProps("temporal")}>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Change detection">
                <Spec
                  rows={[
                    ["Difference layers", "Δ = year_b − year_a for LST, NDVI, NDBI; swipe comparison of any two seasons"],
                    ["Driver classification", "Per cell: vegetation loss (ΔNDVI < −0.10), new construction (ΔNDBI > +0.10), both, greening / cooling (ΔNDVI > +0.10 or ΔLST < −1), background warming (ΔLST > +2 without land-cover change)"],
                    ["Zone attribution", "Zone-mean ΔLST regressed on zone-mean ΔNDVI to quantify heating per unit of canopy lost"],
                  ]}
                />
              </Card>
              <Card title="Hotspot persistence & trends">
                <Spec
                  rows={[
                    ["Annual hotspot", "Land cells in the hottest decile of that season"],
                    ["Persistence", "Number of seasons (0–6) a cell was a hotspot; ≥ 5 = persistent, all 6 = structural"],
                    ["Local clustering", "Getis-Ord Gi* z-scores (box neighbourhood) — |z| > 1.96 marks statistically significant hot / cold clusters at 95 %"],
                    ["Rates of change", "Ordinary least squares over the six seasons for city, zone and cell; slopes reported in °C / yr and index units / yr with R²"],
                    ["Extrapolation", "Linear projection to 2026 / 2028 / 2030 shown alongside the machine-learning outlook (§ 5)"],
                  ]}
                />
              </Card>
            </div>
          </SectionBlock>

          {/* 5 · Models */}
          <SectionBlock n="5" id="models" title="Statistical & machine-learning models" icon={BrainCircuit} stage="Temporal analysis → ML / Prediction" {...commonSectionProps("models")}>
            <Card title="Baseline statistical model" subtitle="Two-variable OLS fitted on land cells each season — reported next to every machine-learning result">
              <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
                <Formula>
                  LST = {reg.a.toFixed(2)} {reg.bNdvi < 0 ? "−" : "+"} {Math.abs(reg.bNdvi).toFixed(2)}·NDVI + {reg.bNdbi.toFixed(2)}·NDBI &nbsp;&nbsp; (2024: R² {reg.r2.toFixed(3)}, RMSE {reg.rmse.toFixed(2)} °C, n = {reg.n.toLocaleString()})
                </Formula>
                <p className="text-[11px] text-slate-600">
                  r(NDVI, LST) = {reg.rNdviLst.toFixed(2)} · r(NDBI, LST) = {reg.rNdbiLst.toFixed(2)}
                </p>
              </div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              {MODEL_CARDS.map((m) => {
                const Icon = m.icon;
                return (
                  <div
                    key={m.name}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-shadow duration-200 hover:shadow-[0_4px_12px_rgba(15,23,42,0.10)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
                          <Icon className="h-5 w-5" />
                        </span>
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">{m.name}</h3>
                          <p className="text-xs text-slate-600">{m.role}</p>
                        </div>
                      </div>
                      <Method kind="ml" />
                    </div>
                    <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Algorithm</dt>
                        <dd className="mt-1 text-slate-700">{m.algo}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Inputs</dt>
                        <dd className="mt-1 text-slate-700">{m.features}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Validation</dt>
                        <dd className="mt-1 text-slate-700">{m.validation}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Used in</dt>
                        <dd className="mt-1 space-y-0.5">
                          {m.usedIn.map((u) => (
                            <p key={u} className="text-slate-700">• {u}</p>
                          ))}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Limitations</dt>
                        <dd className="mt-1 text-slate-600">{m.caveat}</dd>
                      </div>
                    </dl>
                  </div>
                );
              })}
            </div>

            <Card title="Feature engineering" subtitle="Twelve predictors per cell, identical across seasons">
              <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Own pixel", ["NDVI", "NDBI"]],
                  ["1 km neighbourhood", ["NDVI mean", "NDBI mean", "NDBI texture (σ)", "Water share"]],
                  ["Geography", ["Distance to water", "Distance to city centre", "Distance to arterial road", "Industrial-land proximity"]],
                  ["Position", ["Easting (km)", "Northing (km)"]],
                ].map(([g, items]) => (
                  <div key={g as string} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="font-semibold text-slate-900">{g as string}</p>
                    <ul className="mt-1 space-y-0.5 text-slate-600">
                      {(items as string[]).map((i) => (
                        <li key={i}>• {i}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-slate-600">
                Neighbourhood terms capture advection and shading from surrounding land cover; geography terms absorb systematic effects (water-body cooling, industrial process heat, urban-core morphology) so that the spectral coefficients are not confounded.
              </p>
            </Card>
          </SectionBlock>

          {/* 6 · Validation */}
          <SectionBlock n="6" id="validation" title="Validation" icon={ShieldCheck} stage="Prediction → Validation" {...commonSectionProps("validation")}>
            <Card title="Protocol">
              <ul className="space-y-1.5 text-xs text-slate-700">
                {[
                  "Spatial block cross-validation: the grid is tiled into 2 km blocks and whole blocks are held out. Random cell-level splits leak information through spatial autocorrelation and overstate skill by 30–50 % in our tests.",
                  "Blind temporal back-test: the outlook model is trained on 2019–2023 and scored on 2024, which it never saw; three baselines (per-cell linear trend, persistence, hybrid ML) are compared on RMSE, bias and pattern RMSE.",
                  "A linear baseline is fitted and displayed next to every machine-learning result so that the added value of non-linearity is always visible.",
                  "Predictor importance is computed by permutation on the held-out blocks (not by in-sample impurity) to avoid bias toward high-cardinality features.",
                  "All figures below are recomputed on the currently loaded dataset, in this browser session.",
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    {t}
                  </li>
                ))}
              </ul>
            </Card>
            <LiveValidation />
            <ForecastValidation />
          </SectionBlock>

          {/* 7 · HVI & scenario */}
          <SectionBlock n="7" id="hvi" title="Vulnerability index & scenario method" icon={Scale} stage="Prediction → Planning application" {...commonSectionProps("hvi")}>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Heat Vulnerability Index (HVI)" subtitle="Exposure-weighted composite per planning zone, scaled 0–100">
                <Eq label="Composite">
                  HVI = 0.35·Exposure + 0.20·Persistence + 0.15·Trend + 0.15·Canopy deficit + 0.15·Density
                </Eq>
                <div className="mt-3">
                  <Spec
                    rows={[
                      ["Exposure", "Zone-mean LST of the latest season (z-scored, logistic-squashed to 0–1)"],
                      ["Persistence", "Share of zone cells that are persistent hotspots (≥ 5 of 6 seasons)"],
                      ["Trend", "Zone LST slope 2019–2024 (z-scored)"],
                      ["Canopy deficit", "Negative zone-mean NDVI (z-scored)"],
                      ["Density", "log(residents / km²) (z-scored)"],
                      ["Tiers", "Critical ≥ 75 · High ≥ 50 · Moderate ≥ 25 · Low < 25"],
                      ["Extension", "Census sensitivity layers (age structure, income, housing type, AC penetration) can be appended per zone to complete a full IPCC-style exposure × sensitivity × adaptive-capacity index"],
                    ]}
                  />
                </div>
              </Card>
              <Card title="Scenario model" subtitle="Intervention → index change → temperature response → cost">
                <div className="space-y-3">
                  <Eq
                    label="Cover to index"
                    note="Calibrated on the seasonal composites: NDVI rises 0.72 per unit vegetation-cover fraction, NDBI rises 0.75 per unit impervious fraction."
                  >
                    ΔNDVI = 0.72·Δveg &nbsp;·&nbsp; ΔNDBI = 0.75·Δbuilt
                  </Eq>
                  <Eq
                    label="Temperature response"
                    note="Linear response uses the OLS coefficients of § 5; the non-linear response re-computes all twelve predictors (including neighbourhood context) and queries the gradient-boosting model. Both are shown; the linear estimate is preferred outside the observed feature range."
                  >
                    ΔLST = b₁·ΔNDVI + b₂·ΔNDBI
                  </Eq>
                  <Spec
                    rows={[
                      ["Baselines", "2024 observed, or 2030 business-as-usual (each zone's own 2019–2024 trend extended)"],
                      ["Buildings lever", "One mid-rise block ≈ 3,500 m² including paved surrounds; converted to percentage points of zone area"],
                      ["Uncertainty", "0.18 × |ΔLST| + 0.12 × model RMSE (calibration + composite noise)"],
                      ["Costing", "Street trees (₹ per tree incl. 3-yr O&M, ≈ 25 m² canopy each), Miyawaki (₹/m²), de-paving (₹/m²), cool roofs (₹/m², informational); rates editable, ₹ per °C and ₹ per resident reported"],
                    ]}
                  />
                </div>
              </Card>
            </div>
          </SectionBlock>

          {/* 8 · Uncertainty */}
          <SectionBlock n="8" id="uncertainty" title="Uncertainty, limitations & responsible use" icon={AlertTriangle} stage="Validation → Limitations" {...commonSectionProps("uncertainty")}>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="Known limitations">
                <ul className="space-y-1.5 text-xs text-slate-700">
                  {[
                    "Landsat thermal is acquired at 100 m and resampled; sub-block heat sources (a single furnace, a car park) are smoothed.",
                    "Seasonal medians hide short heat-wave peaks; the platform describes chronic, not acute, heat.",
                    "200 m cells mix land covers; zone statistics are robust, single-cell values should be read with the residual map.",
                    "Population figures are indicative; HVI density and per-resident costs inherit that uncertainty.",
                    "Six seasons is a short record for trends; slopes with R² < 0.5 should be treated as indicative.",
                  ].map((t) => (
                    <li key={t} className="flex gap-2">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                      {t}
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="Uncertainty communicated in the interface">
                <ul className="space-y-1.5 text-xs text-slate-700">
                  {[
                    "Held-out RMSE and R² on every model output",
                    "± band on scenario ΔLST and on the 2030 outlook",
                    "Provenance tags (ML / validated / statistical / physics) beside derived figures",
                    "Data-quality panel per season (scenes, cloud, completeness, confidence)",
                    "Explicit demonstration-data banner until a live service is connected",
                  ].map((t) => (
                    <li key={t} className="flex gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" />
                      {t}
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="Responsible use">
                <ul className="space-y-1.5 text-xs text-slate-700">
                  {[
                    "Outputs are decision support, not regulatory measurements; verify priority sites with ground surveys or mobile transects before capital commitment.",
                    "Do not use LST thresholds as health triggers — heat-health warnings must follow IMD air-temperature criteria.",
                    "Model-generated demonstration composites exercise the platform but must not inform operational decisions.",
                    "Report the data source, season and model version with any figure reused from this platform.",
                  ].map((t) => (
                    <li key={t} className="flex gap-2">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                      {t}
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </SectionBlock>

          {/* 9 · Standards */}
          <SectionBlock n="9" id="standards" title="Standards, references & data governance" icon={Database} stage="Reference" {...commonSectionProps("standards")}>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Methodological references">
                <ol className="list-decimal space-y-1.5 pl-4 text-xs text-slate-700">
                  <li>USGS. <i>Landsat 8–9 Collection 2 Level-2 Science Product Guide</i> — surface reflectance and surface temperature algorithms, QA_PIXEL specification.</li>
                  <li>ESA. <i>Sentinel-2 Level-2A Algorithm Theoretical Basis Document</i> — Sen2Cor scene classification (SCL).</li>
                  <li>Sobrino, J. A., Jiménez-Muñoz, J. C., Paolini, L. (2004). Land surface temperature retrieval from Landsat TM 5. <i>Remote Sensing of Environment</i>, 90, 434–440 — NDVI-threshold emissivity.</li>
                  <li>Zha, Y., Gao, J., Ni, S. (2003). Use of normalized difference built-up index in automatically mapping urban areas from TM imagery. <i>IJRS</i>, 24, 583–594.</li>
                  <li>Getis, A., Ord, J. K. (1992). The analysis of spatial association by use of distance statistics. <i>Geographical Analysis</i>, 24, 189–206.</li>
                  <li>Roberts, D. R. et al. (2017). Cross-validation strategies for data with temporal, spatial, hierarchical, or phylogenetic structure. <i>Ecography</i>, 40, 913–929 — spatial block CV.</li>
                  <li>Ester, M. et al. (1996). A density-based algorithm for discovering clusters (DBSCAN). <i>KDD-96</i>.</li>
                  <li>NDMA (2019). <i>National Guidelines for Preparation of Action Plan — Prevention and Management of Heat Wave</i>; IMD heat-wave criteria.</li>
                </ol>
              </Card>
              <Card title="Data governance">
                <Spec
                  rows={[
                    ["Data classification", "All satellite inputs are open data; no personal data is processed. Population aggregates are at zone level."],
                    ["Provenance", "Each composite records sensor, acquisition dates, cloud statistics and processing version; exports embed dataset id and generation time."],
                    ["Versioning", "Interface v1.2 · method document v1.2 · seasonal composites keyed by year; changes to thresholds or model settings increment the method version."],
                    ["Update cadence", "One composite per pre-monsoon season, published by mid-June; ad-hoc re-runs after major Landsat / Sentinel reprocessing."],
                    ["Interoperability", "Zone products exportable as CSV and GeoJSON (CRS84); rasters available as GeoTIFF (EPSG:4326) from the data service; REST endpoints documented under the data-source dialog."],
                    ["Attribution", "Contains modified Copernicus Sentinel data (2019–2024) · Landsat courtesy of the U.S. Geological Survey · Basemap © OpenStreetMap contributors, © CARTO, Esri"],
                  ]}
                />
              </Card>
            </div>
          </SectionBlock>
        </div>
      </div>
    </div>
  );
}