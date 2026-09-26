import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Building2, Database, Flame, Leaf, Map as MapIcon, ThermometerSun, TrendingUp } from "lucide-react";
import { useApp } from "@/App";
import HomeMap from "@/components/HomeMap";
import { Card, KPI, Legend, Pill, YearPicker } from "@/components/ui";
import { fmt } from "@/data/engine";
import { uhiApi } from "@/api/client";
import type { HotspotRanking, OverviewResponse } from "@/api/types";
import { cn } from "@/utils/cn";

export default function Overview() {
  const { ds, year, setYear, setView, setSelectedLayer, setScenarioZoneId } = useApp();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [hotspots, setHotspots] = useState<HotspotRanking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([uhiApi.overview(year), uhiApi.topHotspots(year, 5)])
      .then(([o, h]) => { if (alive) { setOverview(o.data); setHotspots(h.data); } })
      .catch(() => { if (alive) { setOverview(null); setHotspots([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [year]);

  const c = ds.city[year];
  const c19 = ds.city[2019];
  const kpis = overview?.kpis ?? {
    averageTemperature: c.lstMean, maximumTemperature: c.lstMax, hotspotCount: 0,
    vegetationChange: c.ndviMean - c19.ndviMean, averageNdvi: c.ndviMean, averageNdbi: c.ndbiMean,
  };
  const quality = overview?.quality;
  const fallback = useMemo(() => [...ds.zones].sort((a, b) => b.byYear[year].lst - a.byYear[year].lst).slice(0, 5).map((z, i) => ({ rank: i + 1, zoneId: z.zone.id, zone: z.zone.name, temperature: z.byYear[year].lst, peakTemperature: z.byYear[year].lst + 1.2, severity: z.byYear[year].lst > 43 ? "Critical" as const : "High" as const, persistence: z.persistentFrac, areaKm2: z.areaKm2 })), [ds, year]);
  const top = hotspots.length ? hotspots : fallback;

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ThermometerSun className="h-6 w-6 text-orange-500" />
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-3xl">Nagpur Urban Heat Island Analysis</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <YearPicker value={year} onChange={setYear} />
          {!loading && (
            <Pill tone={overview?.source === "mock" ? "amber" : "green"}>
              {overview?.source === "mock" ? "Demonstration dataset" : "Live data"}
            </Pill>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,32%)_minmax(0,68%)]">
        {/* LEFT SIDEBAR */}
        <aside className="space-y-6">
          {/* Situation Snapshot Section */}
          <div>
            <div className="mb-4 border-l-4 border-orange-500 pl-4">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">Situation Snapshot</h2>
              <p className="mt-1 text-xs text-slate-600">Pre-monsoon composite · {year}</p>
            </div>
            <div className="space-y-3">
              {/* Row 1: Temperature Cards */}
              <div className="grid grid-cols-2 gap-3">
                <KPI 
                  label="Average Temperature" 
                  value={fmt.temp(kpis.averageTemperature)} 
                  sub={`${fmt.delta(kpis.averageTemperature - c19.lstMean, 1, "°C")} vs 2019`} 
                  tone="hot" 
                  icon={<Flame className="h-4 w-4 text-orange-500" />} 
                />
                <KPI 
                  label="Maximum Temperature" 
                  value={fmt.temp(kpis.maximumTemperature)} 
                  sub="mapped surface maximum" 
                  tone="hot" 
                />
              </div>

              {/* Row 2: Hotspot & Vegetation */}
              <div className="grid grid-cols-2 gap-3">
                <KPI 
                  label="Hotspot Count" 
                  value={kpis.hotspotCount.toLocaleString()} 
                  sub="cells in hottest decile" 
                  tone="amber" 
                />
                <KPI 
                  label="Vegetation Change" 
                  value={fmt.delta(kpis.vegetationChange, 3)} 
                  sub="mean NDVI vs 2019" 
                  tone="green" 
                  icon={<Leaf className="h-4 w-4 text-emerald-500" />} 
                />
              </div>

              {/* Row 3: NDVI & NDBI (Secondary Tier) */}
              <div className="grid grid-cols-2 gap-3 opacity-80">
                <KPI 
                  label="Average NDVI" 
                  value={kpis.averageNdvi.toFixed(3)} 
                  sub="vegetation greenness" 
                  tone="green" 
                />
                <KPI 
                  label="Average NDBI" 
                  value={kpis.averageNdbi.toFixed(3)} 
                  sub="built-up intensity" 
                  tone="violet" 
                  icon={<Building2 className="h-4 w-4 text-purple-500" />} 
                />
              </div>
            </div>

            {/* Data Quality - Collapsible */}
            {quality && (
              <details className="mt-4 group">
                <summary className="cursor-pointer rounded-lg bg-slate-100 px-3 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-200 transition flex items-center gap-2">
                  <span>Data quality: <span className="font-bold text-emerald-600">{quality.label}</span></span>
                  <span className="group-open:rotate-180 transition">▼</span>
                </summary>
                <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 space-y-1">
                  <div className="flex justify-between">
                    <span>Usable scenes:</span>
                    <span className="font-semibold text-slate-900">{quality.clearScenes}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Coverage:</span>
                    <span className="font-semibold text-slate-900">{quality.completeness.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Residual cloud:</span>
                    <span className="font-semibold text-slate-900">{quality.residualCloud.toFixed(1)}%</span>
                  </div>
                </div>
              </details>
            )}
          </div>

          {/* Top Hotspots Section */}
          <div>
            <div className="mb-4 border-l-4 border-orange-500 pl-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">Top Hotspots</h2>
                <p className="mt-1 text-xs text-slate-600">Zone-mean LST ranked for the selected season</p>
              </div>
              <button 
                onClick={() => setView("insights")} 
                className="text-xs font-semibold text-orange-600 hover:text-orange-700 transition"
              >
                View all →
              </button>
            </div>

            <div className="space-y-2">
              {top.map((h, i) => (
                <button
                  key={h.zoneId}
                  onClick={() => { setSelectedLayer("hotspot"); setView("explore"); }}
                  className="w-full group rounded-xl border border-slate-200 bg-white p-3 hover:border-orange-300 hover:shadow-md transition-all"
                >
                  <div className="flex items-start gap-3">
                    {/* Badge */}
                    <div className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-bold text-sm transition",
                      i < 3 
                        ? "bg-gradient-to-br from-orange-400 to-orange-500 text-white shadow-md" 
                        : "bg-slate-100 text-slate-700"
                    )}>
                      {h.rank}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1 text-left">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-semibold text-slate-900 truncate text-sm">{h.zone}</p>
                        <span className="shrink-0 text-base font-bold text-slate-900 tabular-nums">{h.temperature.toFixed(1)}°</span>
                      </div>
                      
                      {/* Severity Badge & Stats */}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span 
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{
                            backgroundColor: h.severity === "Critical" ? "#fee2e2" : "#fef3c7",
                            color: h.severity === "Critical" ? "#991b1b" : "#92400e"
                          }}
                        >
                          <span 
                            className="h-2 w-2 rounded-full"
                            style={{
                              background: h.severity === "Critical" ? "#dc2626" : "#f59e0b"
                            }}
                          />
                          {h.severity}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {(h.persistence * 100).toFixed(0)}% persistent · {h.areaKm2.toFixed(1)} km²
                        </span>
                      </div>

                      {/* Persistence Bar */}
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div 
                          className="h-full rounded-full bg-gradient-to-r from-orange-400 to-red-500 shadow-sm"
                          style={{ width: `${Math.min(100, h.persistence * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-2">
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-600">Actions</p>
            <div className="space-y-2">
              <button
                onClick={() => { setSelectedLayer("lst"); setView("explore"); }}
                className="w-full flex items-center justify-between rounded-lg border-2 border-orange-500 bg-white px-4 py-2.5 font-semibold text-orange-600 hover:bg-orange-50 transition-all"
              >
                <span className="flex items-center gap-2">
                  <MapIcon className="h-4 w-4" />
                  Explore Analysis
                </span>
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => { setScenarioZoneId(top[0]?.zoneId ?? "besa"); setView("planning"); }}
                className="w-full flex items-center justify-between rounded-lg bg-orange-500 px-4 py-2.5 font-semibold text-white hover:bg-orange-600 shadow-md hover:shadow-lg transition-all"
              >
                <span className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Test Scenarios
                </span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* RIGHT SECTION: MAP & CARDS */}
        <section className="space-y-4">
          {/* Map Card */}
          <Card 
            title={`Land Surface Temperature · ${year}`} 
            subtitle="Interactive map · scroll / pinch to zoom · click zones to compare" 
            right={<Pill tone="orange">{fmt.temp(c.lstMean)} mean</Pill>} 
            bodyClassName="p-4"
          >
            <HomeMap />
            <Legend layer="lst" className="mt-4" />
          </Card>

          {/* Bottom Insight Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { 
                icon: TrendingUp, 
                title: "What is new?", 
                eyebrow: "Change since 2019", 
                value: fmt.delta(c.lstMean - c19.lstMean, 2, "°C"), 
                bgColor: "#FEF3C7",
                textColor: "#92400E",
                accentColor: "#F59E0B",
                desc: "City-mean LST; use Explore to locate the cells and corridors behind this change." 
              },
              { 
                icon: AlertTriangle, 
                title: "Persistent risk", 
                eyebrow: "Structural, not one-season heat", 
                value: `${top.filter((h) => h.persistence >= 0.5).length} priority zones`, 
                bgColor: "#FEE2E2",
                textColor: "#991B1B",
                accentColor: "#DC2626",
                desc: "with ≥50% of land in persistent hotspot conditions." 
              },
              { 
                icon: Database, 
                title: "Data status", 
                eyebrow: "Ready for review", 
                value: quality?.label ?? "Checking", 
                bgColor: "#EFF6FF",
                textColor: "#0369A1",
                accentColor: "#0284C7",
                desc: quality ? `${quality.completeness.toFixed(1)}% coverage from ${quality.clearScenes} usable scenes` : "Loading quality indicators…" 
              },
            ].map((card) => (
              <div 
                key={card.title} 
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-md hover:shadow-lg transition-all hover:border-slate-300 group"
                style={{ backgroundColor: card.bgColor }}
              >
                {/* Header */}
                <div className="flex items-center gap-3 mb-4">
                  <div 
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${card.accentColor}20`, color: card.accentColor }}
                  >
                    <card.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm" style={{ color: card.textColor }}>
                      {card.title}
                    </p>
                    <p className="text-xs text-slate-600">{card.eyebrow}</p>
                  </div>
                </div>

                {/* Value */}
                <p 
                  className="text-3xl font-bold tracking-tight tabular-nums" 
                  style={{ color: card.textColor }}
                >
                  {card.value}
                </p>

                {/* Description */}
                <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                  {card.desc}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}