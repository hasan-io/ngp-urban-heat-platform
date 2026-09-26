import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend as RLegend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { BrainCircuit, Building2, Flame, Leaf } from "lucide-react";
import { useApp } from "@/App";
import RasterCanvas from "@/components/RasterCanvas";
import { Card, Formula, Legend, Pill, SectionHeader, Stat, YearPicker, chartTheme } from "@/components/ui";
import { Method, MLPending } from "@/components/ml-ui";
import { useML } from "@/ml/context";
import { METRIC_META, rampCss } from "@/data/colors";
import { fmt, histogram, linearFit, sampleCells, type Metric } from "@/data/engine";
import { CLASSES_NDVI, YEARS } from "@/data/nagpur";

const INDEX_CARDS: { metric: Metric; icon: typeof Flame; formula: string; bands: string; note: string }[] = [
  { metric: "lst", icon: Flame, formula: "LST = BT / (1 + (λ·BT/ρ)·ln ε) − 273.15", bands: "Landsat 8/9 TIRS B10 → TOA radiance → brightness temp (BT) → NDVI-threshold emissivity (ε)", note: "Thermographic surface temperature, not air temperature — roofs and tarmac run 5–10 °C hotter than shaded ground." },
  { metric: "ndvi", icon: Leaf, formula: "NDVI = (NIR − Red) / (NIR + Red)", bands: "Landsat: (B5 − B4)/(B5 + B4) · Sentinel-2: (B8 − B4)/(B8 + B4)", note: "Chlorophyll absorbs red and reflects NIR strongly — high values mean dense, healthy canopy." },
  { metric: "ndbi", icon: Building2, formula: "NDBI = (SWIR1 − NIR) / (SWIR1 + NIR)", bands: "Landsat: (B6 − B5)/(B6 + B5) · Sentinel-2: (B11 − B8)/(B11 + B8)", note: "Concrete, asphalt and roofing reflect more SWIR than NIR — positive values flag built-up surfaces." },
];

