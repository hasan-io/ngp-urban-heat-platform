// Colour ramps and raster -> ImageData rendering.
import type { Dataset, Metric } from "./engine";

export type LayerKey = Metric | "dlst" | "dndvi" | "dndbi" | "hotspot" | "scenario" | "cluster";

type RGB = [number, number, number];
interface Ramp {
  domain: [number, number];
  stops: { t: number; c: RGB }[];
  unit: string;
  label: string;
  ticks: number[];
  palette?: string[]; // categorical layers: value → palette[round(value)]
}

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export const RAMPS: Record<LayerKey, Ramp> = {
  lst: {
    domain: [30, 47],
    stops: [
      { t: 0, c: hex("#1e3a8a") }, { t: 0.18, c: hex("#0ea5e9") }, { t: 0.36, c: hex("#22c55e") },
      { t: 0.54, c: hex("#facc15") }, { t: 0.72, c: hex("#f97316") }, { t: 0.88, c: hex("#dc2626") }, { t: 1, c: hex("#7f1d1d") },
    ],
    unit: "°C", label: "Land Surface Temperature", ticks: [30, 34, 38, 42, 47],
  },
  ndvi: {
    domain: [-0.1, 0.8],
    stops: [
      { t: 0, c: hex("#7c2d12") }, { t: 0.2, c: hex("#d6a35c") }, { t: 0.42, c: hex("#d9f99d") },
      { t: 0.62, c: hex("#4ade80") }, { t: 0.82, c: hex("#15803d") }, { t: 1, c: hex("#052e16") },
    ],
    unit: "", label: "Vegetation Index (NDVI)", ticks: [-0.1, 0.2, 0.4, 0.6, 0.8],
  },
  ndbi: {
    domain: [-0.45, 0.5],
    stops: [
      { t: 0, c: hex("#0f766e") }, { t: 0.3, c: hex("#a7f3d0") }, { t: 0.48, c: hex("#f1f5f9") },
      { t: 0.68, c: hex("#fb923c") }, { t: 0.86, c: hex("#c026d3") }, { t: 1, c: hex("#4a044e") },
    ],
    unit: "", label: "Built-up Index (NDBI)", ticks: [-0.4, -0.2, 0, 0.2, 0.5],
  },
  dlst: {
    domain: [-4, 4],
    stops: [{ t: 0, c: hex("#1d4ed8") }, { t: 0.5, c: hex("#f8fafc") }, { t: 1, c: hex("#b91c1c") }],
    unit: "°C", label: "Δ LST", ticks: [-4, -2, 0, 2, 4],
  },
  dndvi: {
    domain: [-0.3, 0.3],
    stops: [{ t: 0, c: hex("#9a3412") }, { t: 0.5, c: hex("#f8fafc") }, { t: 1, c: hex("#15803d") }],
    unit: "", label: "Δ NDVI", ticks: [-0.3, -0.15, 0, 0.15, 0.3],
  },
  dndbi: {
    domain: [-0.3, 0.3],
    stops: [{ t: 0, c: hex("#0e7490") }, { t: 0.5, c: hex("#f8fafc") }, { t: 1, c: hex("#7e22ce") }],
    unit: "", label: "Δ NDBI", ticks: [-0.3, -0.15, 0, 0.15, 0.3],
  },
  hotspot: {
    domain: [0, 6],
    stops: [{ t: 0, c: hex("#0f172a") }, { t: 0.5, c: hex("#f59e0b") }, { t: 1, c: hex("#dc2626") }],
    unit: " yrs", label: "Hotspot persistence (years in top 10%)", ticks: [0, 2, 4, 6],
  },
  scenario: {
    domain: [30, 47],
    stops: [
      { t: 0, c: hex("#1e3a8a") }, { t: 0.18, c: hex("#0ea5e9") }, { t: 0.36, c: hex("#22c55e") },
      { t: 0.54, c: hex("#facc15") }, { t: 0.72, c: hex("#f97316") }, { t: 0.88, c: hex("#dc2626") }, { t: 1, c: hex("#7f1d1d") },
    ],
    unit: "°C", label: "Scenario LST", ticks: [30, 34, 38, 42, 47],
  },
  cluster: {
    domain: [0, 12],
    stops: [{ t: 0, c: hex("#0f172a") }, { t: 1, c: hex("#f8fafc") }],
    unit: "", label: "Cluster id", ticks: [0, 4, 8, 12],
    palette: ["#0f172a", "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#f43f5e", "#84cc16", "#14b8a6", "#8b5cf6"],
  },
};

export function paletteColor(palette: string[], v: number): RGB {
  return hex(palette[Math.min(palette.length - 1, Math.max(0, Math.round(v)))]);
}

export function rampColor(key: LayerKey, v: number): RGB {
  const r = RAMPS[key];
  if (r.palette) return paletteColor(r.palette, v);
  const t = Math.min(1, Math.max(0, (v - r.domain[0]) / (r.domain[1] - r.domain[0])));
  const s = r.stops;
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i].t) {
      const f = (t - s[i - 1].t) / (s[i].t - s[i - 1].t || 1);
      const a = s[i - 1].c, b = s[i].c;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
  }
  return s[s.length - 1].c;
}

const rgbCss = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
export const rampCss = (key: LayerKey, v: number) => rgbCss(rampColor(key, v));

export function rampGradient(key: LayerKey): string {
  const r = RAMPS[key];
  return `linear-gradient(90deg, ${r.stops.map((s) => `${rgbCss(s.c)} ${(s.t * 100).toFixed(0)}%`).join(", ")})`;
}

/** Render a raster into ImageData. Water is painted a fixed dark blue unless the layer is a delta layer. */
export function rasterToImageData(
  ds: Dataset,
  values: Float32Array | Uint8Array,
  key: LayerKey,
  opts: { alpha?: number; waterColor?: RGB | null; highlight?: (i: number) => number; palette?: string[] } = {},
): ImageData {
  const img = new ImageData(ds.w, ds.h);
  const d = img.data;
  const alpha = Math.round((opts.alpha ?? 1) * 255);
  const waterColor = opts.waterColor === undefined ? hex("#0c2a4a") : opts.waterColor;
  for (let i = 0; i < ds.n; i++) {
    let c: RGB;
    if (ds.water[i] && waterColor) c = waterColor;
    else if (opts.palette) c = paletteColor(opts.palette, values[i]);
    else c = rampColor(key, values[i]);
    let a = alpha;
    if (opts.highlight) a = Math.round(a * opts.highlight(i));
    const o = i * 4;
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = a;
  }
  return img;
}

export function imageDataToDataUrl(img: ImageData): string {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c.toDataURL();
}

export const METRIC_META: Record<Metric, { label: string; short: string; unit: string; color: string; decimals: number }> = {
  lst: { label: "Land Surface Temperature", short: "LST", unit: "°C", color: "#f97316", decimals: 1 },
  ndvi: { label: "Vegetation Index", short: "NDVI", unit: "", color: "#22c55e", decimals: 3 },
  ndbi: { label: "Built-up Index", short: "NDBI", unit: "", color: "#c084fc", decimals: 3 },
};
