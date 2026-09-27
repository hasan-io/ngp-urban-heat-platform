/**
 * Administrative boundaries for the area selector.
 *
 * Files under this directory are generated once by `scripts/fetch-boundaries.mjs`
 * from geoBoundaries (CC-BY 4.0) — https://www.geoboundaries.org — and committed
 * to the repo. No runtime fetch is performed.
 *
 * Vidarbha Region is the actual union of 11 districts:
 *   Amravati, Akola, Bhandara, Buldhana, Chandrapur, Gadchiroli,
 *   Gondia, Nagpur, Wardha, Washim, Yavatmal.
 */
import nagpurRaw from "./nagpur.geojson?raw";
import bhandaraRaw from "./bhandara.geojson?raw";
import yavatmalRaw from "./yavatmal.geojson?raw";
import chandrapurRaw from "./chandrapur.geojson?raw";
import vidarbhaRaw from "./vidarbha.geojson?raw";

export type AreaKey = "nagpur" | "bhandara" | "yavatmal" | "chandrapur" | "vidarbha";

export interface AreaMeta {
  key: AreaKey;
  label: string;
  /** Whether the current data pipeline has raster coverage for this area. */
  hasRaster: boolean;
}

export const AREAS: AreaMeta[] = [
  { key: "nagpur",     label: "Nagpur",          hasRaster: true  },
  { key: "bhandara",   label: "Bhandara",        hasRaster: true  },
  { key: "yavatmal",   label: "Yavatmal",        hasRaster: true  },
  { key: "chandrapur", label: "Chandrapur",      hasRaster: true  },
  { key: "vidarbha",   label: "Vidarbha Region", hasRaster: true  },
];

// ------------------------------------------------------------------ geometry types
type Ring = [number, number][]; // [lon, lat] — GeoJSON order
interface PolygonGeom { type: "Polygon"; coordinates: Ring[] }
type Geom = PolygonGeom;

const RAW: Record<AreaKey, string> = {
  nagpur: nagpurRaw,
  bhandara: bhandaraRaw,
  yavatmal: yavatmalRaw,
  chandrapur: chandrapurRaw,
  vidarbha: vidarbhaRaw,
};

function parseGeometries(key: AreaKey): Geom[] {
  let json: unknown;
  try { json = JSON.parse(RAW[key]); } catch { return []; }
  const fc = json as { type?: string; features?: unknown[] };
  const features: any[] = fc.type === "FeatureCollection" ? (fc.features ?? []) : [json];
  const out: Geom[] = [];
  for (const f of features) {
    const g = f?.geometry ?? f;
    if (!g?.type) continue;
    if (g.type === "Polygon") {
      out.push({ type: "Polygon", coordinates: g.coordinates });
    } else if (g.type === "MultiPolygon") {
      for (const coords of g.coordinates) out.push({ type: "Polygon", coordinates: coords });
    } else if (g.type === "GeometryCollection") {
      for (const inner of g.geometries ?? []) {
        if (inner.type === "Polygon") out.push({ type: "Polygon", coordinates: inner.coordinates });
        else if (inner.type === "MultiPolygon") for (const c of inner.coordinates) out.push({ type: "Polygon", coordinates: c });
      }
    }
  }
  return out;
}

const POLYGONS: Record<AreaKey, Geom[]> = {
  nagpur: parseGeometries("nagpur"),
  bhandara: parseGeometries("bhandara"),
  yavatmal: parseGeometries("yavatmal"),
  chandrapur: parseGeometries("chandrapur"),
  vidarbha: parseGeometries("vidarbha"),
};

// ------------------------------------------------------------------ public accessors
export function getPolygons(key: AreaKey): Geom[] {
  return POLYGONS[key] ?? [];
}

/** Leaflet-friendly outer rings: [lat, lon][]. */
export function getLeafletRings(key: AreaKey): [number, number][][] {
  const rings: [number, number][][] = [];
  for (const poly of getPolygons(key)) {
    const outer = poly.coordinates[0];
    if (outer?.length) rings.push(outer.map(([lon, lat]) => [lat, lon] as [number, number]));
  }
  return rings;
}

/** Bounding box [west, south, east, north] or null when no boundary is loaded. */
export function getBbox(key: AreaKey): [number, number, number, number] | null {
  const polys = getPolygons(key);
  if (!polys.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const poly of polys) {
    for (const ring of poly.coordinates) {
      for (const [lon, lat] of ring) {
        if (lon < w) w = lon;
        if (lat < s) s = lat;
        if (lon > e) e = lon;
        if (lat > n) n = lat;
      }
    }
  }
  return [w, s, e, n];
}

// ------------------------------------------------------------------ masking
function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const hit = (yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function pointInPolygons(lon: number, lat: number, polys: Geom[]): boolean {
  for (const poly of polys) {
    const [outer, ...holes] = poly.coordinates;
    if (!outer || !pointInRing(lon, lat, outer)) continue;
    let inHole = false;
    for (const hole of holes) if (pointInRing(lon, lat, hole)) { inHole = true; break; }
    if (!inHole) return true;
  }
  return false;
}

const MASK_CACHE = new Map<string, Uint8Array>();

/**
 * Build a per-cell mask (1 = inside area, 0 = outside) for a raster of size w × h.
 * `latLonAt(i)` returns the [lat, lon] of cell i — pass a closure over the dataset's
 * own lat/lon arrays so district datasets (which do not share the global BOUNDS) work.
 * Results are cached per (area, grid size, dataset id).
 */
export function buildMask(
  w: number,
  h: number,
  key: AreaKey,
  latLonAt: (i: number) => [number, number],
): Uint8Array {
  const cacheKey = `${key}:${w}x${h}`;
  const cached = MASK_CACHE.get(cacheKey);
  if (cached) return cached;

  const polys = getPolygons(key);
  const mask = new Uint8Array(w * h);
  if (!polys.length) { MASK_CACHE.set(cacheKey, mask); return mask; }

  const bbox = getBbox(key);
  for (let i = 0; i < w * h; i++) {
    const [lat, lon] = latLonAt(i);
    if (bbox && (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3])) continue;
    if (pointInPolygons(lon, lat, polys)) mask[i] = 1;
  }
  MASK_CACHE.set(cacheKey, mask);
  return mask;
}