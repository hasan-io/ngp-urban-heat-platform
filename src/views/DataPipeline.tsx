import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend as RLegend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CheckCircle2, CloudOff, Crosshair, Database, Layers, Satellite, Server } from "lucide-react";
import { useApp } from "@/App";
import RasterCanvas from "@/components/RasterCanvas";
import { Card, Pill, SectionHeader, Segmented, Stat, YearPicker, chartTheme } from "@/components/ui";
import { PIPELINE_STEPS, qualityFor, scenesFor } from "@/data/catalog";
import { fbm } from "@/data/noise";
import { YEARS } from "@/data/nagpur";
import type { Dataset } from "@/data/engine";
import { cn } from "@/utils/cn";

const STEP_ICONS = [Satellite, CloudOff, Crosshair, Layers];

function pseudoTrueColor(ds: Dataset, i: number, veg: number, built: number): [number, number, number] {
  if (ds.water[i]) return [18, 46, 82];
  // bare soil / cropland base (Vidarbha black cotton soil, dry season)
  let r = 128 + 30 * (1 - veg), g = 108 + 10 * (1 - veg), b = 82;
  // vegetation → green
  r = r * (1 - veg) + 40 * veg; g = g * (1 - veg) + 95 * veg; b = b * (1 - veg) + 38 * veg;
  // built-up → grey/white roofs
  r = r * (1 - built) + 172 * built; g = g * (1 - built) + 168 * built; b = b * (1 - built) + 160 * built;
  return [r, g, b];
}

