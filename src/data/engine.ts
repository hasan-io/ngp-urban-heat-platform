// Analytics engine: builds the Nagpur multi-temporal raster stack and derives
// every statistic used by the platform (zonal stats, regression, hotspots, trends).
// Rasters are procedurally generated from a physically-motivated land-cover model
// calibrated to Nagpur's known geography (lakes, reserve forests, CBD, SEZ, growth corridors).

import { fbm, hash2, valueNoise } from "./noise";
import {
  AIRPORT, BOUNDS, CITY_CENTER, CLASSES_NDVI, FORESTS, GRID, GROWTH_ZONES, INDUSTRIAL,
  KM_PER_DEG_LAT, KM_PER_DEG_LON, LAKES, LST_TREND_PER_YEAR, RIVERS, ROADS, URBAN_CORES, YEARS, YEAR_ANOMALY, ZONES,
  type Ellipse, type LatLon, type Year, type Zone,
} from "./nagpur";

export type Metric = "lst" | "ndvi" | "ndbi";

export interface YearRasters {
  ndvi: Float32Array;
  ndbi: Float32Array;
  lst: Float32Array;
  veg: Float32Array; // vegetation cover fraction 0..1
  built: Float32Array; // built-up fraction 0..1
}

export interface Regression {
  a: number;
  bNdvi: number;
  bNdbi: number;
  r2: number;
  rmse: number;
  rNdviLst: number;
  rNdbiLst: number;
  rNdviNdbi: number;
  n: number;
}

export interface Trend {
  slope: number;
  intercept: number;
  r2: number;
}

export interface CityStats {
  lstMean: number;
  lstP90: number;
  lstMax: number;
  lstMin: number;
  ndviMean: number;
  ndbiMean: number;
  hotAreaKm2: number; // LST > 42 °C
  greenAreaKm2: number; // NDVI > 0.4
  builtAreaKm2: number; // NDBI > 0.1
  classAreaKm2: Record<string, number>;
}

export interface ZoneYearStats {
  lst: number;
  ndvi: number;
  ndbi: number;
  veg: number;
  built: number;
  hotFrac: number; // share of cells in city-wide top 10% LST that year
}

export interface ZoneStats {
  zone: Zone;
  index: number;
  cells: number;
  areaKm2: number;
  byYear: Record<Year, ZoneYearStats>;
  dLst: number;
  dNdvi: number;
  dNdbi: number;
  lstSlope: number;
  ndviSlope: number;
  ndbiSlope: number;
  persistentFrac: number;
  centroid: LatLon;
}

export type DataSource = "demo" | "live";

export interface DatasetMeta {
  baseUrl?: string;
  fetchedAt?: string;
  serviceSource?: string; // e.g. "landsat+sentinel", "gee", "synthetic"
  gridResM?: number;
  note?: string;
}

/** Raw inputs to `buildDataset` — produced by the synthetic generator or by the live data service. */
export interface DatasetInput {
  id: string;
  source: DataSource;
  label: string;
  w: number;
  h: number;
  lat: Float32Array;
  lon: Float32Array;
  water: Uint8Array;
  rasters: Record<Year, YearRasters>;
  meta?: DatasetMeta;
  quality?: import("./catalog").YearQuality[];
  scenes?: import("./catalog").Scene[];
}

export interface Dataset {
  id: string;
  source: DataSource;
  label: string;
  meta: DatasetMeta;
  quality?: import("./catalog").YearQuality[];
  scenes?: import("./catalog").Scene[];
  cellAreaKm2: number;
  w: number;
  h: number;
  n: number;
  years: readonly Year[];
  rasters: Record<Year, YearRasters>;
  water: Uint8Array;
  lat: Float32Array;
  lon: Float32Array;
  zoneIndex: Int16Array;
  zones: ZoneStats[];
  city: Record<Year, CityStats>;
  hotCount: Uint8Array; // years (0..6) in which the cell was a top-10% hotspot
  regression: Record<Year, Regression>;
  trends: { lst: Trend; ndvi: Trend; ndbi: Trend };
}

