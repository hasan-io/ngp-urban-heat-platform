// Live data adapter: loads the analysis cube from the `nagpur_uhi` Python service
// (FastAPI) and feeds it through the same `buildDataset()` used for the demonstration data.
//
//   GET {base}/api/summary            → meta (bbox, shape, years), per-year quality
//   GET {base}/api/raster/water/2024  → water mask
//   GET {base}/api/raster/{lst|ndvi|ndbi}/{year}
//   GET {base}/api/scenes             → acquisition catalogue (optional)
import type { Scene, YearQuality } from "./catalog";
import { buildDataset, cellLatLon, coverFromIndices, type Dataset, type YearRasters } from "./engine";
import { BOUNDS, YEARS, type Year } from "./nagpur";

export interface ServiceInfo {
  baseUrl: string;
  shape: [number, number];
  bbox: [number, number, number, number];
  years: number[];
  source: string;
  gridResM?: number;
  quality: Record<string, { quality: string; completeness_pct: number; used: number; scenes: number }>;
}

const TIMEOUT_MS = 8000;

async function getJson<T>(url: string, timeout = TIMEOUT_MS): Promise<T> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
    return (await res.json()) as T;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`Timed out after ${timeout / 1000}s — ${url}`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}

export const normalizeBaseUrl = (u: string) => u.trim().replace(/\/+$/, "").replace(/\/api$/, "");

/** Cheap reachability + contract check (used by the "Test connection" button). */
export async function probeService(baseUrl: string): Promise<ServiceInfo> {
  const base = normalizeBaseUrl(baseUrl);
  const s = await getJson<{ meta: { bbox: number[]; shape: number[]; years: number[]; source?: string; grid_res_m?: number }; quality: ServiceInfo["quality"] }>(`${base}/api/summary`);
  const bbox = s.meta.bbox as [number, number, number, number];
  const tol = 1e-3;
  if (Math.abs(bbox[0] - BOUNDS.west) > tol || Math.abs(bbox[1] - BOUNDS.south) > tol || Math.abs(bbox[2] - BOUNDS.east) > tol || Math.abs(bbox[3] - BOUNDS.north) > tol) {
    throw new Error(`Service AOI ${bbox.map((v) => v.toFixed(3)).join(", ")} does not match the platform AOI (${BOUNDS.west}, ${BOUNDS.south}, ${BOUNDS.east}, ${BOUNDS.north}).`);
  }
  const missing = YEARS.filter((y) => !s.meta.years.includes(y));
  if (missing.length) throw new Error(`Service is missing composites for ${missing.join(", ")}; the platform expects ${YEARS[0]}–${YEARS[YEARS.length - 1]}.`);
  return { baseUrl: base, shape: [s.meta.shape[0], s.meta.shape[1]], bbox, years: s.meta.years, source: s.meta.source ?? "unknown", gridResM: s.meta.grid_res_m, quality: s.quality ?? {} };
}

interface RasterResponse { shape: number[]; values: number[][] | number[] }

function flatten(r: RasterResponse, n: number): Float32Array {
  const out = new Float32Array(n);
  const v = r.values;
  if (Array.isArray(v[0])) {
    let k = 0;
    for (const row of v as number[][]) for (const x of row) out[k++] = x;
  } else out.set(v as number[]);
  return out;
}

function toQuality(q: ServiceInfo["quality"]): YearQuality[] {
  return YEARS.map((year) => {
    const r = (q[String(year)] ?? {}) as Partial<{ scenes: number; used: number; partial: number; rejected: number; mean_scene_cloud: number; completeness_pct: number; sensors: string[]; quality: string }>;
    const used = r.used ?? 0, partial = r.partial ?? 0, rejected = r.rejected ?? 0;
    return {
      year, total: r.scenes ?? used + partial + rejected, used, partial, rejected,
      meanCloud: r.mean_scene_cloud ?? NaN, compositeCloud: Math.max(0.2, 3.5 - (used + partial * 0.5) * 0.12),
      completeness: r.completeness_pct ?? NaN, sensors: r.sensors ?? [],
      quality: (r.quality as YearQuality["quality"]) ?? "Good",
    };
  });
}

function toScenes(raw: { id: string; platform: string; sensor: string; date: string; year: number; cloud: number; status: string; bands: string[] }[]): Scene[] {
  return raw.map((r) => ({
    id: r.id, sensor: r.sensor as Scene["sensor"], platform: r.platform as Scene["platform"], date: r.date, year: r.year as Year, cloud: r.cloud,
    status: r.status as Scene["status"], resolution: r.platform === "Landsat" ? "30 m (TIR 100 m)" : "10 m / 20 m",
    bands: r.bands.join(" "), tile: r.platform === "Landsat" ? "144/045" : (r.id.match(/T(\d{2}[A-Z]{3})/)?.[1] ?? "44QLJ"),
  }));
}

/** Load the full cube from the service and derive all platform statistics. */
export async function loadLiveDataset(baseUrl: string, onProgress?: (done: number, total: number, label: string) => void): Promise<Dataset> {
  const info = await probeService(baseUrl);
  const base = info.baseUrl;
  const [h, w] = info.shape;
  const n = w * h;
  const total = 2 + YEARS.length * 3;
  let done = 0;
  const tick = (label: string) => onProgress?.(++done, total, label);

  const waterRaw = await getJson<RasterResponse>(`${base}/api/raster/water/${YEARS[YEARS.length - 1]}`);
  tick("water mask");
  const waterF = flatten(waterRaw, n);
  const water = new Uint8Array(n);
  for (let i = 0; i < n; i++) water[i] = waterF[i] > 0.5 ? 1 : 0;

  const rasters = {} as Record<Year, YearRasters>;
  await Promise.all(
    YEARS.map(async (y) => {
      const [lst, ndvi, ndbi] = await Promise.all(
        (["lst", "ndvi", "ndbi"] as const).map(async (m) => {
          const r = await getJson<RasterResponse>(`${base}/api/raster/${m}/${y}`);
          tick(`${m.toUpperCase()} ${y}`);
          return flatten(r, n);
        }),
      );
      const veg = new Float32Array(n), built = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        // service encodes NaN as -9999; fill with neutral values so statistics stay finite
        if (lst[i] < -100) lst[i] = 38;
        if (ndvi[i] < -1) ndvi[i] = 0.2;
        if (ndbi[i] < -1) ndbi[i] = -0.15;
        const [v, b] = coverFromIndices(ndvi[i], ndbi[i]);
        veg[i] = v; built[i] = b;
      }
      rasters[y] = { lst, ndvi, ndbi, veg, built };
    }),
  );

  let scenes: Scene[] | undefined;
  try {
    scenes = toScenes(await getJson(`${base}/api/scenes`, 4000));
  } catch { /* optional endpoint */ }
  tick("catalogue");

  const lat = new Float32Array(n), lon = new Float32Array(n);
  for (let i = 0; i < n; i++) { const [la, lo] = cellLatLon(i, w, h); lat[i] = la; lon[i] = lo; }
  const fetchedAt = new Date().toISOString();
  return buildDataset({
    id: `live:${fetchedAt}`, source: "live", label: `Live · ${new URL(base).host}`, w, h, lat, lon, water, rasters,
    meta: { baseUrl: base, fetchedAt, serviceSource: info.source, gridResM: info.gridResM },
    quality: toQuality(info.quality), scenes,
  });
}