function CloudMaskDemo({ ds, seed }: { ds: Dataset; seed: number }) {
  const refs = [useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null)];
  const stats = useMemo(() => {
    const r = ds.rasters[2024];
    const imgs = [new ImageData(ds.w, ds.h), new ImageData(ds.w, ds.h), new ImageData(ds.w, ds.h)];
    let cloud = 0, shadow = 0;
    for (let i = 0; i < ds.n; i++) {
      const col = i % ds.w, row = Math.floor(i / ds.w);
      const c = fbm(col / 22 + seed, row / 22 - seed * 0.3, 900 + seed, 4);
      const cloudA = Math.min(1, Math.max(0, (c - 0.18) / 0.22));
      const sIdx = Math.max(0, row - 6) * ds.w + Math.min(ds.w - 1, col + 5);
      const cS = fbm((sIdx % ds.w) / 22 + seed, Math.floor(sIdx / ds.w) / 22 - seed * 0.3, 900 + seed, 4);
      const shadowA = cloudA < 0.15 ? Math.min(1, Math.max(0, (cS - 0.18) / 0.22)) * 0.55 : 0;
      const base = pseudoTrueColor(ds, i, r.veg[i], r.built[i]);
      const o = i * 4;
      // raw
      const rr = base[0] * (1 - cloudA) * (1 - shadowA) + 245 * cloudA;
      const gg = base[1] * (1 - cloudA) * (1 - shadowA) + 245 * cloudA;
      const bb = base[2] * (1 - cloudA) * (1 - shadowA) + 250 * cloudA;
      imgs[0].data.set([rr, gg, bb, 255], o);
      // mask
      const isCloud = cloudA > 0.35, isShadow = shadowA > 0.2;
      if (isCloud) { imgs[1].data.set([217, 70, 239, 255], o); cloud++; }
      else if (isShadow) { imgs[1].data.set([56, 189, 248, 255], o); shadow++; }
      else { const gray = (base[0] + base[1] + base[2]) / 3 * 0.55; imgs[1].data.set([gray, gray, gray, 255], o); }
      // composite
      imgs[2].data.set([base[0], base[1], base[2], 255], o);
    }
    return { imgs, cloudPct: (cloud / ds.n) * 100, shadowPct: (shadow / ds.n) * 100 };
  }, [ds, seed]);

  useEffect(() => {
    stats.imgs.forEach((img, k) => {
      const cv = refs[k].current;
      if (!cv) return;
      const off = document.createElement("canvas");
      off.width = ds.w; off.height = ds.h;
      off.getContext("2d")!.putImageData(img, 0, 0);
      cv.width = ds.w * 3; cv.height = ds.h * 3;
      const ctx = cv.getContext("2d")!;
      ctx.imageSmoothingEnabled = k !== 1;
      ctx.drawImage(off, 0, 0, cv.width, cv.height);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats]);

  const labels = ["Raw scene (true colour)", "QA mask · cloud / shadow", "Median composite (clean)"];
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        {labels.map((l, k) => (
          <div key={l} className="relative overflow-hidden rounded-xl border border-white/10">
            <canvas ref={refs[k]} className="aspect-[7/6] w-full" />
            <span className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-0.5 text-[11px] text-slate-100">{l}</span>
            {k === 1 && (
              <div className="absolute bottom-2 left-2 flex gap-2 text-[10px]">
                <span className="rounded bg-black/60 px-1.5 py-0.5 text-fuchsia-300">cloud {stats.cloudPct.toFixed(1)}%</span>
                <span className="rounded bg-black/60 px-1.5 py-0.5 text-sky-300">shadow {stats.shadowPct.toFixed(1)}%</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-400">
        CFMask / SCL bits flag cloud, cirrus and cloud-shadow. Flagged pixels are dropped before the per-pixel <span className="text-slate-200">median</span> across all clear observations in the season — the composite is cloud-free even when every single scene has some cloud.
      </p>
    </div>
  );
}

const GCPS = [
  { id: "GCP-01", name: "Zero Mile stone", dx: 0.21, dy: -0.14 },
  { id: "GCP-02", name: "Ambazari spillway", dx: -0.33, dy: 0.19 },
  { id: "GCP-03", name: "Airport runway 14 threshold", dx: 0.12, dy: 0.28 },
  { id: "GCP-04", name: "Kalamna rail junction", dx: -0.18, dy: -0.36 },
  { id: "GCP-05", name: "Koradi TPS chimney", dx: 0.4, dy: 0.05 },
  { id: "GCP-06", name: "Outer Ring Rd flyover (Besa)", dx: -0.27, dy: 0.22 },
];

export default function DataPipeline() {
  const { ds, year, setYear, setView } = useApp();
  const catalog = useMemo(() => scenesFor(ds), [ds]);
  const quality = useMemo(() => qualityFor(ds), [ds]);
  const [platform, setPlatform] = useState<"all" | "Landsat" | "Sentinel">("all");
  const [showAll, setShowAll] = useState(false);
  const [maskSeed, setMaskSeed] = useState(1);

  const scenes = catalog.filter((s) => s.year === year && (platform === "all" || s.platform === platform));
  const visible = showAll ? scenes : scenes.slice(0, 10);
  const q = quality.find((x) => x.year === year)!;
  const chartData = quality.map((x) => ({ year: x.year, Used: x.used, Partial: x.partial, Rejected: x.rejected }));
  const rmse = Math.sqrt(GCPS.reduce((s, g) => s + g.dx * g.dx + g.dy * g.dy, 0) / GCPS.length);

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6">
      <SectionHeader n={1} title="Data Collection & Preprocessing" purpose="Acquire Landsat 8/9 and Sentinel-2 scenes for the Nagpur AOI, remove clouds and shadows, align every scene to a common grid and organise six pre-monsoon seasons into an analysis-ready cube." why="Every downstream statistic inherits the quality of this step — undetected cloud biases surface temperature low and misregistration smears change signals.">
        <YearPicker value={year} onChange={setYear} />
      </SectionHeader>

      {/* Pipeline steps */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PIPELINE_STEPS.map((s, k) => {
          const Icon = STEP_ICONS[k];
          return (
            <div key={s.key} className="relative rounded-2xl border border-white/10 bg-slate-900/70 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300"><Icon className="h-4 w-4" /></span>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Step {k + 1}</p>
                  <h3 className="text-sm font-semibold text-white">{s.title}</h3>
                </div>
                <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-400" />
              </div>
              <p className="mt-2 text-[11px] italic text-slate-400">{s.hinglish}</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-300">{s.detail}</p>
              <ul className="mt-3 space-y-1">
                {s.metrics.map((m) => (
                  <li key={m} className="flex items-center gap-1.5 text-[11px] text-slate-400"><span className="h-1 w-1 rounded-full bg-sky-400" />{m}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        {/* Catalog */}
        <Card className="xl:col-span-3" title={`Scene catalogue · ${year}`} subtitle="Landsat WRS-2 path 144 / row 045 · Sentinel-2 tile 44QLJ · 1 Mar – 31 May"
          right={<Segmented size="xs" options={[{ value: "all", label: "All" }, { value: "Landsat", label: "Landsat" }, { value: "Sentinel", label: "Sentinel-2" }]} value={platform} onChange={setPlatform} />}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Scene ID</th>
                  <th className="pb-2 pr-3 font-medium">Sensor</th>
                  <th className="pb-2 pr-3 font-medium">Date</th>
                  <th className="pb-2 pr-3 font-medium">Cloud %</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {visible.map((s) => (
                  <tr key={s.id} className="hover:bg-white/3">
                    <td className="max-w-[240px] truncate py-2 pr-3 font-mono text-[10px] text-slate-300">{s.id}</td>
                    <td className="py-2 pr-3 text-slate-300">{s.sensor}</td>
                    <td className="py-2 pr-3 tabular-nums text-slate-300">{s.date}</td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10"><div className={cn("h-full rounded-full", s.cloud < 20 ? "bg-emerald-400" : s.cloud < 45 ? "bg-amber-400" : "bg-red-400")} style={{ width: `${s.cloud}%` }} /></div>
                        <span className="tabular-nums text-slate-300">{s.cloud.toFixed(1)}</span>
                      </div>
                    </td>
                    <td className="py-2">
                      {s.status === "used" && <Pill tone="green">used</Pill>}
                      {s.status === "partial" && <Pill tone="amber">partial mask</Pill>}
                      {s.status === "rejected" && <Pill tone="red">rejected</Pill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {scenes.length > 10 && (
            <button onClick={() => setShowAll(!showAll)} className="mt-3 text-xs font-medium text-sky-300 hover:text-sky-200">
              {showAll ? "Show fewer" : `Show all ${scenes.length} scenes`}
            </button>
          )}
        </Card>

        {/* Year quality */}
        <div className="space-y-4 xl:col-span-2">
          <Card title="Composite quality" subtitle={`Data availability & cleanliness · ${year}`} right={<Pill tone={q.quality === "High" ? "green" : q.quality === "Good" ? "sky" : "amber"}>{q.quality}</Pill>}>
            <Stat label="Scenes acquired" value={q.total} />
            <Stat label="Clear scenes used" value={q.used} tone="text-emerald-300" />
            <Stat label="Partially masked" value={q.partial} tone="text-amber-300" />
            <Stat label="Rejected (cloud > 45%)" value={q.rejected} tone="text-red-300" />
            <Stat label="Mean scene cloud cover" value={`${q.meanCloud.toFixed(1)}%`} />
            <Stat label="Residual cloud in composite" value={`${q.compositeCloud.toFixed(1)}%`} />
            <Stat label="AOI coverage (≥3 clear obs)" value={`${q.completeness.toFixed(1)}%`} />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {q.sensors.map((s) => <Pill key={s} tone="sky">{s}</Pill>)}
              {year < 2022 && <Pill tone="slate">Landsat 9 not yet launched</Pill>}
            </div>
          </Card>
          <Card title="Scenes per season" subtitle="Usable vs rejected acquisitions, 2019–2024">
            <div className="h-44">
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ left: -20, right: 5, top: 5 }}>
                  <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                  <XAxis dataKey="year" stroke={chartTheme.axis} fontSize={11} tickLine={false} />
                  <YAxis stroke={chartTheme.axis} fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={chartTheme.tooltip} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <RLegend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Used" stackId="a" fill="#34d399" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Partial" stackId="a" fill="#fbbf24" />
                  <Bar dataKey="Rejected" stackId="a" fill="#f87171" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>

      {/* Production runtime */}
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300"><Server className="h-5 w-5" /></span>
          <div>
            <p className="text-sm font-semibold text-white">Production pipeline · Python service <span className="font-mono text-xs font-normal text-slate-400">nagpur_uhi</span></p>
            <p className="mt-0.5 text-xs text-slate-400">The four steps above run as <span className="font-mono text-slate-300">fetch → build → analyze</span> against USGS / Copernicus archives (Planetary Computer STAC or Earth Engine), at native 30 m, with the same QA rules shown here. Outputs: analysis JSON, GeoTIFFs, PNG maps and a REST API.</p>
          </div>
        </div>
        <button onClick={() => setView("methodology")} className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10">Methods & validation →</button>
      </div>

      {/* Cloud masking */}
      <Card title="Cloud removal & cleaning" subtitle="Per-scene QA masking → seasonal median composite" right={<button onClick={() => setMaskSeed((s) => s + 1)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10">Next scene ›</button>}>
        <CloudMaskDemo ds={ds} seed={maskSeed} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Georeferencing */}
        <Card title="Georeferencing & co-registration" subtitle="Aligning every scene to exact geographic coordinates">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Stat label="Native CRS" value="WGS 84 / UTM 44N" />
              <Stat label="EPSG" value="32644 → 4326 (web)" />
              <Stat label="Datum" value="WGS 84 (G1762)" />
              <Stat label="Resampling" value="Bilinear (indices) / NN (QA)" />
              <Stat label="Analysis grid" value={`${ds.w} × ${ds.h} @ ~200 m`} />
              <Stat label="Co-registration RMSE" value={`${rmse.toFixed(2)} px`} tone="text-emerald-300" />
            </div>
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Ground control points (residuals, px)</p>
              <div className="space-y-1.5">
                {GCPS.map((g) => (
                  <div key={g.id} className="flex items-center justify-between rounded-lg bg-white/3 px-2 py-1.5 text-[11px]">
                    <span className="text-slate-300"><span className="font-mono text-slate-500">{g.id}</span> {g.name}</span>
                    <span className="font-mono tabular-nums text-slate-400">dx {g.dx > 0 ? "+" : ""}{g.dx.toFixed(2)} · dy {g.dy > 0 ? "+" : ""}{g.dy.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-slate-950/50 p-3 text-xs text-slate-400">
            <span className="font-semibold text-slate-200">Bounds:</span> {`21.02°N – 21.26°N, 78.94°E – 79.22°E`} · ~29 km × 27 km · covers NMC limits + MIHAN, Hingna, Koradi periphery.
          </div>
        </Card>

        {/* Time series stack */}
        <Card title="Time-series organisation" subtitle="Chronological NDVI composites — the stack every later component reads from" right={<Database className="h-4 w-4 text-slate-500" />}>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {YEARS.map((y) => {
              const yq = quality.find((x) => x.year === y)!;
              return (
                <button key={y} onClick={() => setYear(y)} className={cn("rounded-xl border p-1.5 text-left transition", y === year ? "border-orange-400/50 bg-orange-500/10" : "border-white/10 hover:border-white/25")}>
                  <RasterCanvas values={ds.rasters[y].ndvi} layer="ndvi" className="rounded-lg border-0" />
                  <p className="mt-1.5 text-xs font-semibold text-white">{y}</p>
                  <p className="text-[10px] text-slate-400">{yq.used + yq.partial} obs · {yq.compositeCloud.toFixed(1)}% cloud</p>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400">
            <Pill tone="slate">Cube: 6 yr × 3 idx × {ds.n.toLocaleString()} px</Pill>
            <Pill tone="slate">Reducer: median</Pill>
            <Pill tone="slate">QA: obs-count layer</Pill>
            <Pill tone="slate">Storage: Zarr / COG</Pill>
          </div>
        </Card>
      </div>
    </div>
  );
}