// ---------- geometry helpers ----------
export const toKm = (lat: number, lon: number): [number, number] => [
  (lon - CITY_CENTER.lon) * KM_PER_DEG_LON,
  (lat - CITY_CENTER.lat) * KM_PER_DEG_LAT,
];

export function ellipseDist(x: number, y: number, e: Ellipse): number {
  const [ex, ey] = toKm(e.lat, e.lon);
  const rot = ((e.rot ?? 0) * Math.PI) / 180;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const dx = x - ex;
  const dy = y - ey;
  const xr = dx * c + dy * s;
  const yr = -dx * s + dy * c;
  return Math.sqrt((xr / e.rx) ** 2 + (yr / e.ry) ** 2);
}

const smoothstep = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
const soft = (d: number, inner: number, outer: number) => 1 - smoothstep(inner, outer, d);
const gauss = (d: number, k = 1) => Math.exp(-d * d * k);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy || 1e-9;
  const t = clamp((wx * vx + wy * vy) / len2, 0, 1);
  const cx = ax + t * vx;
  const cy = ay + t * vy;
  return Math.hypot(px - cx, py - cy);
}

export function polylineDist(x: number, y: number, pts: LatLon[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = toKm(pts[i][0], pts[i][1]);
    const [bx, by] = toKm(pts[i + 1][0], pts[i + 1][1]);
    const d = segDist(x, y, ax, ay, bx, by);
    if (d < best) best = d;
  }
  return best;
}

