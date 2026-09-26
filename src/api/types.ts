import type { LayerKey } from "@/data/colors";
import type { Metric } from "@/data/engine";
import type { Year } from "@/data/nagpur";

/** API envelope used by the future Python REST service and the current mock adapter. */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error: string | null;
  timestamp: string;
}

export interface OverviewResponse {
  year: Year;
  kpis: {
    averageTemperature: number;
    maximumTemperature: number;
    hotspotCount: number;
    vegetationChange: number;
    averageNdvi: number;
    averageNdbi: number;
  };
  quality: { label: string; completeness: number; clearScenes: number; residualCloud: number };
  source: "mock" | "api";
}

export interface HotspotRanking {
  rank: number;
  zoneId: string;
  zone: string;
  temperature: number;
  peakTemperature: number;
  severity: "Critical" | "High" | "Moderate";
  persistence: number;
  areaKm2: number;
}

export interface ScatterResponse {
  year: Year;
  x: "ndvi" | "ndbi";
  points: { x: number; y: number }[];
  equation: string;
  intercept: number;
  r2: number;
  slope: number;
}

export interface TrendResponse {
  years: Year[];
  city: { year: Year; lst: number; ndvi: number; ndbi: number }[];
  projection: { year: number; lst: number; lo: number; hi: number }[];
}

export interface InsightsResponse {
  year: Year;
  findings: { title: string; body: string; tone: "hot" | "green" | "violet" | "sky" }[];
  recommendations: { priority: "Immediate" | "Near term" | "Monitor"; title: string; body: string; zones: string[] }[];
  quality: { label: string; completeness: number; clearScenes: number; residualCloud: number };
}

export interface ReportResponse {
  id: string;
  title: string;
  generatedAt: string;
  period: string;
  sections: { heading: string; body: string; highlights?: string[] }[];
}

export interface ScenarioRequest {
  zoneId: string;
  baseline: "2024" | "2030";
  vegetationChange: number;
  builtUpChange: number;
}

export interface ScenarioApiResponse {
  zoneId: string;
  baseline: "2024" | "2030";
  deltaLst: number;
  confidence: "High" | "Medium" | "Indicative";
  uncertainty: number;
  before: { lst: number; ndvi: number; ndbi: number };
  after: { lst: number; ndvi: number; ndbi: number };
  explanation: string;
  layer: LayerKey;
}

export type RasterRequestLayer = Metric | "delta-lst" | "persistent-hotspots" | "hotspots";