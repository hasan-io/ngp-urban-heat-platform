import { useRef } from "react";
import { Box, Expand, Map as MapIcon, MousePointer2 } from "lucide-react";
import { useApp } from "@/App";
import MapView from "@/components/MapView";
import Surface3D from "@/components/Surface3D";
import { latLonToCell } from "@/data/engine";
import { cn } from "@/utils/cn";

/** Compact interactive map for Home. It reuses the same Leaflet / 3D map components as Explore. */
export default function HomeMap() {
  const {
    ds, year, view3d, setView3d, showZones, showLandmarks, showZoneLabels,
    selectedBasemap, opacity, selectedZoneA, selectedZoneB, setSelectedZoneA, setSelectedZoneB, setInspectedPixel,
  } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const selected = [selectedZoneA, selectedZoneB].filter((v): v is number => v != null);
  const choose = (zi: number) => {
    if (selectedZoneA === zi) { setSelectedZoneA(null); return; }
    if (selectedZoneB === zi) { setSelectedZoneB(null); return; }
    if (selectedZoneA == null) setSelectedZoneA(zi);
    else if (selectedZoneB == null) setSelectedZoneB(zi);
    else { setSelectedZoneA(selectedZoneB); setSelectedZoneB(zi); }
  };
  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await ref.current?.requestFullscreen();
    } catch { /* fullscreen availability is browser-controlled */ }
  };
  return (
    <div ref={ref} className="relative h-[58vh] min-h-[440px] overflow-hidden rounded-xl border border-white/10 bg-slate-950 sm:h-[66vh] xl:h-[calc(100vh-300px)] xl:max-h-[880px] xl:min-h-[600px]">
      {view3d ? (
        <Surface3D ds={ds} values={ds.rasters[year].lst} layer="lst" exag={1} showZones={showZones} />
      ) : (
        <MapView
          ds={ds} values={ds.rasters[year].lst} layer="lst" basemap={selectedBasemap} opacity={opacity}
          showZones={showZones} showLandmarks={showLandmarks} showZoneLabels={showZoneLabels}
          mode="zones" selectedZones={selected} inspected={null}
          zoneValue={(zi) => { const z = ds.zones[zi]; return `LST ${year}: ${z.byYear[year].lst.toFixed(1)} °C`; }}
          onZoneClick={choose}
          onInspect={(lat, lon) => { const cell = latLonToCell(ds, lat, lon); if (cell >= 0) setInspectedPixel({ cell, lat, lon }); }}
        />
      )}
      <div className="absolute left-3 top-3 z-[500] rounded-xl border border-white/10 bg-slate-950/85 px-3 py-2 backdrop-blur">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Land surface temperature</p>
        <p className="text-lg font-semibold text-white">Nagpur · {year}</p>
        <p className="text-[10px] text-slate-400">Click a zone to compare it in Explore</p>
      </div>
      <div className="absolute right-3 top-3 z-[500] inline-flex rounded-xl border border-white/10 bg-slate-950/85 p-0.5 backdrop-blur">
        <button onClick={() => setView3d(false)} className={cn("flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium", !view3d ? "bg-white/10 text-white" : "text-slate-400 hover:text-white")}><MapIcon className="h-3.5 w-3.5" />2D</button>
        <button onClick={() => setView3d(true)} className={cn("flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium", view3d ? "bg-white/10 text-white" : "text-slate-400 hover:text-white")}><Box className="h-3.5 w-3.5" />3D</button>
        <button onClick={toggleFull} className="rounded-lg px-2 py-1.5 text-slate-400 hover:bg-white/10 hover:text-white" title="Fullscreen"><Expand className="h-3.5 w-3.5" /></button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 z-[500] flex items-center gap-1.5 rounded-lg bg-slate-950/80 px-2 py-1 text-[10px] text-slate-300"><MousePointer2 className="h-3 w-3 text-orange-300" /> Zoom and select zones directly on the map</div>
    </div>
  );
}