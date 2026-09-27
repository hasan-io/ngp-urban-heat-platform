import { useMemo } from "react";
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, ZoomControl } from "react-leaflet";
import { rampCss } from "@/data/colors";
import { STATE_COLOR, latestValue, type Sensor } from "@/data/hardware";

// Same basemap + attribution as Home for a consistent geographic look.
const CARTO_KEY = (import.meta.env.VITE_CARTO_KEY as string | undefined)?.trim();
const TILE_URL = `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png${CARTO_KEY ? `?key=${CARTO_KEY}` : ""}`;
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

interface Props {
  sensors: Sensor[];
  onSensorClick: (s: Sensor) => void;
}

export default function SensorMap({ sensors, onSensorClick }: Props) {
  const critical = useMemo(() => sensors.filter((s) => s.state === "critical"), [sensors]);

  return (
    <MapContainer
      center={[21.146, 79.088]}
      zoom={11}
      minZoom={9}
      maxZoom={15}
      zoomControl={false}
      className="h-full w-full"
      attributionControl
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTR} subdomains="abcd" />

      {/* Concentric heat blobs around critical sensors — same colour language
          as the Home heatmap. Four rings of decreasing radius increase the
          "hot core" effect without any raster work. */}
      {critical.map((s) => {
        const temp = latestValue(s) ?? 38;
        const heat = rampCss("lst", temp);
        return (
          <g key={`heat-${s.id}`}>
            <Circle center={[s.lat, s.lon]} radius={9000} pathOptions={{ fillColor: heat, fillOpacity: 0.10, stroke: false, interactive: false }} />
            <Circle center={[s.lat, s.lon]} radius={5500} pathOptions={{ fillColor: heat, fillOpacity: 0.18, stroke: false, interactive: false }} />
            <Circle center={[s.lat, s.lon]} radius={3000} pathOptions={{ fillColor: heat, fillOpacity: 0.28, stroke: false, interactive: false }} />
            <Circle center={[s.lat, s.lon]} radius={1500} pathOptions={{ fillColor: heat, fillOpacity: 0.45, stroke: false, interactive: false }} />
          </g>
        );
      })}

      {/* Sensor markers */}
      {sensors.map((s) => {
        const color = STATE_COLOR[s.state];
        const isCritical = s.state === "critical";
        const isWarning = s.state === "warning";
        return (
          <CircleMarker
            key={s.id}
            center={[s.lat, s.lon]}
            radius={isCritical ? 11 : isWarning ? 8 : 6}
            pathOptions={{ color: "#fff", weight: isCritical ? 3 : 2, fillColor: color, fillOpacity: 1 }}
            eventHandlers={{ click: () => onSensorClick(s) }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <div className="text-xs">
                <b>{s.id}</b>
                <br />
                <span style={{ color }}>{s.state.toUpperCase()}</span>
                {latestValue(s) != null && (
                  <>
                    <br />
                    {latestValue(s)!.toFixed(1)} °C
                  </>
                )}
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}

      {/* Pulsing halos on critical + warning sensors */}
      {sensors.filter((s) => s.state === "critical").map((s) => (
        <CircleMarker
          key={`pulse-${s.id}`}
          center={[s.lat, s.lon]}
          radius={22}
          pathOptions={{ className: "sensor-pulse-critical", color: "#DC2626", weight: 3, fillOpacity: 0, opacity: 0.7 }}
          interactive={false}
        />
      ))}
      {sensors.filter((s) => s.state === "warning").map((s) => (
        <CircleMarker
          key={`pulse-${s.id}`}
          center={[s.lat, s.lon]}
          radius={16}
          pathOptions={{ className: "sensor-pulse-warning", color: "#F97316", weight: 2, fillOpacity: 0, opacity: 0.6 }}
          interactive={false}
        />
      ))}

      <ZoomControl position="bottomright" />
    </MapContainer>
  );
}