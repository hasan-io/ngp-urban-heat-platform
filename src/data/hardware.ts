/**
 * Hardware / IoT simulation engine.
 *
 * The page that uses this is a SIMULATION. No physical sensors are deployed
 * in Nagpur. The simulation demonstrates how a future sensor network would
 * interact with the UHI platform: multi-day trend monitoring → early warning
 * → geographic alert.
 *
 * All values are deterministic — reproducible on every reset.
 */
import { LANDMARKS } from "./nagpur";

export type SensorState = "normal" | "rising" | "warning" | "critical" | "offline";
export type AlertSeverity = "info" | "warning" | "critical";

export interface SensorReading {
  day: number;
  clock: string;
  value: number;
}

export interface Sensor {
  id: string;
  name: string;
  zone: string;
  lat: number;
  lon: number;
  baseline: number;
  trendPerDay: number;
  humidity: number;
  offlineAtDay?: number;
  readings: SensorReading[];
  state: SensorState;
}

export interface AlertEvent {
  id: string;
  clock: string;
  area: string;
  sensorId: string;
  message: string;
  severity: AlertSeverity;
}

// ------------------------------------------------------------------ timing
export const SIM_MAX_DAYS = 6;
export const SIM_BASE_INTERVAL_MS = 5000;   // 1× speed = 5 s per simulated day
export const SIM_ALERT_DURATION_MS = 5000;  // central overlay visible this long

// ------------------------------------------------------------------ deterministic PRNG
/** mulberry32 — small, fast, reproducible */
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

// ------------------------------------------------------------------ sensor definitions
interface SensorDef {
  id: string;
  landmark: string;      // matches LANDMARKS[i].name
  zone: string;
  baseline: number;      // °C at day 1
  trendPerDay: number;   // °C / day
  humidity: number;      // %
  offlineAtDay?: number;
}

const SENSOR_DEFS: SensorDef[] = [
  { id: "NGP-S01", landmark: "Zero Mile",        zone: "Sitabuldi – Zero Mile",   baseline: 33.5, trendPerDay: 0.15, humidity: 42 },
  { id: "NGP-S02", landmark: "Itwari",           zone: "Itwari – Mahal",          baseline: 34.0, trendPerDay: 0.12, humidity: 38 },
  { id: "NGP-S03", landmark: "Koradi TPS",       zone: "Koradi – Kamptee Rd",     baseline: 33.8, trendPerDay: 0.72, humidity: 31 },
  { id: "NGP-S04", landmark: "Hingna MIDC",      zone: "Hingna MIDC",             baseline: 33.6, trendPerDay: 0.34, humidity: 35 },
  { id: "NGP-S05", landmark: "Seminary Hills",   zone: "Seminary Hills – Futala", baseline: 30.2, trendPerDay: 0.02, humidity: 55 },
  { id: "NGP-S06", landmark: "Ambazari Lake",    zone: "Ambazari – VNIT",         baseline: 29.8, trendPerDay: -0.03, humidity: 62 },
  { id: "NGP-S07", landmark: "Gorewada Reserve", zone: "Gorewada – Koradi Rd",    baseline: 29.4, trendPerDay: 0.02, humidity: 58 },
  { id: "NGP-S08", landmark: "MIHAN SEZ",        zone: "MIHAN – Jamtha",          baseline: 34.4, trendPerDay: 0.20, humidity: 34 },
  { id: "NGP-S09", landmark: "Airport",          zone: "Airport – Sonegaon",      baseline: 33.9, trendPerDay: 0.18, humidity: 36 },
  { id: "NGP-S10", landmark: "Besa",             zone: "Besa – Beltarodi",        baseline: 33.2, trendPerDay: 0.30, humidity: 40 },
  { id: "NGP-S11", landmark: "Wathoda",          zone: "Wathoda – Hudkeshwar",    baseline: 33.4, trendPerDay: 0.28, humidity: 41 },
  { id: "NGP-S12", landmark: "Manish Nagar",     zone: "Manish Nagar – Somalwada",baseline: 33.6, trendPerDay: 0.25, humidity: 39 },
  { id: "NGP-S13", landmark: "Futala Lake",      zone: "Seminary Hills – Futala", baseline: 30.4, trendPerDay: 0.04, humidity: 60, offlineAtDay: 4 },
];

