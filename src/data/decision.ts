// Decision-support layer: Heat Vulnerability Index, priority register, intervention costing and exports.
import type { Dataset, ZoneStats } from "./engine";
import { ZONES } from "./nagpur";

// ------------------------------------------------------------------ Heat Vulnerability Index
export type Tier = "Critical" | "High" | "Moderate" | "Low";

export interface ZonePriority {
  zone: ZoneStats;
  hvi: number; // 0–100
  tier: Tier;
  components: { exposure: number; persistence: number; trend: number; shade: number; density: number }; // 0–1 each
  drivers: string[];
  intervention: string;
  densityPerKm2: number;
}

const z = (v: number, arr: number[]) => {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sd = Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length) || 1;
  return (v - m) / sd;
};
const unit = (v: number) => 1 / (1 + Math.exp(-1.2 * v)); // squash z-score to 0–1

/** Exposure-weighted HVI. Sensitivity layers (age structure, income, housing) can be appended from census CSVs. */
export function priorityRegister(ds: Dataset, year = 2024 as const): ZonePriority[] {
  const zs = ds.zones.filter((s) => s.cells > 0);
  const lst = zs.map((s) => s.byYear[year].lst);
  const slope = zs.map((s) => s.lstSlope);
  const shade = zs.map((s) => -s.byYear[year].ndvi);
  const dens = zs.map((s) => s.zone.population / Math.max(0.5, s.areaKm2));
  const rows = zs.map((s, i) => {
    const c = {
      exposure: unit(z(lst[i], lst)),
      persistence: s.persistentFrac,
      trend: unit(z(slope[i], slope)),
      shade: unit(z(shade[i], shade)),
      density: unit(z(Math.log(dens[i]), dens.map(Math.log))),
    };
    const raw = 0.35 * c.exposure + 0.2 * c.persistence + 0.15 * c.trend + 0.15 * c.shade + 0.15 * c.density;
    return { s, c, raw, dens: dens[i] };
  });
  const min = Math.min(...rows.map((r) => r.raw)), max = Math.max(...rows.map((r) => r.raw));
  return rows
    .map(({ s, c, raw, dens: d }) => {
      const hvi = ((raw - min) / (max - min || 1)) * 100;
      const tier: Tier = hvi >= 75 ? "Critical" : hvi >= 50 ? "High" : hvi >= 25 ? "Moderate" : "Low";
      const drivers: string[] = [];
      if (c.exposure > 0.65) drivers.push("very high surface temperature");
      if (c.persistence > 0.5) drivers.push("persistent hotspot");
      if (c.trend > 0.7) drivers.push("fast warming");
      if (c.shade > 0.65) drivers.push("low canopy");
      if (c.density > 0.65) drivers.push("high population density");
      if (s.dNdbi > 0.08) drivers.push("rapid construction");
      const ch = s.zone.character.toLowerCase();
      let intervention: string;
      if (ch.includes("industrial") || ch.includes("sez")) intervention = "Industrial heat buffers: shelter-belt plantation, cool-roof mandate on sheds, process-heat audits";
      else if (s.dNdbi > 0.08 || ch.includes("boom") || ch.includes("growth") || ch.includes("new layouts")) intervention = "Green-cover conditions in layout sanction (≥ 15 % canopy), avenue trees on new roads, permeable parking";
      else if (c.shade > 0.6 && c.density > 0.6) intervention = "Cool roofs on dense housing, pocket Miyawaki forests on vacant plots, shaded bus stops & markets";
      else if (c.shade > 0.6) intervention = "Street-tree programme and de-paving of medians / footpaths";
      else if (c.persistence > 0.5) intervention = "Cool-roof retrofit of commercial roofs, misting / shade at transit nodes, heat-wave shelters";
      else intervention = "Protect existing canopy and water bodies; monitor";
      return { zone: s, hvi, tier, components: c, drivers, intervention, densityPerKm2: d };
    })
    .sort((a, b) => b.hvi - a.hvi);
}

// ------------------------------------------------------------------ intervention costing
export interface UnitCosts {
  streetTree: number; // ₹ per tree incl. 3-year maintenance
  miyawakiM2: number; // ₹ per m² of dense micro-forest
  depaveM2: number; // ₹ per m² permeable surface conversion
  coolRoofM2: number; // ₹ per m² reflective coating (informational)
}
export const DEFAULT_UNIT_COSTS: UnitCosts = { streetTree: 2500, miyawakiM2: 1200, depaveM2: 1500, coolRoofM2: 220 };

export interface CostEstimate {
  vegAreaM2: number;
  builtAreaM2: number;
  trees: number;
  costVeg: number; // ₹
  costBuilt: number; // ₹
  total: number; // ₹
  perDegree: number | null; // ₹ per °C of zone cooling
  perResident: number;
  method: "trees" | "miyawaki";
}

