import { useEffect, useMemo } from "react";
import { CircleMarker, ImageOverlay, MapContainer, Polygon, TileLayer, Tooltip, useMap, useMapEvents, ZoomControl } from "react-leaflet";
import type { LatLngBoundsExpression, LatLngExpression } from "leaflet";
import { Info } from "lucide-react";
import type { Dataset } from "@/data/engine";
import { imageDataToDataUrl, rasterToImageData, type LayerKey } from "@/data/colors";
import { LANDMARKS, ZONES } from "@/data/nagpur";
import { AREAS, buildMask, getBbox, getLeafletRings, type AreaKey } from "@/data/boundaries";
import { useApp } from "@/App";
import AreaSelector from "@/components/AreaSelector";

export type Basemap = "dark" | "streets" | "satellite";

const CARTO_KEY = (import.meta.env.VITE_CARTO_KEY as string | undefined)?.trim();
const carto = (style: string) =>
  `https://basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}.png${CARTO_KEY ? `?key=${CARTO_KEY}` : ""}`;
const CARTO_ATTR = "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors &copy; <a href=\"https://carto.com/attributions\">CARTO</a>";

const TILES: Record<Basemap, { url: string; attribution: string }> = {
  dark: { url: carto("dark_all"), attribution: CARTO_ATTR },
  streets: { url: carto("voyager"), attribution: CARTO_ATTR },
  satellite: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors &copy; Esri, Maxar, Earthstar Geographics" },
};

const LM_COLORS: Record<string, string> = { city: "#f8fafc", water: "#38bdf8", forest: "#4ade80", industry: "#fb7185", transport: "#fbbf24", growth: "#c084fc" };

interface Props {
  ds: Dataset;
  values: Float32Array | Uint8Array;
  layer: LayerKey;
  basemap: Basemap;
  opacity: number;
  showZones: boolean;
  showLandmarks: boolean;
  showZoneLabels: boolean;
  mode: "zones" | "inspect";
  selectedZones: number[];
  inspected: { cell: number; lat: number; lon: number } | null;
  zoneValue: (zi: number) => string;
  onZoneClick: (zi: number) => void;
  onInspect: (lat: number, lon: number) => void;
  palette?: string[];
}

