// Temporary realistic mock service. It deliberately shares the public REST contract with
// the planned Python backend so `client.ts` can switch transport without changing a view.
import { qualityFor } from "@/data/catalog";
import { diffRaster, fmt, getDataset, runScenario, sampleCells, type Metric } from "@/data/engine";
import { priorityRegister } from "@/data/decision";
import { YEARS, type Year } from "@/data/nagpur";
import type { InsightsResponse, HotspotRanking, OverviewResponse, ReportResponse, ScenarioApiResponse, ScenarioRequest, ScatterResponse, TrendResponse } from "./types";

const ds = getDataset();
const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

export async function mockOverview(year: Year): Promise<OverviewResponse> {
  await delay();
  const c = ds.city[year];
  const prev = ds.city[2019];
  const q = qualityFor(ds).find((v) => v.year === year)!;
  let count = 0;
  for (let i = 0; i < ds.n; i++) if (!ds.water[i] && ds.rasters[year].lst[i] >= c.lstP90) count++;
  return {
    year,
    kpis: {
      averageTemperature: c.lstMean,
      maximumTemperature: c.lstMax,
      hotspotCount: count,
      vegetationChange: c.ndviMean - prev.ndviMean,
      averageNdvi: c.ndviMean,
      averageNdbi: c.ndbiMean,
    },
    quality: { label: q.quality, completeness: q.completeness, clearScenes: q.used + q.partial, residualCloud: q.compositeCloud },
    source: "mock",
  };
}

export async function mockHotspots(year: Year, limit = 8): Promise<HotspotRanking[]> {
  await delay();
  return [...ds.zones]
    .map((z) => {
      let peak = -Infinity;
      for (let i = 0; i < ds.n; i++) if (ds.zoneIndex[i] === z.index) peak = Math.max(peak, ds.rasters[year].lst[i]);
      const t = z.byYear[year].lst;
      return {
        rank: 0, zoneId: z.zone.id, zone: z.zone.name, temperature: t, peakTemperature: peak,
        severity: (t >= 43 ? "Critical" : t >= 40.5 ? "High" : "Moderate") as HotspotRanking["severity"],
        persistence: z.persistentFrac, areaKm2: z.areaKm2,
      };
    })
    .sort((a, b) => b.temperature - a.temperature)
    .slice(0, limit)
    .map((h, i) => ({ ...h, rank: i + 1 }));
}

export async function mockScatter(year: Year, x: "ndvi" | "ndbi"): Promise<ScatterResponse> {
  await delay();
  const rows = sampleCells(ds, 850, x === "ndvi" ? 77 : 91);
  const points = rows.map((i) => ({ x: ds.rasters[year][x][i], y: ds.rasters[year].lst[i] }));
  const reg = ds.regression[year];
  const slope = x === "ndvi" ? reg.bNdvi : reg.bNdbi;
  const intercept = reg.a;
  const r = x === "ndvi" ? reg.rNdviLst : reg.rNdbiLst;
  return { year, x, points, equation: `LST = ${intercept.toFixed(2)} ${slope < 0 ? "−" : "+"} ${Math.abs(slope).toFixed(2)}·${x.toUpperCase()}`, intercept, r2: r * r, slope };
}

export async function mockTrends(): Promise<TrendResponse> {
  await delay();
  const city = YEARS.map((year) => ({ year, lst: ds.city[year].lstMean, ndvi: ds.city[year].ndviMean, ndbi: ds.city[year].ndbiMean }));
  const sigma = 0.65;
  const projection = Array.from({ length: 7 }, (_, i) => {
    const year = 2024 + i;
    const lst = year === 2024 ? ds.city[2024].lstMean : ds.trends.lst.intercept + ds.trends.lst.slope * year;
    return { year, lst, lo: lst - sigma * (1 + i * 0.12), hi: lst + sigma * (1 + i * 0.12) };
  });
  return { years: [...YEARS], city, projection };
}

