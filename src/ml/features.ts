// Feature engineering for the ML models. Every cell gets 12 predictors: its own spectral
// indices, 1 km neighbourhood context (mean / texture / water share) and static geography
// (distance to water, city centre and major roads, industrial land-use proximity, position).
import { ellipseDist, polylineDist, toKm, type Dataset } from "@/data/engine";
import { INDUSTRIAL, ROADS } from "@/data/nagpur";

export const FEATURES = [
  { key: "ndvi", label: "NDVI", group: "spectral" },
  { key: "ndbi", label: "NDBI", group: "spectral" },
  { key: "ndvi_1km", label: "NDVI · 1 km mean", group: "context" },
  { key: "ndbi_1km", label: "NDBI · 1 km mean", group: "context" },
  { key: "ndbi_std_1km", label: "NDBI · 1 km texture (std)", group: "context" },
  { key: "water_1km", label: "Water share · 1 km", group: "context" },
  { key: "dist_water", label: "Distance to water (km)", group: "geography" },
  { key: "dist_center", label: "Distance to centre (km)", group: "geography" },
  { key: "dist_road", label: "Distance to major road (km)", group: "geography" },
  { key: "industrial", label: "Industrial land-use proximity", group: "geography" },
  { key: "x_km", label: "Easting (km)", group: "position" },
  { key: "y_km", label: "Northing (km)", group: "position" },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
export const FEATURE_INDEX = Object.fromEntries(FEATURES.map((f, i) => [f.key, i])) as Record<FeatureKey, number>;

/** Box mean of `values` over a (2r+1)² window using an integral image; edge windows are renormalised. */
export function boxMean(values: ArrayLike<number>, w: number, h: number, r: number): Float32Array {
  const W = w + 1;
  const I = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += values[y * w + x];
      I[(y + 1) * W + (x + 1)] = I[y * W + (x + 1)] + rowSum;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const s = I[(y1 + 1) * W + (x1 + 1)] - I[y0 * W + (x1 + 1)] - I[(y1 + 1) * W + x0] + I[y0 * W + x0];
      out[y * w + x] = s / ((y1 - y0 + 1) * (x1 - x0 + 1));
    }
  }
  return out;
}

interface StaticFeatures { water_1km: Float32Array; dist_water: Float32Array; dist_center: Float32Array; dist_road: Float32Array; industrial: Float32Array; x_km: Float32Array; y_km: Float32Array; land: Int32Array }
const staticCache = new WeakMap<Dataset, StaticFeatures>();

export function staticFeatures(ds: Dataset): StaticFeatures {
  const hit = staticCache.get(ds);
  if (hit) return hit;
  const n = ds.n;
  const x_km = new Float32Array(n), y_km = new Float32Array(n), dist_center = new Float32Array(n);
  const dist_road = new Float32Array(n), industrial = new Float32Array(n), dist_water = new Float32Array(n);
  const wx: number[] = [], wy: number[] = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = toKm(ds.lat[i], ds.lon[i]);
    x_km[i] = x; y_km[i] = y;
    if (ds.water[i]) { wx.push(x); wy.push(y); }
  }
  const majorRoads = ROADS.filter((r) => r.s >= 0.4);
  for (let i = 0; i < n; i++) {
    const x = x_km[i], y = y_km[i];
    dist_center[i] = Math.hypot(x, y);
    let dr = Infinity;
    for (const rd of majorRoads) dr = Math.min(dr, polylineDist(x, y, rd.pts));
    dist_road[i] = dr;
    let ind = 0;
    for (const e of INDUSTRIAL) ind = Math.max(ind, (e.s ?? 1) * Math.exp(-(ellipseDist(x, y, e) ** 2)));
    industrial[i] = ind;
    let dw = Infinity;
    for (let k = 0; k < wx.length; k++) { const d2 = (wx[k] - x) ** 2 + (wy[k] - y) ** 2; if (d2 < dw) dw = d2; }
    dist_water[i] = Math.sqrt(dw);
  }
  const water_1km = boxMean(ds.water, ds.w, ds.h, 2);
  const landIdx: number[] = [];
  for (let i = 0; i < n; i++) if (!ds.water[i]) landIdx.push(i);
  const out = { water_1km, dist_water, dist_center, dist_road, industrial, x_km, y_km, land: Int32Array.from(landIdx) };
  staticCache.set(ds, out);
  return out;
}

/** Full feature matrix (column-major) for one year; `ndvi`/`ndbi` overrides let scenarios re-featurise. */
export function buildFeatures(ds: Dataset, year: keyof Dataset["rasters"], override?: { ndvi?: Float32Array; ndbi?: Float32Array }): Float32Array[] {
  const s = staticFeatures(ds);
  const ndvi = override?.ndvi ?? ds.rasters[year].ndvi;
  const ndbi = override?.ndbi ?? ds.rasters[year].ndbi;
  const ndviM = boxMean(ndvi, ds.w, ds.h, 2);
  const ndbiM = boxMean(ndbi, ds.w, ds.h, 2);
  const ndbiSq = new Float32Array(ds.n);
  for (let i = 0; i < ds.n; i++) ndbiSq[i] = ndbi[i] * ndbi[i];
  const ndbiM2 = boxMean(ndbiSq, ds.w, ds.h, 2);
  const ndbiStd = new Float32Array(ds.n);
  for (let i = 0; i < ds.n; i++) ndbiStd[i] = Math.sqrt(Math.max(0, ndbiM2[i] - ndbiM[i] * ndbiM[i]));
  return [ndvi, ndbi, ndviM, ndbiM, ndbiStd, s.water_1km, s.dist_water, s.dist_center, s.dist_road, s.industrial, s.x_km, s.y_km];
}

export const landRows = (ds: Dataset) => staticFeatures(ds).land;