function ClickHandler({ mode, onInspect }: { mode: Props["mode"]; onInspect: Props["onInspect"] }) {
  useMapEvents({
    click(e) {
      if (mode === "inspect") onInspect(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/** Flies the map to the selected area's bounding box whenever it changes. */
function MapController({ area }: { area: AreaKey }) {
  const map = useMap();
  useEffect(() => {
    const bbox = getBbox(area);
    if (!bbox) return;
    const [w, s, e, n] = bbox;
    map.fitBounds([[s, w], [n, e]], { padding: [24, 24], duration: 0.6 });
  }, [area, map]);
  return null;
}

export default function MapView(p: Props) {
  const { selectedArea, setSelectedArea } = useApp();
  const areaMeta = AREAS.find((a) => a.key === selectedArea) ?? AREAS[0];
  const hasRaster = areaMeta.hasRaster;
  const showNagpurOverlays = selectedArea === "nagpur";

  // Image extent derived from the *dataset's own* lat/lon arrays, so district
  // datasets (which don't share the global BOUNDS) render at the correct place.
  const imageBounds: LatLngBoundsExpression = useMemo(() => {
    let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
    const N = p.ds.n;
    for (let i = 0; i < N; i++) {
      const la = p.ds.lat[i];
      const lo = p.ds.lon[i];
      if (la < s) s = la;
      if (la > n) n = la;
      if (lo < w) w = lo;
      if (lo > e) e = lo;
    }
    const halfLat = ((n - s) / Math.max(1, p.ds.h - 1)) / 2;
    const halfLon = ((e - w) / Math.max(1, p.ds.w - 1)) / 2;
    return [[s - halfLat, w - halfLon], [n + halfLat, e + halfLon]];
  }, [p.ds]);

  // Per-cell mask — cells outside the selected area are turned fully transparent.
  const mask = useMemo(
    () => (hasRaster ? buildMask(p.ds.w, p.ds.h, selectedArea, (i) => [p.ds.lat[i], p.ds.lon[i]]) : undefined),
    [hasRaster, p.ds, selectedArea],
  );

  const url = useMemo(() => {
    if (!hasRaster) return null;
    const img = rasterToImageData(p.ds, p.values, p.layer, {
      waterColor: p.layer === "lst" || p.layer.startsWith("d") ? null : undefined,
      palette: p.palette,
      mask,
    });
    return imageDataToDataUrl(img);
  }, [hasRaster, p.ds, p.values, p.layer, p.palette, mask]);

  const boundaryRings = useMemo(() => getLeafletRings(selectedArea), [selectedArea]);
  const tiles = TILES[p.basemap];

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={[21.14, 79.08]}
        zoom={12}
        minZoom={6}
        maxZoom={16}
        zoomControl={false}
        className="h-full w-full"
        attributionControl
      >
        <TileLayer key={p.basemap} url={tiles.url} attribution={tiles.attribution} subdomains="abcd" />

        {url && (
          <ImageOverlay url={url} bounds={imageBounds} opacity={p.opacity} zIndex={300} className="raster-overlay" />
        )}

        {boundaryRings.map((ring, i) => (
          <Polygon
            key={`boundary-${selectedArea}-${i}`}
            positions={ring as LatLngExpression[]}
            pathOptions={{ color: "#FF6B35", weight: 1.5, opacity: 0.85, fill: false, interactive: false }}
          />
        ))}

        <MapController area={selectedArea} />
        <ZoomControl position="bottomright" />
        <ClickHandler mode={p.mode} onInspect={p.onInspect} />

        {showNagpurOverlays && p.showZones && ZONES.map((z, zi) => {
          const sel = p.selectedZones.indexOf(zi);
          const color = sel === 0 ? "#38bdf8" : sel === 1 ? "#f472b6" : "#ffffff";
          return (
            <Polygon
              key={`${z.id}-${p.mode}`}
              positions={z.poly as LatLngExpression[]}
              pathOptions={{ color, weight: sel >= 0 ? 3 : 1, fillOpacity: sel >= 0 ? 0.15 : 0.02, dashArray: sel >= 0 ? undefined : "4 4", interactive: p.mode === "zones" }}
              eventHandlers={{ click: () => p.onZoneClick(zi) }}
            >
              {p.mode === "zones" && !p.showZoneLabels && (
                <Tooltip sticky>
                  <div className="text-xs">
                    <b>{z.name}</b>
                    <br />
                    {p.zoneValue(zi)}
                    <br />
                    <span className="text-slate-400">{sel >= 0 ? "click to deselect" : "click to select"}</span>
                  </div>
                </Tooltip>
              )}
              {p.showZoneLabels && (
                <Tooltip permanent direction="center" className="zone-label" interactive={false}>
                  {z.short}
                </Tooltip>
              )}
            </Polygon>
          );
        })}

        {showNagpurOverlays && p.showLandmarks && LANDMARKS.map((lm) => (
          <CircleMarker
            key={lm.name}
            center={[lm.lat, lm.lon]}
            radius={4}
            pathOptions={{ color: "#0f172a", weight: 1.5, fillColor: LM_COLORS[lm.kind], fillOpacity: 1, interactive: p.mode !== "inspect" }}
          >
            <Tooltip direction="top" offset={[0, -4]}>
              {lm.name}
            </Tooltip>
          </CircleMarker>
        ))}

        {p.inspected && (
          <>
            <CircleMarker center={[p.inspected.lat, p.inspected.lon]} radius={12} pathOptions={{ color: "#fff", weight: 2, fillOpacity: 0, interactive: false }} />
            <CircleMarker center={[p.inspected.lat, p.inspected.lon]} radius={3} pathOptions={{ color: "#fff", fillColor: "#fff", fillOpacity: 1, interactive: false }} />
          </>
        )}
      </MapContainer>

      <div className="pointer-events-none absolute left-1/2 top-3 z-[500] -translate-x-1/2">
        <AreaSelector value={selectedArea} onChange={setSelectedArea} />
      </div>

      {!hasRaster && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-[499] w-[min(92%,420px)] -translate-x-1/2">
          <div className="rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_4px_12px_rgba(15,23,42,0.10)] backdrop-blur">
            <div className="flex items-start gap-2.5">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#FF6B35]" />
              <div>
                <p className="text-xs font-semibold text-slate-900">No heatmap data for {areaMeta.label}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
                  The current analysis dataset covers the Nagpur AOI only. The {areaMeta.label} boundary is shown for geographic context — heat values are not available here.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-1 left-2 z-[400] text-[9px] text-slate-500">
        Boundaries: geoBoundaries (CC-BY 4.0)
      </div>
    </div>
  );
}