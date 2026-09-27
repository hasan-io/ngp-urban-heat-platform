/**
 * Synthetic dataset generator for non-Nagpur districts.
 *
 * Uses the same physics-motivated land-cover model as the Nagpur demo,
 * with a per-district calibration (urban fraction, forest bias, industrial heat).
 * Data source is labelled "demo" with the district name — the platform's
 * existing demonstration-data badge applies automatically.
 */
import { buildDataset, type Dataset, type DatasetInput, type YearRasters } from "./engine";
import { YEARS, YEAR_ANOMALY, LST_TREND_PER_YEAR, KM_PER_DEG_LAT, KM_PER_DEG_LON, type Year } from "./nagpur";
import { getBbox, type AreaKey } from "./boundaries";
import { fbm, hash2 } from "./noise";

interface DistrictConfig {
  label: string;
  urbanFraction: number;
  forestBias: number;
  industrialHeat: number;
  lstBase: number;
}

const CONFIGS: Record<Exclude<AreaKey, "nagpur">, DistrictConfig> = {
  bhandara:   { label: "Bhandara",        urbanFraction: 0.10, forestBias: 0.55, industrialHeat: 1.2, lstBase: 40.8 },
  yavatmal:   { label: "Yavatmal",        urbanFraction: 0.08, forestBias: 0.35, industrialHeat: 0.8, lstBase: 41.2 },
  chandrapur: { label: "Chandrapur",      urbanFraction: 0.14, forestBias: 0.45, industrialHeat: 2.4, lstBase: 41.5 },
  vidarbha:   { label: "Vidarbha Region", urbanFraction: 0.06, forestBias: 0.40, industrialHeat: 1.6, lstBase: 41.0 },
};

function generateDistrictInput(key: Exclude<AreaKey, "nagpur">): DatasetInput | null {
  const cfg = CONFIGS[key];
  const bbox = getBbox(key);
  if (!bbox) return null;

  const [west, south, east, north] = bbox;
  const latSpanKm = (north - south) * KM_PER_DEG_LAT;
  const lonSpanKm = (east - west) * KM_PER_DEG_LON;

  // Target ~500 m cells for districts; cap at 280 per axis to keep generation fast.
  const targetKm = 0.5;
  const w = Math.max(60, Math.min(280, Math.round(lonSpanKm / targetKm)));
  const h = Math.max(60, Math.min(280, Math.round(latSpanKm / targetKm)));
  const n = w * h;

  const lat = new Float32Array(n);
  const lon = new Float32Array(n);
  const water = new Uint8Array(n);
  const centreLat = (south + north) / 2;
  const centreLon = (west + east) / 2;

  for (let i = 0; i < n; i++) {
    const col = i % w;
    const row = Math.floor(i / w);
    lon[i] = west + ((col + 0.5) / w) * (east - west);
    lat[i] = north - ((row + 0.5) / h) * (north - south);
  }

  const rasters: Record<Year, YearRasters> = {} as Record<Year, YearRasters>;
  for (const y of YEARS) {
    const t = Math.pow((y - 2019) / 5, 0.9);
    const an = YEAR_ANOMALY[y];
    const ndvi = new Float32Array(n);
    const ndbi = new Float32Array(n);
    const lst = new Float32Array(n);
    const veg = new Float32Array(n);
    const built = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const x = (lon[i] - centreLon) * KM_PER_DEG_LON;
      const yk = (lat[i] - centreLat) * KM_PER_DEG_LAT;

      const distFromCentre = Math.hypot(x, yk) / Math.max(latSpanKm, lonSpanKm);
      const coreStrength = Math.exp(-(distFromCentre * distFromCentre) / (cfg.urbanFraction * cfg.urbanFraction * 2));

      const fN = fbm(x / 4, yk / 4, 11, 4);
      const forest = Math.max(0, Math.min(1, (fN - 0.35) * cfg.forestBias * 3));

      const roadNoise = fbm(x / 8, yk / 8, 23, 3);
      const roadFactor = roadNoise > 0.65 ? 0.4 : 0.15;
      const builtFrac = Math.min(1, coreStrength * (1 + 0.05 * t) * 0.85 + roadFactor * (1 - forest));
      const vegFrac = Math.max(0, Math.min(1, forest * 0.75 + (1 - builtFrac) * 0.35));

      if (fN > 0.82 && builtFrac < 0.15 && hash2(i, 999, 5) > 0.85) water[i] = 1;

      if (water[i]) {
        ndvi[i] = -0.10 + 0.03 * fbm(x, yk, 5, 2);
        ndbi[i] = -0.45 + 0.04 * fbm(x, yk, 6, 2);
        lst[i] = 30.2 + 0.12 * (y - 2019) + an.lst * 0.4;
        veg[i] = 0; built[i] = 0;
        continue;
      }

      veg[i] = vegFrac;
      built[i] = builtFrac;
      ndvi[i] = Math.max(-0.05, Math.min(0.9, 0.06 + 0.72 * vegFrac + 0.04 * fbm(x, yk, 41, 3)));
      ndbi[i] = Math.max(-0.5, Math.min(0.7, -0.32 + 0.75 * builtFrac + 0.06 * fbm(x, yk, 51, 3)));

      const nd = Math.max(0, ndvi[i]);
      lst[i] =
        cfg.lstBase +
        cfg.industrialHeat * coreStrength +
        8.0 * ndbi[i] +
        1.8 / (1 + Math.exp(-(ndbi[i] - 0.15) / 0.07)) -
        10.5 * (1 - Math.exp(-2.0 * nd)) +
        LST_TREND_PER_YEAR * (y - 2019) + an.lst +
        2.0 * fbm(x, yk, 61 + y, 4) + 0.9 * (hash2(i, y, 999) * 2 - 1);
    }

    rasters[y] = { ndvi, ndbi, lst, veg, built };
  }

  const cellAreaKm2 = ((east - west) / w) * KM_PER_DEG_LON * (((north - south) / h) * KM_PER_DEG_LAT);

  return {
    id: `demo:${key}`,
    source: "demo",
    label: `Demonstration — ${cfg.label}`,
    w, h, lat, lon, water, rasters,
    cellAreaKm2,
    meta: {
      serviceSource: "synthetic",
      gridResM: Math.round(Math.sqrt(cellAreaKm2) * 1000),
      note: `Synthetic pre-monsoon composites for ${cfg.label} (2019–2024).`,
    },
  };
}

const CACHE = new Map<AreaKey, Dataset>();

export function getDistrictDataset(key: AreaKey): Dataset | null {
  if (key === "nagpur") return null;
  const cached = CACHE.get(key);
  if (cached) return cached;

  const inp = generateDistrictInput(key);
  if (!inp) return null;

  const ds = buildDataset(inp);
  CACHE.set(key, ds);
  return ds;
}