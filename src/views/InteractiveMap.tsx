import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Box, Crosshair, FlaskConical, Layers, Map as MapIcon, MousePointer2, Pause, Play, ShieldCheck, X } from "lucide-react";
import { useApp, type UhiLayer } from "@/App";
import MapView from "@/components/MapView";
import Surface3D from "@/components/Surface3D";
import { Legend, Pill, Segmented, Slider, Stat, chartTheme } from "@/components/ui";
import { METRIC_META, RAMPS, rampCss, type LayerKey } from "@/data/colors";
import { diffRaster, fmt, latLonToCell } from "@/data/engine";
import { qualityFor } from "@/data/catalog";
import { YEARS, YEAR_ANOMALY } from "@/data/nagpur";
import { cn } from "@/utils/cn";
import { useML } from "@/ml/context";
import { Method } from "@/components/ml-ui";

const LAYERS: { key: UhiLayer; label: string; desc: string; swatch: string }[] = [
  { key: "lst", label: "LST", desc: "Surface temperature", swatch: "linear-gradient(90deg,#1e3a8a,#facc15,#7f1d1d)" },
  { key: "ndvi", label: "NDVI", desc: "Vegetation", swatch: "linear-gradient(90deg,#7c2d12,#d9f99d,#052e16)" },
  { key: "ndbi", label: "NDBI", desc: "Built-up / concrete", swatch: "linear-gradient(90deg,#0f766e,#f1f5f9,#4a044e)" },
  { key: "dlst", label: "ΔLST", desc: "Change since 2019", swatch: "linear-gradient(90deg,#1d4ed8,#f8fafc,#b91c1c)" },
  { key: "hotspot", label: "Hotspots", desc: "Persistence 2019–24", swatch: "linear-gradient(90deg,#0f172a,#f59e0b,#dc2626)" },
  { key: "islands", label: "Heat islands", desc: "DBSCAN segmentation · ML", swatch: "linear-gradient(90deg,#ef4444,#eab308,#06b6d4,#a855f7)" },
  { key: "outlook", label: "Outlook 2030", desc: "Projected LST · ML", swatch: "linear-gradient(90deg,#1e3a8a,#facc15,#7f1d1d)" },
];

