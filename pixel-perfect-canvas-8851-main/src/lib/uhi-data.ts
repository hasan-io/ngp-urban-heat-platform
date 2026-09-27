export type Zone = {
  id: string;
  name: string;
  lst: number; // mean land surface temperature (°C)
  anomaly: number; // °C above city mean
  ndvi: number;
  builtUp: number; // % impervious surface
  trend: string;
  x: number; // % position on schematic map
  y: number;
};

export const CITY_MEAN_LST = 38.4;

export const zones: Zone[] = [
  {
    id: "sadar",
    name: "Sadar",
    lst: 43.1,
    anomaly: 4.7,
    ndvi: 0.14,
    builtUp: 82,
    trend: "+1.9 °C over 2015–2025, steepest rise after 2020 commercial densification",
    x: 46,
    y: 33,
  },
  {
    id: "sitabuldi",
    name: "Sitabuldi",
    lst: 44.2,
    anomaly: 5.8,
    ndvi: 0.11,
    builtUp: 88,
    trend: "+2.3 °C over 2015–2025, hottest core of the city",
    x: 52,
    y: 47,
  },
  {
    id: "itwari",
    name: "Itwari",
    lst: 42.6,
    anomaly: 4.2,
    ndvi: 0.13,
    builtUp: 79,
    trend: "+1.6 °C over 2015–2025, dense market rooftops retain night heat",
    x: 63,
    y: 40,
  },
  {
    id: "dharampeth",
    name: "Dharampeth",
    lst: 38.9,
    anomaly: 0.5,
    ndvi: 0.34,
    builtUp: 58,
    trend: "+0.7 °C over 2015–2025, mature avenue trees buffer the rise",
    x: 38,
    y: 52,
  },
  {
    id: "civil-lines",
    name: "Civil Lines",
    lst: 36.4,
    anomaly: -2.0,
    ndvi: 0.46,
    builtUp: 34,
    trend: "+0.3 °C over 2015–2025, coolest administrative belt",
    x: 44,
    y: 62,
  },
  {
    id: "ambazari",
    name: "Ambazari",
    lst: 35.2,
    anomaly: -3.2,
    ndvi: 0.57,
    builtUp: 26,
    trend: "stable, lake and green cover keep it the city's cool sink",
    x: 30,
    y: 68,
  },
  {
    id: "hingna",
    name: "Hingna (MIDC)",
    lst: 41.8,
    anomaly: 3.4,
    ndvi: 0.18,
    builtUp: 71,
    trend: "+1.4 °C over 2015–2025, industrial sheds and low vegetation",
    x: 20,
    y: 44,
  },
  {
    id: "kamptee",
    name: "Kamptee Road",
    lst: 40.7,
    anomaly: 2.3,
    ndvi: 0.22,
    builtUp: 68,
    trend: "+1.2 °C over 2015–2025, rapid roadside construction",
    x: 58,
    y: 22,
  },
  {
    id: "manish-nagar",
    name: "Manish Nagar",
    lst: 39.6,
    anomaly: 1.2,
    ndvi: 0.27,
    builtUp: 61,
    trend: "+1.1 °C over 2015–2025, fast-growing residential expansion",
    x: 56,
    y: 74,
  },
  {
    id: "seminary-hills",
    name: "Seminary Hills",
    lst: 34.6,
    anomaly: -3.8,
    ndvi: 0.63,
    builtUp: 17,
    trend: "stable, forested reserve acts as the strongest cool island",
    x: 40,
    y: 18,
  },
];

export const datasetSummary = `Nagpur Urban Heat Island dataset (demo)
Source: Landsat-8/9 thermal composite, summer daytime mean, 2015-2025
City mean land surface temperature: ${CITY_MEAN_LST} °C
Zones (name | mean LST °C | anomaly vs city mean °C | NDVI | built-up % | decadal trend):
${zones
  .map(
    (z) =>
      `${z.name} | ${z.lst} | ${z.anomaly > 0 ? "+" : ""}${z.anomaly} | ${z.ndvi} | ${z.builtUp}% | ${z.trend}`,
  )
  .join("\n")}`;