export default function IndexAnalysis() {
  const { ds, year, setYear } = useApp();
  const ml = useML();
  const r = ds.rasters[year];
  const reg = ds.regression[year];
  const city = ds.city[year];

  const sample = useMemo(() => sampleCells(ds, 1100), [ds]);
  const scatterV = useMemo(() => sample.map((i) => ({ x: r.ndvi[i], y: r.lst[i] })), [sample, r]);
  const scatterB = useMemo(() => sample.map((i) => ({ x: r.ndbi[i], y: r.lst[i] })), [sample, r]);
  const fitV = useMemo(() => linearFit(scatterV.map((p) => p.x), scatterV.map((p) => p.y)), [scatterV]);
  const fitB = useMemo(() => linearFit(scatterB.map((p) => p.x), scatterB.map((p) => p.y)), [scatterB]);

  const rangeOf = (arr: Float32Array) => {
    let mn = Infinity, mx = -Infinity, s = 0;
    for (let i = 0; i < arr.length; i++) { if (ds.water[i]) continue; const v = arr[i]; if (v < mn) mn = v; if (v > mx) mx = v; s += v; }
    return { min: mn, max: mx, mean: s / arr.length };
  };
  const ranges = { lst: rangeOf(r.lst), ndvi: rangeOf(r.ndvi), ndbi: rangeOf(r.ndbi) };

  const hottest = [...ds.zones].sort((a, b) => b.byYear[year].lst - a.byYear[year].lst).slice(0, 8);
  const greenest = [...ds.zones].sort((a, b) => b.byYear[year].ndvi - a.byYear[year].ndvi).slice(0, 5);
  const mostBuilt = [...ds.zones].sort((a, b) => b.byYear[year].ndbi - a.byYear[year].ndbi).slice(0, 5);

  const classTrend = YEARS.map((y) => {
    const row: Record<string, number | string> = { year: y };
    for (const c of CLASSES_NDVI) row[c.label] = +ds.city[y].classAreaKm2[c.key].toFixed(1);
    return row;
  });
  const areaTrend = YEARS.map((y) => ({ year: y, green: +ds.city[y].greenAreaKm2.toFixed(1), built: +ds.city[y].builtAreaKm2.toFixed(1), hot: +ds.city[y].hotAreaKm2.toFixed(1) }));

  const hist = {
    lst: histogram(r.lst, 30, 47, 34, ds.water),
    ndvi: histogram(r.ndvi, -0.1, 0.8, 30, ds.water),
    ndbi: histogram(r.ndbi, -0.45, 0.5, 30, ds.water),
  };

  const corr = [
    ["LST", 1, reg.rNdviLst, reg.rNdbiLst],
    ["NDVI", reg.rNdviLst, 1, reg.rNdviNdbi],
    ["NDBI", reg.rNdbiLst, reg.rNdviNdbi, 1],
  ] as const;
  const corrColor = (v: number) => (v > 0 ? `rgba(249,115,22,${Math.abs(v) * 0.75})` : `rgba(34,197,94,${Math.abs(v) * 0.75})`);

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6">
      <SectionHeader n={2} title="Geospatial Analysis & Index Calculation" purpose="Derive land-surface temperature, vegetation (NDVI) and built-up (NDBI) indices for every cell, rank neighbourhoods, and quantify how strongly greenery and impervious cover control surface heat." why="Indices turn raw radiance into planning variables — the strength of the NDVI–LST and NDBI–LST relationships is what makes greening and de-paving defensible interventions.">
        <YearPicker value={year} onChange={setYear} />
      </SectionHeader>

      {/* Three index maps */}
      <div className="grid gap-4 lg:grid-cols-3">
        {INDEX_CARDS.map((c) => {
          const meta = METRIC_META[c.metric];
          const rg = ranges[c.metric];
          const d = meta.decimals;
          return (
            <Card key={c.metric} title={<span className="flex items-center gap-2"><c.icon className="h-4 w-4" style={{ color: meta.color }} />{meta.label} · {year}</span>} subtitle={c.bands}>
              <RasterCanvas values={r[c.metric]} layer={c.metric} showLabels labelKinds={c.metric === "lst" ? ["industry", "city"] : c.metric === "ndvi" ? ["forest", "water"] : ["growth", "city"]} />
              <Legend layer={c.metric} className="mt-3" />
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                {[["min", rg.min], ["mean", rg.mean], ["max", rg.max]].map(([l, v]) => (
                  <div key={String(l)} className="rounded-lg bg-white/4 py-1.5">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">{l}</p>
                    <p className="text-sm font-semibold tabular-nums text-white">{Number(v).toFixed(d)}{meta.unit}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3"><Formula>{c.formula}</Formula></div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{c.note}</p>
            </Card>
          );
        })}
      </div>

      {/* Rankings */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Kaunse areas hottest hain?" subtitle={`Zones ranked by mean LST · ${year}`}>
          <div className="space-y-2">
            {hottest.map((z, k) => {
              const v = z.byYear[year].lst;
              const w = ((v - 32) / (46 - 32)) * 100;
              return (
                <div key={z.zone.id} className="text-xs">
                  <div className="flex items-center justify-between"><span className="text-slate-200"><span className="mr-1.5 text-slate-500">#{k + 1}</span>{z.zone.name}</span><span className="font-semibold tabular-nums" style={{ color: rampCss("lst", v) }}>{fmt.temp(v)}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full" style={{ width: `${w}%`, background: rampCss("lst", v) }} /></div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Green areas & vegetation density" subtitle={`Highest mean NDVI · ${year}`}>
          <div className="space-y-1">
            {greenest.map((z) => (
              <Stat key={z.zone.id} label={z.zone.name} value={<span className="flex items-center gap-2"><span className="text-emerald-300">{z.byYear[year].ndvi.toFixed(3)}</span><Pill tone="green">{fmt.pct(z.byYear[year].veg)} cover</Pill></span>} />
            ))}
          </div>
          <div className="mt-4">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">NDVI class distribution · {year}</p>
            <div className="flex h-3 w-full overflow-hidden rounded-full">
              {CLASSES_NDVI.map((c) => {
                const tot = Object.values(city.classAreaKm2).reduce((a, b) => a + b, 0);
                return <div key={c.key} title={`${c.label}: ${city.classAreaKm2[c.key].toFixed(1)} km²`} style={{ width: `${(city.classAreaKm2[c.key] / tot) * 100}%`, background: c.color }} />;
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400">
              {CLASSES_NDVI.map((c) => <span key={c.key} className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: c.color }} />{c.label} {city.classAreaKm2[c.key].toFixed(0)} km²</span>)}
            </div>
          </div>
        </Card>
        <Card title="Urban development · built-up" subtitle={`Highest mean NDBI · ${year}`}>
          <div className="space-y-1">
            {mostBuilt.map((z) => (
              <Stat key={z.zone.id} label={z.zone.name} value={<span className="flex items-center gap-2"><span className="text-fuchsia-300">{z.byYear[year].ndbi.toFixed(3)}</span><Pill tone="violet">{fmt.pct(z.byYear[year].built)} built</Pill></span>} />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-fuchsia-500/10 p-2"><p className="text-[10px] uppercase text-slate-500">Built-up area</p><p className="text-sm font-semibold text-fuchsia-200">{city.builtAreaKm2.toFixed(0)} km²</p></div>
            <div className="rounded-lg bg-emerald-500/10 p-2"><p className="text-[10px] uppercase text-slate-500">Green area</p><p className="text-sm font-semibold text-emerald-200">{city.greenAreaKm2.toFixed(0)} km²</p></div>
            <div className="rounded-lg bg-orange-500/10 p-2"><p className="text-[10px] uppercase text-slate-500">&gt; 42 °C</p><p className="text-sm font-semibold text-orange-200">{city.hotAreaKm2.toFixed(0)} km²</p></div>
          </div>
        </Card>
      </div>

      {/* Cross-correlation */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="NDVI vs LST" subtitle={`"Jahan NDVI low, wahan LST high?" · r = ${reg.rNdviLst.toFixed(3)}`} right={<Pill tone="green">slope {fitV.slope.toFixed(1)} °C / NDVI</Pill>}>
          <div className="h-64">
            <ResponsiveContainer>
              <ScatterChart margin={{ left: -10, right: 10, top: 10, bottom: 0 }}>
                <CartesianGrid stroke={chartTheme.grid} />
                <XAxis type="number" dataKey="x" name="NDVI" domain={[-0.1, 0.85]} stroke={chartTheme.axis} fontSize={11} tickLine={false} />
                <YAxis type="number" dataKey="y" name="LST" unit="°C" domain={[30, 48]} stroke={chartTheme.axis} fontSize={11} tickLine={false} />
                <ZAxis range={[14, 14]} />
                <Tooltip contentStyle={chartTheme.tooltip} formatter={(v, n) => [Number(v).toFixed(String(n) === "LST" ? 1 : 3), String(n)]} cursor={{ strokeDasharray: "3 3" }} />
                <Scatter data={scatterV} isAnimationActive={false}>
                  {scatterV.map((p, i) => <Cell key={i} fill={rampCss("lst", p.y)} fillOpacity={0.6} />)}
                </Scatter>
                <ReferenceLine segment={[{ x: -0.05, y: fitV.intercept + fitV.slope * -0.05 }, { x: 0.8, y: fitV.intercept + fitV.slope * 0.8 }]} stroke="#fff" strokeWidth={2} strokeDasharray="6 4" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="NDBI vs LST" subtitle={`Built-up drives heating · r = ${reg.rNdbiLst.toFixed(3)}`} right={<Pill tone="violet">slope +{fitB.slope.toFixed(1)} °C / NDBI</Pill>}>
          <div className="h-64">
            <ResponsiveContainer>
              <ScatterChart margin={{ left: -10, right: 10, top: 10, bottom: 0 }}>
                <CartesianGrid stroke={chartTheme.grid} />
                <XAxis type="number" dataKey="x" name="NDBI" domain={[-0.5, 0.6]} stroke={chartTheme.axis} fontSize={11} tickLine={false} />
                <YAxis type="number" dataKey="y" name="LST" unit="°C" domain={[30, 48]} stroke={chartTheme.axis} fontSize={11} tickLine={false} />
                <ZAxis range={[14, 14]} />
                <Tooltip contentStyle={chartTheme.tooltip} formatter={(v, n) => [Number(v).toFixed(String(n) === "LST" ? 1 : 3), String(n)]} cursor={{ strokeDasharray: "3 3" }} />
                <Scatter data={scatterB} isAnimationActive={false}>
                  {scatterB.map((p, i) => <Cell key={i} fill={rampCss("lst", p.y)} fillOpacity={0.6} />)}
                </Scatter>
                <ReferenceLine segment={[{ x: -0.45, y: fitB.intercept + fitB.slope * -0.45 }, { x: 0.55, y: fitB.intercept + fitB.slope * 0.55 }]} stroke="#fff" strokeWidth={2} strokeDasharray="6 4" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Multivariate relationship" subtitle="OLS · LST ~ NDVI + NDBI (land pixels only)">
          <Formula>LST = {reg.a.toFixed(2)} {reg.bNdvi < 0 ? "−" : "+"} {Math.abs(reg.bNdvi).toFixed(2)}·NDVI + {reg.bNdbi.toFixed(2)}·NDBI</Formula>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-white/4 p-2"><p className="text-[10px] uppercase text-slate-500">R²</p><p className="text-lg font-semibold text-white">{reg.r2.toFixed(3)}</p></div>
            <div className="rounded-lg bg-white/4 p-2"><p className="text-[10px] uppercase text-slate-500">RMSE</p><p className="text-lg font-semibold text-white">{reg.rmse.toFixed(2)}°</p></div>
            <div className="rounded-lg bg-white/4 p-2"><p className="text-[10px] uppercase text-slate-500">n</p><p className="text-lg font-semibold text-white">{reg.n.toLocaleString()}</p></div>
          </div>
          <div className="mt-3 space-y-1.5 text-xs text-slate-300">
            <p>• +0.1 NDVI (≈ +14% canopy) → <span className="font-semibold text-emerald-300">{(reg.bNdvi * 0.1).toFixed(2)} °C</span></p>
            <p>• +0.1 NDBI (≈ +13% built-up) → <span className="font-semibold text-fuchsia-300">+{(reg.bNdbi * 0.1).toFixed(2)} °C</span></p>
            <p>• NDVI–NDBI collinearity r = {reg.rNdviNdbi.toFixed(2)} (expected: concrete replaces canopy)</p>
          </div>
          <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Correlation matrix</p>
          <div className="mt-1 grid grid-cols-4 gap-1 text-[11px]">
            <div />
            {["LST", "NDVI", "NDBI"].map((h) => <div key={h} className="text-center text-slate-400">{h}</div>)}
            {corr.map((row) => (
              <div key={row[0]} className="contents">
                <div className="flex items-center text-slate-400">{row[0]}</div>
                {row.slice(1).map((v, k) => (
                  <div key={k} className="rounded-md py-1.5 text-center font-semibold tabular-nums text-white" style={{ background: corrColor(Number(v)) }}>{Number(v).toFixed(2)}</div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Learned relationship (ML) */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={<span className="flex items-center gap-2"><BrainCircuit className="h-4 w-4 text-fuchsia-300" />Beyond the linear fit</span>} subtitle="Non-linear surface model: LST learned from 12 land-cover & context features" right={<Method kind="ml" />}>
          {ml.lst ? (
            <>
              <div className="space-y-2">
                {ml.lst.models.map((m) => (
                  <div key={m.name} className="text-xs">
                    <div className="flex items-center justify-between"><span className={m.name === ml.lst!.best.name ? "font-semibold text-white" : "text-slate-300"}>{m.name}{m.name === ml.lst!.best.name && <Pill tone="orange" className="ml-2">selected</Pill>}</span><span className="tabular-nums text-slate-300">R² {m.test.r2.toFixed(3)} · RMSE {m.test.rmse.toFixed(2)}°</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full" style={{ width: `${m.test.r2 * 100}%`, background: m.kind === "gbm" ? "#f97316" : m.kind === "rf" ? "#22c55e" : "#94a3b8" }} /></div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-400">Skill measured on <span className="text-slate-200">{ml.lst.split.nTestBlocks} held-out spatial blocks</span> ({ml.lst.split.blockKm} km) never seen in training. The ensemble captures the saturation of canopy cooling and the NDBI heating threshold that the two-variable OLS above averages away.</p>
            </>
          ) : <MLPending stage="lst" height={200} />}
        </Card>
        <Card title="What drives surface temperature?" subtitle="Permutation importance — ΔRMSE when one predictor is shuffled on held-out blocks">
          {ml.lst ? (
            <div className="h-60">
              <ResponsiveContainer>
                <BarChart data={ml.lst.permutation.slice(0, 8)} layout="vertical" margin={{ left: 40, right: 20, top: 0, bottom: 0 }}>
                  <CartesianGrid stroke={chartTheme.grid} horizontal={false} />
                  <XAxis type="number" stroke={chartTheme.axis} fontSize={10} tickLine={false} unit="°" />
                  <YAxis type="category" dataKey="label" stroke={chartTheme.axis} fontSize={10} tickLine={false} width={125} />
                  <Tooltip contentStyle={chartTheme.tooltip} formatter={(v) => `+${Number(v).toFixed(3)} °C RMSE`} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>{ml.lst.permutation.slice(0, 8).map((p) => <Cell key={p.key} fill={p.group === "spectral" ? "#f97316" : p.group === "context" ? "#38bdf8" : p.group === "geography" ? "#a78bfa" : "#64748b"} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <MLPending stage="lst" height={240} />}
          <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-slate-400"><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-orange-500" />own pixel</span><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-sky-400" />1 km neighbourhood</span><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-violet-400" />geography</span><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-slate-500" />position</span></div>
        </Card>
        <Card title="Learned response curves" subtitle="Partial dependence — how LST responds as one index changes, all else held at observed values">
          {ml.lst ? (
            <div className="grid grid-cols-2 gap-2">
              {(["ndvi", "ndbi"] as const).map((k) => (
                <div key={k} className="h-56">
                  <ResponsiveContainer>
                    <LineChart data={ml.lst!.pd[k]} margin={{ left: -18, right: 6, top: 10 }}>
                      <CartesianGrid stroke={chartTheme.grid} />
                      <XAxis dataKey="x" stroke={chartTheme.axis} fontSize={10} tickLine={false} label={{ value: k.toUpperCase(), position: "insideBottom", offset: -2, fill: "#64748b", fontSize: 10 }} />
                      <YAxis stroke={chartTheme.axis} fontSize={10} tickLine={false} domain={["auto", "auto"]} tickFormatter={(v) => Number(v).toFixed(0)} />
                      <Tooltip contentStyle={chartTheme.tooltip} formatter={(v) => `${Number(v).toFixed(2)} °C`} />
                      <Line type="monotone" dataKey="linear" name="Linear" stroke="#94a3b8" strokeWidth={1.5} dot={false} strokeDasharray="5 4" />
                      <Line type="monotone" dataKey="gbm" name="Gradient boosting" stroke={k === "ndvi" ? "#22c55e" : "#c084fc"} strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </div>
          ) : <MLPending stage="lst" height={224} />}
          <p className="mt-2 text-[11px] text-slate-400">Solid: gradient boosting · dashed: linear. Greening pays off most in the first +0.2 NDVI; heating accelerates once NDBI exceeds ≈ 0.15.</p>
        </Card>
      </div>

      {/* Year-by-year + histograms */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Vegetation kam ho raha hai ya badh raha hai?" subtitle="Area by NDVI class per year (km²)">
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={classTrend} margin={{ left: -15, right: 5, top: 5 }}>
                <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                <XAxis dataKey="year" stroke={chartTheme.axis} fontSize={11} tickLine={false} />
                <YAxis stroke={chartTheme.axis} fontSize={11} tickLine={false} />
                <Tooltip contentStyle={chartTheme.tooltip} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <RLegend wrapperStyle={{ fontSize: 10 }} />
                {CLASSES_NDVI.map((c, k) => <Bar key={c.key} dataKey={c.label} stackId="a" fill={c.color} radius={k === CLASSES_NDVI.length - 1 ? [4, 4, 0, 0] : undefined} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Expansion over time" subtitle="Built-up (NDBI > 0.1) vs green (NDVI > 0.4) vs hot (> 42 °C) area">
          <div className="h-56">
            <ResponsiveContainer>
              <LineChart data={areaTrend} margin={{ left: -15, right: 10, top: 5 }}>
                <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                <XAxis dataKey="year" stroke={chartTheme.axis} fontSize={11} tickLine={false} />
                <YAxis stroke={chartTheme.axis} fontSize={11} tickLine={false} unit=" km²" width={70} />
                <Tooltip contentStyle={chartTheme.tooltip} />
                <RLegend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="built" name="Built-up km²" stroke="#c084fc" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="green" name="Green km²" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="hot" name="Hot km²" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Index distributions" subtitle={`Pixel histograms (land only) · ${year}`}>
          <div className="space-y-2">
            {(["lst", "ndvi", "ndbi"] as Metric[]).map((m) => (
              <div key={m}>
                <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{METRIC_META[m].short}</p>
                <div className="h-14">
                  <ResponsiveContainer>
                    <BarChart data={hist[m]} margin={{ left: 0, right: 0, top: 0, bottom: 0 }} barCategoryGap={1}>
                      <Bar dataKey="count" isAnimationActive={false}>
                        {hist[m].map((h, i) => <Cell key={i} fill={rampCss(m, h.x)} />)}
                      </Bar>
                      <Tooltip contentStyle={chartTheme.tooltip} cursor={{ fill: "rgba(255,255,255,0.06)" }} labelFormatter={(v) => `${METRIC_META[m].short} ≈ ${Number(v).toFixed(m === "lst" ? 1 : 2)}`} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