function pointInPoly(lat: number, lon: number, poly: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0], xi = poly[i][1];
    const yj = poly[j][0], xj = poly[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function cellLatLon(i: number, w = GRID.w, h = GRID.h): LatLon {
  const col = i % w;
  const row = Math.floor(i / w);
  const lon = BOUNDS.west + ((col + 0.5) / w) * (BOUNDS.east - BOUNDS.west);
  const lat = BOUNDS.north - ((row + 0.5) / h) * (BOUNDS.north - BOUNDS.south);
  return [lat, lon];
}

export function cellAreaFor(w: number, h: number): number {
  return ((BOUNDS.east - BOUNDS.west) / w) * KM_PER_DEG_LON * (((BOUNDS.north - BOUNDS.south) / h) * KM_PER_DEG_LAT);
}

/** Vegetation / built-up cover fractions from the indices (inverse of the composite calibration). */
export const coverFromIndices = (ndvi: number, ndbi: number): [number, number] => [
  Math.min(1, Math.max(0, (ndvi - 0.06) / 0.72)),
  Math.min(1, Math.max(0, (ndbi + 0.32) / 0.75)),
];

export function latLonToCell(ds: { w: number; h: number }, lat: number, lon: number): number {
  if (lat < BOUNDS.south || lat > BOUNDS.north || lon < BOUNDS.west || lon > BOUNDS.east) return -1;
  const col = Math.min(ds.w - 1, Math.floor(((lon - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * ds.w));
  const row = Math.min(ds.h - 1, Math.floor(((BOUNDS.north - lat) / (BOUNDS.north - BOUNDS.south)) * ds.h));
  return row * ds.w + col;
}

// ---------- stats helpers ----------
export function linearFit(xs: number[], ys: number[]): Trend {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, intercept, r2 };
}

function percentile(arr: Float32Array | number[], p: number): number {
  const s = Array.from(arr).sort((a, b) => a - b);
  const idx = clamp(Math.floor(p * (s.length - 1)), 0, s.length - 1);
  return s[idx];
}

function fitRegression(lst: Float32Array, ndvi: Float32Array, ndbi: Float32Array, water: Uint8Array): Regression {
  let n = 0, s1 = 0, s2 = 0, s11 = 0, s22 = 0, s12 = 0, sy = 0, sy1 = 0, sy2 = 0, syy = 0;
  for (let i = 0; i < lst.length; i++) {
    if (water[i]) continue;
    const x1 = ndvi[i], x2 = ndbi[i], y = lst[i];
    n++; s1 += x1; s2 += x2; s11 += x1 * x1; s22 += x2 * x2; s12 += x1 * x2; sy += y; sy1 += x1 * y; sy2 += x2 * y; syy += y * y;
  }
  // Solve normal equations [n s1 s2; s1 s11 s12; s2 s12 s22] * [a b1 b2] = [sy sy1 sy2]
  const M = [
    [n, s1, s2, sy],
    [s1, s11, s12, sy1],
    [s2, s12, s22, sy2],
  ];
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  const a = M[0][3] / M[0][0];
  const bNdvi = M[1][3] / M[1][1];
  const bNdbi = M[2][3] / M[2][2];
  let ssRes = 0;
  const my = sy / n;
  for (let i = 0; i < lst.length; i++) {
    if (water[i]) continue;
    const pred = a + bNdvi * ndvi[i] + bNdbi * ndbi[i];
    ssRes += (lst[i] - pred) ** 2;
  }
  const ssTot = syy - n * my * my;
  const corr = (sxy: number, sx: number, sy_: number, sxx: number, syy_: number) => {
    const cov = sxy - (sx * sy_) / n;
    const vx = sxx - (sx * sx) / n;
    const vy = syy_ - (sy_ * sy_) / n;
    return cov / Math.sqrt(vx * vy);
  };
  return {
    a, bNdvi, bNdbi,
    r2: 1 - ssRes / ssTot,
    rmse: Math.sqrt(ssRes / n),
    rNdviLst: corr(sy1, s1, sy, s11, syy),
    rNdbiLst: corr(sy2, s2, sy, s22, syy),
    rNdviNdbi: corr(s12, s1, s2, s11, s22),
    n,
  };
}

// ---------- dataset builder ----------
let cached: Dataset | null = null;

/** Demonstration cube: physically-motivated land-cover model calibrated to Nagpur's geography. */
export function getDataset(): Dataset {
  if (cached) return cached;
  cached = buildDataset(generateSynthetic());
  return cached;
}

function generateSynthetic(): DatasetInput {
  const { w, h } = GRID;
  const n = w * h;

  const lat = new Float32Array(n);
  const lon = new Float32Array(n);
  const core = new Float32Array(n);
  const forest = new Float32Array(n);
  const water = new Uint8Array(n);
  const ind0 = new Float32Array(n);
  const ind1 = new Float32Array(n);
  const indHeat = new Float32Array(n);
  const airport = new Float32Array(n);
  const road = new Float32Array(n);
  const river = new Float32Array(n);
  const g0 = new Float32Array(n);
  const g1 = new Float32Array(n);
  const nB = new Float32Array(n);
  const nV = new Float32Array(n);
  const nL = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const [la, lo] = cellLatLon(i, w, h);
    lat[i] = la;
    lon[i] = lo;
    const [x, y] = toKm(la, lo);

    // urban cores (union of gaussians)
    let c = 1;
    for (const e of URBAN_CORES) c *= 1 - (e.s ?? 1) * gauss(ellipseDist(x, y, e), 0.9);
    core[i] = 1 - c;

    // forests
    let f = 0;
    for (const e of FORESTS) f = Math.max(f, (e.s ?? 1) * soft(ellipseDist(x, y, e) + 0.12 * valueNoise(x * 1.8, y * 1.8, 77), 0.72, 1.15));
    forest[i] = f;

    // lakes (hard mask with wobbly shoreline)
    for (const e of LAKES) {
      if (ellipseDist(x, y, e) + 0.1 * valueNoise(x * 3, y * 3, 91) < 1) { water[i] = 1; break; }
    }

    // industrial (static + growing parts) and extra heat
    let i0 = 0, i1 = 0, heat = 0;
    for (const e of INDUSTRIAL) {
      const m = (e.s ?? 1) * soft(ellipseDist(x, y, e), 0.6, 1.2);
      const gr = e.growth ?? 0;
      i0 += m * (1 - gr);
      i1 += m * gr;
      heat = Math.max(heat, m * e.heat);
    }
    ind0[i] = Math.min(1, i0);
    ind1[i] = Math.min(1, i1);
    indHeat[i] = heat;

    airport[i] = soft(ellipseDist(x, y, AIRPORT), 0.7, 1.1);

    // road corridors
    let r = 0;
    for (const rd of ROADS) r = Math.max(r, rd.s * soft(polylineDist(x, y, rd.pts), rd.w * 0.5, rd.w * 2.2));
    road[i] = r;

    let rv = 0;
    for (const rd of RIVERS) rv = Math.max(rv, rd.s * soft(polylineDist(x, y, rd.pts), rd.w * 0.4, rd.w * 2));
    river[i] = rv;

    // growth zones: g(y) = g0 + g1 * t(y)
    let a0 = 0, a1 = 0;
    for (const e of GROWTH_ZONES) {
      const m = (e.s ?? 1) * gauss(ellipseDist(x, y, e), 1.1);
      a0 += m * e.base;
      a1 += m * (1 - e.base);
    }
    g0[i] = a0;
    g1[i] = a1;

    nB[i] = fbm(x / 1.4, y / 1.4, 11, 4);
    nV[i] = fbm(x / 1.1, y / 1.1, 23, 4);
    nL[i] = fbm(x / 0.9, y / 0.9, 37, 4);

  }

  const rasters = {} as Record<Year, YearRasters>;
  for (const y of YEARS) {
    const t = Math.pow((y - 2019) / 5, 0.9);
    const an = YEAR_ANOMALY[y];
    const ndvi = new Float32Array(n);
    const ndbi = new Float32Array(n);
    const lst = new Float32Array(n);
    const veg = new Float32Array(n);
    const built = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const [x, yk] = toKm(lat[i], lon[i]);
      const nY = fbm(x / 0.7 + y * 3.1, yk / 0.7 - y * 1.7, 500 + y, 3);
      if (water[i]) {
        veg[i] = 0; built[i] = 0;
        ndvi[i] = -0.12 + 0.04 * nY;
        ndbi[i] = -0.46 + 0.04 * nV[i];
        lst[i] = 30.4 + 0.12 * (y - 2019) + an.lst * 0.4 + 0.35 * nY;
        continue;
      }
      const g = Math.min(1, g0[i] + g1[i] * t);
      const ind = Math.min(1, ind0[i] + ind1[i] * t);
      const coreD = core[i] * (1 + 0.06 * t);
      let B = 1 - (1 - 0.86 * coreD) * (1 - 0.78 * ind) * (1 - 0.5 * road[i]) * (1 - 0.72 * g) * (1 - 0.7 * airport[i]) * 0.95;
      B = clamp(B * (1 - 0.92 * forest[i]) * (1 + 0.14 * nB[i]), 0, 1);
      let V = (0.3 + 0.62 * forest[i] + 0.12 * river[i] + 0.06 * nV[i]) * (1 - 0.88 * B) + an.ndvi * 1.3 + 0.02 * nY;
      if (B > 0.3) V *= 1 - 0.012 * (y - 2019); // tree felling in urbanised areas
      V = clamp(V, 0, 1);
      veg[i] = V;
      built[i] = B;
      ndvi[i] = clamp(0.06 + 0.72 * V + 0.03 * nY, -0.05, 0.92);
      ndbi[i] = clamp(-0.32 + 0.75 * B + 0.12 * ind + 0.08 * airport[i] + 0.04 * nB[i] + 0.02 * nY, -0.5, 0.7);
      // Non-linear surface energy balance: canopy cooling saturates with NDVI (Carlson & Ripley),
      // impervious heating shows a threshold once NDBI exceeds ~0.15 (dense roofs / tarmac).
      const nd = Math.max(0, ndvi[i]);
      lst[i] =
        42.25 + 8.0 * ndbi[i] + 1.8 / (1 + Math.exp(-(ndbi[i] - 0.15) / 0.07)) - 10.5 * (1 - Math.exp(-2.0 * nd)) +
        indHeat[i] + 1.6 * airport[i] +
        LST_TREND_PER_YEAR * (y - 2019) + an.lst + 2.4 * nL[i] + 1.3 * nY + 0.9 * (hash2(i, y, 999) * 2 - 1);
    }
    rasters[y] = { ndvi, ndbi, lst, veg, built };
  }
  return {
    id: "demo", source: "demo", label: "Demonstration dataset", w, h, lat, lon, water, rasters,
    meta: { serviceSource: "synthetic", gridResM: 200, note: "Model-generated pre-monsoon composites calibrated to Nagpur's geography (2019–2024)." },
  };
}

