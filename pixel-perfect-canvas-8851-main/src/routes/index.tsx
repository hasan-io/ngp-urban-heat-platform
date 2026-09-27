import { createFileRoute } from "@tanstack/react-router";
import { Layers, Satellite, Thermometer } from "lucide-react";

import { VoiceQuery } from "@/components/VoiceQuery";
import { CITY_MEAN_LST, zones } from "@/lib/uhi-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Voice Query — Nagpur Netra" },
      {
        name: "description",
        content:
          "Ask questions by voice about Nagpur's urban heat island data and get an instant AI analysis of land surface temperature by zone.",
      },
      { property: "og:title", content: "Voice Query — Nagpur Netra" },
      {
        property: "og:description",
        content:
          "Speak a question about Nagpur's heat zones and the platform answers with land surface temperature insights.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VoiceQueryDemo,
});

function heatColor(anomaly: number) {
  if (anomaly >= 5) return "var(--heat-5)";
  if (anomaly >= 3.5) return "var(--heat-4)";
  if (anomaly >= 2) return "var(--heat-3)";
  if (anomaly >= 0.5) return "var(--heat-2)";
  if (anomaly >= -2.5) return "var(--heat-1)";
  return "var(--heat-0)";
}

function VoiceQueryDemo() {
  const hottest = [...zones].sort((a, b) => b.lst - a.lst).slice(0, 3);

  return (
    <div className="min-h-screen bg-background font-sans">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Thermometer className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight text-foreground">
                Nagpur Netra
              </h1>
              <p className="font-mono text-[11px] text-muted-foreground">
                Urban Heat Island Analysis · Voice Query
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <Satellite className="h-3.5 w-3.5" />
            Landsat-8/9 LST composite · 2015–2025
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[1.6fr_1fr]">
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-panel">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Layers className="h-4 w-4 text-primary" />
              Surface temperature anomaly
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">
              city mean {CITY_MEAN_LST} °C
            </span>
          </div>

          <div className="relative aspect-[4/3] w-full bg-secondary/60">
            <svg className="absolute inset-0 h-full w-full" aria-hidden>
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path
                    d="M 40 0 L 0 0 0 40"
                    fill="none"
                    stroke="var(--border)"
                    strokeWidth="1"
                  />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>

            {zones.map((z) => (
              <div
                key={z.id}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${z.x}%`, top: `${z.y}%` }}
              >
                <div
                  className="h-20 w-20 rounded-full blur-xl"
                  style={{ backgroundColor: heatColor(z.anomaly), opacity: 0.55 }}
                />
              </div>
            ))}

            {zones.map((z) => (
              <div
                key={`${z.id}-label`}
                className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
                style={{ left: `${z.x}%`, top: `${z.y}%` }}
              >
                <span
                  className="mx-auto block h-2.5 w-2.5 rounded-full border-2 border-card"
                  style={{ backgroundColor: heatColor(z.anomaly) }}
                />
                <span className="mt-1 block font-mono text-[10px] whitespace-nowrap text-foreground/80">
                  {z.name} · {z.lst}°
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 border-t border-border px-5 py-3">
            <span className="font-mono text-[11px] text-muted-foreground">cooler</span>
            <div className="flex h-2 flex-1 overflow-hidden rounded-full">
              {["heat-0", "heat-1", "heat-2", "heat-3", "heat-4", "heat-5"].map((c) => (
                <span key={c} className="flex-1" style={{ backgroundColor: `var(--${c})` }} />
              ))}
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">hotter</span>
          </div>
        </section>

        <div className="flex flex-col gap-6">
          <section className="rounded-xl border border-border bg-card p-5 shadow-panel">
            <h2 className="text-sm font-semibold text-foreground">Hottest zones</h2>
            <ul className="mt-3 space-y-2">
              {hottest.map((z) => (
                <li
                  key={z.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <span className="text-sm text-foreground">{z.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {z.lst} °C · +{z.anomaly}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-border bg-card px-5 py-7 shadow-panel">
            <h2 className="mb-5 text-center text-sm font-semibold text-foreground">
              Ask the dataset
            </h2>
            <VoiceQuery />
          </section>
        </div>
      </main>
    </div>
  );
}
