import { useEffect, useMemo, useRef } from "react";
import { getDataset, type Dataset } from "@/data/engine";
import { rasterToImageData, type LayerKey } from "@/data/colors";
import { BOUNDS, LANDMARKS, ZONES } from "@/data/nagpur";
import { cn } from "@/utils/cn";

interface RasterCanvasProps {
  values: Float32Array | Uint8Array;
  layer: LayerKey;
  className?: string;
  showZones?: boolean;
  highlightZone?: number | null;
  selectedZones?: number[];
  showLabels?: boolean;
  labelKinds?: string[];
  dimOutside?: number | null; // dim everything outside this zone
  marker?: [number, number] | null; // lat, lon
  onClick?: (cell: number, lat: number, lon: number) => void;
  waterColor?: null;
  title?: string;
  alpha?: number;
  palette?: string[]; // categorical rendering (overrides the ramp)
  /** Light scientific theme (defaults to true on Explore / Analysis). */
  light?: boolean;
}

function project(lat: number, lon: number, w: number, h: number): [number, number] {
  return [((lon - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * w, ((BOUNDS.north - lat) / (BOUNDS.north - BOUNDS.south)) * h];
}

export function drawOverlays(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  opts: {
    showZones?: boolean;
    highlightZone?: number | null;
    selectedZones?: number[];
    showLabels?: boolean;
    labelKinds?: string[];
    marker?: [number, number] | null;
    scale: number;
    light?: boolean;
  },
) {
  const s = opts.scale;
  const light = opts.light ?? true;
  if (opts.showZones) {
    ZONES.forEach((z, zi) => {
      const sel = opts.selectedZones?.indexOf(zi) ?? -1;
      const hl = opts.highlightZone === zi;
      ctx.beginPath();
      z.poly.forEach((p, k) => {
        const [x, y] = project(p[0], p[1], W, H);
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
      if (hl || sel >= 0) {
        // Zone A → orange (heat), Zone B → green (vegetation). Matches the panel below.
        ctx.fillStyle = sel === 0
          ? "rgba(255,107,53,0.16)"
          : sel === 1
            ? "rgba(16,185,129,0.16)"
            : light
              ? "rgba(15,23,42,0.08)"
              : "rgba(255,255,255,0.12)";
        ctx.fill();
      }
      ctx.lineWidth = (hl || sel >= 0 ? 2.2 : 0.9) * s;
      ctx.strokeStyle = sel === 0
        ? "#FF6B35"
        : sel === 1
          ? "#10B981"
          : hl
            ? light ? "#0f172a" : "#ffffff"
            : light ? "rgba(15,23,42,0.45)" : "rgba(255,255,255,0.45)";
      ctx.setLineDash(hl || sel >= 0 ? [] : [3 * s, 3 * s]);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }
  if (opts.showLabels) {
    ctx.font = `${10 * s}px ui-sans-serif, system-ui`;
    ctx.textBaseline = "middle";
    for (const lm of LANDMARKS) {
      if (opts.labelKinds && !opts.labelKinds.includes(lm.kind)) continue;
      const [x, y] = project(lm.lat, lm.lon, W, H);
      // Marker dot
      ctx.fillStyle = light ? "#0f172a" : "rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.arc(x, y, 2.2 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = light ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.6)";
      ctx.lineWidth = 1 * s;
      ctx.stroke();
      // Label pill (light: white bg + dark text; dark: near-black bg + light text)
      const tw = ctx.measureText(lm.name).width;
      ctx.fillStyle = light ? "rgba(255,255,255,0.92)" : "rgba(2,6,23,0.72)";
      ctx.fillRect(x + 5 * s, y - 7 * s, tw + 6 * s, 14 * s);
      ctx.strokeStyle = light ? "rgba(15,23,42,0.18)" : "rgba(255,255,255,0.10)";
      ctx.lineWidth = 0.8 * s;
      ctx.strokeRect(x + 5 * s, y - 7 * s, tw + 6 * s, 14 * s);
      ctx.fillStyle = light ? "#0f172a" : "#f8fafc";
      ctx.fillText(lm.name, x + 8 * s, y);
    }
  }
  if (opts.marker) {
    const [x, y] = project(opts.marker[0], opts.marker[1], W, H);
    ctx.beginPath();
    ctx.arc(x, y, 6 * s, 0, Math.PI * 2);
    ctx.strokeStyle = light ? "#0f172a" : "#fff";
    ctx.lineWidth = 2 * s;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 2 * s, 0, Math.PI * 2);
    ctx.fillStyle = light ? "#0f172a" : "#fff";
    ctx.fill();
  }
}

export default function RasterCanvas(props: RasterCanvasProps) {
  const { values, layer, className, showZones, highlightZone, selectedZones, showLabels, labelKinds, dimOutside, marker, onClick, alpha, light = true } = props;
  const ds: Dataset = useMemo(() => getDataset(), []);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const offscreen = useMemo(() => {
    const img = rasterToImageData(ds, values, layer, {
      alpha: alpha ?? 1,
      waterColor: props.waterColor === null ? null : undefined,
      highlight: dimOutside != null ? (i) => (ds.zoneIndex[i] === dimOutside ? 1 : 0.35) : undefined,
      palette: props.palette,
    });
    const c = document.createElement("canvas");
    c.width = ds.w;
    c.height = ds.h;
    c.getContext("2d")!.putImageData(img, 0, 0);
    return c;
  }, [ds, values, layer, dimOutside, alpha, props.waterColor, props.palette]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const draw = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(1, Math.round(rect.width * dpr));
      const H = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // Light scientific theme: paper-white backdrop instead of near-black.
      ctx.fillStyle = light ? "#ffffff" : "#020617";
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(offscreen, 0, 0, W, H);
      drawOverlays(ctx, W, H, { showZones, highlightZone, selectedZones, showLabels, labelKinds, marker, scale: dpr * (rect.width / 520) * 0.9 + 0.4, light });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [offscreen, showZones, highlightZone, selectedZones, showLabels, labelKinds, marker, light]);

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative aspect-[7/6] w-full overflow-hidden rounded-xl border",
        light ? "border-slate-200 bg-white" : "border-white/10 bg-slate-950",
        onClick && "cursor-crosshair",
        className,
      )}
      onClick={(e) => {
        if (!onClick) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const fx = (e.clientX - rect.left) / rect.width;
        const fy = (e.clientY - rect.top) / rect.height;
        const lon = BOUNDS.west + fx * (BOUNDS.east - BOUNDS.west);
        const lat = BOUNDS.north - fy * (BOUNDS.north - BOUNDS.south);
        const col = Math.min(ds.w - 1, Math.floor(fx * ds.w));
        const row = Math.min(ds.h - 1, Math.floor(fy * ds.h));
        onClick(row * ds.w + col, lat, lon);
      }}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
      {props.title && (
        <span
          className={cn(
            "absolute left-2 top-2 rounded-md px-2 py-0.5 text-[11px] font-medium",
            light ? "border border-slate-200 bg-white/95 text-slate-800" : "bg-black/60 text-slate-100",
          )}
        >
          {props.title}
        </span>
      )}
    </div>
  );
}