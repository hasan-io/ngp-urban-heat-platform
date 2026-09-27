import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity, AlertTriangle, Droplets, Pause, Play, RotateCcw, ThermometerSun,
  TrendingUp, Volume2, VolumeX, X,
} from "lucide-react";
import SensorMap from "@/components/SensorMap";
import { Pill, Stat, chartTheme } from "@/components/ui";
import { useI18n } from "@/i18n";
import {
  SIM_ALERT_DURATION_MS, SIM_BASE_INTERVAL_MS, SIM_MAX_DAYS,
  STATE_COLOR,
  advanceSensor, createSensors, deltaOf, latestValue, playAlertSound, primeAudio, simClock,
  type AlertEvent, type Sensor,
} from "@/data/hardware";
import { cn } from "@/utils/cn";

type RunStatus = "idle" | "running" | "paused" | "done";

/** Tiny deterministic PRNG — separate instance so it can be re-seeded on reset. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function HardwareSimulation() {
  const { t } = useI18n();
  const [sensors, setSensors] = useState<Sensor[]>(() => createSensors());
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [day, setDay] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [selected, setSelected] = useState<Sensor | null>(null);
  const [activeAlert, setActiveAlert] = useState<AlertEvent | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  // -------- refs that must survive re-renders without triggering them --------
  const rndRef = useRef<() => number>(mulberry32(20260101));
  const prevStatesRef = useRef<Record<string, string>>({});
  const alertTimerRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);

  // -------- day tick --------
  const tickDay = useCallback(() => {
    setDay((d) => {
      const next = d + 1;
      if (next > SIM_MAX_DAYS) {
        setStatus("done");
        return d;
      }
      setSensors((prev) => prev.map((s) => advanceSensor(s, next, rndRef.current)));
      return next;
    });
  }, []);

  // -------- day interval — created once when running, cleaned up on pause/unmount --------
  useEffect(() => {
    if (status !== "running") return;
    const ms = SIM_BASE_INTERVAL_MS / speed;
    const id = window.setInterval(tickDay, ms);
    return () => window.clearInterval(id);
  }, [status, speed, tickDay]);

  // -------- elapsed timer — 1 Hz while running --------
  useEffect(() => {
    if (status !== "running") return;
    const id = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    elapsedTimerRef.current = id;
    return () => {
      window.clearInterval(id);
      elapsedTimerRef.current = null;
    };
  }, [status]);

  // -------- alert detection — reacts to sensor state changes, one pass per render --------
  useEffect(() => {
    const transitions: AlertEvent[] = [];
    for (const s of sensors) {
      const prev = prevStatesRef.current[s.id] ?? "normal";
      if (prev !== s.state) {
        const clock = simClock(day);
        if (s.state === "warning" && prev !== "critical") {
          transitions.push({
            id: `${s.id}-warn-${day}`,
            clock,
            area: s.zone,
            sensorId: s.id,
            message: t("hw.risingTrendDetected"),
            severity: "warning",
          });
        } else if (s.state === "critical" && prev !== "critical") {
          transitions.push({
            id: `${s.id}-crit-${day}`,
            clock,
            area: s.zone,
            sensorId: s.id,
            message: t("hw.persistentTempRiseCritical"),
            severity: "critical",
          });
        } else if (s.state === "offline") {
          transitions.push({
            id: `${s.id}-off-${day}`,
            clock,
            area: s.zone,
            sensorId: s.id,
            message: t("hw.sensorOfflineEvent"),
            severity: "info",
          });
        }
        prevStatesRef.current[s.id] = s.state;
      }
    }

    if (transitions.length === 0) return;

    // push all events to history
    setAlerts((prev) => [...transitions.reverse(), ...prev]);

    // if a critical event just occurred, fire the overlay + sound
    const critical = transitions.find((x) => x.severity === "critical");
    if (critical) {
      setActiveAlert(critical);
      if (!muted) playAlertSound();
      if (alertTimerRef.current) window.clearTimeout(alertTimerRef.current);
      alertTimerRef.current = window.setTimeout(() => {
        setActiveAlert((cur) => (cur?.id === critical.id ? null : cur));
      }, SIM_ALERT_DURATION_MS);
    }
    // t changes when language changes; re-running is harmless (transitions is empty)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sensors, day, muted]);

  // -------- cleanup on unmount --------
  useEffect(() => () => {
    if (alertTimerRef.current) window.clearTimeout(alertTimerRef.current);
    if (elapsedTimerRef.current) window.clearInterval(elapsedTimerRef.current);
  }, []);

  // -------- actions --------
  const start = () => {
    primeAudio();
    if (status === "done") reset();
    setStatus("running");
  };
  const pause = () => setStatus("paused");
  const reset = () => {
    if (alertTimerRef.current) { window.clearTimeout(alertTimerRef.current); alertTimerRef.current = null; }
    rndRef.current = mulberry32(20260101);
    prevStatesRef.current = {};
    setSensors(createSensors());
    setAlerts([]);
    setActiveAlert(null);
    setSelected(null);
    setDay(0);
    setElapsedSec(0);
    setStatus("idle");
  };

  // -------- derived stats (memoised — no work on unrelated renders) --------
  const online = sensors.filter((s) => s.state !== "offline").length;
  const activeAlerts = alerts.filter((a) => a.severity === "critical").length;
  const hottest = useMemo(() => {
    return sensors.reduce<Sensor | null>((acc, s) => {
      const v = latestValue(s);
      if (v == null) return acc;
      if (!acc) return s;
      const av = latestValue(acc);
      return av == null || v > av ? s : acc;
    }, null);
  }, [sensors]);
  const hottestValue = hottest ? latestValue(hottest) : null;
  const hottestDelta = hottest ? deltaOf(hottest) : 0;

  const criticalSensors = useMemo(() => sensors.filter((s) => s.state === "critical"), [sensors]);
  const hasCritical = criticalSensors.length > 0;
  const running = status === "running";

  const chartData = useMemo(() => {
    const days = Math.max(1, day);
    const rows: Record<string, number | string>[] = [];
    for (let d = 1; d <= days; d++) {
      const row: Record<string, number | string> = { day: `${t("hw.day")} ${d}` };
      for (const s of sensors) {
        const r = s.readings.find((x) => x.day === d);
        if (r) row[s.id] = r.value;
      }
      rows.push(row);
    }
    return rows;
  }, [sensors, day, t]);

  const alertBandFrom = criticalSensors.length ? `${t("hw.day")} ${Math.max(1, (criticalSensors[0].readings.length || 1) - 3)}` : null;
  const alertBandTo = day > 0 ? `${t("hw.day")} ${day}` : null;

  // -------- timeline stages --------
  const STAGES: { day: number; label: string }[] = [
    { day: 1, label: t("hw.timelineBaseline") },
    { day: 2, label: t("hw.timelineRising") },
    { day: 3, label: t("hw.timelineRising") },
    { day: 4, label: t("hw.timelineWarning") },
    { day: 5, label: t("hw.timelinePersistentHeat") },
    { day: 6, label: t("hw.timelineCritical") },
  ];

  const fmtElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  };

  // Local state labels — use i18n instead of hardware.ts STATE_LABEL
  const stateLabels: Record<Sensor["state"], string> = {
    normal: t("hw.sensorNormal"),
    rising: t("hw.sensorRising"),
    warning: t("hw.sensorWarning"),
    critical: t("hw.sensorCritical"),
    offline: t("hw.sensorOffline"),
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 p-4 sm:p-6">
      {/* ============= HEADER ============= */}
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#C2410C]">{t("nav.hardware")}</p>
          <div className="mt-1 flex items-center gap-2">
            <Activity className="h-5 w-5 text-[#FF6B35]" />
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{t("hw.title")}</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{t("hw.subtitle")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Pill tone="amber">{t("common.simulationMode")}</Pill>
            <Pill tone={running ? "green" : hasCritical ? "red" : "slate"}>
              {status === "idle" ? t("hw.ready") : running ? t("hw.monitoring") : status === "paused" ? t("hw.paused") : hasCritical ? t("hw.criticalAlert") : t("hw.complete")}
            </Pill>
            <Pill tone="slate">{online} / {sensors.length} {t("hw.activeSensors").toLowerCase()}</Pill>
          </div>
        </div>
      </header>

      {/* ============= CONTROL BAR ============= */}
      <div className={cn(
        "rounded-2xl border bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-colors duration-500",
        running ? "border-emerald-300" : hasCritical ? "border-red-300" : "border-slate-200",
      )}>
        <div className="flex flex-wrap items-center gap-3">
          <div className={cn(
            "inline-flex items-center gap-2 rounded-xl border px-3 py-2",
            running ? "border-emerald-300 bg-emerald-50" : status === "paused" ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50",
          )}>
            <span className={cn(
              "h-2 w-2 rounded-full",
              running ? "live-dot bg-emerald-500" : status === "paused" ? "bg-amber-500" : status === "done" ? "bg-slate-400" : "bg-slate-300",
            )} />
            <span className={cn(
              "text-xs font-semibold uppercase tracking-wider",
              running ? "text-emerald-800" : status === "paused" ? "text-amber-800" : "text-slate-600",
            )}>
              {status === "idle" ? t("hw.ready") : running ? t("hw.monitoring") : status === "paused" ? t("hw.paused") : t("hw.complete")}
            </span>
          </div>

          <div className="flex min-w-[180px] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <ThermometerSun className={cn("h-4 w-4", running ? "text-[#FF6B35]" : "text-slate-400")} />
            <div className="flex-1">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("hw.simDay")}</span>
                <span className="text-base font-bold tabular-nums text-slate-900">{day} / {SIM_MAX_DAYS}</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div className="h-full bg-[#FF6B35] transition-[width] duration-500 ease-out" style={{ width: `${(day / SIM_MAX_DAYS) * 100}%` }} />
              </div>
            </div>
          </div>

          <div className={cn(
            "flex items-center gap-2 rounded-xl border px-3 py-2",
            activeAlerts > 0 ? "border-red-300 bg-red-50" : "border-slate-200 bg-slate-50",
          )}>
            <AlertTriangle className={cn("h-3.5 w-3.5", activeAlerts > 0 ? "text-[#DC2626]" : "text-slate-400")} />
            <span className={cn("text-xs", activeAlerts > 0 ? "text-red-700" : "text-slate-600")}>{t("hw.alerts")}</span>
            <span className={cn("text-sm font-bold tabular-nums", activeAlerts > 0 ? "text-[#DC2626]" : "text-slate-900")}>{activeAlerts}</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {status === "idle" || status === "done" ? (
              <button onClick={start} className="flex items-center gap-1.5 rounded-xl bg-[#FF6B35] px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#e85a28]">
                <Play className="h-3.5 w-3.5" /> {t("hw.startSimulation")}
              </button>
            ) : running ? (
              <button onClick={pause} className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50">
                <Pause className="h-3.5 w-3.5" /> {t("hw.pause")}
              </button>
            ) : (
              <button onClick={start} className="flex items-center gap-1.5 rounded-xl bg-[#FF6B35] px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#e85a28]">
                <Play className="h-3.5 w-3.5" /> {t("hw.resumeSim")}
              </button>
            )}
            <button onClick={reset} className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50">
              <RotateCcw className="h-3.5 w-3.5" /> {t("common.reset")}
            </button>
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
              {[1, 2, 4].map((s) => (
                <button key={s} onClick={() => setSpeed(s)} className={cn("rounded-md px-2.5 py-1 text-[11px] font-semibold transition", speed === s ? "bg-[#FF6B35] text-white" : "text-slate-600 hover:bg-slate-100")}>
                  {s}×
                </button>
              ))}
            </div>
            <button onClick={() => setMuted((m) => !m)} title={muted ? t("common.unmute") : t("common.mute")} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50">
              {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* ----- timeline ----- */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 text-[11px]">
          <span className="font-semibold uppercase tracking-wider text-slate-500">{t("hw.timeline")}</span>
          {STAGES.map((st) => (
            <span key={st.day} className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition",
              day >= st.day
                ? st.day === 6
                  ? "border-red-300 bg-red-50 text-red-800"
                  : "border-orange-200 bg-orange-50 text-[#C2410C]"
                : "border-slate-200 bg-white text-slate-500",
            )}>
              <span className="font-bold tabular-nums">{t("hw.day")} {st.day}</span>
              <span>— {st.label}</span>
            </span>
          ))}
        </div>
      </div>

      {/* ============= MAP + SENSORS ============= */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className={cn(
          "overflow-hidden rounded-2xl border bg-white shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-all duration-700",
          hasCritical ? "border-red-300 shadow-[0_0_0_3px_rgba(220,38,38,0.10),0_2px_8px_rgba(15,23,42,0.06)]" : "border-slate-200",
        )}>
          <div className="h-[520px] w-full">
            <SensorMap sensors={sensors} onSensorClick={setSelected} />
          </div>

          {hasCritical && !activeAlert && (
            <div className="border-t border-red-200 bg-red-50 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[#DC2626]">
                  <AlertTriangle className="h-3.5 w-3.5" /> {t("hw.heatTrendAlertActive")}
                </span>
                {criticalSensors.map((s) => (
                  <span key={s.id} className="text-red-800">
                    {s.zone} · {latestValue(s)?.toFixed(1)} °C · +{deltaOf(s).toFixed(1)} °C
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 px-4 py-2.5 text-[11px]">
            <span className="font-semibold uppercase tracking-wider text-slate-500">{t("hw.sensorState")}</span>
            {(["normal", "rising", "warning", "critical", "offline"] as const).map((st) => (
              <span key={st} className="flex items-center gap-1.5 text-slate-600">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATE_COLOR[st] }} />
                {stateLabels[st]}
              </span>
            ))}
          </div>
        </div>

        {/* ----- side panel ----- */}
        <aside className="space-y-3">
          <div className={cn(
            "rounded-2xl border bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-colors duration-500",
            running ? "border-emerald-200" : "border-slate-200",
          )}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">{t("hw.liveMonitoringPanel")}</h3>
              {running ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                  <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-500" /> {t("hw.live")}
                </span>
              ) : (
                <Pill tone="slate">{status === "idle" ? t("hw.ready") : status === "paused" ? t("hw.paused") : t("hw.complete")}</Pill>
              )}
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("hw.currentTempHighest")}</p>
                <p className="mt-0.5 text-3xl font-bold tabular-nums text-[#FF6B35]">
                  {hottestValue != null ? `${hottestValue.toFixed(1)} °C` : "—"}
                </p>
                <p className="text-[11px] text-slate-500">{hottest ? hottest.zone : t("hw.awaitingFirstReading")}</p>
              </div>

              <Stat
                label={<span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" /> {t("hw.temperatureTrend")}</span>}
                value={
                  <span className={cn("text-base font-bold tabular-nums", hottestDelta >= 2 ? "text-[#DC2626]" : hottestDelta >= 1 ? "text-amber-600" : "text-slate-700")}>
                    {hottestDelta >= 0 ? "+" : ""}{hottestDelta.toFixed(1)} °C
                  </span>
                }
              />
              <Stat label={<span className="flex items-center gap-1"><Droplets className="h-3 w-3" /> {t("hw.humidity")}</span>} value={hottest ? `${hottest.humidity}%` : "—"} />
              <Stat label={t("hw.activeSensors")} value={<span className="text-base font-bold text-slate-900">{online} / {sensors.length}</span>} />
              <Stat label={t("hw.activeAlerts")} value={<span className={cn("text-base font-bold", activeAlerts > 0 ? "text-[#DC2626]" : "text-slate-700")}>{activeAlerts}</span>} />
              <Stat label={t("hw.monitoringDuration")} value={<span className="text-base font-bold tabular-nums text-slate-900">{fmtElapsed(elapsedSec)}</span>} />
            </div>
          </div>

          {/* sensor list */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
            <h3 className="text-sm font-semibold text-slate-900">{t("hw.sensorNetwork")}</h3>
            <ul className="mt-3 max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
              {sensors.map((s) => (
                <li key={s.id}>
                  <button onClick={() => setSelected(s)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition hover:bg-slate-50">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATE_COLOR[s.state] }} />
                    <span className="font-mono text-slate-700">{s.id}</span>
                    <span className="truncate text-slate-500">{s.zone}</span>
                    <span className="ml-auto font-semibold tabular-nums text-slate-700">
                      {latestValue(s) != null ? `${latestValue(s)!.toFixed(1)}°` : "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* satellite vs sensor note */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("hw.satelliteVsSensor")}</p>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
              {t("hw.satelliteVsSensorNote")}
            </p>
          </div>
        </aside>
      </div>

      {/* ============= TREND CHART ============= */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{t("hw.trendChartTitle", { day: Math.max(1, day), total: SIM_MAX_DAYS })}</h2>
            <p className="text-xs text-slate-500">{t("hw.trendChartSubtitle")}</p>
          </div>
          {hasCritical && <Pill tone="red">{t("hw.persistentRiseDetected", { n: criticalSensors.length })}</Pill>}
        </div>

        <div className="mt-4 h-72">
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ left: -8, right: 16, top: 10, bottom: 4 }}>
              <CartesianGrid stroke={chartTheme.grid} vertical={false} />
              <XAxis dataKey="day" stroke={chartTheme.axis} fontSize={11} tickLine={false} />
              <YAxis stroke={chartTheme.axis} fontSize={11} tickLine={false} domain={[28, "auto"]} unit="°C" />
              <Tooltip contentStyle={chartTheme.tooltip} formatter={(v) => `${Number(v).toFixed(1)} °C`} />
              <ReferenceLine y={38} stroke="#DC2626" strokeDasharray="4 4" label={{ value: t("hw.heatAlertBand"), position: "insideTopRight", fill: "#DC2626", fontSize: 10 }} />
              {alertBandFrom && alertBandTo && hasCritical && (
                <ReferenceArea x1={alertBandFrom} x2={alertBandTo} fill="#DC2626" fillOpacity={0.08} />
              )}
              {sensors.map((s) => (
                <Line
                  key={s.id}
                  type="monotone"
                  dataKey={s.id}
                  name={s.id}
                  stroke={STATE_COLOR[s.state]}
                  strokeWidth={s.state === "critical" ? 3 : s.state === "warning" ? 2.2 : 1.5}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ============= ALERT HISTORY ============= */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">{t("hw.alertHistory")}</h2>
          <Pill tone="slate">{alerts.length} {t("hw.event").toLowerCase()}</Pill>
        </div>
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">{t("hw.time")}</th>
                <th className="px-3 py-2 text-left font-semibold">{t("hw.sensor")}</th>
                <th className="px-3 py-2 text-left font-semibold">{t("hw.area")}</th>
                <th className="px-3 py-2 text-left font-semibold">{t("hw.event")}</th>
                <th className="px-3 py-2 text-center font-semibold">{t("hw.severity")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {alerts.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">{t("hw.noEventsYet")}</td></tr>
              )}
              {alerts.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 tabular-nums text-slate-600">{a.clock}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{a.sensorId}</td>
                  <td className="px-3 py-2 text-slate-700">{a.area}</td>
                  <td className="px-3 py-2 text-slate-700">{a.message}</td>
                  <td className="px-3 py-2 text-center">
                    <Pill tone={a.severity === "critical" ? "red" : a.severity === "warning" ? "amber" : "slate"}>{a.severity}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ============= CENTRAL ALERT OVERLAY ============= */}
      {activeAlert && (
        <div className="alert-backdrop-enter fixed inset-0 z-[950] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-[2px]">
          <div className="alert-overlay-enter w-full max-w-xl overflow-hidden rounded-2xl border-2 border-[#DC2626] bg-white shadow-[0_24px_60px_rgba(220,38,38,0.35)]">
            <div className="flex items-center justify-between bg-[#DC2626] px-6 py-4 text-white">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-6 w-6" />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] opacity-90">{t("hw.simulatedMonitoringAlert")}</p>
                  <p className="text-lg font-bold uppercase tracking-wide">{t("hw.criticalEnvAlert")}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMuted((m) => !m)}
                  title={muted ? t("common.unmute") : t("common.mute")}
                  className="rounded-lg border border-white/30 bg-white/10 p-2 transition hover:bg-white/20"
                >
                  {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <button onClick={() => setActiveAlert(null)} className="rounded-lg border border-white/30 bg-white/10 p-2 transition hover:bg-white/20" aria-label={t("common.close")}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="px-8 py-7">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t("hw.affectedArea")}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{activeAlert.area}</p>

              <div className="mt-5 grid grid-cols-2 gap-4">
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-red-700">{t("hw.currentReading")}</p>
                  <p className="mt-1 text-4xl font-bold tabular-nums text-[#DC2626]">
                    {sensors.find((s) => s.id === activeAlert.sensorId)?.readings.slice(-1)[0]?.value.toFixed(1) ?? "—"} °C
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("hw.trend")}</p>
                  <p className="mt-1 text-4xl font-bold tabular-nums text-[#C2410C]">
                    +{(deltaOf(sensors.find((s) => s.id === activeAlert.sensorId) ?? sensors[0])).toFixed(1)} °C
                  </p>
                  <p className="text-[11px] text-slate-500">{t("hw.overDays", { n: day })}</p>
                </div>
              </div>

              <div className="mt-5 rounded-xl border-l-4 border-[#DC2626] bg-red-50/60 px-4 py-3">
                <p className="text-sm font-bold uppercase tracking-wide text-[#DC2626]">{t("hw.persistentTempRise")}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-700">
                  {t("hw.persistentTempRiseNote")}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  {t("hw.sensor")}: <span className="font-mono font-semibold text-slate-800">{activeAlert.sensorId}</span> ·{" "}
                  {t("hw.simulatedTime")}: <span className="font-semibold text-slate-800">{activeAlert.clock}</span>
                </span>
                <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#DC2626]">{t("hw.active")}</span>
              </div>
            </div>

            <div className="h-1 w-full bg-red-100">
              <div className="h-full bg-[#DC2626]" style={{ animation: `alertShrink ${SIM_ALERT_DURATION_MS}ms linear forwards` }} />
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes alertShrink { from { width: 100%; } to { width: 0%; } }`}</style>

      {/* ============= SENSOR DETAIL MODAL ============= */}
      {selected && (
        <div className="fixed inset-0 z-[900] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("hw.sensorDetail")}</p>
                <p className="text-sm font-semibold text-slate-900">{selected.name}</p>
                <p className="text-xs text-slate-500">{selected.zone}</p>
              </div>
              <button onClick={() => setSelected(null)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATE_COLOR[selected.state] }} />
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: STATE_COLOR[selected.state] }}>
                  {stateLabels[selected.state]}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("hw.currentReading")}</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-[#C2410C]">
                    {latestValue(selected) != null ? `${latestValue(selected)!.toFixed(1)} °C` : "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("hw.baseline")}</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-slate-800">{selected.baseline.toFixed(1)} °C</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("hw.change")}</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-[#C2410C]">+{deltaOf(selected).toFixed(1)} °C</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("hw.humidity")}</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-slate-800">{selected.humidity}%</p>
                </div>
              </div>

              <div className="mt-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("hw.recentReadings")}</p>
                <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-semibold">{t("hw.day")}</th>
                        <th className="px-3 py-1.5 text-left font-semibold">{t("hw.clock")}</th>
                        <th className="px-3 py-1.5 text-right font-semibold">{t("hw.temp")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selected.readings.length === 0 && (
                        <tr><td colSpan={3} className="px-3 py-3 text-center text-slate-400">{t("hw.noReadingsYet")}</td></tr>
                      )}
                      {selected.readings.slice(-6).reverse().map((r) => (
                        <tr key={r.day}>
                          <td className="px-3 py-1.5 text-slate-700">{t("hw.day")} {r.day}</td>
                          <td className="px-3 py-1.5 text-slate-500 tabular-nums">{r.clock}</td>
                          <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-800">{r.value.toFixed(1)} °C</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}