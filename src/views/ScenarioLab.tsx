import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle, ArrowRight, BrainCircuit, Building2, Clock, CloudSun, Download,
  HelpCircle, IndianRupee, Leaf, Minus, Plus, RotateCcw, ThermometerSun, Users,
} from "lucide-react";
import { useApp } from "@/App";
import RasterCanvas from "@/components/RasterCanvas";
import { Card, Formula, Legend, Pill, Segmented, Slider, Stat, chartTheme } from "@/components/ui";
import { fmt, runScenario } from "@/data/engine";
import { DEFAULT_UNIT_COSTS, estimateCost, inr, type UnitCosts } from "@/data/decision";
import { Method } from "@/components/ml-ui";
import { useML } from "@/ml/context";
import { mlScenario } from "@/ml/pipeline";
import { uhiApi } from "@/api/client";
import type { ScenarioApiResponse } from "@/api/types";
import { cn } from "@/utils/cn";

const BUILDING_FOOTPRINT_KM2 = 0.0035; // ~3,500 m² per mid-rise block incl. paved surrounds

/**
 * External interactive environmental simulation (supporting demonstration only).
 * Single source of truth for the URL — do not duplicate elsewhere.
 * This is NOT part of the UHI calculation pipeline.
 */
const EXTERNAL_ENV_SIM_URL = "https://farmview-3d.vercel.app/";

const PRESETS = [
  { name: "Miyawaki drive", veg: 20, built: 0, desc: "Dense micro-forests on vacant plots" },
  { name: "Urban forest + de-pave", veg: 30, built: -10, desc: "Canopy + permeable surfaces" },
  { name: "Cool corridor", veg: 15, built: -5, desc: "Avenue trees, shaded streets" },
  { name: "New township", veg: -15, built: 25, desc: "Business-as-usual layout sprawl" },
  { name: "Redevelopment", veg: 5, built: 15, desc: "FSI increase with mandated greens" },
];

const FLOW = ["Choose area", "Set interventions", "View scenario", "Understand impact"];