export default function InteractiveMap() {
  const {
    ds, year, setYear, setView, setScenarioZoneId,
    selectedLayer: layer, setSelectedLayer: setLayer,
    selectedBasemap: basemap, setSelectedBasemap: setBasemap,
    opacity, setOpacity, showZones, setShowZones, showLandmarks, setShowLandmarks, showZoneLabels, setShowZoneLabels,
    inspectMode: mode, setInspectMode: setMode, selectedZoneA, setSelectedZoneA, selectedZoneB, setSelectedZoneB,
    inspectedPixel: inspected, setInspectedPixel: setInspected, playing, setPlaying, playbackRate, setPlaybackRate, view3d, setView3d,
  } = useApp();
  const ml = useML();
  const [exag, setExag] = useState(1);
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const idx = YEARS.indexOf(year);
      setYear(YEARS[(idx + 1) % YEARS.length]);
    }, Math.round(1400 / playbackRate));
    return () => clearInterval(id);
  }, [playing, year, setYear, playbackRate]);

  const values = useMemo(() => {
    if (layer === "dlst") return diffRaster(ds, "lst", 2019, year);
    if (layer === "hotspot") return ds.hotCount;
    if (layer === "islands") return ml.islands ? ml.islands.raster : new Float32Array(ds.n);
    if (layer === "outlook") return ml.forecast ? ml.forecast.raster : ds.rasters[2024].lst;
    return ds.rasters[year][layer];
  }, [ds, layer, year, ml.islands, ml.forecast]);

  const layerKey: LayerKey = layer === "islands" ? "cluster" : layer === "outlook" ? "lst" : layer;
  const palette = layer === "islands" ? ml.islands?.palette : undefined;
  const mlLayerPending = (layer === "islands" && !ml.islands) || (layer === "outlook" && !ml.forecast);
  const quality = useMemo(() => qualityFor(ds), [ds]);
  const q = quality.find((x) => x.year === year)!;
  const reg = ds.regression[year];

  const zoneValue = (zi: number) => {
    const z = ds.zones[zi];
    if (layer === "dlst") return `ΔLST 2019→${year}: ${fmt.delta(z.byYear[year].lst - z.byYear[2019].lst, 2, "°C")}`;
    if (layer === "hotspot") return `Persistent hotspot share: ${fmt.pct(z.persistentFrac)}`;
    if (layer === "islands") { const n = ml.islands ? ml.islands.islands.filter((i) => i.zone === z.zone.short).length : 0; return `${n} heat island${n === 1 ? "" : "s"} centred here`; }
    if (layer === "outlook") { const zz = ml.forecast?.zones.find((f) => f.name === z.zone.name); return zz ? `Outlook 2030: ${fmt.temp(zz.lstTarget)} (${fmt.delta(zz.delta, 1, "°C")})` : "computing…"; }
    const v = z.byYear[year][layer];
    return `${METRIC_META[layer].short} ${year}: ${layer === "lst" ? fmt.temp(v) : v.toFixed(3)}`;
  };

  const onZoneClick = (zi: number) => {
    if (selectedZoneA === zi) { setSelectedZoneA(null); return; }
    if (selectedZoneB === zi) { setSelectedZoneB(null); return; }
    if (selectedZoneA == null) { setSelectedZoneA(zi); return; }
    if (selectedZoneB == null) { setSelectedZoneB(zi); return; }
    setSelectedZoneA(selectedZoneB);
    setSelectedZoneB(zi);
  };
  const onInspect = (lat: number, lon: number) => {
    const cell = latLonToCell(ds, lat, lon);
    if (cell >= 0) setInspected({ cell, lat, lon });
  };

  const selected = [selectedZoneA, selectedZoneB].filter((z): z is number => z != null);
  const A = selectedZoneA != null ? ds.zones[selectedZoneA] : null;
  const B = selectedZoneB != null ? ds.zones[selectedZoneB] : null;
  const compareRows = YEARS.map((y) => ({ year: y, A: A ? +A.byYear[y].lst.toFixed(2) : undefined, B: B ? +B.byYear[y].lst.toFixed(2) : undefined }));
  const pixelSeries = inspected ? YEARS.map((y) => ({ year: y, lst: +ds.rasters[y].lst[inspected.cell].toFixed(2), ndvi: +ds.rasters[y].ndvi[inspected.cell].toFixed(3) })) : [];

  const confidence = reg.r2 > 0.8 && q.completeness > 96 ? "High" : reg.r2 > 0.65 && q.completeness > 93 ? "Medium" : "Low";

  return (
    <div className="flex flex-col xl:h-[calc(100vh-58px)] xl:min-h-[640px] xl:flex-row">
      {/* Map area */}
      <div className="relative h-[68vh] min-h-[460px] flex-1 xl:h-auto">
        {view3d ? (
          <div className="absolute inset-0">
            <Surface3D ds={ds} values={layer === "islands" ? ds.hotCount : values} layer={layer === "islands" ? "hotspot" : layerKey} exag={exag} showZones={showZones} />
          </div>
        ) : (
          <div className="absolute inset-0">
            <MapView
              ds={ds} values={values} layer={layerKey} basemap={basemap} opacity={opacity}
              showZones={showZones} showLandmarks={showLandmarks} showZoneLabels={showZoneLabels}
              mode={mode} selectedZones={selected} inspected={inspected} zoneValue={zoneValue}
              onZoneClick={onZoneClick} onInspect={onInspect} palette={palette}
            />
          </div>
        )}

        {/* Top-left: header + layer panel */}
        <div className="pointer-events-none absolute left-3 top-3 z-[500] flex max-h-[calc(100%-120px)] w-[280px] flex-col gap-2">
          <div className="pointer-events-auto rounded-2xl border border-white/10 bg-slate-950/85 p-3 shadow-xl backdrop-blur">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><Layers className="h-4 w-4 text-orange-400" /> Map layers</div>
              <button onClick={() => setPanelOpen(false)} aria-label="Close map layers panel" className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 text-slate-400 transition hover:bg-white/10 hover:text-white"><X className="h-3.5 w-3.5" /></button>
            </div>
            {panelOpen && (
              <div className="mt-3 space-y-3">
                <div className="space-y-1">
                  {LAYERS.map((l) => (
                    <button key={l.key} onClick={() => setLayer(l.key)} className={cn("flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-1.5 text-left transition", layer === l.key ? "border-orange-400/50 bg-orange-500/10" : "border-transparent hover:bg-white/5")}>
                      <span className="h-3 w-8 rounded-sm" style={{ background: l.swatch }} />
                      <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 text-xs font-semibold text-white">{l.label}{(l.key === "islands" || l.key === "outlook") && <Method kind="ml" className="px-1 py-0 text-[8px]" />}</span><span className="block text-[10px] text-slate-400">{l.desc}</span></span>
                      <span className={cn("h-2 w-2 rounded-full", layer === l.key ? "bg-orange-400" : "bg-white/15")} />
                    </button>
                  ))}
                </div>
                {layer === "islands" ? (
                  <p className="text-[10px] text-slate-400">{ml.islands ? `${ml.islands.islands.length} contiguous islands · each colour one island · hover a zone for its count` : "Segmenting heat islands…"}</p>
                ) : <Legend layer={layerKey} compact />}
                {mlLayerPending && <p className="rounded-md bg-fuchsia-500/10 px-2 py-1 text-[10px] text-fuchsia-200">Model still training — layer will appear automatically.</p>}
                {!view3d && (
                  <>
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Basemap</p>
                      <Segmented size="xs" options={[{ value: "dark", label: "Dark" }, { value: "streets", label: "Streets" }, { value: "satellite", label: "Satellite" }]} value={basemap} onChange={setBasemap} />
                    </div>
                    <Slider label="Layer opacity" value={opacity} min={0.2} max={1} step={0.02} onChange={setOpacity} format={(v) => `${Math.round(v * 100)}%`} />
                  </>
                )}
                {view3d && <Slider label="Vertical exaggeration" value={exag} min={0.3} max={2.5} step={0.1} onChange={setExag} format={(v) => `${v.toFixed(1)}×`} accent="#c084fc" />}
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { l: "Zones", v: showZones, s: setShowZones },
                    { l: "Landmarks", v: showLandmarks, s: setShowLandmarks },
                    { l: "Zone names", v: showZoneLabels, s: setShowZoneLabels },
                  ].map((t) => (
                    <button key={t.l} onClick={() => t.s(!t.v)} className={cn("rounded-full border px-2.5 py-1 text-[11px]", t.v ? "border-sky-400/40 bg-sky-500/15 text-sky-200" : "border-white/10 text-slate-400 hover:bg-white/5")}>{t.l}</button>
                  ))}
                </div>
                {!view3d && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Click mode</p>
                    <Segmented size="xs" options={[{ value: "zones", label: <span className="flex items-center gap-1"><MousePointer2 className="h-3 w-3" /> Select zones</span> }, { value: "inspect", label: <span className="flex items-center gap-1"><Crosshair className="h-3 w-3" /> Inspect pixel</span> }]} value={mode} onChange={setMode} />
                  </div>
                )}
              </div>
            )}
          </div>
          {!panelOpen && (
            <button onClick={() => setPanelOpen(true)} className="pointer-events-auto flex w-fit items-center gap-2 rounded-xl border border-white/10 bg-slate-950/85 px-3 py-2 text-xs font-medium text-white shadow-lg backdrop-blur transition hover:bg-white/10">
              <Layers className="h-4 w-4 text-orange-400" /> Map layers
            </button>
          )}
        </div>

        {/* Top-right: 2D/3D */}
        <div className="absolute right-3 top-3 z-[500] flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-white/10 bg-slate-950/85 p-0.5 shadow-xl backdrop-blur">
            <button onClick={() => setView3d(false)} className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium", !view3d ? "bg-white/10 text-white" : "text-slate-400 hover:text-white")}><MapIcon className="h-3.5 w-3.5" /> 2D map</button>
            <button onClick={() => setView3d(true)} className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium", view3d ? "bg-white/10 text-white" : "text-slate-400 hover:text-white")}><Box className="h-3.5 w-3.5" /> 3D surface</button>
          </div>
        </div>

        {/* Bottom: timeline */}
        <div className="absolute inset-x-3 bottom-3 z-[500] sm:left-1/2 sm:right-auto sm:w-[560px] sm:max-w-[calc(100%-24px)] sm:-translate-x-1/2">
          <div className="rounded-2xl border border-white/10 bg-slate-950/85 px-4 py-3 shadow-xl backdrop-blur">
            <div className="flex items-center gap-3">
              <button onClick={() => setPlaying(!playing)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-500 text-white shadow-lg shadow-orange-900/50 hover:bg-orange-400">{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 pl-0.5" />}</button>
              <div className="min-w-0 flex-1">
                <input type="range" min={0} max={YEARS.length - 1} step={1} value={YEARS.indexOf(year)} onChange={(e) => { setPlaying(false); setYear(YEARS[Number(e.target.value)]); }} className="range-input w-full" style={{ background: `linear-gradient(90deg,#f97316 ${(YEARS.indexOf(year) / (YEARS.length - 1)) * 100}%, rgba(100,116,139,0.28) ${(YEARS.indexOf(year) / (YEARS.length - 1)) * 100}%)` }} />
                <div className="mt-1 flex justify-between">
                  {YEARS.map((y) => (
                    <button key={y} onClick={() => { setPlaying(false); setYear(y); }} className={cn("text-[11px] tabular-nums", y === year ? "font-bold text-orange-300" : "text-slate-500 hover:text-slate-300")}>{y}</button>
                  ))}
                </div>
              </div>
              <div className="hidden shrink-0 text-right sm:block">
                <p className="text-2xl font-bold tabular-nums text-white">{year}</p>
                <p className="text-[10px] text-slate-400">{layer === "hotspot" || layer === "islands" ? "all years" : layer === "outlook" ? "→ 2030" : "composite · "}{playing ? `${playbackRate}× looping` : "paused"}</p>
              </div>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2"><p className="truncate text-[10px] text-slate-400">{YEAR_ANOMALY[year].note} · city-mean LST {fmt.temp(ds.city[year].lstMean)}</p><Segmented size="xs" options={[{ value: 0.5, label: "0.5×" }, { value: 1, label: "1×" }, { value: 2, label: "2×" }]} value={playbackRate} onChange={setPlaybackRate} /></div>
          </div>
        </div>
      </div>

      {/* Right info panel */}
      <aside className="w-full shrink-0 space-y-3 overflow-y-auto border-t border-white/10 bg-slate-950/70 p-3 xl:h-full xl:w-[380px] xl:border-l xl:border-t-0">
        {/* Zone comparison */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Area selection & comparison</h3>
            <span className="text-[10px] text-slate-500">{selected.length}/2 zones</span>
          </div>
          {selected.length === 0 && <p className="mt-2 text-xs text-slate-400">Click up to two zones on the map to compare them side by side.</p>}
          {selected.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {[A, B].map((z, k) => (
                <div key={k} className={cn("rounded-xl border p-2", k === 0 ? "border-sky-400/40 bg-sky-500/10" : "border-pink-400/40 bg-pink-500/10", !z && "border-dashed border-white/10 bg-transparent")}>
                  {z ? (
                    <>
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-xs font-semibold leading-tight text-white">{z.zone.name}</p>
                        <button onClick={() => (k === 0 ? setSelectedZoneA(null) : setSelectedZoneB(null))} className="text-slate-500 hover:text-white"><X className="h-3 w-3" /></button>
                      </div>
                      <p className="mt-1 text-xl font-bold tabular-nums" style={{ color: rampCss("lst", z.byYear[year].lst) }}>{fmt.temp(z.byYear[year].lst)}</p>
                      <p className="text-[10px] text-slate-400">{z.zone.character}</p>
                    </>
                  ) : <p className="py-4 text-center text-[11px] text-slate-500">Zone {k === 0 ? "A" : "B"}<br />click map</p>}
                </div>
              ))}
            </div>
          )}
          {A && (
            <div className="mt-2">
              <table className="w-full text-[11px]">
                <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500"><th className="pb-1 text-left font-medium">{year}</th><th className="pb-1 text-right font-medium text-sky-300">A</th>{B && <th className="pb-1 text-right font-medium text-pink-300">B</th>}</tr></thead>
                <tbody className="divide-y divide-white/5">
                  {[
                    ["LST", (z: typeof A) => fmt.temp(z.byYear[year].lst)],
                    ["NDVI", (z: typeof A) => z.byYear[year].ndvi.toFixed(3)],
                    ["NDBI", (z: typeof A) => z.byYear[year].ndbi.toFixed(3)],
                    ["Veg. cover", (z: typeof A) => fmt.pct(z.byYear[year].veg)],
                    ["Built cover", (z: typeof A) => fmt.pct(z.byYear[year].built)],
                    ["ΔLST since 2019", (z: typeof A) => fmt.delta(z.byYear[year].lst - z.byYear[2019].lst, 2, "°C")],
                    ["ΔNDVI since 2019", (z: typeof A) => fmt.delta(z.byYear[year].ndvi - z.byYear[2019].ndvi, 3)],
                    ["ΔNDBI since 2019", (z: typeof A) => fmt.delta(z.byYear[year].ndbi - z.byYear[2019].ndbi, 3)],
                    ["Hotspot share", (z: typeof A) => fmt.pct(z.byYear[year].hotFrac)],
                    ["Persistent hotspot", (z: typeof A) => fmt.pct(z.persistentFrac)],
                    ["Population", (z: typeof A) => `~${(z.zone.population / 1000).toFixed(0)}k`],
                  ].map(([label, f]) => (
                    <tr key={label as string}>
                      <td className="py-1 text-slate-400">{label as string}</td>
                      <td className="py-1 text-right font-medium tabular-nums text-slate-100">{(f as (z: typeof A) => string)(A)}</td>
                      {B && <td className="py-1 text-right font-medium tabular-nums text-slate-100">{(f as (z: typeof A) => string)(B)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {A && B && (
                <p className="mt-2 rounded-lg bg-white/4 px-2 py-1.5 text-[11px] text-slate-300">
                  <b className="text-sky-300">{A.zone.short}</b> is <b className={A.byYear[year].lst > B.byYear[year].lst ? "text-orange-300" : "text-emerald-300"}>{Math.abs(A.byYear[year].lst - B.byYear[year].lst).toFixed(1)} °C {A.byYear[year].lst > B.byYear[year].lst ? "hotter" : "cooler"}</b> than <b className="text-pink-300">{B.zone.short}</b>; NDVI gap {fmt.delta(A.byYear[year].ndvi - B.byYear[year].ndvi, 2)}, NDBI gap {fmt.delta(A.byYear[year].ndbi - B.byYear[year].ndbi, 2)}.
                </p>
              )}
              <div className="mt-2 h-28">
                <ResponsiveContainer>
                  <LineChart data={compareRows} margin={{ left: -22, right: 6, top: 6 }}>
                    <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                    <XAxis dataKey="year" stroke={chartTheme.axis} fontSize={10} tickLine={false} />
                    <YAxis stroke={chartTheme.axis} fontSize={10} tickLine={false} domain={["auto", "auto"]} />
                    <Tooltip contentStyle={chartTheme.tooltip} formatter={(v) => `${Number(v).toFixed(2)} °C`} />
                    <Line type="monotone" dataKey="A" stroke="#38bdf8" strokeWidth={2} dot={{ r: 2 }} name={A.zone.short} />
                    {B && <Line type="monotone" dataKey="B" stroke="#f472b6" strokeWidth={2} dot={{ r: 2 }} name={B.zone.short} />}
                  </LineChart>
                </ResponsiveContainer>
              </div>
               <button onClick={() => { setScenarioZoneId(A.zone.id); setView("planning"); }} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/8 px-3 py-2 text-xs font-medium text-white hover:bg-white/15"><FlaskConical className="h-3.5 w-3.5" /> Model {A.zone.short} in Scenario Lab</button>
            </div>
          )}
        </div>

        {/* Pixel inspector */}
        {inspected && (
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-3">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white"><Crosshair className="h-3.5 w-3.5 text-orange-400" /> Pixel inspector</h3>
              <button onClick={() => setInspected(null)} className="text-slate-500 hover:text-white"><X className="h-3.5 w-3.5" /></button>
            </div>
            <p className="mt-1 font-mono text-[10px] text-slate-400">{inspected.lat.toFixed(4)}°N, {inspected.lon.toFixed(4)}°E · {ds.zoneIndex[inspected.cell] >= 0 ? ds.zones[ds.zoneIndex[inspected.cell]].zone.name : "outside analysis zones"}{ds.water[inspected.cell] ? " · water body" : ""}</p>
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-lg bg-white/4 p-1.5"><p className="text-[10px] text-slate-500">LST</p><p className="text-sm font-semibold" style={{ color: rampCss("lst", ds.rasters[year].lst[inspected.cell]) }}>{fmt.temp(ds.rasters[year].lst[inspected.cell])}</p></div>
              <div className="rounded-lg bg-white/4 p-1.5"><p className="text-[10px] text-slate-500">NDVI</p><p className="text-sm font-semibold text-emerald-300">{ds.rasters[year].ndvi[inspected.cell].toFixed(3)}</p></div>
              <div className="rounded-lg bg-white/4 p-1.5"><p className="text-[10px] text-slate-500">NDBI</p><p className="text-sm font-semibold text-fuchsia-300">{ds.rasters[year].ndbi[inspected.cell].toFixed(3)}</p></div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pill tone={ds.hotCount[inspected.cell] >= 5 ? "red" : ds.hotCount[inspected.cell] >= 3 ? "amber" : "slate"}>hotspot {ds.hotCount[inspected.cell]}/6 yrs</Pill>
              <Pill tone="slate">ΔLST {fmt.delta(ds.rasters[2024].lst[inspected.cell] - ds.rasters[2019].lst[inspected.cell], 1, "°C")} (19→24)</Pill>
            </div>
            <div className="mt-2 h-24">
              <ResponsiveContainer>
                <LineChart data={pixelSeries} margin={{ left: -22, right: 6, top: 6 }}>
                  <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                  <XAxis dataKey="year" stroke={chartTheme.axis} fontSize={10} tickLine={false} />
                  <YAxis stroke={chartTheme.axis} fontSize={10} tickLine={false} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={chartTheme.tooltip} />
                  <Line type="monotone" dataKey="lst" stroke="#f97316" strokeWidth={2} dot={{ r: 2 }} name="LST °C" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Data quality */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white"><ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Data quality · {year}</h3>
            <Pill tone={q.quality === "High" ? "green" : q.quality === "Good" ? "sky" : "amber"}>{q.quality}</Pill>
          </div>
          <Stat label="Cloud cover (composite residual)" value={`${q.compositeCloud.toFixed(1)}%`} />
          <Stat label="Mean scene cloud" value={`${q.meanCloud.toFixed(1)}%`} />
          <Stat label="Satellite availability" value={<span className="flex flex-wrap justify-end gap-1">{q.sensors.map((s) => <Pill key={s} tone="sky">{s}</Pill>)}</span>} />
          <Stat label="Clear scenes / total" value={`${q.used + q.partial} / ${q.total}`} />
          <Stat label="AOI coverage" value={`${q.completeness.toFixed(1)}%`} />
          <Stat label="Model R² (LST ~ NDVI + NDBI)" value={reg.r2.toFixed(2)} />
          <Stat label="Prediction confidence" value={<Pill tone={confidence === "High" ? "green" : confidence === "Medium" ? "amber" : "red"}>{confidence}</Pill>} />
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-sky-400" style={{ width: `${q.completeness}%` }} /></div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">{RAMPS[layerKey].label} · pre-monsoon median composite · 200 m grid · WGS 84. Confidence blends composite completeness, residual cloud and regression fit.</p>
        </div>
      </aside>
    </div>
  );
}
