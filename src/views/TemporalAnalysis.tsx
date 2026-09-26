import { useMemo, useRef, useState } from "react";
import { CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { AlertTriangle, ArrowLeftRight, Boxes, Network, TrendingUp } from "lucide-react";
import { useApp } from "@/App";
import RasterCanvas from "@/components/RasterCanvas";
import { Card, KPI, Legend, Pill, SectionHeader, Segmented, chartTheme } from "@/components/ui";
import { Method, MLPending } from "@/components/ml-ui";
import { useML } from "@/ml/context";
import { METRIC_META, rampCss, type LayerKey } from "@/data/colors";
import { diffRaster, fmt, linearFit, type Metric } from "@/data/engine";
import { YEARS, type Year } from "@/data/nagpur";
import { cn } from "@/utils/cn";

function SwipeCompare({ a, b, metric, yearA, yearB }: { a: Float32Array; b: Float32Array; metric: Metric; yearA: Year; yearB: Year }) {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const update = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos(Math.min(98, Math.max(2, ((clientX - r.left) / r.width) * 100)));
  };
  return (
    <div
      ref={ref}
      className="relative select-none touch-none"
      onPointerDown={(e) => { dragging.current = true; update(e.clientX); }}
      onPointerMove={(e) => dragging.current && update(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerLeave={() => (dragging.current = false)}
    >
      <RasterCanvas values={b} layer={metric} showLabels labelKinds={["growth", "city"]} />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <RasterCanvas values={a} layer={metric} showLabels labelKinds={["growth", "city"]} />
      </div>
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_12px_rgba(255,255,255,0.8)]" style={{ left: `${pos}%` }}>
        <div className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-slate-900 text-white shadow-lg"><ArrowLeftRight className="h-4 w-4" /></div>
      </div>
      <span className="pointer-events-none absolute left-2 bottom-2 rounded-md bg-black/70 px-2 py-0.5 text-xs font-semibold text-white">{yearA}</span>
      <span className="pointer-events-none absolute right-2 bottom-2 rounded-md bg-black/70 px-2 py-0.5 text-xs font-semibold text-white">{yearB}</span>
    </div>
  );
}

function classifyDriver(dL: number, dV: number, dB: number): { label: string; tone: "red" | "orange" | "amber" | "violet" | "slate" | "green" } {
  if (dV < -0.04 && dB > 0.04) return { label: "Tree loss + construction", tone: "red" };
  if (dB > 0.04) return { label: "New construction", tone: "violet" };
  if (dV < -0.04) return { label: "Vegetation loss", tone: "orange" };
  if (dL > 1.2) return { label: "Background warming", tone: "amber" };
  if (dL < 0.4) return { label: "Stable", tone: "green" };
  return { label: "Densification", tone: "slate" };
}

export default function TemporalAnalysis() {
  const { ds } = useApp();
  const ml = useML();
  const [yearA, setYearA] = useState<Year>(2019);
  const [yearB, setYearB] = useState<Year>(2024);
  const [metric, setMetric] = useState<Metric>("lst");

  const diff = useMemo(() => diffRaster(ds, metric, yearA, yearB), [ds, metric, yearA, yearB]);
  const dLst = useMemo(() => diffRaster(ds, "lst", yearA, yearB), [ds, yearA, yearB]);
  const dNdvi = useMemo(() => diffRaster(ds, "ndvi", yearA, yearB), [ds, yearA, yearB]);
  const dNdbi = useMemo(() => diffRaster(ds, "ndbi", yearA, yearB), [ds, yearA, yearB]);
  const diffLayer = (`d${metric}`) as LayerKey;

  const summary = useMemo(() => {
    let sL = 0, heated = 0, vegLost = 0, newBuilt = 0, cooled = 0, n = 0;
    for (let i = 0; i < ds.n; i++) {
      if (ds.water[i]) continue;
      n++; sL += dLst[i];
      if (dLst[i] > 2) heated++;
      if (dLst[i] < -1) cooled++;
      if (dNdvi[i] < -0.1) vegLost++;
      if (dNdbi[i] > 0.1) newBuilt++;
    }
    return { meanDLst: sL / n, heatedKm2: heated * ds.cellAreaKm2, cooledKm2: cooled * ds.cellAreaKm2, vegLostKm2: vegLost * ds.cellAreaKm2, newBuiltKm2: newBuilt * ds.cellAreaKm2 };
  }, [ds, dLst, dNdvi, dNdbi]);

  const zoneChanges = useMemo(() =>
    ds.zones.map((z) => ({
      z,
      dL: z.byYear[yearB].lst - z.byYear[yearA].lst,
      dV: z.byYear[yearB].ndvi - z.byYear[yearA].ndvi,
      dB: z.byYear[yearB].ndbi - z.byYear[yearA].ndbi,
    })).sort((a, b) => b.dL - a.dL), [ds, yearA, yearB]);

  const zoneScatter = zoneChanges.map((c) => ({ x: c.dV, y: c.dL, name: c.z.zone.short }));
  const zoneFit = linearFit(zoneScatter.map((p) => p.x), zoneScatter.map((p) => p.y));
  const zoneR = Math.sqrt(zoneFit.r2) * Math.sign(zoneFit.slope);

  const persistentKm2 = useMemo(() => { let k = 0; for (let i = 0; i < ds.n; i++) if (ds.hotCount[i] >= 5) k++; return k * ds.cellAreaKm2; }, [ds]);
  const allYearsKm2 = useMemo(() => { let k = 0; for (let i = 0; i < ds.n; i++) if (ds.hotCount[i] === 6) k++; return k * ds.cellAreaKm2; }, [ds]);
  const persistentZones = [...ds.zones].sort((a, b) => b.persistentFrac - a.persistentFrac).slice(0, 6);

  const trendRows = (m: Metric) => {
    const t = ds.trends[m];
    return Array.from({ length: 12 }, (_, k) => {
      const y = 2019 + k;
      const fit = t.intercept + t.slope * y;
      return { year: y, obs: y <= 2024 ? ds.city[y as Year][`${m}Mean` as "lstMean"] : undefined, fit: y <= 2024 ? fit : undefined, proj: y >= 2024 ? fit : undefined };
    });
  };
  const fastest = [...ds.zones].sort((a, b) => b.lstSlope - a.lstSlope).slice(0, 6);
  const proj = (m: Metric, y: number) => ds.trends[m].intercept + ds.trends[m].slope * y;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6">
      <SectionHeader n={3} title="Temporal Analysis & Hotspot Detection" purpose="Compare seasons, attribute change to tree loss or construction, isolate neighbourhoods that stay hot every year, and project current rates forward." why="A single-year map shows a state; six years show a trajectory — persistent hotspots and fast-warming corridors are where action has the highest return.">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>From</span><Segmented size="xs" options={YEARS.map((y) => ({ value: y, label: y }))} value={yearA} onChange={setYearA} />
          <span>to</span><Segmented size="xs" options={YEARS.map((y) => ({ value: y, label: y }))} value={yearB} onChange={setYearB} />
          <Segmented size="xs" options={(["lst", "ndvi", "ndbi"] as Metric[]).map((m) => ({ value: m, label: METRIC_META[m].short }))} value={metric} onChange={setMetric} />
        </div>
      </SectionHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KPI label={`Mean ΔLST ${yearA}→${yearB}`} value={fmt.delta(summary.meanDLst, 2, "°C")} tone="hot" sub="land pixels" />
        <KPI label="Heated > +2 °C" value={fmt.km2(summary.heatedKm2)} tone="hot" sub="deterioration hotspots" />
        <KPI label="Vegetation lost" value={fmt.km2(summary.vegLostKm2)} tone="green" sub="ΔNDVI < −0.10" />
        <KPI label="New built-up" value={fmt.km2(summary.newBuiltKm2)} tone="violet" sub="ΔNDBI > +0.10" />
        <KPI label="Cooled < −1 °C" value={fmt.km2(summary.cooledKm2)} tone="sky" sub="plantation / water bodies" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={`Multi-temporal comparison · ${METRIC_META[metric].label}`} subtitle={`Drag the handle — ${yearA} on the left, ${yearB} on the right`}>
          <SwipeCompare a={ds.rasters[yearA][metric]} b={ds.rasters[yearB][metric]} metric={metric} yearA={yearA} yearB={yearB} />
          <Legend layer={metric} className="mt-3" />
        </Card>
        <Card title={`Change detection · Δ${METRIC_META[metric].short} (${yearB} − ${yearA})`} subtitle="Where did maximum deterioration happen?">
          <RasterCanvas values={diff} layer={diffLayer} showZones showLabels labelKinds={["growth"]} waterColor={null} />
          <Legend layer={diffLayer} className="mt-3" />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Zone-wise change ranking" subtitle={`${yearA} → ${yearB} · sorted by ΔLST · driver classification from ΔNDVI / ΔNDBI`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr><th className="pb-2 pr-2 font-medium">Zone</th><th className="pb-2 pr-2 font-medium">ΔLST</th><th className="pb-2 pr-2 font-medium">ΔNDVI</th><th className="pb-2 pr-2 font-medium">ΔNDBI</th><th className="pb-2 font-medium">Driver</th></tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {zoneChanges.map((c) => {
                  const d = classifyDriver(c.dL, c.dV, c.dB);
                  return (
                    <tr key={c.z.zone.id}>
                      <td className="py-1.5 pr-2 text-slate-200">{c.z.zone.name}</td>
                      <td className="py-1.5 pr-2"><span className="rounded px-1.5 py-0.5 font-semibold tabular-nums text-white" style={{ background: rampCss("dlst", c.dL) + "aa" }}>{fmt.delta(c.dL, 2, "°C")}</span></td>
                      <td className={cn("py-1.5 pr-2 tabular-nums", c.dV < 0 ? "text-orange-300" : "text-emerald-300")}>{fmt.delta(c.dV, 3)}</td>
                      <td className={cn("py-1.5 pr-2 tabular-nums", c.dB > 0 ? "text-fuchsia-300" : "text-sky-300")}>{fmt.delta(c.dB, 3)}</td>
                      <td className="py-1.5"><Pill tone={d.tone}>{d.label}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="xl:col-span-2" title="Tree cut-out → temperature increase?" subtitle={`Zone ΔNDVI vs ΔLST · r = ${zoneR.toFixed(2)}`}>
          <div className="h-72">
            <ResponsiveContainer>
              <ScatterChart margin={{ left: -10, right: 15, top: 10 }}>
                <CartesianGrid stroke={chartTheme.grid} />
                <XAxis type="number" dataKey="x" name="ΔNDVI" stroke={chartTheme.axis} fontSize={11} tickLine={false} domain={["auto", "auto"]} />
                <YAxis type="number" dataKey="y" name="ΔLST" unit="°C" stroke={chartTheme.axis} fontSize={11} tickLine={false} domain={["auto", "auto"]} />
                <ZAxis range={[80, 80]} />
                <Tooltip contentStyle={chartTheme.tooltip} cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
                  const p = payload?.[0]?.payload as { name: string; x: number; y: number } | undefined;
                  if (!p) return null;
                  return <div style={chartTheme.tooltip} className="px-3 py-2"><p className="font-semibold text-white">{p.name}</p><p className="text-slate-300">ΔNDVI {fmt.delta(p.x, 3)} · ΔLST {fmt.delta(p.y, 2, "°C")}</p></div>;
                }} />
                <ReferenceLine x={0} stroke="rgba(255,255,255,0.2)" />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                <Scatter data={zoneScatter} isAnimationActive={false}>
                  {zoneScatter.map((p, i) => <Cell key={i} fill={rampCss("dlst", p.y)} stroke="#fff" strokeWidth={0.5} />)}
                </Scatter>
                {zoneScatter.length > 1 && (
                  <ReferenceLine segment={[
                    { x: Math.min(...zoneScatter.map((p) => p.x)), y: zoneFit.intercept + zoneFit.slope * Math.min(...zoneScatter.map((p) => p.x)) },
                    { x: Math.max(...zoneScatter.map((p) => p.x)), y: zoneFit.intercept + zoneFit.slope * Math.max(...zoneScatter.map((p) => p.x)) },
                  ]} stroke="#fff" strokeDasharray="6 4" strokeWidth={1.5} />
                )}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-slate-400">Every 0.1 NDVI lost in a zone came with <span className="font-semibold text-orange-300">{fmt.delta(-zoneFit.slope * 0.1, 2, "°C")}</span> of extra surface heating over this period.</p>
        </Card>
      </div>

      {/* Persistent hotspots */}
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Persistent hotspot identification" subtitle="Cells inside the city-wide top-10% LST decile, counted across all six years" right={<Pill tone="red"><AlertTriangle className="h-3 w-3" /> {persistentKm2.toFixed(1)} km² in ≥5 yrs</Pill>}>
          <RasterCanvas values={ds.hotCount} layer="hotspot" showZones showLabels labelKinds={["industry", "city", "transport"]} />
          <Legend layer="hotspot" className="mt-3" />
        </Card>
        <Card className="xl:col-span-2" title="Vulnerable zones" subtitle="Kaunse areas CONSISTENTLY garam rahe sab saal?">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-red-500/10 p-3"><p className="text-[10px] uppercase text-slate-500">Hot in all 6 years</p><p className="text-xl font-semibold text-red-200">{allYearsKm2.toFixed(1)} km²</p></div>
            <div className="rounded-xl bg-amber-500/10 p-3"><p className="text-[10px] uppercase text-slate-500">Hot in ≥ 5 years</p><p className="text-xl font-semibold text-amber-200">{persistentKm2.toFixed(1)} km²</p></div>
          </div>
          <div className="mt-3 space-y-2">
            {persistentZones.map((z, k) => (
              <div key={z.zone.id} className="text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-200"><span className="mr-1.5 text-slate-500">#{k + 1}</span>{z.zone.name}</span>
                  <span className="flex items-center gap-2"><span className="tabular-nums text-slate-400">{(z.persistentFrac * z.areaKm2).toFixed(1)} km²</span><span className="font-semibold text-red-300">{fmt.pct(z.persistentFrac)}</span></span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-red-500" style={{ width: `${z.persistentFrac * 100}%` }} /></div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-400">Persistence means the heat is structural (materials, lack of canopy, industrial load) — not a one-season anomaly. These zones are <span className="text-red-300">at-risk</span> and should be first in line for cooling interventions.</p>
        </Card>
      </div>

      {/* Heat islands (DBSCAN) */}
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title={<span className="flex items-center gap-2"><Network className="h-4 w-4 text-fuchsia-300" />Heat-island segmentation</span>} subtitle="Density clustering (DBSCAN, ε ≈ 300 m, minPts 4) groups persistent-hotspot cells into contiguous, nameable islands" right={<Method kind="ml" />}>
          {ml.islands ? (
            <>
              <RasterCanvas values={ml.islands.raster} layer="cluster" palette={ml.islands.palette} showZones showLabels labelKinds={["industry", "transport", "city"]} />
              <p className="mt-2 text-[11px] text-slate-400">{ml.islands.islands.length} islands from {ml.islands.nCandidates.toLocaleString()} candidate cells (hottest decile in ≥ {ml.islands.minYears} of 6 years); {ml.islands.nNoise} isolated cells rejected as noise. Each colour is one island.</p>
            </>
          ) : <MLPending stage="islands" height={360} />}
        </Card>
        <Card className="xl:col-span-2" title="Island catalogue" subtitle="Ranked by area · 2024 statistics · population share" bodyClassName="p-0">
          {ml.islands ? (
            <div className="max-h-[520px] overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-2 text-left font-medium">#</th><th className="py-2 text-left font-medium">Island</th><th className="py-2 text-right font-medium">km²</th><th className="py-2 text-right font-medium">Mean</th><th className="py-2 text-right font-medium">Peak</th><th className="px-3 py-2 text-right font-medium">Yrs</th></tr></thead>
                <tbody className="divide-y divide-white/5">
                  {ml.islands.islands.map((i, k) => (
                    <tr key={i.id}>
                      <td className="px-3 py-1.5"><span className="mr-1 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: ml.islands!.palette[(i.id % (ml.islands!.palette.length - 1)) + 1] }} /><span className="text-slate-500">{k + 1}</span></td>
                      <td className="py-1.5 text-slate-100"><p>{i.name}</p><p className="text-[10px] text-slate-500">NDBI {i.meanNdbi.toFixed(2)} · NDVI {i.meanNdvi.toFixed(2)}{i.residents ? ` · ~${(i.residents / 1000).toFixed(0)}k residents` : ""}</p></td>
                      <td className="py-1.5 text-right tabular-nums text-slate-200">{i.areaKm2.toFixed(1)}</td>
                      <td className="py-1.5 text-right tabular-nums" style={{ color: rampCss("lst", i.meanLst) }}>{i.meanLst.toFixed(1)}</td>
                      <td className="py-1.5 text-right tabular-nums text-red-300">{i.peakLst.toFixed(1)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{i.persistence.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <MLPending stage="islands" height={360} className="m-4" />}
        </Card>
      </div>

      {/* Land-cover transitions (k-means) */}
      <Card title={<span className="flex items-center gap-2"><Boxes className="h-4 w-4 text-fuchsia-300" />Land-cover transitions 2019 → 2024</span>} subtitle="Unsupervised spectral classes (k-means on NDVI, NDBI and 1 km context; water from QA mask). Rows: 2019 class · columns: 2024 class · km²" right={<Method kind="ml" />}>
        {ml.landcover ? (() => {
          const lc = ml.landcover;
          const maxOff = Math.max(...lc.transition.flatMap((row, a) => row.filter((_, b) => a !== b)));
          return (
            <div className="grid gap-4 xl:grid-cols-5">
              <div className="xl:col-span-2">
                <RasterCanvas values={Float32Array.from(lc.labels[2024])} layer="cluster" palette={lc.palette} waterColor={null} title="2024 classes" />
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-300">{lc.classes.map((c) => <span key={c.id} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />{c.label}</span>)}</div>
              </div>
              <div className="xl:col-span-3">
                <div className="overflow-x-auto">
                  <div className="grid min-w-[560px] gap-1 text-[11px]" style={{ gridTemplateColumns: `150px repeat(${lc.classes.length}, 1fr)` }}>
                    <div />
                    {lc.classes.map((c) => <div key={c.id} className="truncate text-center text-slate-400" title={c.label}><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: c.color }} />{c.label.split(" ")[0]}</div>)}
                    {lc.transition.map((row, a) => (
                      <div key={a} className="contents">
                        <div className="flex items-center gap-1.5 truncate text-slate-300"><span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: lc.classes[a].color }} />{lc.classes[a].label}</div>
                        {row.map((v, b) => <div key={b} className={cn("rounded-md py-1.5 text-center tabular-nums", a === b ? "bg-white/5 text-slate-500" : "text-white")} style={a !== b && v > 0 ? { background: `rgba(249,115,22,${0.12 + 0.75 * (v / maxOff)})` } : undefined}>{v < 0.05 ? "·" : v.toFixed(1)}</div>)}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-fuchsia-500/10 p-3"><p className="text-[10px] uppercase text-slate-500">Open / vegetated → built-up</p><p className="text-lg font-semibold text-fuchsia-200">{lc.vegToBuiltKm2.toFixed(1)} km²</p></div>
                  <div className="rounded-xl bg-emerald-500/10 p-3"><p className="text-[10px] uppercase text-slate-500">Built-up → open</p><p className="text-lg font-semibold text-emerald-200">{lc.builtToVegKm2.toFixed(1)} km²</p></div>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">Both years share one centroid set, so the matrix is directly comparable. Hottest class in 2024: <span className="text-slate-200">{[...lc.classes].sort((a, b) => b.lst[2024] - a.lst[2024])[0].label}</span> ({fmt.temp([...lc.classes].sort((a, b) => b.lst[2024] - a.lst[2024])[0].lst[2024])}).</p>
              </div>
            </div>
          );
        })() : <MLPending stage="landcover" height={280} />}
      </Card>

      {/* Rate of change */}
      <div className="grid gap-4 xl:grid-cols-3">
        {(["lst", "ndvi", "ndbi"] as Metric[]).map((m) => {
          const meta = METRIC_META[m];
          const t = ds.trends[m];
          const rows = trendRows(m);
          return (
            <Card key={m} title={<span className="flex items-center gap-2"><TrendingUp className="h-4 w-4" style={{ color: meta.color }} />{meta.short} rate of change</span>} subtitle={`${fmt.delta(t.slope, m === "lst" ? 3 : 4, m === "lst" ? " °C/yr" : "/yr")} · R² ${t.r2.toFixed(2)} · dashed = extrapolation`}>
              <div className="h-44">
                <ResponsiveContainer>
                  <LineChart data={rows} margin={{ left: -12, right: 10, top: 8 }}>
                    <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                    <XAxis dataKey="year" stroke={chartTheme.axis} fontSize={10} tickLine={false} />
                    <YAxis stroke={chartTheme.axis} fontSize={10} tickLine={false} domain={["auto", "auto"]} tickFormatter={(v) => Number(v).toFixed(m === "lst" ? 1 : 2)} />
                    <Tooltip contentStyle={chartTheme.tooltip} formatter={(v) => Number(v).toFixed(m === "lst" ? 2 : 3)} />
                    <ReferenceLine x={2024} stroke="rgba(255,255,255,0.2)" strokeDasharray="2 2" />
                    <Line type="monotone" dataKey="obs" name="Observed" stroke={meta.color} strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="linear" dataKey="fit" name="Trend" stroke="rgba(255,255,255,0.5)" strokeWidth={1.5} dot={false} />
                    <Line type="linear" dataKey="proj" name="Projection" stroke={meta.color} strokeDasharray="5 5" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-[11px]">
                {[2026, 2028, 2030].map((y) => (
                  <div key={y} className="rounded-lg bg-white/4 py-1.5"><p className="text-slate-500">{y}</p><p className="font-semibold text-white">{proj(m, y).toFixed(m === "lst" ? 1 : 3)}{meta.unit}</p></div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      <Card title="“Agar same rate se change hota raha toh 5 saal mein kya hoga?”" subtitle="Zone-level LST trend (°C/yr) extrapolated to 2029">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {fastest.map((z) => (
            <div key={z.zone.id} className="flex items-center justify-between rounded-xl border border-white/8 bg-white/3 px-3 py-2 text-xs">
              <div><p className="font-medium text-slate-100">{z.zone.name}</p><p className="text-slate-500">2024: {fmt.temp(z.byYear[2024].lst)} · NDVI {fmt.delta(z.ndviSlope, 3, "/yr")}</p></div>
              <div className="text-right"><p className="font-semibold text-orange-300">{fmt.delta(z.lstSlope, 2, " °C/yr")}</p><p className="text-slate-400">2029 ≈ <span className="text-white">{fmt.temp(z.byYear[2024].lst + z.lstSlope * 5)}</span></p></div>
            </div>
          ))}
        </div>
      </Card>
      {/* 2030 outlook (ML) */}
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title={<span className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-fuchsia-300" />Spatial outlook · 2030</span>} subtitle="Hybrid model: gradient boosting learns the spatial pattern from land cover; the city-mean trend supplies the temporal drift; NDVI / NDBI projected per pixel" right={<Method kind="ml" />}>
          {ml.forecast ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><RasterCanvas values={ml.forecast.raster} layer="lst" showZones title="Projected LST 2030" /><Legend layer="lst" className="mt-2" /></div>
                <div><RasterCanvas values={ml.forecast.delta} layer="dlst" waterColor={null} title="Δ vs 2024" /><Legend layer="dlst" className="mt-2" /></div>
              </div>
            </>
          ) : <MLPending stage="forecast" height={320} />}
        </Card>
        <Card className="xl:col-span-2" title="Outlook summary & skill" subtitle="Blind back-test: trained on 2019–2023, forecast 2024">
          {ml.forecast ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-red-500/10 p-3"><p className="text-[10px] uppercase text-slate-500">City mean 2030</p><p className="text-xl font-semibold text-red-200">{fmt.temp(ml.forecast.stats.meanTarget)}</p><p className="text-[10px] text-slate-400">{fmt.delta(ml.forecast.stats.meanTarget - ml.forecast.stats.mean2024, 1, "°C")} vs 2024 · ±{ml.forecast.stats.sigma.toFixed(1)}</p></div>
                <div className="rounded-xl bg-amber-500/10 p-3"><p className="text-[10px] uppercase text-slate-500">Area &gt; 42 °C</p><p className="text-xl font-semibold text-amber-200">{ml.forecast.stats.hotTarget.toFixed(0)} km²</p><p className="text-[10px] text-slate-400">from {ml.forecast.stats.hot2024.toFixed(0)} km² in 2024</p></div>
              </div>
              <table className="mt-3 w-full text-[11px]">
                <thead className="text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="pb-1 text-left font-medium">Back-test 2024</th><th className="pb-1 text-right font-medium">RMSE</th><th className="pb-1 text-right font-medium">Pattern</th><th className="pb-1 text-right font-medium">R²</th></tr></thead>
                <tbody className="divide-y divide-white/5">
                  {ml.forecast.backtest.map((b, i) => <tr key={b.name} className={cn(i === 0 && "bg-white/4")}><td className="py-1 text-slate-200">{b.name}</td><td className="py-1 text-right tabular-nums text-white">{b.rmse.toFixed(2)}</td><td className="py-1 text-right tabular-nums text-emerald-300">{b.patternRmse.toFixed(2)}</td><td className="py-1 text-right tabular-nums text-slate-300">{b.r2.toFixed(2)}</td></tr>)}
                </tbody>
              </table>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">All methods under-predict 2024 because of that season's heat-wave anomaly; pattern RMSE removes this shared bias and isolates the spatial skill where the hybrid model leads.</p>
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Largest projected zone changes</p>
              <div className="mt-1 space-y-1">
                {ml.forecast.zones.slice(0, 5).map((z) => <div key={z.name} className="flex justify-between text-[11px]"><span className="text-slate-300">{z.name}</span><span className="tabular-nums text-slate-400">{z.lst2024.toFixed(1)} → <span className="text-white">{z.lstTarget.toFixed(1)}</span> <b className="text-orange-300">{fmt.delta(z.delta, 1)}</b></span></div>)}
              </div>
            </>
          ) : <MLPending stage="forecast" height={320} />}
        </Card>
      </div>
    </div>
  );
}