/** Derive every statistic the platform needs from a raster stack (demo or live). */
export function buildDataset(inp: DatasetInput): Dataset {
  const { w, h, lat, lon, water, rasters } = inp;
  const n = w * h;
  const cellArea = cellAreaFor(w, h);
  const zoneIndex = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let z = 0; z < ZONES.length; z++) {
      if (pointInPoly(lat[i], lon[i], ZONES[z].poly)) { zoneIndex[i] = z; break; }
    }
  }

  // city-wide stats and hotspot masks
  const city = {} as Record<Year, CityStats>;
  const hotCount = new Uint8Array(n);
  const landLst: Record<number, Float32Array> = {};
  for (const y of YEARS) {
    const r = rasters[y];
    const land: number[] = [];
    for (let i = 0; i < n; i++) if (!water[i]) land.push(r.lst[i]);
    const arr = Float32Array.from(land);
    landLst[y] = arr;
    const p90 = percentile(arr, 0.9);
    let sumL = 0, sumV = 0, sumB = 0, hot = 0, green = 0, builtA = 0, mx = -Infinity, mn = Infinity;
    const classArea: Record<string, number> = {};
    for (const c of CLASSES_NDVI) classArea[c.key] = 0;
    for (let i = 0; i < n; i++) {
      const L = r.lst[i];
      sumL += L; sumV += r.ndvi[i]; sumB += r.ndbi[i];
      if (L > mx) mx = L;
      if (L < mn) mn = L;
      if (!water[i] && L >= p90) hotCount[i]++;
      if (L > 42) hot++;
      if (r.ndvi[i] > 0.4) green++;
      if (r.ndbi[i] > 0.1) builtA++;
      for (const c of CLASSES_NDVI) if (r.ndvi[i] >= c.min && r.ndvi[i] < c.max) { classArea[c.key] += cellArea; break; }
    }
    city[y] = {
      lstMean: sumL / n, lstP90: p90, lstMax: mx, lstMin: mn,
      ndviMean: sumV / n, ndbiMean: sumB / n,
      hotAreaKm2: hot * cellArea, greenAreaKm2: green * cellArea, builtAreaKm2: builtA * cellArea,
      classAreaKm2: classArea,
    };
  }

  // zonal stats
  const zones: ZoneStats[] = ZONES.map((zone, zi) => {
    const idx: number[] = [];
    for (let i = 0; i < n; i++) if (zoneIndex[i] === zi) idx.push(i);
    const byYear = {} as Record<Year, ZoneYearStats>;
    for (const y of YEARS) {
      const r = rasters[y];
      let L = 0, V = 0, B = 0, vg = 0, bt = 0, hot = 0;
      for (const i of idx) {
        L += r.lst[i]; V += r.ndvi[i]; B += r.ndbi[i]; vg += r.veg[i]; bt += r.built[i];
        if (!water[i] && r.lst[i] >= city[y].lstP90) hot++;
      }
      const c = idx.length || 1;
      byYear[y] = { lst: L / c, ndvi: V / c, ndbi: B / c, veg: vg / c, built: bt / c, hotFrac: hot / c };
    }
    const ys = YEARS.map((y) => y);
    const lstSlope = linearFit(ys, YEARS.map((y) => byYear[y].lst)).slope;
    const ndviSlope = linearFit(ys, YEARS.map((y) => byYear[y].ndvi)).slope;
    const ndbiSlope = linearFit(ys, YEARS.map((y) => byYear[y].ndbi)).slope;
    let pers = 0;
    for (const i of idx) if (hotCount[i] >= 5) pers++;
    const clat = zone.poly.reduce((s, p) => s + p[0], 0) / zone.poly.length;
    const clon = zone.poly.reduce((s, p) => s + p[1], 0) / zone.poly.length;
    return {
      zone, index: zi, cells: idx.length, areaKm2: idx.length * cellArea, byYear,
      dLst: byYear[2024].lst - byYear[2019].lst,
      dNdvi: byYear[2024].ndvi - byYear[2019].ndvi,
      dNdbi: byYear[2024].ndbi - byYear[2019].ndbi,
      lstSlope, ndviSlope, ndbiSlope,
      persistentFrac: pers / (idx.length || 1),
      centroid: [clat, clon],
    };
  });

  const regression = {} as Record<Year, Regression>;
  for (const y of YEARS) regression[y] = fitRegression(rasters[y].lst, rasters[y].ndvi, rasters[y].ndbi, water);

  const ys = YEARS.map((y) => y);
  const trends = {
    lst: linearFit(ys, YEARS.map((y) => city[y].lstMean)),
    ndvi: linearFit(ys, YEARS.map((y) => city[y].ndviMean)),
    ndbi: linearFit(ys, YEARS.map((y) => city[y].ndbiMean)),
  };

  return {
    id: inp.id, source: inp.source, label: inp.label, meta: inp.meta ?? {}, quality: inp.quality, scenes: inp.scenes, cellAreaKm2: cellArea,
    w, h, n, years: YEARS, rasters, water, lat, lon, zoneIndex, zones, city, hotCount, regression, trends,
  };
}

