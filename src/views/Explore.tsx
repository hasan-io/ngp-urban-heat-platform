import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { ArrowLeftRight, Layers3 } from "lucide-react";
import { useApp } from "@/App";
import InteractiveMap from "@/views/InteractiveMap";
import RasterCanvas from "@/components/RasterCanvas";
import { Card, Legend, Pill, Segmented, YearPicker, chartTheme } from "@/components/ui";
import { diffRaster } from "@/data/engine";
import { rampCss } from "@/data/colors";
import { uhiApi } from "@/api/client";
import type { ScatterResponse, TrendResponse } from "@/api/types";
import { YEARS, type Year } from "@/data/nagpur";

/* -------------------------------------------------------------------------- */
/*  Swipe comparison — larger orange-ringed handle, light theme               */
/* -------------------------------------------------------------------------- */
function SwipeComparison({ a, b, yearA, yearB }: { a: Float32Array; b: Float32Array; yearA: Year; yearB: Year }) {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const update = (x: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos(Math.max(2, Math.min(98, ((x - r.left) / r.width) * 100)));
  };
  return (
    <div
      ref={ref}
      className="relative select-none touch-none"
      onPointerDown={(e) => { drag.current = true; update(e.clientX); }}
      onPointerMove={(e) => drag.current && update(e.clientX)}
      onPointerUp={() => { drag.current = false; }}
      onPointerLeave={() => { drag.current = false; }}
    >
      <RasterCanvas values={b} layer="lst" showLabels labelKinds={["growth", "city"]} />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <RasterCanvas values={a} layer="lst" showLabels labelKinds={["growth", "city"]} />
      </div>

      {/* Divider line + orange-ringed handle */}
      <div
        className="pointer-events-none absolute inset-y-0 w-[2px] bg-[#FF6B35] shadow-[0_0_10px_rgba(255,107,53,0.55)]"
        style={{ left: `${pos}%` }}
      >
        <div className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[#FF6B35] bg-white text-[#FF6B35] shadow-[0_4px_12px_rgba(15,23,42,0.18)]">
          <ArrowLeftRight className="h-4 w-4" strokeWidth={2.5} />
        </div>
      </div>

      {/* Year badges — light with dark text */}
      <span className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-slate-200 bg-white/95 px-2 py-0.5 text-xs font-semibold text-slate-800">
        {yearA}
      </span>
      <span className="pointer-events-none absolute bottom-2 right-2 rounded-md border border-slate-200 bg-white/95 px-2 py-0.5 text-xs font-semibold text-slate-800">
        {yearB}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  GroupHeader — 4px orange left border + #f9fafb background                 */
/* -------------------------------------------------------------------------- */
function GroupHeader({ title, desc, right }: { title: string; desc: string; right?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-r-lg border-l-4 border-[#FF6B35] bg-[#f9fafb] py-3 pr-4 pl-4 sm:flex-row sm:items-baseline sm:justify-between">
      <div>
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-slate-900">{title}</h3>
        <p className="mt-0.5 max-w-3xl text-xs text-slate-600">{desc}</p>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
export default function Explore() {
  const { ds, year, setYear } = useApp();
  const [scatter, setScatter] = useState<{ ndvi: ScatterResponse | null; ndbi: ScatterResponse | null }>({ ndvi: null, ndbi: null });
  const [trends, setTrends] = useState<TrendResponse | null>(null);
  const [changeA, setChangeA] = useState<Year>(2019);
  const [changeB, setChangeB] = useState<Year>(2024);

  useEffect(() => {
    let alive = true;
    Promise.all([uhiApi.scatter("ndvi-lst", year), uhiApi.scatter("ndbi-lst", year), uhiApi.trends()])
      .then(([a, b, t]) => { if (alive) { setScatter({ ndvi: a.data, ndbi: b.data }); setTrends(t.data); } })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [year]);

  const trendRows = trends?.city ?? YEARS.map((y) => ({ year: y, lst: ds.city[y].lstMean, ndvi: ds.city[y].ndviMean, ndbi: ds.city[y].ndbiMean }));

  const indexTrendRows = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const y = 2019 + i;
    return {
      year: y,
      ndvi: y <= 2024 ? ds.city[y as Year].ndviMean : undefined,
      ndbi: y <= 2024 ? ds.city[y as Year].ndbiMean : undefined,
      ndviProjection: y >= 2024 ? ds.trends.ndvi.intercept + ds.trends.ndvi.slope * y : undefined,
      ndbiProjection: y >= 2024 ? ds.trends.ndbi.intercept + ds.trends.ndbi.slope * y : undefined,
    };
  }), [ds]);

  const dLst = useMemo(() => diffRaster(ds, "lst", changeA, changeB), [ds, changeA, changeB]);

  return (
    <div>
      <InteractiveMap />
      <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
        {/* ============ MAJOR SECTION: Analytical Workspace ============ */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.06)] sm:p-6">
          <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#C2410C]">Analysis &amp; evidence</p>
              <div className="mt-1 flex items-center gap-2">
                <Layers3 className="h-5 w-5 text-[#FF6B35]" />
                <h2 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Analytical Workspace</h2>
              </div>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                Synchronized views, relationship diagnostics, change detection, persistent hotspots and trend evidence for the selected season.
              </p>
            </div>
            <YearPicker value={year} onChange={setYear} />
          </header>

          {/* ---------- 1 · Synchronized index views ---------- */}
          <div className="pt-5">
            <GroupHeader title="Synchronized index views" desc="One season across the three surface indices — LST, NDVI and NDBI share the same frame and year." />
            <div className="mt-3 grid gap-4 xl:grid-cols-3">
              {(["lst", "ndvi", "ndbi"] as const).map((metric) => (
                <Card
                  key={metric}
                  title={metric === "lst" ? `LST · ${year}` : `${metric.toUpperCase()} · ${year}`}
                  subtitle={metric === "lst" ? "Land-surface temperature" : metric === "ndvi" ? "Vegetation greenness" : "Built-up intensity"}
                >
                  <RasterCanvas
                    values={ds.rasters[year][metric]}
                    layer={metric}
                    showLabels
                    labelKinds={metric === "lst" ? ["industry", "city"] : metric === "ndvi" ? ["forest", "water"] : ["growth", "city"]}
                  />
                  <Legend layer={metric} className="mt-3" />
                </Card>
              ))}
            </div>
          </div>

          {/* ---------- 2 · Relationship diagnostics ---------- */}
          <div className="mt-8 border-t border-slate-100 pt-5">
            <GroupHeader title="Relationship diagnostics" desc="Pixel-level pairing of each index with surface temperature, fitted with an ordinary least-squares line." />
            <div className="mt-3 grid gap-4 xl:grid-cols-2">
              {(["ndvi", "ndbi"] as const).map((key) => {
                const s = scatter[key];
                const fallback = ds.regression[year];
                const slope = s?.slope ?? (key === "ndvi" ? fallback.bNdvi : fallback.bNdbi);
                const intercept = s?.intercept ?? fallback.a;
                const r2 = s?.r2 ?? (key === "ndvi" ? fallback.rNdviLst ** 2 : fallback.rNdbiLst ** 2);
                const pts = s?.points ?? [];
                const x0 = key === "ndvi" ? -0.1 : -0.5;
                const x1 = key === "ndvi" ? 0.85 : 0.6;
                return (
                  <Card
                    key={key}
                    title={`${key.toUpperCase()} vs LST`}
                    subtitle={key === "ndvi" ? "Vegetation–temperature relationship" : "Built-up–temperature relationship"}
                    right={<Pill tone={key === "ndvi" ? "green" : "violet"}>R² {r2.toFixed(2)}</Pill>}
                  >
                    <div className="h-64">
                      <ResponsiveContainer>
                        <ScatterChart margin={{ left: -10, right: 10, top: 10 }}>
                          <CartesianGrid stroke={chartTheme.grid} />
                          <XAxis
                            type="number" dataKey="x" name={key.toUpperCase()}
                            domain={key === "ndvi" ? [-0.1, 0.85] : [-0.5, 0.6]}
                            stroke={chartTheme.axis} fontSize={11} tickLine={false}
                          />
                          <YAxis type="number" dataKey="y" name="LST" unit="°C" domain={[30, 52]} stroke={chartTheme.axis} fontSize={11} tickLine={false} />
                          <ZAxis range={[12, 12]} />
                          <Tooltip contentStyle={chartTheme.tooltip} formatter={(v) => Number(v).toFixed(3)} cursor={{ strokeDasharray: "3 3" }} />
                          <ReferenceLine
                            segment={[{ x: x0, y: intercept + slope * x0 }, { x: x1, y: intercept + slope * x1 }]}
                            stroke="#64748b" strokeWidth={2} strokeDasharray="6 4"
                          />
                          <Scatter data={pts} isAnimationActive={false}>
                            {pts.map((p, i) => <Cell key={i} fill={rampCss("lst", p.y)} fillOpacity={0.6} />)}
                          </Scatter>
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                      <span className="font-mono text-[#C2410C]">
                        {s?.equation ?? `LST = ${fallback.a.toFixed(2)} ${slope < 0 ? "−" : "+"} ${Math.abs(slope).toFixed(2)}·${key.toUpperCase()}`}
                      </span>
                      <span className="ml-3 text-slate-600">
                        slope {slope > 0 ? "+" : ""}{slope.toFixed(2)} °C / index unit
                      </span>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* ---------- 3 · Change detection ---------- */}
          <div className="mt-8 border-t border-slate-100 pt-5">
            <GroupHeader title="Change detection" desc="Two pre-monsoon composites compared side by side — draggable divider and per-cell difference." />
            <div className="mt-3 grid gap-4 xl:grid-cols-2">
              <Card title="Change Detection — LST Swipe" right={<span className="text-xs font-medium text-slate-500">Drag to compare</span>}>
                <div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Start year</p>
                    <div className="mt-1 flex min-w-0 justify-center overflow-x-auto">
                      <Segmented size="xs" options={YEARS.map((y) => ({ value: y, label: y }))} value={changeA} onChange={setChangeA} />
                    </div>
                  </div>
                  <ArrowLeftRight className="h-4 w-4 text-slate-400" />
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">End year</p>
                    <div className="mt-1 flex min-w-0 justify-center overflow-x-auto">
                      <Segmented size="xs" options={YEARS.map((y) => ({ value: y, label: y }))} value={changeB} onChange={setChangeB} />
                    </div>
                  </div>
                </div>
                <SwipeComparison a={ds.rasters[changeA].lst} b={ds.rasters[changeB].lst} yearA={changeA} yearB={changeB} />
                <Legend layer="lst" className="mt-3" />
              </Card>

              <Card
                title={`ΔLST · ${changeB} − ${changeA}`}
                subtitle="Positive values mark warming; use alongside ΔNDVI and ΔNDBI layers in the main map"
              >
                <RasterCanvas values={dLst} layer="dlst" showZones showLabels labelKinds={["growth"]} waterColor={null} />
                <Legend layer="dlst" className="mt-3" />
              </Card>
            </div>
          </div>

          {/* ---------- 4 · Persistence & trends ---------- */}
          <div className="mt-8 border-t border-slate-100 pt-5">
            <GroupHeader title="Persistence & trends" desc="Where heat has stayed over the six-season record, and where each index is heading." />
            <div className="mt-3 grid gap-4 xl:grid-cols-3">
              <Card
                title="Persistent hotspots"
                subtitle="Cells in the annual top LST decile across 2019–2024"
                right={<Pill tone="red">≥5 years</Pill>}
              >
                <RasterCanvas values={ds.hotCount} layer="hotspot" showZones showLabels labelKinds={["industry", "city"]} />
                <Legend layer="hotspot" className="mt-3" />
              </Card>

              <Card title="LST trend" subtitle="City-mean surface temperature: observed 2019–2024, projected forward">
                <div className="h-64">
                  <ResponsiveContainer>
                    <LineChart
                      data={[
                        ...trendRows,
                        ...(trends?.projection?.filter((r) => r.year > 2024).map((r) => ({ year: r.year, lst: undefined, projection: r.lst })) ?? []),
                      ]}
                      margin={{ left: -10, right: 10, top: 10 }}
                    >
                      <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                      <XAxis dataKey="year" stroke={chartTheme.axis} fontSize={11} tickLine={false} />
                      <YAxis stroke={chartTheme.axis} fontSize={12} tickLine={false} domain={["auto", "auto"]} unit="°" />
                      <Tooltip contentStyle={chartTheme.tooltip} formatter={(v) => `${Number(v).toFixed(2)} °C`} />
                      <Line type="monotone" dataKey="lst" name="Observed" stroke="#FF6B35" strokeWidth={2.4} dot={{ r: 3 }} />
                      <Line type="linear" dataKey="projection" name="Projection" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card title="NDVI & NDBI trends" subtitle="City mean · dashed lines extend the historical linear trend to 2030">
                <div className="h-64">
                  <ResponsiveContainer>
                    <LineChart data={indexTrendRows} margin={{ left: -10, right: 10, top: 10 }}>
                      <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                      <XAxis dataKey="year" stroke={chartTheme.axis} fontSize={11} tickLine={false} />
                      <YAxis yAxisId="left" stroke={chartTheme.axis} fontSize={11} tickLine={false} domain={["auto", "auto"]} />
                      <YAxis yAxisId="right" orientation="right" stroke={chartTheme.axis} fontSize={11} tickLine={false} domain={["auto", "auto"]} />
                      <Tooltip contentStyle={chartTheme.tooltip} />
                      <Line yAxisId="left" type="monotone" dataKey="ndvi" name="NDVI observed" stroke="#10B981" strokeWidth={2.4} dot={{ r: 3 }} />
                      <Line yAxisId="right" type="monotone" dataKey="ndbi" name="NDBI observed" stroke="#A78BFA" strokeWidth={2.4} dot={{ r: 3 }} />
                      <Line yAxisId="left" type="linear" dataKey="ndviProjection" name="NDVI projection" stroke="#10B981" strokeWidth={1.6} strokeDasharray="5 4" dot={false} />
                      <Line yAxisId="right" type="linear" dataKey="ndbiProjection" name="NDBI projection" stroke="#A78BFA" strokeWidth={1.6} strokeDasharray="5 4" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}