export async function mockInsights(year: Year): Promise<InsightsResponse> {
  await delay();
  const c = ds.city[year];
  const p = priorityRegister(ds);
  const reg = ds.regression[year];
  const hottest = p[0];
  const greenLoss = ds.city[year].greenAreaKm2 - ds.city[2019].greenAreaKm2;
  const q = qualityFor(ds).find((v) => v.year === year)!;
  return {
    year,
    findings: [
      { title: "Structural heat concentration", body: `${hottest.zone.zone.name} is the highest-priority zone (HVI ${hottest.hvi.toFixed(0)}). It combines ${fmt.temp(hottest.zone.byYear[year].lst)} LST, ${fmt.pct(hottest.zone.persistentFrac)} persistent-hotspot share and ~${(hottest.zone.zone.population / 1000).toFixed(0)}k residents.`, tone: "hot" },
      { title: "Canopy–temperature relationship", body: `Across land cells in ${year}, NDVI and LST are inversely related (r = ${reg.rNdviLst.toFixed(2)}). The fitted baseline associates +0.1 NDVI with ${(reg.bNdvi * 0.1).toFixed(2)} °C surface cooling.`, tone: "green" },
      { title: "Built-up expansion", body: `Built-up area (NDBI > 0.10) changed from ${ds.city[2019].builtAreaKm2.toFixed(0)} to ${c.builtAreaKm2.toFixed(0)} km². The strongest growth corridors are Besa, MIHAN, Wathoda and Manish Nagar.`, tone: "violet" },
      { title: "Green-cover change", body: `Area with NDVI > 0.40 changed by ${greenLoss >= 0 ? "+" : ""}${greenLoss.toFixed(0)} km² since 2019; this signal should be assessed alongside monsoon carry-over and on-ground tree inventories.`, tone: "sky" },
    ],
    recommendations: [
      { priority: "Immediate", title: "Prioritise persistent dense hotspots", body: "Deploy cool roofs, shaded transit stops, market-area trees and heat-health outreach before the next pre-monsoon season.", zones: p.filter((x) => x.tier === "Critical").slice(0, 4).map((x) => x.zone.zone.short) },
      { priority: "Near term", title: "Condition growth approvals on cooling performance", body: "Require canopy, permeable parking, shaded streets and roof-albedo targets in rapidly urbanising corridors; monitor construction-driven NDBI change annually.", zones: ["Besa", "MIHAN", "Wathoda", "Manish Nagar"] },
      { priority: "Monitor", title: "Protect cooling assets", body: "Maintain forest, lake and campus canopy; these areas form the city-scale cooling network and should not be treated as surplus land.", zones: ["Gorewada", "Seminary Hills", "Ambazari"] },
    ],
    quality: { label: q.quality, completeness: q.completeness, clearScenes: q.used + q.partial, residualCloud: q.compositeCloud },
  };
}

export async function mockScenario(req: ScenarioRequest): Promise<ScenarioApiResponse> {
  await delay(180);
  const zoneIndex = ds.zones.find((z) => z.zone.id === req.zoneId)?.index ?? 8;
  const r = runScenario(ds, { zoneIndex, vegDeltaPct: req.vegetationChange, builtDeltaPct: req.builtUpChange, baseline: req.baseline });
  const confidence = r.uncertainty < 0.45 ? "High" : r.uncertainty < 0.8 ? "Medium" : "Indicative";
  const drivers = [
    req.vegetationChange ? `${req.vegetationChange > 0 ? "increased" : "reduced"} canopy` : "no canopy change",
    req.builtUpChange ? `${req.builtUpChange > 0 ? "increased" : "reduced"} impervious cover` : "no impervious-cover change",
  ].join(" and ");
  return {
    zoneId: req.zoneId, baseline: req.baseline, deltaLst: r.dLst, confidence, uncertainty: r.uncertainty,
    before: { lst: r.zoneBefore.lst, ndvi: r.zoneBefore.ndvi, ndbi: r.zoneBefore.ndbi },
    after: { lst: r.zoneAfter.lst, ndvi: r.zoneAfter.ndvi, ndbi: r.zoneAfter.ndbi },
    explanation: `The mock model estimates ${Math.abs(r.dLst).toFixed(2)} °C ${r.dLst <= 0 ? "cooling" : "warming"} from ${drivers}; estimate uses historical land-cover relationships and must be replaced by the configured REST model before operational use.`,
    layer: "scenario",
  };
}