const LM = new Map(LANDMARKS.map((l) => [l.name, l]));

/** Create a fresh, reproducible sensor network. */
export function createSensors(): Sensor[] {
  const rnd = mulberry32(20260101);
  return SENSOR_DEFS.map((d) => {
    const lm = LM.get(d.landmark);
    // tiny per-sensor humidity jitter, deterministic
    const hum = Math.round(d.humidity + (rnd() - 0.5) * 3);
    return {
      id: d.id,
      name: `${d.id} · ${d.landmark}`,
      zone: d.zone,
      lat: lm?.lat ?? 21.146,
      lon: lm?.lon ?? 79.088,
      baseline: d.baseline,
      trendPerDay: d.trendPerDay,
      humidity: hum,
      offlineAtDay: d.offlineAtDay,
      readings: [],
      state: "normal" as SensorState,
    };
  });
}

// ------------------------------------------------------------------ simulated clock
/** Each simulated day = 1 hour, starting 08:00. */
export function simClock(day: number): string {
  const hour = Math.min(23, 8 + day);
  return `${String(hour).padStart(2, "0")}:00`;
}

// ------------------------------------------------------------------ step function
/** Advance a single sensor by one simulated day. Returns a new Sensor object. */
export function advanceSensor(s: Sensor, nextDay: number, rnd: () => number): Sensor {
  if (s.offlineAtDay != null && nextDay >= s.offlineAtDay) {
    return { ...s, state: "offline" };
  }
  // Small deterministic noise around the trend line (±0.2 °C)
  const noise = (rnd() - 0.5) * 0.4;
  const value = +(s.baseline + s.trendPerDay * (nextDay - 1) + noise).toFixed(1);
  const readings = [...s.readings, { day: nextDay, clock: simClock(nextDay), value }];
  return { ...s, readings, state: evaluateState(readings) };
}

/**
 * Trend-based state evaluation — a single reading never triggers critical.
 * Requires sustained rise over multiple days.
 */
function evaluateState(readings: SensorReading[]): SensorState {
  const n = readings.length;
  if (n < 2) return "normal";
  const delta = readings[n - 1].value - readings[0].value;
  if (n >= 6 && delta >= 3.0) return "critical";
  if (n >= 5 && delta >= 2.0) return "warning";
  if (n >= 3 && delta >= 0.6) return "rising";
  return "normal";
}

// ------------------------------------------------------------------ helpers
export function deltaOf(s: Sensor): number {
  if (s.readings.length < 2) return 0;
  return +(s.readings[s.readings.length - 1].value - s.readings[0].value).toFixed(2);
}

export function latestValue(s: Sensor): number | null {
  if (!s.readings.length) return null;
  return s.readings[s.readings.length - 1].value;
}

export const STATE_LABEL: Record<SensorState, string> = {
  normal: "Normal",
  rising: "Rising",
  warning: "Warning",
  critical: "Critical",
  offline: "Offline",
};

export const STATE_COLOR: Record<SensorState, string> = {
  normal: "#10B981",
  rising: "#F59E0B",
  warning: "#F97316",
  critical: "#DC2626",
  offline: "#94A3B8",
};

// ------------------------------------------------------------------ sound
/**
 * Short three-beep warning via Web Audio. No external file.
 * Called once per critical transition; caller must not loop it.
 */
export function playAlertSound(): void {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    const now = ctx.currentTime;

    const sequence: [number, number, number][] = [
      [880, 0.00, 0.14],
      [880, 0.22, 0.14],
      [660, 0.44, 0.28],
    ];

    for (const [freq, start, dur] of sequence) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.30, now + start + 0.02);
      gain.gain.setValueAtTime(0.30, now + start + dur - 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    }

    window.setTimeout(() => { void ctx.close(); }, 1400);
  } catch {
    /* autoplay blocked or unsupported — ignore */
  }
}

/** Prime the audio context inside a user gesture so the alert can play. */
export function primeAudio(): void {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    void ctx.resume();
    window.setTimeout(() => { void ctx.close(); }, 200);
  } catch { /* ignore */ }
}