/* ------------------------------------------------------------------ section labels */
function FlowSection({ step, title, question, children }: { step: string; title: string; question: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-3 rounded-r-lg border-l-4 border-[#FF6B35] bg-[#f9fafb] py-3 pr-4 pl-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#FF6B35] text-[10px] font-bold text-white shadow-sm">
            {step}
          </span>
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.09em] text-slate-900">{title}</h2>
            <p className="truncate text-xs text-slate-600">{question}</p>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ first-visit tour */
const TOUR_KEY = "nagpur-uhi.scenario-tour-v1";
const TOUR_STEPS = [
  { id: "zone", text: "Start by selecting the area you want to analyze." },
  { id: "interventions", text: "Choose what you want to change, such as vegetation or built-up conditions." },
  { id: "presets", text: "Use a preset scenario to quickly test a predefined intervention." },
  { id: "viz", text: "See how your selected scenario changes the projected heat conditions." },
  { id: "impact", text: "Review the predicted impact, combined effects, and sensitivity of your scenario." },
];

function TourOverlay({ step, onBack, onNext, onSkip }: { step: number | null; onBack: () => void; onNext: () => void; onSkip: () => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (step === null) { setRect(null); return; }
    const target = TOUR_STEPS[step].id;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
      if (el) setRect(el.getBoundingClientRect());
    };
    const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    measure();
    const t = window.setTimeout(measure, 420);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.clearTimeout(t); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [step]);

  if (step === null || !rect) return null;
  const last = step === TOUR_STEPS.length - 1;
  const tooltipBelow = rect.bottom + 230 < window.innerHeight;
  const top = tooltipBelow ? Math.min(rect.bottom + 14, window.innerHeight - 230) : Math.max(12, rect.top - 224);
  const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - 356));

  const strip = (style: CSSProperties) => (
    <div className="fixed z-[900] bg-[rgba(15,23,42,0.55)]" style={style} />
  );
  return (
    <>
      {strip({ top: 0, left: 0, right: 0, height: Math.max(0, rect.top) })}
      {strip({ top: rect.bottom, left: 0, right: 0, bottom: 0 })}
      {strip({ top: rect.top, left: 0, width: Math.max(0, rect.left), height: rect.height })}
      {strip({ top: rect.top, left: rect.right, right: 0, height: rect.height })}
      <div
        className="pointer-events-none fixed z-[901] rounded-xl border-2 border-[#FF6B35]"
        style={{
          top: rect.top - 3,
          left: rect.left - 3,
          width: rect.width + 6,
          height: rect.height + 6,
          boxShadow: "0 0 0 5px rgba(255,107,53,0.22)",
        }}
      />
      <div className="fixed z-[902] w-[344px] max-w-[calc(100vw-24px)] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl" style={{ top, left }}>
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Step {step + 1} of {TOUR_STEPS.length}</p>
          <div className="flex gap-1">
            {TOUR_STEPS.map((s, i) => (
              <span key={s.id} className={cn("h-1.5 w-1.5 rounded-full transition", i <= step ? "bg-[#FF6B35]" : "bg-slate-200")} />
            ))}
          </div>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-800">{TOUR_STEPS[step].text}</p>
        <div className="mt-4 flex items-center justify-between">
          <button onClick={onSkip} className="text-xs font-medium text-slate-500 transition hover:text-slate-800">Skip Tour</button>
          <div className="flex items-center gap-2">
            <button
              onClick={onBack}
              disabled={step === 0}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Back
            </button>
            <button
              onClick={onNext}
              className="rounded-lg bg-[#FF6B35] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#e85a28]"
            >
              {last ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function ScenarioLab() {
  const {
    ds, scenarioZoneId, setScenarioZoneId, scenarioBaseline: baseline, setScenarioBaseline: setBaseline,
    vegetationChange: veg, setVegetationChange: setVeg, builtUpChange: built, setBuiltUpChange: setBuilt,
  } = useApp();
  const ml = useML();
  const [showDiff, setShowDiff] = useState(false);
  const [costs, setCosts] = useState<UnitCosts>(DEFAULT_UNIT_COSTS);
  const [method, setMethod] = useState<"trees" | "miyawaki">("trees");
  const [showCosts, setShowCosts] = useState(false);
  const [apiScenario, setApiScenario] = useState<ScenarioApiResponse | null>(null);
  const [tourStep, setTourStep] = useState<number | null>(null);
  const tourShown = useRef(false);

  const scenarioZone = ds.zones.find((z) => z.zone.id === scenarioZoneId)?.index ?? 8;
  const zone = ds.zones[scenarioZone];
  const result = useMemo(
    () => runScenario(ds, { zoneIndex: scenarioZone, vegDeltaPct: veg, builtDeltaPct: built, baseline }),
    [ds, scenarioZone, veg, built, baseline],
  );
  const reg = ds.regression[2024];

  useEffect(() => {
    if (tourShown.current) return;
    tourShown.current = true;
    if (!localStorage.getItem(TOUR_KEY)) {
      const t = window.setTimeout(() => setTourStep(0), 700);
      return () => window.clearTimeout(t);
    }
  }, []);
  const finishTour = () => { localStorage.setItem(TOUR_KEY, "1"); setTourStep(null); };

  useEffect(() => {
    let alive = true;
    uhiApi.scenario({ zoneId: scenarioZoneId, baseline, vegetationChange: veg, builtUpChange: built })
      .then((r) => { if (alive) setApiScenario(r.data); })
      .catch(() => { if (alive) setApiScenario(null); });
    return () => { alive = false; };
  }, [scenarioZoneId, baseline, veg, built]);

  const buildingsEquivalent = Math.round((built / 100) * zone.areaKm2 / BUILDING_FOOTPRINT_KM2);
  const stepBuildings = (n: number) => {
    const pct = (n * BUILDING_FOOTPRINT_KM2 / zone.areaKm2) * 100;
    setBuilt(Math.max(-30, Math.min(30, +(built + pct).toFixed(1))));
  };

  const mlEstimate = useMemo(
    () => (ml.lst && ml.lst.year === 2024 ? mlScenario(ds, ml.lst, scenarioZone, veg, built) : null),
    [ds, ml.lst, scenarioZone, veg, built],
  );

  const sensitivity = useMemo(() => {
    const rows = [];
    for (let v = -30; v <= 50; v += 5) {
      const r = runScenario(ds, { zoneIndex: scenarioZone, vegDeltaPct: v, builtDeltaPct: built, baseline });
      const r0 = runScenario(ds, { zoneIndex: scenarioZone, vegDeltaPct: v, builtDeltaPct: 0, baseline });
      const m = ml.lst && ml.lst.year === 2024 && v % 10 === 0 ? mlScenario(ds, ml.lst, scenarioZone, v, built) : null;
      rows.push({ veg: v, combined: +r.dLst.toFixed(2), vegOnly: +r0.dLst.toFixed(2), ml: m ? +m.ml.toFixed(2) : undefined });
    }
    return rows;
  }, [ds, ml.lst, scenarioZone, built, baseline]);

  const diffRaster = useMemo(() => {
    const out = new Float32Array(ds.n);
    for (let i = 0; i < ds.n; i++) out[i] = result.lst[i] - result.baseLst[i];
    return out;
  }, [result, ds.n]);

  const diffView = useMemo(() => {
    let mn = 0, mx = 0;
    for (let i = 0; i < ds.n; i++) { const v = diffRaster[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    const abs = Math.max(Math.abs(mn), Math.abs(mx));
    const noChange = abs < 0.005;
    const k = noChange ? 0 : 4 / abs;
    const scaled = noChange ? new Float32Array(ds.n) : Float32Array.from(diffRaster, (v) => v * k);
    return { mn, mx, abs, noChange, scaled };
  }, [diffRaster, ds.n]);

  const cost = useMemo(
    () => estimateCost(zone.areaKm2, zone.zone.population, veg, built, result.dLst, costs, method),
    [zone, veg, built, result.dLst, costs, method],
  );

  const exportScenario = () => {
    const payload = {
      generated: new Date().toISOString(),
      dataset: ds.label,
      zone: zone.zone.name,
      baseline,
      intervention: { vegetation_pct_points: veg, built_up_pct_points: built, buildings_equivalent: buildingsEquivalent },
      result: {
        d_lst_c: +result.dLst.toFixed(3),
        uncertainty_c: +result.uncertainty.toFixed(3),
        from_vegetation_c: +result.dLstVeg.toFixed(3),
        from_built_up_c: +result.dLstBuilt.toFixed(3),
        lst_before_c: +result.zoneBefore.lst.toFixed(2),
        lst_after_c: +result.zoneAfter.lst.toFixed(2),
        city_mean_effect_c: +result.cityDLst.toFixed(4),
      },
      ml_estimate: mlEstimate ? { d_lst_c: +mlEstimate.ml.toFixed(3), linear_12_feature_c: +mlEstimate.linear.toFixed(3), in_range: mlEstimate.inRange } : null,
      cost: {
        method,
        unit_costs_inr: costs,
        trees: cost.trees,
        vegetation_area_m2: Math.round(cost.vegAreaM2),
        depaved_area_m2: Math.round(cost.builtAreaM2),
        total_inr: Math.round(cost.total),
        inr_per_degree: cost.perDegree ? Math.round(cost.perDegree) : null,
        inr_per_resident: Math.round(cost.perResident),
      },
      residents: zone.zone.population,
    };
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `scenario_${zone.zone.id}_${veg}_${built}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const historic = zone.dLst;
  const offsetPct = historic !== 0 ? (-result.dLst / historic) * 100 : 0;
  const cooling = result.dLst < 0;
  const baselineLabel = baseline === "2024" ? "Baseline — 2024" : "Baseline — 2030 BAU";

  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      {/* ---------- header ---------- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Scenario Modeling &amp; What-If Tool</h1>
          <p className="mt-1.5 text-sm text-slate-600">Choose an area, adjust interventions, and see the projected heat impact.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="xs"
            options={[
              { value: "2024", label: "Baseline: 2024 observed" },
              { value: "2030", label: "Baseline: 2030 BAU projection" },
            ]}
            value={baseline}
            onChange={setBaseline}
          />
          <button
            onClick={() => setTourStep(0)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            title="Replay the guided tour"
          >
            <HelpCircle className="h-3.5 w-3.5" /> How it works
          </button>
        </div>
      </div>

      {/* ---------- workflow strip ---------- */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {FLOW.map((label, i) => (
          <span key={label} className="flex items-center gap-2">
            <span className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#FF6B35] text-[10px] font-bold text-white">{i + 1}</span>
              {label}
            </span>
            {i < FLOW.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-slate-300" />}
          </span>
        ))}
      </div>

      {/* ---------- three-column workspace ---------- */}
      <div className="mt-6 grid gap-5 xl:grid-cols-12">
        {/* 1 · Scenario Setup */}
        <div className="space-y-4 xl:col-span-4">
          <FlowSection step="1·2" title="Scenario Setup" question="What do you want to change?">
            <div className="space-y-4">
              <div data-tour="zone" className="scroll-mt-28">
                <Card title="Target zone" subtitle="Choose from list or click the map">
                  <select
                    value={scenarioZoneId}
                    onChange={(e) => setScenarioZoneId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#FF6B35] focus:ring-2 focus:ring-orange-100"
                  >
                    {ds.zones.map((z) => <option key={z.zone.id} value={z.zone.id}>{z.zone.name}</option>)}
                  </select>
                  <p className="mt-2 text-[11px] text-slate-500">
                    {zone.zone.character} · {zone.areaKm2.toFixed(1)} km² · ~{(zone.zone.population / 1000).toFixed(0)}k residents
                  </p>
                  <div className="mt-3">
                    <Stat label={`LST (${baseline === "2024" ? "2024" : "2030 BAU"})`} value={fmt.temp(result.zoneBefore.lst)} tone="text-[#C2410C]" />
                    <Stat label="NDVI" value={result.zoneBefore.ndvi.toFixed(3)} tone="text-emerald-700" />
                    <Stat label="NDBI" value={result.zoneBefore.ndbi.toFixed(3)} tone="text-violet-700" />
                    <Stat label="Vegetation cover" value={fmt.pct(result.zoneBefore.veg)} />
                    <Stat label="Built-up cover" value={fmt.pct(result.zoneBefore.built)} />
                    <Stat label="2019→2024 change" value={fmt.delta(zone.dLst, 2, "°C")} />
                  </div>
                </Card>
              </div>

              <div data-tour="interventions" className="scroll-mt-28">
                <Card
                  title="Interventions"
                  subtitle="Percentage points of zone area"
                  right={
                    <button
                      onClick={() => { setVeg(0); setBuilt(0); }}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-800"
                      title="Reset"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  }
                >
                  <div className="space-y-5">
                    <Slider
                      label={<span className="flex items-center gap-1.5"><Leaf className="h-3.5 w-3.5 text-emerald-600" /> Vegetation change</span>}
                      value={veg}
                      min={-30}
                      max={50}
                      step={1}
                      onChange={setVeg}
                      format={(v) => `${v > 0 ? "+" : ""}${v}%`}
                      accent="#10B981"
                    />
                    <div className="flex gap-1.5">
                      {[10, 20, 30].map((v) => (
                        <button
                          key={v}
                          onClick={() => setVeg(v)}
                          className={cn(
                            "flex-1 rounded-lg border px-2 py-1 text-[11px] transition",
                            veg === v
                              ? "border-emerald-300 bg-emerald-50 text-emerald-800 font-semibold"
                              : "border-slate-200 text-slate-600 hover:bg-slate-50",
                          )}
                        >
                          +{v}% green
                        </button>
                      ))}
                    </div>

                    <Slider
                      label={<span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-violet-600" /> Built-up change</span>}
                      value={built}
                      min={-30}
                      max={30}
                      step={1}
                      onChange={setBuilt}
                      format={(v) => `${v > 0 ? "+" : ""}${v}%`}
                      accent="#A78BFA"
                    />
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={() => setBuilt(-10)}
                        className={cn(
                          "rounded-lg border px-2 py-1 text-[11px] transition",
                          built === -10
                            ? "border-orange-300 bg-orange-50 text-[#C2410C] font-semibold"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50",
                        )}
                      >
                        −10% de-pave
                      </button>
                      <button
                        onClick={() => setBuilt(0)}
                        className={cn(
                          "rounded-lg border px-2 py-1 text-[11px] transition",
                          built === 0
                            ? "border-slate-300 bg-slate-100 text-slate-800 font-semibold"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50",
                        )}
                      >
                        Reset built-up
                      </button>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-700">Buildings (≈3,500 m² each)</span>
                        <span
                          className={cn(
                            "font-semibold tabular-nums",
                            buildingsEquivalent > 0 ? "text-violet-700" : buildingsEquivalent < 0 ? "text-orange-700" : "text-slate-700",
                          )}
                        >
                          {buildingsEquivalent > 0 ? "+" : ""}{buildingsEquivalent}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-4 gap-1.5">
                        <button onClick={() => stepBuildings(-25)} className="rounded-lg border border-slate-200 bg-white py-1 text-[11px] text-slate-700 transition hover:bg-slate-100">−25</button>
                        <button onClick={() => stepBuildings(-5)} className="flex items-center justify-center rounded-lg border border-slate-200 bg-white py-1 text-[11px] text-slate-700 transition hover:bg-slate-100">
                          <Minus className="h-3 w-3" />5
                        </button>
                        <button onClick={() => stepBuildings(5)} className="flex items-center justify-center rounded-lg border border-slate-200 bg-white py-1 text-[11px] text-slate-700 transition hover:bg-slate-100">
                          <Plus className="h-3 w-3" />5
                        </button>
                        <button onClick={() => stepBuildings(25)} className="rounded-lg border border-slate-200 bg-white py-1 text-[11px] text-slate-700 transition hover:bg-slate-100">+25</button>
                      </div>
                      <p className="mt-2 text-[10px] text-slate-500">
                        Negative = demolition / de-paving. "Agar naye 5 buildings aaye toh?" → press +5.
                      </p>
                    </div>
                  </div>
                </Card>
              </div>

              <div data-tour="presets" className="scroll-mt-28">
                <Card title="Presets" subtitle="Combined scenarios">
                  <div className="space-y-1.5">
                    {PRESETS.map((p) => {
                      const active = veg === p.veg && built === p.built;
                      return (
                        <button
                          key={p.name}
                          onClick={() => { setVeg(p.veg); setBuilt(p.built); }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-xs transition",
                            active
                              ? "border-[#FF6B35] bg-orange-50"
                              : "border-slate-200 bg-white hover:border-orange-200 hover:bg-orange-50/40",
                          )}
                        >
                          <span>
                            <span className="font-medium text-slate-900">{p.name}</span>
                            <span className="block text-[10px] text-slate-500">{p.desc}</span>
                          </span>
                          <span className="shrink-0 text-right tabular-nums">
                            <span className="font-semibold text-emerald-700">{p.veg > 0 ? "+" : ""}{p.veg}%</span>{" "}
                            <span className="text-slate-400">/</span>{" "}
                            <span className="font-semibold text-violet-700">{p.built > 0 ? "+" : ""}{p.built}%</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </Card>
              </div>
            </div>
          </FlowSection>
        </div>

        {/* 2 · Scenario Visualization */}
        <div className="space-y-4 xl:col-span-4">
          <FlowSection step="3" title="Scenario Visualization" question="What does the scenario look like?">
            <div className="space-y-4">
              <div data-tour="viz" className="scroll-mt-28">
                <Card
                  title="Real-time visualisation"
                  subtitle="Change a slider → zone LST re-renders instantly"
                  right={
                    <Segmented
                      size="xs"
                      options={[{ value: 0, label: "Before / After" }, { value: 1, label: "Difference" }]}
                      value={showDiff ? 1 : 0}
                      onChange={(v) => setShowDiff(v === 1)}
                    />
                  }
                >
                  {showDiff ? (
                    <div>
                      <div className="relative">
                        <RasterCanvas
                          values={diffView.scaled}
                          layer="dlst"
                          showZones
                          highlightZone={scenarioZone}
                          showLabels
                          labelKinds={["city"]}
                          waterColor={null}
                          onClick={(c) => { const z = ds.zoneIndex[c]; if (z >= 0) setScenarioZoneId(ds.zones[z].zone.id); }}
                        />
                        {diffView.noChange && (
                          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
                            <div className="max-w-xs rounded-xl border border-slate-200 bg-white/95 px-4 py-3 text-center shadow-lg">
                              <p className="text-sm font-semibold text-slate-800">No difference to display</p>
                              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                                The scenario currently equals the baseline. Move the vegetation or built-up slider to generate a difference map.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                        <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-slate-500">
                          <span>← Cooling</span><span>No change</span><span>Warming →</span>
                        </div>
                        <div
                          className="mt-1 h-2 rounded-full border border-slate-200"
                          style={{ background: "linear-gradient(90deg,#1d4ed8,#93c5fd,#f8fafc,#fca5a5,#b91c1c)" }}
                        />
                        <div className="mt-1 flex justify-between text-[11px] tabular-nums text-slate-700">
                          <span>−{diffView.abs.toFixed(2)} °C</span>
                          <span>0.00 °C</span>
                          <span>+{diffView.abs.toFixed(2)} °C</span>
                        </div>
                        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                          Scenario − baseline. The colour scale spans the largest change in this view ({diffView.abs.toFixed(2)} °C); cells outside the selected zone are unchanged. Selected zone mean:{" "}
                          <span className="font-semibold text-slate-700">{fmt.delta(result.dLst, 2, "°C")}</span>.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <RasterCanvas
                            values={result.baseLst}
                            layer="lst"
                            showZones
                            highlightZone={scenarioZone}
                            dimOutside={scenarioZone}
                            title={baselineLabel}
                            onClick={(c) => { const z = ds.zoneIndex[c]; if (z >= 0) setScenarioZoneId(ds.zones[z].zone.id); }}
                          />
                        </div>
                        <div>
                          <RasterCanvas
                            values={result.lst}
                            layer="lst"
                            showZones
                            highlightZone={scenarioZone}
                            dimOutside={scenarioZone}
                            title="Scenario — Projected"
                            onClick={(c) => { const z = ds.zoneIndex[c]; if (z >= 0) setScenarioZoneId(ds.zones[z].zone.id); }}
                          />
                        </div>
                        <Legend layer="lst" className="sm:col-span-2" />
                      </div>
                      {diffView.noChange && (
                        <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
                          No intervention set — the baseline and scenario conditions are identical. Set vegetation or built-up to see them diverge.
                        </p>
                      )}
                    </div>
                  )}
                </Card>
              </div>

              <Card
                title="Sensitivity curve"
                subtitle={`ΔLST in ${zone.zone.short} as vegetation varies · built-up fixed at ${built > 0 ? "+" : ""}${built}%`}
              >
                <div className="h-56">
                  <ResponsiveContainer>
                    <LineChart data={sensitivity} margin={{ left: -10, right: 15, top: 10 }}>
                      <CartesianGrid stroke={chartTheme.grid} />
                      <XAxis
                        dataKey="veg"
                        stroke={chartTheme.axis}
                        fontSize={11}
                        tickLine={false}
                        tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
                      />
                      <YAxis stroke={chartTheme.axis} fontSize={11} tickLine={false} unit="°C" />
                      <Tooltip
                        contentStyle={chartTheme.tooltip}
                        labelFormatter={(v) => `Vegetation ${Number(v) > 0 ? "+" : ""}${v}%`}
                        formatter={(v) => `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(2)} °C`}
                      />
                      <ReferenceLine y={0} stroke="rgba(100,116,139,0.4)" />
                      <Line type="monotone" dataKey="vegOnly" name="Vegetation only" stroke="#10B981" strokeWidth={2} dot={false} strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="combined" name="Combined · linear" stroke="#FF6B35" strokeWidth={2.5} dot={false} />
                      <Line type="monotone" dataKey="ml" name="Combined · ML (2024 baseline)" stroke="#A78BFA" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <ReferenceDot
                        x={Math.round(veg / 5) * 5}
                        y={+result.dLst.toFixed(2)}
                        r={6}
                        fill="#fff"
                        stroke="#FF6B35"
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          </FlowSection>

          {/* supporting · planning information */}
          <FlowSection step="—" title="Planning Information" question="What does this mean for planning?">
            <div className="space-y-4">
              <Card
                title={<span className="flex items-center gap-2"><IndianRupee className="h-4 w-4 text-emerald-600" />Indicative cost</span>}
                subtitle="Capital cost of the intervention at editable unit rates"
                right={
                  <button
                    onClick={() => setShowCosts(!showCosts)}
                    className="text-[11px] font-medium text-slate-500 transition hover:text-slate-800"
                  >
                    {showCosts ? "hide rates" : "edit rates"}
                  </button>
                }
              >
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="text-slate-600">Greening method</span>
                  <Segmented
                    size="xs"
                    options={[{ value: "trees", label: "Street trees" }, { value: "miyawaki", label: "Miyawaki" }]}
                    value={method}
                    onChange={setMethod}
                  />
                </div>
                {showCosts && (
                  <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                    {(
                      [
                        ["streetTree", "₹ / tree (3-yr O&M)"],
                        ["miyawakiM2", "₹ / m² Miyawaki"],
                        ["depaveM2", "₹ / m² de-paving"],
                        ["coolRoofM2", "₹ / m² cool roof"],
                      ] as [keyof UnitCosts, string][]
                    ).map(([k, l]) => (
                      <label key={k} className="text-[10px] text-slate-500">
                        {l}
                        <input
                          type="number"
                          value={costs[k]}
                          onChange={(e) => setCosts({ ...costs, [k]: Number(e.target.value) })}
                          className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-[#FF6B35] focus:ring-2 focus:ring-orange-100"
                        />
                      </label>
                    ))}
                  </div>
                )}
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-slate-600">Total capital cost</p>
                  <p className="text-2xl font-bold tabular-nums text-emerald-800">{cost.total > 0 ? inr(cost.total) : "—"}</p>
                </div>
                <div className="mt-2">
                  {veg > 0 && (
                    <Stat
                      label={method === "trees"
                        ? `Street trees (${cost.trees.toLocaleString("en-IN")} × ₹${costs.streetTree.toLocaleString("en-IN")})`
                        : `Miyawaki (${Math.round(cost.vegAreaM2 / 1e4).toLocaleString("en-IN")} ha × ₹${costs.miyawakiM2}/m²)`}
                      value={inr(cost.costVeg)}
                    />
                  )}
                  {built < 0 && (
                    <Stat
                      label={`De-paving (${Math.round(cost.builtAreaM2 / 1e4).toLocaleString("en-IN")} ha × ₹${costs.depaveM2}/m²)`}
                      value={inr(cost.costBuilt)}
                    />
                  )}
                  <Stat label="Cost per °C of zone cooling" value={cost.perDegree ? inr(cost.perDegree) : "—"} tone="text-emerald-700" />
                  <Stat label="Cost per resident" value={cost.total > 0 ? `₹${Math.round(cost.perResident).toLocaleString("en-IN")}` : "—"} />
                  {built > 0 && (
                    <Stat
                      label="Cool-roof offset (informational)"
                      value={`${inr(cost.vegAreaM2 === 0 ? (built / 100) * zone.areaKm2 * 1e6 * 0.35 * costs.coolRoofM2 : 0)} for 35 % roof coverage`}
                    />
                  )}
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                  Indicative capital costs at default Indian urban-forestry / public-works rates; excludes land, design and long-term O&amp;M beyond year 3. Adjust rates to your tender data.
                </p>
                <button
                  onClick={exportScenario}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" /> Export scenario (JSON)
                </button>
              </Card>

              <Card title="Model backend" subtitle="Historical relationships from Component 2">
                <Formula>ΔLST = {reg.bNdvi.toFixed(2)}·ΔNDVI + {reg.bNdbi.toFixed(2)}·ΔNDBI</Formula>
                <p className="mt-2 text-[12px] leading-relaxed text-slate-600">
                  ΔNDVI = 0.72 × Δ(vegetation cover) and ΔNDBI = 0.75 × Δ(built-up cover) from the 2024 land-cover calibration; coefficients are the OLS fit (R² {reg.r2.toFixed(2)}) over{" "}
                  {reg.n.toLocaleString()} land pixels. 2030 BAU baseline extrapolates each zone's own 2019–24 trend.
                </p>
              </Card>
            </div>
          </FlowSection>
        </div>

        {/* 3 · Impact Analysis */}
        <div className="space-y-4 xl:col-span-4">
          <FlowSection step="4" title="Impact Analysis" question="What effect does it have?">
            <div data-tour="impact" className="space-y-4 scroll-mt-28">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Predicted zone ΔLST</p>
                <p className="mt-1 text-4xl font-bold tabular-nums tracking-tight text-[#FF6B35]">
                  {fmt.delta(result.dLst, 2, "°C")}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>± {(apiScenario?.uncertainty ?? result.uncertainty).toFixed(2)} °C (model + composite uncertainty)</span>
                  <Pill tone={apiScenario?.confidence === "High" ? "green" : apiScenario?.confidence === "Indicative" ? "amber" : "sky"}>
                    {apiScenario?.confidence ?? "estimating"} confidence
                  </Pill>
                </div>

                <div className="mt-3 rounded-xl border-l-4 border-violet-400 bg-violet-50 px-3 py-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 text-violet-800">
                      <BrainCircuit className="h-3.5 w-3.5" /> Non-linear model estimate
                    </span>
                    <Method kind="ml" />
                  </div>
                  {mlEstimate ? (
                    <>
                      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                        {fmt.delta(mlEstimate.ml, 2, "°C")}{" "}
                        <span className="text-xs font-normal text-slate-500">· 12-feature linear {fmt.delta(mlEstimate.linear, 2, "°C")}</span>
                      </p>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-slate-600">
                        {baseline === "2030" ? "Evaluated on the 2024 baseline (the ML model is not extrapolated to 2030). " : ""}
                        {mlEstimate.inRange
                          ? "Intervention stays within the observed feature range."
                          : "Part of the intervention lies outside the observed feature range — the linear estimate is more reliable there."}
                        {Math.abs(mlEstimate.ml) < Math.abs(result.dLst) * 0.8 && veg > 0
                          ? " Diminishing returns: the learned response saturates at high canopy."
                          : ""}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-600">Training surface model…</p>
                  )}
                </div>

                {apiScenario && (
                  <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-700">
                    <span className="font-semibold text-slate-900">Why this changes:</span> {apiScenario.explanation}
                  </p>
                )}

                <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-600">{fmt.temp(result.zoneBefore.lst)}</span>
                  <span className="text-slate-400">→</span>
                  <span className={cn("font-bold", cooling ? "text-emerald-700" : "text-[#C2410C]")}>{fmt.temp(result.zoneAfter.lst)}</span>
                </div>

                {result.coverWarning && (
                  <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    Vegetation + built-up exceeds available land in parts of the zone — scenario is physically capped.
                  </p>
                )}
              </div>

              <Card title="Combined effect breakdown" subtitle="Contribution of each lever">
                {[
                  { label: "Vegetation", v: result.dLstVeg, color: "#10B981" },
                  { label: "Built-up", v: result.dLstBuilt, color: "#A78BFA" },
                ].map((b) => (
                  <div key={b.label} className="mb-3 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-700">{b.label}</span>
                      <span className="font-semibold tabular-nums text-slate-900">{fmt.delta(b.v, 2, "°C")}</span>
                    </div>
                    <div className="relative mt-1 h-2 rounded-full bg-slate-100">
                      <div className="absolute left-1/2 top-0 h-full w-px bg-slate-300" />
                      <div
                        className="absolute top-0 h-full rounded-full"
                        style={{
                          background: b.color,
                          left: b.v < 0 ? `${50 - Math.min(50, Math.abs(b.v) * 12)}%` : "50%",
                          width: `${Math.min(50, Math.abs(b.v) * 12)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
                <Stat label="Zone NDVI" value={<>{result.zoneBefore.ndvi.toFixed(3)} → <span className="text-emerald-700">{result.zoneAfter.ndvi.toFixed(3)}</span></>} />
                <Stat label="Zone NDBI" value={<>{result.zoneBefore.ndbi.toFixed(3)} → <span className="text-violet-700">{result.zoneAfter.ndbi.toFixed(3)}</span></>} />
                <Stat label="Vegetation cover" value={<>{fmt.pct(result.zoneBefore.veg)} → {fmt.pct(result.zoneAfter.veg)}</>} />
                <Stat label="Built-up cover" value={<>{fmt.pct(result.zoneBefore.built)} → {fmt.pct(result.zoneAfter.built)}</>} />
              </Card>

              <Card title="Planning impact" subtitle="What this means for the city">
                <Stat
                  label="City-mean LST effect"
                  value={<span className="font-bold text-[#C2410C] text-base">{fmt.delta(result.cityDLst, 3, "°C")}</span>}
                />
                <Stat
                  label="vs 2019→24 warming here"
                  value={
                    <span className={cooling ? "text-emerald-700" : "text-[#C2410C]"}>
                      {cooling ? "offsets " : "adds "}
                      {Math.abs(offsetPct).toFixed(0)}%
                    </span>
                  }
                />
                <Stat
                  label={<span className="flex items-center gap-1"><Users className="h-3 w-3" /> Residents affected</span>}
                  value={<span className="text-base font-bold text-slate-900">~{(zone.zone.population / 1000).toFixed(0)}k</span>}
                />
                <Stat
                  label="Trees needed (est.)"
                  value={
                    <span className="text-base font-bold text-slate-900">
                      {veg > 0 ? `~${Math.round((veg / 100) * zone.areaKm2 * 1e6 / 25).toLocaleString()}` : "—"}
                    </span>
                  }
                />
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {veg >= 20 && <Pill tone="green">Miyawaki-scale</Pill>}
                  {built < 0 && <Pill tone="orange">De-paving</Pill>}
                  {built > 15 && <Pill tone="red">Heat-risk increase</Pill>}
                  {result.dLst < -1 && <Pill tone="green">≥1 °C cooling</Pill>}
                </div>
              </Card>
            </div>
          </FlowSection>
        </div>
      </div>

      {/* ================================================================= */}
      {/* NEW SECTION · Interactive Environmental Simulation (supporting)  */}
      {/* ================================================================= */}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.06)] sm:p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          {/* left: copy */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
                <Leaf className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Supporting demonstration
                </p>
                <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                  Interactive Environmental Simulation
                </h2>
              </div>
            </div>

            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-700">
              Explore how vegetation, weather and time can influence environmental conditions through an interactive 3D simulation.
            </p>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-slate-500">
              Our satellite analysis helps us study urban heat and environmental changes across Nagpur over time. This interactive simulation provides another way to understand the concept by allowing environmental conditions to be changed and their effects to be observed visually.
            </p>

            {/* subtle theme hints — small chips, not cards */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                <Leaf className="h-3 w-3 text-emerald-600" /> Vegetation
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                <CloudSun className="h-3 w-3 text-sky-600" /> Weather
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                <ThermometerSun className="h-3 w-3 text-[#FF6B35]" /> Temperature
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                <Clock className="h-3 w-3 text-violet-600" /> Time of day
              </span>
            </div>
          </div>

          {/* right: CTA */}
          <div className="shrink-0 lg:text-right">
            <a
              href={EXTERNAL_ENV_SIM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2 rounded-xl bg-[#FF6B35] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e85a28]"
            >
              Explore 3D Simulation
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <p className="mt-1.5 text-center text-[10px] text-slate-400 lg:text-right">
              Opens in a new tab
            </p>
          </div>
        </div>

        {/* disclaimer footer */}
        <p className="mt-5 border-t border-slate-100 pt-3 text-[10px] leading-relaxed text-slate-400">
          This simulation is an external supporting tool, not part of our UHI calculation pipeline. It is provided to illustrate environmental concepts and does not use the Nagpur satellite dataset or our ML models.
        </p>
      </section>

      <TourOverlay
        step={tourStep}
        onBack={() => setTourStep((s) => (s === null ? null : Math.max(0, s - 1)))}
        onNext={() =>
          setTourStep((s) =>
            s === null ? null : s + 1 >= TOUR_STEPS.length ? (localStorage.setItem(TOUR_KEY, "1"), null) : s + 1,
          )
        }
        onSkip={finishTour}
      />
    </div>
  );
}