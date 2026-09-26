import axios from "axios";
import type { Year } from "@/data/nagpur";
import type { ApiEnvelope, InsightsResponse, OverviewResponse, ReportResponse, ScenarioApiResponse, ScenarioRequest, ScatterResponse, TrendResponse } from "./types";
import { mockHotspots, mockInsights, mockOverview, mockReport, mockScenario, mockScatter, mockSeasonalPatterns, mockSensitivity, mockTrends, mockZoneStats } from "./mock";

// Set VITE_API_BASE_URL when the Python service is deployed. Until then every method uses
// the isolated mock adapter below; views never need to know which transport answered.
const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const USE_MOCK = !BASE_URL || (import.meta.env.VITE_USE_MOCK_API as string | undefined) !== "false";
const http = axios.create({ baseURL: BASE_URL, timeout: 12_000, headers: { Accept: "application/json" } });

function envelope<T>(data: T): ApiEnvelope<T> { return { success: true, data, error: null, timestamp: new Date().toISOString() }; }

async function request<T>(url: string, mock: () => Promise<T>, config?: Parameters<typeof http.get>[1]): Promise<ApiEnvelope<T>> {
  if (USE_MOCK) return envelope(await mock());
  const res = await http.get<ApiEnvelope<T>>(url, config);
  if (!res.data.success) throw new Error(res.data.error || "API request failed");
  return res.data;
}

export const uhiApi = {
  overview: (year: Year) => request<OverviewResponse>(`/api/overview?year=${year}`, () => mockOverview(year)),
  dataLayer: (layer: string, year: Year) => request(`/api/data/${layer}?year=${year}`, async () => ({ layer, year })),
  lst: (year: Year) => request(`/api/data/lst?year=${year}`, async () => ({ year })),
  topHotspots: (year: Year, limit = 8) => request(`/api/hotspots/top?year=${year}&limit=${limit}`, () => mockHotspots(year, limit)),
  zones: () => request("/api/zones", async () => ({ source: "mock" })),
  zoneStats: (zoneId: string, year: Year) => request(`/api/zones/${zoneId}/stats?year=${year}`, () => mockZoneStats(zoneId, year)),
  scatter: (kind: "ndvi-lst" | "ndbi-lst", year: Year) => request<ScatterResponse>(`/api/analysis/scatter/${kind}?year=${year}`, () => mockScatter(year, kind === "ndvi-lst" ? "ndvi" : "ndbi")),
  deltaLst: (year1: Year, year2: Year) => request(`/api/data/delta-lst?year1=${year1}&year2=${year2}`, async () => ({ year1, year2 })),
  persistentHotspots: () => request("/api/data/persistent-hotspots?year_range=2019-2024", async () => ({ yearRange: "2019-2024" })),
  trends: () => request<TrendResponse>("/api/analysis/trends", mockTrends),
  insights: (year: Year) => request<InsightsResponse>(`/api/insights/findings?year=${year}`, () => mockInsights(year)),
  hotspotRankings: (year: Year) => request(`/api/insights/hotspot-rankings?year=${year}`, () => mockHotspots(year, 18)),
  seasonalPatterns: (zoneId?: string) => request(`/api/insights/seasonal-patterns${zoneId ? `?zone_id=${zoneId}` : ""}`, () => mockSeasonalPatterns(zoneId)),
  scenario: (body: ScenarioRequest) => USE_MOCK ? mockScenario(body).then(envelope) : http.post<ApiEnvelope<ScenarioApiResponse>>("/api/scenario/predict", body).then((r) => {
    if (!r.data.success) throw new Error(r.data.error || "Scenario API request failed");
    return r.data;
  }),
  sensitivity: (zoneId: string, baseline: "2024" | "2030") => request(`/api/scenario/sensitivity-curve?zone_id=${zoneId}&baseline_year=${baseline}`, () => mockSensitivity(zoneId, baseline)),
  scenarioRasters: (zoneId: string, vegetationChange: number, builtUpChange: number) => request(`/api/scenario/rasters?zone_id=${zoneId}&vegetation_change=${vegetationChange}&built_up_change=${builtUpChange}`, async () => ({ zoneId, vegetationChange, builtUpChange })),
  report: (year: Year) => USE_MOCK ? mockReport(year).then(envelope) : http.post<ApiEnvelope<ReportResponse>>("/api/reports/generate", { year }).then((r) => {
    if (!r.data.success) throw new Error(r.data.error || "Report API request failed");
    return r.data;
  }),
};

export const apiConfig = { baseUrl: BASE_URL || "Mock adapter", usingMock: USE_MOCK };