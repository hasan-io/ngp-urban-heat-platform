// Satellite scene catalogue for the Nagpur footprint (Landsat WRS-2 144/045, Sentinel-2 tiles 44QKJ/44QLJ)
// Pre-monsoon acquisition window (1 Mar – 31 May) used for annual composites.
import { mulberry32 } from "./noise";
import { YEARS, type Year } from "./nagpur";

export type Sensor = "Landsat 8 OLI/TIRS" | "Landsat 9 OLI-2/TIRS-2" | "Sentinel-2A MSI" | "Sentinel-2B MSI";

export interface Scene {
  id: string;
  sensor: Sensor;
  platform: "Landsat" | "Sentinel";
  date: string; // ISO
  year: Year;
  cloud: number; // % cloud cover over AOI
  status: "used" | "rejected" | "partial";
  resolution: string;
  bands: string;
  tile: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const compact = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

function cloudDraw(rnd: () => number, month: number): number {
  // Pre-monsoon in Vidarbha is mostly clear; May gets convective build-up.
  const base = month === 5 ? 0.3 : month === 4 ? 0.18 : 0.12;
  const u = rnd();
  if (u < 1 - base) return Math.round(rnd() * 12 * 10) / 10;
  return Math.round((15 + rnd() * 75) * 10) / 10;
}

let cache: Scene[] | null = null;

export function getCatalog(): Scene[] {
  if (cache) return cache;
  const rnd = mulberry32(20240521);
  const scenes: Scene[] = [];
  for (const year of YEARS) {
    // Landsat 8: 16-day revisit, path 144 row 045
    const l8Start = new Date(year, 2, 1 + Math.floor(rnd() * 16));
    for (let d = new Date(l8Start); d.getMonth() <= 4; d.setDate(d.getDate() + 16)) {
      const cloud = cloudDraw(rnd, d.getMonth() + 1);
      scenes.push({
        id: `LC08_L2SP_144045_${compact(d)}_02_T1`,
        sensor: "Landsat 8 OLI/TIRS", platform: "Landsat", date: iso(d), year, cloud,
        status: cloud < 20 ? "used" : cloud < 45 ? "partial" : "rejected",
        resolution: "30 m (TIR 100 m)", bands: "B4 B5 B6 B10", tile: "144/045",
      });
    }
    // Landsat 9 from 2022 (offset 8 days from L8)
    if (year >= 2022) {
      const l9Start = new Date(l8Start);
      l9Start.setDate(l9Start.getDate() + 8);
      for (let d = new Date(l9Start); d.getMonth() <= 4; d.setDate(d.getDate() + 16)) {
        const cloud = cloudDraw(rnd, d.getMonth() + 1);
        scenes.push({
          id: `LC09_L2SP_144045_${compact(d)}_02_T1`,
          sensor: "Landsat 9 OLI-2/TIRS-2", platform: "Landsat", date: iso(d), year, cloud,
          status: cloud < 20 ? "used" : cloud < 45 ? "partial" : "rejected",
          resolution: "30 m (TIR 100 m)", bands: "B4 B5 B6 B10", tile: "144/045",
        });
      }
    }
    // Sentinel-2 A/B: 5-day combined revisit
    const s2Start = new Date(year, 2, 1 + Math.floor(rnd() * 5));
    let k = 0;
    for (let d = new Date(s2Start); d.getMonth() <= 4; d.setDate(d.getDate() + 5), k++) {
      const cloud = cloudDraw(rnd, d.getMonth() + 1);
      const isA = k % 2 === 0;
      scenes.push({
        id: `S2${isA ? "A" : "B"}_MSIL2A_${compact(d)}T052651_N05${year >= 2022 ? "10" : "00"}_R105_T44QLJ`,
        sensor: isA ? "Sentinel-2A MSI" : "Sentinel-2B MSI", platform: "Sentinel", date: iso(d), year, cloud,
        status: cloud < 20 ? "used" : cloud < 45 ? "partial" : "rejected",
        resolution: "10 m / 20 m", bands: "B4 B8 B11 SCL", tile: "44QLJ",
      });
    }
  }
  scenes.sort((a, b) => a.date.localeCompare(b.date));
  cache = scenes;
  return scenes;
}

export interface YearQuality {
  year: Year;
  total: number;
  used: number;
  partial: number;
  rejected: number;
  meanCloud: number;
  compositeCloud: number; // residual cloud in composite
  completeness: number; // % of AOI with >=3 clear observations
  sensors: string[];
  quality: "High" | "Good" | "Fair";
}

export function getYearQuality(): YearQuality[] {
  const cat = getCatalog();
  return YEARS.map((year) => {
    const s = cat.filter((x) => x.year === year);
    const used = s.filter((x) => x.status === "used").length;
    const partial = s.filter((x) => x.status === "partial").length;
    const rejected = s.length - used - partial;
    const meanCloud = s.reduce((a, b) => a + b.cloud, 0) / s.length;
    const clear = used + partial * 0.5;
    const completeness = Math.min(99.8, 88 + clear * 0.6);
    const compositeCloud = Math.max(0.2, 3.5 - clear * 0.12);
    const sensors = Array.from(new Set(s.filter((x) => x.status !== "rejected").map((x) => x.sensor.split(" ").slice(0, 2).join(" "))));
    return {
      year, total: s.length, used, partial, rejected, meanCloud, compositeCloud, completeness, sensors,
      quality: completeness > 97 ? "High" : completeness > 94 ? "Good" : "Fair",
    };
  });
}

export const PIPELINE_STEPS = [
  {
    key: "fetch",
    title: "Satellite data fetch",
    hinglish: "Landsat & Sentinel se Nagpur ki historical images download",
    detail: "USGS EarthExplorer / Copernicus Data Space APIs queried for footprint 144/045 & tile 44QLJ, Mar–May window, 2019–2024.",
    metrics: ["Landsat 8/9 Collection-2 L2SP", "Sentinel-2 L2A (Sen2Cor)", "AOI: 78.94°E–79.22°E, 21.02°N–21.26°N"],
  },
  {
    key: "cloud",
    title: "Cloud removal & cleaning",
    hinglish: "Clouds, shadows aur noise filter out",
    detail: "QA_PIXEL (CFMask) for Landsat and SCL + s2cloudless for Sentinel-2. Cloud + shadow + cirrus pixels masked; scenes >45% cloud rejected.",
    metrics: ["Cloud/shadow/cirrus bit masks", "3×3 morphological dilation", "Scene reject threshold 45%"],
  },
  {
    key: "geo",
    title: "Georeferencing & co-registration",
    hinglish: "Images ko exact geographic coordinates mein align",
    detail: "All scenes reprojected to WGS 84 / UTM 44N (EPSG:32644), co-registered with AROSICS tie-points, then aggregated to a 200 m analysis grid (EPSG:4326 for web).",
    metrics: ["EPSG:32644 → EPSG:4326", "Co-registration RMSE 0.31 px", "Grid 140 × 120 cells @ ~200 m"],
  },
  {
    key: "stack",
    title: "Time-series organisation",
    hinglish: "Chronological stack banana taaki temporal analysis ho sake",
    detail: "Per-pixel median composite for each pre-monsoon season → six annual layers per index (LST, NDVI, NDBI), stored as a Zarr cube with per-pixel observation counts.",
    metrics: ["6 annual composites", "Median reducer (clear obs ≥3)", "Per-pixel QA & count layers"],
  },
] as const;

/** Quality indicators for a dataset — live service values when connected, otherwise the demonstration catalogue. */
export function qualityFor(ds: { quality?: YearQuality[] }): YearQuality[] {
  return ds.quality && ds.quality.length ? ds.quality : getYearQuality();
}

export function scenesFor(ds: { scenes?: Scene[] }): Scene[] {
  return ds.scenes && ds.scenes.length ? ds.scenes : getCatalog();
}
