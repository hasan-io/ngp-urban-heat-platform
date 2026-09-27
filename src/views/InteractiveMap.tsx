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
import { useI18n } from "@/i18n";
import { cn } from "@/utils/cn";
import { useML } from "@/ml/context";
import { Method } from "@/components/ml-ui";

const LAYERS: { key: UhiLayer; labelKey: "layer.lst" | "layer.ndvi" | "layer.ndbi" | "layer.dlst" | "layer.hotspot" | "layer.islands" | "layer.outlook"; descKey: "layer.lstDesc" | "layer.ndviDesc" | "layer.ndbiDesc" | "layer.dlstDesc" | "layer.hotspotDesc" | "layer.islandsDesc" | "layer.outlookDesc"; swatch: string }[] = [
  { key: "lst", labelKey: "layer.lst", descKey: "layer.lstDesc", swatch: "linear-gradient(90deg,#1e3a8a,#facc15,#7f1d1d)" },
  { key: "ndvi", labelKey: "layer.ndvi", descKey: "layer.ndviDesc", swatch: "linear-gradient(90deg,#7c2d12,#a3e635,#052e16)" },
  { key: "ndbi", labelKey: "layer.ndbi", descKey: "layer.ndbiDesc", swatch: "linear-gradient(90deg,#0f766e,#f1f5f9,#4a044e)" },
  { key: "dlst", labelKey: "layer.dlst", descKey: "layer.dlstDesc", swatch: "linear-gradient(90deg,#1d4ed8,#f8fafc,#b91c1c)" },
  { key: "hotspot", labelKey: "layer.hotspot", descKey: "layer.hotspotDesc", swatch: "linear-gradient(90deg,#e0ecff,#fbbf24,#b91c1c)" },
  { key: "islands", labelKey: "layer.islands", descKey: "layer.islandsDesc", swatch: "linear-gradient(90deg,#ef4444,#eab308,#06b6d4,#a855f7)" },
  { key: "outlook", labelKey: "layer.outlook", descKey: "layer.outlookDesc", swatch: "linear-gradient(90deg,#1e3a8a,#facc15,#7f1d1d)" },
];