export function estimateCost(zoneAreaKm2: number, residents: number, vegDeltaPct: number, builtDeltaPct: number, dLst: number, costs: UnitCosts, method: "trees" | "miyawaki"): CostEstimate {
  const vegAreaM2 = Math.max(0, vegDeltaPct / 100) * zoneAreaKm2 * 1e6;
  const builtAreaM2 = Math.max(0, -builtDeltaPct / 100) * zoneAreaKm2 * 1e6;
  const trees = Math.round(vegAreaM2 / 25); // ~25 m² mature canopy per street tree
  const costVeg = method === "trees" ? trees * costs.streetTree : vegAreaM2 * costs.miyawakiM2;
  const costBuilt = builtAreaM2 * costs.depaveM2;
  const total = costVeg + costBuilt;
  return { vegAreaM2, builtAreaM2, trees, costVeg, costBuilt, total, perDegree: dLst < -0.05 ? total / -dLst : null, perResident: residents ? total / residents : 0, method };
}

export const inr = (v: number) => {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(v >= 1e8 ? 0 : 1)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
};

// ------------------------------------------------------------------ exports
function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function exportZonesCsv(ds: Dataset) {
  const reg = priorityRegister(ds);
  const head = ["zone_id", "zone", "character", "population", "area_km2", ...ds.years.flatMap((y) => [`lst_${y}`, `ndvi_${y}`, `ndbi_${y}`]), "d_lst_2019_2024", "d_ndvi_2019_2024", "d_ndbi_2019_2024", "lst_trend_c_per_yr", "persistent_hotspot_share", "hvi", "tier", "lead_intervention"];
  const rows = reg.map((r) => {
    const s = r.zone;
    return [s.zone.id, `"${s.zone.name}"`, `"${s.zone.character}"`, s.zone.population, s.areaKm2.toFixed(2), ...ds.years.flatMap((y) => [s.byYear[y].lst.toFixed(2), s.byYear[y].ndvi.toFixed(3), s.byYear[y].ndbi.toFixed(3)]), s.dLst.toFixed(2), s.dNdvi.toFixed(3), s.dNdbi.toFixed(3), s.lstSlope.toFixed(3), s.persistentFrac.toFixed(3), r.hvi.toFixed(1), r.tier, `"${r.intervention}"`].join(",");
  });
  download(`nagpur_uhi_zones_${stamp()}.csv`, [head.join(","), ...rows].join("\n"), "text/csv");
}

export function exportZonesGeoJson(ds: Dataset) {
  const reg = priorityRegister(ds);
  const fc = {
    type: "FeatureCollection",
    name: "nagpur_uhi_zones",
    crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
    features: reg.map((r) => {
      const s = r.zone;
      const zdef = ZONES[s.index];
      return {
        type: "Feature",
        id: zdef.id,
        properties: {
          name: zdef.name, character: zdef.character, population: zdef.population, area_km2: +s.areaKm2.toFixed(2),
          lst_2024: +s.byYear[2024].lst.toFixed(2), ndvi_2024: +s.byYear[2024].ndvi.toFixed(3), ndbi_2024: +s.byYear[2024].ndbi.toFixed(3),
          d_lst: +s.dLst.toFixed(2), d_ndvi: +s.dNdvi.toFixed(3), d_ndbi: +s.dNdbi.toFixed(3), lst_trend: +s.lstSlope.toFixed(3),
          persistent_share: +s.persistentFrac.toFixed(3), hvi: +r.hvi.toFixed(1), tier: r.tier, intervention: r.intervention,
        },
        geometry: { type: "Polygon", coordinates: [[...zdef.poly.map((p) => [p[1], p[0]]), [zdef.poly[0][1], zdef.poly[0][0]]]] },
      };
    }),
  };
  download(`nagpur_uhi_zones_${stamp()}.geojson`, JSON.stringify(fc, null, 1), "application/geo+json");
}

export function exportAnalysisJson(ds: Dataset) {
  const out = {
    generated: new Date().toISOString(), dataset: { id: ds.id, source: ds.source, label: ds.label, meta: ds.meta, grid: [ds.h, ds.w], cell_area_km2: ds.cellAreaKm2 },
    city: ds.city, regression: ds.regression, trends: ds.trends,
    zones: ds.zones.map((s) => ({ id: s.zone.id, name: s.zone.name, area_km2: s.areaKm2, by_year: s.byYear, d_lst: s.dLst, d_ndvi: s.dNdvi, d_ndbi: s.dNdbi, lst_slope: s.lstSlope, persistent_fraction: s.persistentFrac })),
    priority_register: priorityRegister(ds).map((r) => ({ zone: r.zone.zone.id, hvi: r.hvi, tier: r.tier, drivers: r.drivers, intervention: r.intervention })),
  };
  download(`nagpur_uhi_analysis_${stamp()}.json`, JSON.stringify(out, null, 1), "application/json");
}