// ---------- derived helpers ----------
export function diffRaster(ds: Dataset, metric: Metric, a: Year, b: Year): Float32Array {
  const out = new Float32Array(ds.n);
  const ra = ds.rasters[a][metric];
  const rb = ds.rasters[b][metric];
  for (let i = 0; i < ds.n; i++) out[i] = rb[i] - ra[i];
  return out;
}

export function sampleCells(ds: Dataset, count: number, seed = 7): number[] {
  const out: number[] = [];
  const step = ds.n / count;
  for (let k = 0; k < count; k++) {
    const i = Math.floor((k + 0.5) * step + ((seed * 9301 + k * 49297) % 233280) / 233280 * step * 0.9) % ds.n;
    if (!ds.water[i]) out.push(i);
  }
  return out;
}

export function histogram(values: Float32Array, min: number, max: number, bins: number, mask?: Uint8Array) {
  const counts = new Array(bins).fill(0);
  for (let i = 0; i < values.length; i++) {
    if (mask && mask[i]) continue;
    const b = Math.floor(((values[i] - min) / (max - min)) * bins);
    if (b >= 0 && b < bins) counts[b]++;
  }
  return counts.map((c, i) => ({ x: min + ((i + 0.5) / bins) * (max - min), count: c }));
}

export interface ScenarioInput {
  zoneIndex: number;
  vegDeltaPct: number; // percentage points of vegetation cover
  builtDeltaPct: number; // percentage points of built-up cover
  baseline: "2024" | "2030";
}