export async function mockZoneStats(zoneId: string, year: Year) {
  await delay();
  const z = ds.zones.find((v) => v.zone.id === zoneId) ?? ds.zones[0];
  return { id: z.zone.id, name: z.zone.name, year, stats: z.byYear[year], change: { lst: z.dLst, ndvi: z.dNdvi, ndbi: z.dNdbi }, trend: { lst: z.lstSlope, ndvi: z.ndviSlope, ndbi: z.ndbiSlope }, persistentHotspotFraction: z.persistentFrac };
}

export async function mockSensitivity(zoneId: string, baseline: "2024" | "2030") {
  await delay();
  const zoneIndex = ds.zones.find((z) => z.zone.id === zoneId)?.index ?? 8;
  const points = [];
  for (let vegetationChange = -30; vegetationChange <= 50; vegetationChange += 5) {
    const combined = runScenario(ds, { zoneIndex, vegDeltaPct: vegetationChange, builtDeltaPct: 0, baseline });
    points.push({ vegetationChange, linear: combined.dLst });
  }
  return { zoneId, baseline, points };
}

export async function mockSeasonalPatterns(zoneId?: string) {
  await delay();
  const z = zoneId ? ds.zones.find((v) => v.zone.id === zoneId) : null;
  const series = YEARS.map((year) => ({ year, lst: z ? z.byYear[year].lst : ds.city[year].lstMean, ndvi: z ? z.byYear[year].ndvi : ds.city[year].ndviMean, ndbi: z ? z.byYear[year].ndbi : ds.city[year].ndbiMean }));
  // same shape as GET /api/insights/seasonal-patterns on the Python backend
  return { zoneId: zoneId ?? null, series, uhiIntensity: YEARS.map((year) => ({ year, intensity: ds.zones[0].byYear[year].lst - ds.city[year].lstMean })),
    seasons: [{ season: "Pre-monsoon (Mar–May)", available: true }, { season: "Monsoon (Jun–Sep)", available: false }, { season: "Winter (Nov–Feb)", available: false }] };
}

export async function mockReport(year: Year): Promise<ReportResponse> {
  const [overview, hotspots, insights] = await Promise.all([mockOverview(year), mockHotspots(year, 5), mockInsights(year)]);
  const stamp = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  return {
    id: `NMC-UHI-${year}-${Date.now().toString(36).toUpperCase()}`,
    title: `Nagpur Urban Heat Island Brief — ${year} pre-monsoon composite`,
    generatedAt: stamp,
    period: `1 March–31 May ${year}`,
    sections: [
      { heading: "Executive summary", body: `The ${year} pre-monsoon composite records a city-mean land-surface temperature of ${fmt.temp(overview.kpis.averageTemperature)} and a maximum mapped surface temperature of ${fmt.temp(overview.kpis.maximumTemperature)}. The analysis identifies ${overview.kpis.hotspotCount.toLocaleString()} cells in the annual hottest decile.`, highlights: [`${fmt.temp(overview.kpis.averageTemperature)} city-mean LST`, `${overview.kpis.hotspotCount.toLocaleString()} annual hotspot cells`, `${overview.quality.completeness.toFixed(1)} % composite coverage`] },
      { heading: "Priority hotspots", body: `Persistent hotspot conditions are concentrated in dense commercial, residential and industrial corridors. The top five zones require focused heat-mitigation packages before the next summer season.`, highlights: hotspots.map((h) => `${h.rank}. ${h.zone}: ${fmt.temp(h.temperature)} · ${h.severity}`) },
      { heading: "Planning recommendations", body: insights.recommendations.map((r) => `${r.priority}: ${r.title} — ${r.body} (${r.zones.join(", ")})`).join("\n\n") },
      { heading: "Method note", body: "This brief is based on a seasonal satellite composite and land-surface temperature. It is decision support, not an air-temperature or health-warning product. Validate sites with ward surveys and update with the connected operational data service before procurement." },
    ],
  };
}

export function mockRaster(layer: Metric | "delta-lst" | "persistent-hotspots" | "hotspots", year: Year, year1: Year = 2019): Float32Array {
  if (layer === "delta-lst") return diffRaster(ds, "lst", year1, year);
  if (layer === "persistent-hotspots") return Float32Array.from(ds.hotCount);
  if (layer === "hotspots") {
    const out = new Float32Array(ds.n);
    for (let i = 0; i < ds.n; i++) out[i] = ds.rasters[year].lst[i] >= ds.city[year].lstP90 ? 1 : 0;
    return out;
  }
  return ds.rasters[year][layer];
}