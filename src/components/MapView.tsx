import { useMemo } from "react";
import { CircleMarker, ImageOverlay, MapContainer, Polygon, TileLayer, Tooltip, useMapEvents, ZoomControl } from "react-leaflet";
import type { LatLngBoundsExpression, LatLngExpression } from "leaflet";
import type { Dataset } from "@/data/engine";
import { imageDataToDataUrl, rasterToImageData, type LayerKey } from "@/data/colors";
import { BOUNDS, LANDMARKS, ZONES } from "@/data/nagpur";

export type Basemap = "dark" | "streets" | "satellite";

// CARTO API key comes from project configuration (.env → VITE_CARTO_KEY), never from source.
// Attribution (OpenStreetMap + CARTO) stays visible on the map at all times.
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
  palette?: string[]; // categorical layers (e.g. heat-island ids)
}

function ClickHandler({ mode, onInspect }: { mode: Props["mode"]; onInspect: Props["onInspect"] }) {
  useMapEvents({
    click(e) {
      if (mode === "inspect") onInspect(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function MapView(p: Props) {
  const bounds: LatLngBoundsExpression = [[BOUNDS.south, BOUNDS.west], [BOUNDS.north, BOUNDS.east]];
  const url = useMemo(() => {
    const img = rasterToImageData(p.ds, p.values, p.layer, { waterColor: p.layer === "lst" || p.layer.startsWith("d") ? null : undefined, palette: p.palette });
    return imageDataToDataUrl(img);
  }, [p.ds, p.values, p.layer, p.palette]);
  const tiles = TILES[p.basemap];

  return (
    <MapContainer center={[21.14, 79.08]} zoom={12} minZoom={10} maxZoom={16} zoomControl={false} className="h-full w-full" attributionControl>
      <TileLayer key={p.basemap} url={tiles.url} attribution={tiles.attribution} subdomains="abcd" />
      <ImageOverlay url={url} bounds={bounds} opacity={p.opacity} zIndex={300} className="raster-overlay" />
      <ZoomControl position="bottomright" />
      <ClickHandler mode={p.mode} onInspect={p.onInspect} />

      {p.showZones && ZONES.map((z, zi) => {
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
                <div className="text-xs"><b>{z.name}</b><br />{p.zoneValue(zi)}<br /><span className="text-slate-400">{sel >= 0 ? "click to deselect" : "click to select"}</span></div>
              </Tooltip>
            )}
            {p.showZoneLabels && (
              <Tooltip permanent direction="center" className="zone-label" interactive={false}>{z.short}</Tooltip>
            )}
          </Polygon>
        );
      })}

      {p.showLandmarks && LANDMARKS.map((lm) => (
        <CircleMarker key={lm.name} center={[lm.lat, lm.lon]} radius={4} pathOptions={{ color: "#0f172a", weight: 1.5, fillColor: LM_COLORS[lm.kind], fillOpacity: 1, interactive: p.mode !== "inspect" }}>
          <Tooltip direction="top" offset={[0, -4]}>{lm.name}</Tooltip>
        </CircleMarker>
      ))}

      {p.inspected && (
        <>
          <CircleMarker center={[p.inspected.lat, p.inspected.lon]} radius={12} pathOptions={{ color: "#fff", weight: 2, fillOpacity: 0, interactive: false }} />
          <CircleMarker center={[p.inspected.lat, p.inspected.lon]} radius={3} pathOptions={{ color: "#fff", fillColor: "#fff", fillOpacity: 1, interactive: false }} />
        </>
      )}
    </MapContainer>
  );
}