export interface ScenarioResult {
  lst: Float32Array; // full raster with scenario applied
  baseLst: Float32Array;
  zoneBefore: { lst: number; ndvi: number; ndbi: number; veg: number; built: number };
  zoneAfter: { lst: number; ndvi: number; ndbi: number; veg: number; built: number };
  dLst: number;
  dLstVeg: number;
  dLstBuilt: number;
  cityDLst: number;
  uncertainty: number;
  coverWarning: boolean;
}

export function runScenario(ds: Dataset, inp: ScenarioInput): ScenarioResult {
  const reg = ds.regression[2024];
  const r = ds.rasters[2024];
  const baseLst = new Float32Array(ds.n);
  const baseNdvi = new Float32Array(ds.n);
  const baseNdbi = new Float32Array(ds.n);
  const yrs = inp.baseline === "2030" ? 6 : 0;
  for (let i = 0; i < ds.n; i++) {
    const zi = ds.zoneIndex[i];
    const zs = zi >= 0 ? ds.zones[zi] : null;
    const sL = zs ? zs.lstSlope : ds.trends.lst.slope;
    const sV = zs ? zs.ndviSlope : ds.trends.ndvi.slope;
    const sB = zs ? zs.ndbiSlope : ds.trends.ndbi.slope;
    baseLst[i] = r.lst[i] + (ds.water[i] ? 0.12 * yrs : sL * yrs);
    baseNdvi[i] = r.ndvi[i] + (ds.water[i] ? 0 : sV * yrs);
    baseNdbi[i] = r.ndbi[i] + (ds.water[i] ? 0 : sB * yrs);
  }
  const lst = Float32Array.from(baseLst);
  let cnt = 0, bL = 0, bV = 0, bB = 0, bveg = 0, bbuilt = 0, aL = 0, aV = 0, aB = 0, aveg = 0, abuilt = 0, dVeg = 0, dBuilt = 0;
  let coverWarning = false;
  for (let i = 0; i < ds.n; i++) {
    if (ds.zoneIndex[i] !== inp.zoneIndex || ds.water[i]) continue;
    cnt++;
    const veg0 = clamp(r.veg[i] + (yrs ? (baseNdvi[i] - r.ndvi[i]) / 0.72 : 0), 0, 1);
    const built0 = clamp(r.built[i] + (yrs ? (baseNdbi[i] - r.ndbi[i]) / 0.75 : 0), 0, 1);
    const veg1 = clamp(veg0 + inp.vegDeltaPct / 100, 0, 0.95);
    const built1 = clamp(built0 + inp.builtDeltaPct / 100, 0, 1);
    if (veg1 + built1 > 1.05) coverWarning = true;
    const dN = 0.72 * (veg1 - veg0);
    const dB = 0.75 * (built1 - built0);
    const dLv = reg.bNdvi * dN;
    const dLb = reg.bNdbi * dB;
    lst[i] = baseLst[i] + dLv + dLb;
    bL += baseLst[i]; bV += baseNdvi[i]; bB += baseNdbi[i]; bveg += veg0; bbuilt += built0;
    aL += lst[i]; aV += baseNdvi[i] + dN; aB += baseNdbi[i] + dB; aveg += veg1; abuilt += built1;
    dVeg += dLv; dBuilt += dLb;
  }
  const c = cnt || 1;
  const zoneBefore = { lst: bL / c, ndvi: bV / c, ndbi: bB / c, veg: bveg / c, built: bbuilt / c };
  const zoneAfter = { lst: aL / c, ndvi: aV / c, ndbi: aB / c, veg: aveg / c, built: abuilt / c };
  const dLst = zoneAfter.lst - zoneBefore.lst;
  return {
    lst, baseLst, zoneBefore, zoneAfter, dLst,
    dLstVeg: dVeg / c, dLstBuilt: dBuilt / c,
    cityDLst: (dLst * cnt) / ds.n,
    uncertainty: Math.abs(dLst) * 0.18 + reg.rmse * 0.12,
    coverWarning,
  };
}

export const fmt = {
  temp: (v: number, d = 1) => `${v.toFixed(d)}°C`,
  delta: (v: number, d = 1, unit = "") => `${v > 0 ? "+" : ""}${v.toFixed(d)}${unit}`,
  idx: (v: number) => v.toFixed(3),
  km2: (v: number) => `${v.toFixed(1)} km²`,
  pct: (v: number, d = 0) => `${(v * 100).toFixed(d)}%`,
};