export default function InteractiveMap() {
  const { t } = useI18n();
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
    if (layer === "dlst") return `${t("layer.dlst")} 2019→${year}: ${fmt.delta(z.byYear[year].lst - z.byYear[2019].lst, 2, "°C")}`;
    if (layer === "hotspot") return `${t("imap.colPersistent")}: ${fmt.pct(z.persistentFrac)}`;
    if (layer === "islands") {
      const n = ml.islands ? ml.islands.islands.filter((i) => i.zone === z.zone.short).length : 0;
      return `${n} ${t("layer.islands")}`;
    }
    if (layer === "outlook") {
      const zz = ml.forecast?.zones.find((f) => f.name === z.zone.name);
      return zz ? `${t("layer.outlook")}: ${fmt.temp(zz.lstTarget)} (${fmt.delta(zz.delta, 1, "°C")})` : "…";
    }
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
  const compareRows = YEARS.map((y) => ({
    year: y,
    A: A ? +A.byYear[y].lst.toFixed(2) : undefined,
    B: B ? +B.byYear[y].lst.toFixed(2) : undefined,
  }));
  const pixelSeries = inspected ? YEARS.map((y) => ({ year: y, lst: +ds.rasters[y].lst[inspected.cell].toFixed(2), ndvi: +ds.rasters[y].ndvi[inspected.cell].toFixed(3) })) : [];

  const confidenceRaw = reg.r2 > 0.8 && q.completeness > 96 ? "High" : reg.r2 > 0.65 && q.completeness > 93 ? "Medium" : "Low";
  const confidence = confidenceRaw === "High" ? t("imap.confidenceHigh") : confidenceRaw === "Medium" ? t("imap.confidenceMedium") : t("imap.confidenceLow");

  const A_ACCENT = "#FF6B35";
  const B_ACCENT = "#10B981";

  return (
    <div className="flex flex-col xl:h-[calc(100vh-58px)] xl:min-h-[640px] xl:flex-row">
      {/* -------- MAP AREA -------- */}
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

        {/* Top-left: layers panel — now light themed */}
        <div className="pointer-events-none absolute left-3 top-3 z-[500] flex max-h-[calc(100%-120px)] w-[280px] flex-col gap-2">
          <div className="pointer-events-auto rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-[0_4px_16px_rgba(15,23,42,0.10)] backdrop-blur">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Layers className="h-4 w-4 text-[#FF6B35]" /> {t("layer.mapLayers")}
              </div>
              <button
                onClick={() => setPanelOpen(false)}
                aria-label={t("layer.closePanel")}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {panelOpen && (
              <div className="mt-3 space-y-3">
                <div className="space-y-1">
                  {LAYERS.map((l) => (
                    <button
                      key={l.key}
                      onClick={() => setLayer(l.key)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-1.5 text-left transition",
                        layer === l.key ? "border-[#FF6B35] bg-orange-50" : "border-transparent hover:bg-slate-50",
                      )}
                    >
                      <span className="h-3 w-8 rounded-sm ring-1 ring-slate-200" style={{ background: l.swatch }} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                          {t(l.labelKey)}
                          {(l.key === "islands" || l.key === "outlook") && <Method kind="ml" className="px-1 py-0 text-[8px]" />}
                        </span>
                        <span className="block text-[10px] text-slate-500">{t(l.descKey)}</span>
                      </span>
                      <span className={cn("h-2 w-2 rounded-full", layer === l.key ? "bg-[#FF6B35]" : "bg-slate-300")} />
                    </button>
                  ))}
                </div>

                {layer === "islands" ? (
                  <p className="text-[10px] text-slate-500">
                    {ml.islands ? t("layer.islandsInfo", { n: ml.islands.islands.length }) : t("layer.segmenting")}
                  </p>
                ) : (
                  <Legend layer={layerKey} compact />
                )}

                {mlLayerPending && (
                  <p className="rounded-md bg-violet-50 px-2 py-1 text-[10px] text-violet-700">
                    {t("layer.trainingPending")}
                  </p>
                )}

                {!view3d && (
                  <>
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("layer.basemap")}</p>
                      <Segmented
                        size="xs"
                        options={[
                          { value: "dark", label: t("layer.dark") },
                          { value: "streets", label: t("layer.streets") },
                          { value: "satellite", label: t("layer.satellite") },
                        ]}
                        value={basemap}
                        onChange={setBasemap}
                      />
                    </div>
                    <Slider label={t("layer.opacity")} value={opacity} min={0.2} max={1} step={0.02} onChange={setOpacity} format={(v) => `${Math.round(v * 100)}%`} />
                  </>
                )}
                {view3d && <Slider label={t("layer.verticalExaggeration")} value={exag} min={0.3} max={2.5} step={0.1} onChange={setExag} format={(v) => `${v.toFixed(1)}×`} accent="#A78BFA" />}

                <div className="flex flex-wrap gap-1.5">
                  {[
                    { l: t("layer.zones"), v: showZones, s: setShowZones },
                    { l: t("layer.landmarks"), v: showLandmarks, s: setShowLandmarks },
                    { l: t("layer.zoneNames"), v: showZoneLabels, s: setShowZoneLabels },
                  ].map((tk) => (
                    <button
                      key={tk.l}
                      onClick={() => tk.s(!tk.v)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] transition",
                        tk.v ? "border-[#FF6B35]/40 bg-orange-50 text-[#C2410C]" : "border-slate-200 text-slate-500 hover:bg-slate-50",
                      )}
                    >
                      {tk.l}
                    </button>
                  ))}
                </div>

                {!view3d && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("layer.clickMode")}</p>
                    <Segmented
                      size="xs"
                      options={[
                        { value: "zones", label: <span className="flex items-center gap-1"><MousePointer2 className="h-3 w-3" /> {t("layer.selectZones")}</span> },
                        { value: "inspect", label: <span className="flex items-center gap-1"><Crosshair className="h-3 w-3" /> {t("layer.inspectPixel")}</span> },
                      ]}
                      value={mode}
                      onChange={setMode}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {!panelOpen && (
            <button
              onClick={() => setPanelOpen(true)}
              className="pointer-events-auto flex w-fit items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs font-medium text-slate-900 shadow-md backdrop-blur transition hover:bg-slate-50"
            >
              <Layers className="h-4 w-4 text-[#FF6B35]" /> {t("layer.mapLayers")}
            </button>
          )}
        </div>

        {/* Top-right: 2D/3D toggle */}
        <div className="absolute right-3 top-3 z-[500] flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-slate-200 bg-white/95 p-0.5 shadow-md backdrop-blur">
            <button
              onClick={() => setView3d(false)}
              className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition", !view3d ? "bg-[#FF6B35] text-white" : "text-slate-600 hover:bg-slate-100")}
            >
              <MapIcon className="h-3.5 w-3.5" /> {t("layer.map2d")}
            </button>
            <button
              onClick={() => setView3d(true)}
              className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition", view3d ? "bg-[#FF6B35] text-white" : "text-slate-600 hover:bg-slate-100")}
            >
              <Box className="h-3.5 w-3.5" /> {t("layer.surface3d")}
            </button>
          </div>
        </div>

        {/* Bottom: timeline */}
        <div className="absolute inset-x-3 bottom-3 z-[500] sm:left-1/2 sm:right-auto sm:w-[560px] sm:max-w-[calc(100%-24px)] sm:-translate-x-1/2">
          <div className="rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_4px_16px_rgba(15,23,42,0.10)] backdrop-blur">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPlaying(!playing)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FF6B35] text-white shadow-md transition hover:bg-[#e85a28]"
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 pl-0.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <input
                  type="range" min={0} max={YEARS.length - 1} step={1} value={YEARS.indexOf(year)}
                  onChange={(e) => { setPlaying(false); setYear(YEARS[Number(e.target.value)]); }}
                  className="range-input w-full"
                  style={{ background: `linear-gradient(90deg,#FF6B35 ${(YEARS.indexOf(year) / (YEARS.length - 1)) * 100}%, rgba(148,163,184,0.35) ${(YEARS.indexOf(year) / (YEARS.length - 1)) * 100}%)` }}
                />
                <div className="mt-1 flex justify-between">
                  {YEARS.map((y) => (
                    <button
                      key={y}
                      onClick={() => { setPlaying(false); setYear(y); }}
                      className={cn("text-[11px] tabular-nums transition", y === year ? "font-bold text-[#C2410C]" : "text-slate-500 hover:text-slate-800")}
                    >
                      {y}
                    </button>
                  ))}
                </div>
              </div>
              <div className="hidden shrink-0 text-right sm:block">
                <p className="text-2xl font-bold tabular-nums text-slate-900">{year}</p>
                <p className="text-[10px] text-slate-500">
                  {layer === "hotspot" || layer === "islands" ? t("imap.timelineAllYears") : layer === "outlook" ? t("imap.timelineTo2030") : t("imap.timelineComposite", { state: playing ? t("imap.looping", { rate: playbackRate }) : t("imap.paused") })}
                </p>
              </div>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <p className="truncate text-[10px] text-slate-500">{YEAR_ANOMALY[year].note}</p>
              <Segmented
                size="xs"
                options={[{ value: 0.5, label: "0.5×" }, { value: 1, label: "1×" }, { value: 2, label: "2×" }]}
                value={playbackRate}
                onChange={setPlaybackRate}
              />
            </div>
          </div>
        </div>
      </div>

      {/* -------- RIGHT INFO PANEL -------- */}
      <aside className="w-full shrink-0 space-y-3 overflow-y-auto border-t border-slate-200 bg-slate-50/60 p-3 xl:h-full xl:w-[380px] xl:border-l xl:border-t-0">
        {/* Zone comparison */}
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">{t("imap.areaSelection")}</h3>
            <span className="text-[10px] text-slate-500">{t("imap.zoneCount", { n: selected.length })}</span>
          </div>
          {selected.length === 0 && (
            <p className="mt-2 text-xs text-slate-500">{t("imap.clickTwoZones")}</p>
          )}

          {selected.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {[A, B].map((z, k) => (
                <div
                  key={k}
                  className={cn(
                    "rounded-xl border p-2 transition",
                    k === 0 ? "border-[#FF6B35]/40 bg-orange-50" : "border-emerald-300 bg-emerald-50/70",
                    !z && "border-dashed border-slate-300 bg-transparent",
                  )}
                >
                  {z ? (
                    <>
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-xs font-semibold leading-tight text-slate-900">{z.zone.name}</p>
                        <button
                          onClick={() => (k === 0 ? setSelectedZoneA(null) : setSelectedZoneB(null))}
                          className="text-slate-400 transition hover:text-slate-700"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: k === 0 ? A_ACCENT : B_ACCENT }}>
                        {fmt.temp(z.byYear[year].lst)}
                      </p>
                      <p className="text-[10px] text-slate-600">{z.zone.character}</p>
                    </>
                  ) : (
                    <p className="py-4 text-center text-[11px] text-slate-400">
                      {k === 0 ? t("imap.zoneA") : t("imap.zoneB")}
                      <br />
                      {t("imap.clickMap")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {A && (
            <div className="mt-3">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="pb-1 text-left font-medium">{year}</th>
                    <th className="pb-1 text-right font-medium" style={{ color: A_ACCENT }}>A</th>
                    {B && <th className="pb-1 text-right font-medium" style={{ color: B_ACCENT }}>B</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[
                    [t("imap.colLst"), (z: typeof A) => fmt.temp(z.byYear[year].lst)],
                    [t("imap.colNdvi"), (z: typeof A) => z.byYear[year].ndvi.toFixed(3)],
                    [t("imap.colNdbi"), (z: typeof A) => z.byYear[year].ndbi.toFixed(3)],
                    [t("imap.colVeg"), (z: typeof A) => fmt.pct(z.byYear[year].veg)],
                    [t("imap.colBuilt"), (z: typeof A) => fmt.pct(z.byYear[year].built)],
                    [t("imap.colDlst2019"), (z: typeof A) => fmt.delta(z.byYear[year].lst - z.byYear[2019].lst, 2, "°C")],
                    [t("imap.colDndvi2019"), (z: typeof A) => fmt.delta(z.byYear[year].ndvi - z.byYear[2019].ndvi, 3)],
                    [t("imap.colDndbi2019"), (z: typeof A) => fmt.delta(z.byYear[year].ndbi - z.byYear[2019].ndbi, 3)],
                    [t("imap.colHotFrac"), (z: typeof A) => fmt.pct(z.byYear[year].hotFrac)],
                    [t("imap.colPersistent"), (z: typeof A) => fmt.pct(z.persistentFrac)],
                    [t("imap.colPopulation"), (z: typeof A) => `~${(z.zone.population / 1000).toFixed(0)}k`],
                  ].map(([label, f]) => (
                    <tr key={label as string}>
                      <td className="py-1 text-slate-500">{label as string}</td>
                      <td className="py-1 text-right font-medium tabular-nums text-slate-800">{(f as (z: typeof A) => string)(A)}</td>
                      {B && <td className="py-1 text-right font-medium tabular-nums text-slate-800">{(f as (z: typeof A) => string)(B)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>

              {A && B && (
                <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700">
                  <b style={{ color: A_ACCENT }}>{A.zone.short}</b> {A.byYear[year].lst > B.byYear[year].lst
                    ? t("imap.hotterThan", { delta: Math.abs(A.byYear[year].lst - B.byYear[year].lst).toFixed(1) })
                    : t("imap.coolerThan", { delta: Math.abs(A.byYear[year].lst - B.byYear[year].lst).toFixed(1) })}{" "}
                  <b style={{ color: B_ACCENT }}>{B.zone.short}</b>; {t("imap.ndviGap", { v: fmt.delta(A.byYear[year].ndvi - B.byYear[year].ndvi, 2) })}, {t("imap.ndbiGap", { v: fmt.delta(A.byYear[year].ndbi - B.byYear[year].ndbi, 2) })}.
                </p>
              )}

              <div className="mt-2 h-28">
                <ResponsiveContainer>
                  <LineChart data={compareRows} margin={{ left: -22, right: 6, top: 6 }}>
                    <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                    <XAxis dataKey="year" stroke={chartTheme.axis} fontSize={10} tickLine={false} />
                    <YAxis stroke={chartTheme.axis} fontSize={10} tickLine={false} domain={["auto", "auto"]} />
                    <Tooltip contentStyle={chartTheme.tooltip} formatter={(v) => `${Number(v).toFixed(2)} °C`} />
                    <Line type="monotone" dataKey="A" stroke={A_ACCENT} strokeWidth={2} dot={{ r: 2 }} name={A.zone.short} />
                    {B && <Line type="monotone" dataKey="B" stroke={B_ACCENT} strokeWidth={2} dot={{ r: 2 }} name={B.zone.short} />}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <button
                onClick={() => { setScenarioZoneId(A.zone.id); setView("planning"); }}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <FlaskConical className="h-3.5 w-3.5" /> {t("imap.modelInScenario", { zone: A.zone.short })}
              </button>
            </div>
          )}
        </div>

        {/* Pixel inspector */}
        {inspected && (
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Crosshair className="h-3.5 w-3.5 text-[#FF6B35]" /> {t("imap.pixelInspector")}
              </h3>
              <button onClick={() => setInspected(null)} className="text-slate-400 transition hover:text-slate-700">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-1 font-mono text-[10px] text-slate-500">
              {inspected.lat.toFixed(4)}°N, {inspected.lon.toFixed(4)}°E ·{" "}
              {ds.zoneIndex[inspected.cell] >= 0 ? ds.zones[ds.zoneIndex[inspected.cell]].zone.name : t("imap.outsideZones")}
              {ds.water[inspected.cell] ? ` · ${t("imap.waterBody")}` : ""}
            </p>
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-lg bg-slate-50 p-1.5">
                <p className="text-[10px] text-slate-500">{t("imap.colLst")}</p>
                <p className="text-sm font-semibold" style={{ color: rampCss("lst", ds.rasters[year].lst[inspected.cell]) }}>
                  {fmt.temp(ds.rasters[year].lst[inspected.cell])}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-1.5">
                <p className="text-[10px] text-slate-500">{t("imap.colNdvi")}</p>
                <p className="text-sm font-semibold text-emerald-700">{ds.rasters[year].ndvi[inspected.cell].toFixed(3)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-1.5">
                <p className="text-[10px] text-slate-500">{t("imap.colNdbi")}</p>
                <p className="text-sm font-semibold text-violet-700">{ds.rasters[year].ndbi[inspected.cell].toFixed(3)}</p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pill tone={ds.hotCount[inspected.cell] >= 5 ? "red" : ds.hotCount[inspected.cell] >= 3 ? "amber" : "slate"}>
                {t("imap.hotspotYears", { n: ds.hotCount[inspected.cell] })}
              </Pill>
              <Pill tone="slate">
                {t("imap.dlst1924", { v: fmt.delta(ds.rasters[2024].lst[inspected.cell] - ds.rasters[2019].lst[inspected.cell], 1, "°C") })}
              </Pill>
            </div>
            <div className="mt-2 h-24">
              <ResponsiveContainer>
                <LineChart data={pixelSeries} margin={{ left: -22, right: 6, top: 6 }}>
                  <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                  <XAxis dataKey="year" stroke={chartTheme.axis} fontSize={10} tickLine={false} />
                  <YAxis stroke={chartTheme.axis} fontSize={10} tickLine={false} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={chartTheme.tooltip} />
                  <Line type="monotone" dataKey="lst" stroke="#FF6B35" strokeWidth={2} dot={{ r: 2 }} name={`${t("imap.colLst")} °C`} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Data quality */}
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> {t("imap.dataQuality", { year })}
            </h3>
            <Pill tone={q.quality === "High" ? "green" : q.quality === "Good" ? "sky" : "amber"}>
              {q.quality === "High" ? t("imap.qualityHigh") : q.quality === "Good" ? t("imap.qualityGood") : t("imap.qualityFair")}
            </Pill>
          </div>
          <Stat label={t("imap.cloudCover")} value={`${q.compositeCloud.toFixed(1)}%`} />
          <Stat label={t("imap.meanSceneCloud")} value={`${q.meanCloud.toFixed(1)}%`} />
          <Stat
            label={t("imap.satelliteAvailability")}
            value={<span className="flex flex-wrap justify-end gap-1">{q.sensors.map((s) => <Pill key={s} tone="sky">{s}</Pill>)}</span>}
          />
          <Stat label={t("imap.clearScenes")} value={`${q.used + q.partial} / ${q.total}`} />
          <Stat label={t("imap.aoiCoverage")} value={`${q.completeness.toFixed(1)}%`} />
          <Stat label={t("imap.modelR2")} value={reg.r2.toFixed(2)} />
          <Stat
            label={t("imap.predConfidence")}
            value={<Pill tone={confidenceRaw === "High" ? "green" : confidenceRaw === "Medium" ? "amber" : "red"}>{confidence}</Pill>}
          />
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-sky-400" style={{ width: `${q.completeness}%` }} />
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            {RAMPS[layerKey].label} · 200 m grid · WGS 84.
          </p>
        </div>
      </aside>
    </div>
  );
}