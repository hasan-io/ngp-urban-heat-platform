// Geographic configuration for the Nagpur study area.
// All coordinates are WGS84 (lat, lon). Distances in km.

export const YEARS = [2019, 2020, 2021, 2022, 2023, 2024] as const;
export type Year = (typeof YEARS)[number];

export const BOUNDS = { south: 21.02, north: 21.26, west: 78.94, east: 79.22 };
export const GRID = { w: 140, h: 120 }; // ~200 m analysis cells
export const KM_PER_DEG_LAT = 111.0;
export const KM_PER_DEG_LON = 104.0; // at ~21°N
export const CELL_AREA_KM2 =
  ((BOUNDS.east - BOUNDS.west) / GRID.w) * KM_PER_DEG_LON * (((BOUNDS.north - BOUNDS.south) / GRID.h) * KM_PER_DEG_LAT);

export const CITY_CENTER = { lat: 21.1458, lon: 79.0882 }; // Zero Mile

export interface Ellipse {
  name: string;
  lat: number;
  lon: number;
  rx: number; // km (semi-axis along rotation)
  ry: number; // km
  rot?: number; // degrees
  s?: number; // strength 0..1
}

export const FORESTS: Ellipse[] = [
  { name: "Gorewada Reserve", lat: 21.205, lon: 79.032, rx: 2.8, ry: 2.3, rot: 20, s: 1 },
  { name: "Seminary Hills", lat: 21.163, lon: 79.061, rx: 1.0, ry: 0.8, rot: 10, s: 0.95 },
  { name: "Ambazari Biodiversity Park", lat: 21.117, lon: 79.03, rx: 1.7, ry: 1.1, rot: -15, s: 0.9 },
  { name: "Telankhedi Garden", lat: 21.156, lon: 79.054, rx: 0.45, ry: 0.4, s: 0.7 },
  { name: "Maharajbagh / Civil Lines canopy", lat: 21.151, lon: 79.069, rx: 0.7, ry: 0.55, s: 0.5 },
  { name: "VNIT Campus", lat: 21.125, lon: 79.051, rx: 0.6, ry: 0.5, s: 0.6 },
  { name: "Hingna forest belt", lat: 21.075, lon: 78.962, rx: 2.2, ry: 1.6, rot: 30, s: 0.75 },
  { name: "Mahurzari scrub", lat: 21.245, lon: 78.975, rx: 2.2, ry: 1.5, rot: -10, s: 0.6 },
  { name: "Ambazari hills", lat: 21.098, lon: 79.008, rx: 1.6, ry: 1.0, rot: 40, s: 0.6 },
  { name: "Umred Rd groves", lat: 21.058, lon: 79.175, rx: 2.0, ry: 1.4, rot: 15, s: 0.5 },
  { name: "Koradi lake belt", lat: 21.238, lon: 79.125, rx: 1.3, ry: 0.9, s: 0.5 },
  { name: "Wanadongri farms", lat: 21.11, lon: 78.945, rx: 1.4, ry: 1.0, s: 0.45 },
];

export const LAKES: Ellipse[] = [
  { name: "Ambazari Lake", lat: 21.129, lon: 79.043, rx: 0.95, ry: 0.42, rot: -25 },
  { name: "Futala Lake", lat: 21.158, lon: 79.047, rx: 0.45, ry: 0.33 },
  { name: "Gorewada Lake", lat: 21.197, lon: 79.047, rx: 0.6, ry: 0.38, rot: 30 },
  { name: "Gandhisagar Lake", lat: 21.148, lon: 79.101, rx: 0.22, ry: 0.2 },
  { name: "Sonegaon Lake", lat: 21.103, lon: 79.062, rx: 0.24, ry: 0.2 },
  { name: "Sakkardara Lake", lat: 21.125, lon: 79.108, rx: 0.2, ry: 0.18 },
  { name: "Naik Talao", lat: 21.155, lon: 79.112, rx: 0.15, ry: 0.14 },
  { name: "Koradi Lake", lat: 21.247, lon: 79.098, rx: 0.75, ry: 0.4, rot: -10 },
];

export const URBAN_CORES: Ellipse[] = [
  { name: "CBD core", lat: 21.148, lon: 79.09, rx: 3.6, ry: 3.0, rot: 10, s: 1 },
  { name: "Dharampeth", lat: 21.14, lon: 79.06, rx: 1.5, ry: 1.2, s: 0.8 },
  { name: "Nandanvan / Sakkardara", lat: 21.128, lon: 79.12, rx: 1.9, ry: 1.5, s: 0.85 },
  { name: "Pratap Nagar / Khamla", lat: 21.115, lon: 79.066, rx: 1.5, ry: 1.3, s: 0.75 },
  { name: "Jaripatka / Indora", lat: 21.181, lon: 79.1, rx: 1.9, ry: 1.4, s: 0.8 },
  { name: "Trimurti Nagar", lat: 21.12, lon: 79.042, rx: 1.1, ry: 0.9, s: 0.65 },
  { name: "Manewada", lat: 21.106, lon: 79.096, rx: 1.3, ry: 1.1, s: 0.7 },
  { name: "Wadi", lat: 21.15, lon: 79.0, rx: 1.2, ry: 1.0, s: 0.6 },
  { name: "Kamptee", lat: 21.225, lon: 79.195, rx: 1.6, ry: 1.3, s: 0.7 },
  { name: "Hudkeshwar", lat: 21.102, lon: 79.122, rx: 1.2, ry: 1.0, s: 0.55 },
];

export interface Industrial extends Ellipse {
  heat: number; // extra LST °C
  growth?: number; // growth factor 0..1 over the period
}

export const INDUSTRIAL: Industrial[] = [
  { name: "MIHAN SEZ", lat: 21.045, lon: 79.03, rx: 2.3, ry: 1.8, rot: 20, s: 0.85, heat: 2.2, growth: 0.6 },
  { name: "Hingna MIDC", lat: 21.108, lon: 78.976, rx: 1.6, ry: 1.1, rot: -20, s: 0.9, heat: 2.6 },
  { name: "Kalamna Market / Yard", lat: 21.168, lon: 79.132, rx: 1.0, ry: 0.8, s: 0.8, heat: 1.8 },
  { name: "Uppalwadi Industrial", lat: 21.187, lon: 79.116, rx: 1.0, ry: 0.8, s: 0.8, heat: 1.9 },
  { name: "Koradi Thermal Power Station", lat: 21.246, lon: 79.088, rx: 0.9, ry: 0.65, s: 0.95, heat: 3.4 },
  { name: "Butibori link", lat: 21.028, lon: 78.985, rx: 1.4, ry: 0.9, rot: 35, s: 0.6, heat: 1.8, growth: 0.4 },
];

export const AIRPORT: Ellipse = { name: "Dr. Babasaheb Ambedkar Intl. Airport", lat: 21.092, lon: 79.049, rx: 1.7, ry: 0.55, rot: -50, s: 1 };

export interface GrowthZone extends Ellipse {
  base: number; // built fraction already present in 2019 (fraction of final)
}

export const GROWTH_ZONES: GrowthZone[] = [
  { name: "Besa – Beltarodi", lat: 21.064, lon: 79.086, rx: 2.0, ry: 1.6, rot: 15, s: 1, base: 0.2 },
  { name: "Manish Nagar – Somalwada", lat: 21.09, lon: 79.075, rx: 1.3, ry: 1.1, s: 0.8, base: 0.45 },
  { name: "Jamtha – Wardha Rd", lat: 21.045, lon: 79.062, rx: 1.6, ry: 1.2, rot: -30, s: 0.8, base: 0.25 },
  { name: "Wathoda – Hudkeshwar Kh.", lat: 21.112, lon: 79.142, rx: 1.7, ry: 1.3, s: 0.9, base: 0.25 },
  { name: "Dighori", lat: 21.098, lon: 79.118, rx: 1.0, ry: 0.9, s: 0.6, base: 0.4 },
  { name: "Godhni – Koradi Rd", lat: 21.212, lon: 79.08, rx: 1.4, ry: 1.1, s: 0.7, base: 0.3 },
  { name: "Dabha – Wadi", lat: 21.158, lon: 78.99, rx: 1.3, ry: 1.0, s: 0.6, base: 0.35 },
  { name: "Kalamna – Pardi", lat: 21.16, lon: 79.148, rx: 1.4, ry: 1.0, s: 0.7, base: 0.35 },
  { name: "MIHAN residential", lat: 21.06, lon: 79.02, rx: 1.3, ry: 1.0, s: 0.7, base: 0.2 },
  { name: "Zingabai Takli – Mankapur", lat: 21.19, lon: 79.07, rx: 1.2, ry: 1.0, s: 0.6, base: 0.4 },
  { name: "Wanadongri – Hingna Rd", lat: 21.112, lon: 78.958, rx: 1.2, ry: 0.9, s: 0.5, base: 0.3 },
  { name: "Omkar Nagar – Narsala", lat: 21.085, lon: 79.11, rx: 1.2, ry: 1.0, s: 0.6, base: 0.3 },
];

export type LatLon = [number, number];

export interface Road {
  name: string;
  pts: LatLon[];
  s: number; // built strength
  w: number; // half width km
}

export const ROADS: Road[] = [
  { name: "Wardha Rd (NH-44 S)", pts: [[21.146, 79.082], [21.12, 79.07], [21.09, 79.06], [21.05, 79.045], [21.02, 79.03]], s: 0.6, w: 0.35 },
  { name: "Kamptee Rd (NH-44 N)", pts: [[21.15, 79.09], [21.18, 79.1], [21.21, 79.12], [21.26, 79.17]], s: 0.55, w: 0.32 },
  { name: "Amravati Rd", pts: [[21.146, 79.082], [21.148, 79.05], [21.15, 79.01], [21.16, 78.94]], s: 0.5, w: 0.3 },
  { name: "Bhandara Rd", pts: [[21.148, 79.09], [21.15, 79.13], [21.155, 79.17], [21.16, 79.22]], s: 0.5, w: 0.3 },
  { name: "Umred Rd", pts: [[21.145, 79.1], [21.12, 79.12], [21.09, 79.15], [21.06, 79.19]], s: 0.45, w: 0.28 },
  { name: "Katol Rd", pts: [[21.15, 79.08], [21.17, 79.06], [21.2, 79.03], [21.24, 78.98]], s: 0.45, w: 0.28 },
  { name: "Hingna Rd", pts: [[21.14, 79.07], [21.13, 79.04], [21.12, 79.0], [21.11, 78.95]], s: 0.45, w: 0.28 },
  { name: "Koradi Rd", pts: [[21.16, 79.08], [21.2, 79.085], [21.26, 79.09]], s: 0.4, w: 0.26 },
  {
    name: "Outer Ring Rd",
    pts: [
      [21.226, 79.09], [21.2, 79.155], [21.14, 79.181], [21.08, 79.155], [21.054, 79.09], [21.08, 79.025], [21.14, 78.999], [21.2, 79.025], [21.226, 79.09],
    ],
    s: 0.35,
    w: 0.25,
  },
  {
    name: "Inner Ring Rd",
    pts: [
      [21.185, 79.085], [21.173, 79.115], [21.145, 79.128], [21.117, 79.115], [21.105, 79.085], [21.117, 79.055], [21.145, 79.042], [21.173, 79.055], [21.185, 79.085],
    ],
    s: 0.4,
    w: 0.22,
  },
];

export const RIVERS: Road[] = [
  { name: "Nag River", pts: [[21.128, 79.05], [21.135, 79.062], [21.14, 79.08], [21.145, 79.1], [21.14, 79.13], [21.135, 79.17], [21.13, 79.22]], s: 1, w: 0.18 },
  { name: "Pili River", pts: [[21.19, 78.99], [21.185, 79.04], [21.18, 79.09], [21.17, 79.13], [21.16, 79.17]], s: 0.8, w: 0.15 },
  { name: "Pora River", pts: [[21.07, 79.14], [21.09, 79.17], [21.11, 79.2]], s: 0.6, w: 0.12 },
];

export interface Zone {
  id: string;
  name: string;
  short: string;
  poly: LatLon[]; // lat, lon
  population: number; // approx residents
  character: string;
}

export const ZONES: Zone[] = [
  { id: "cbd", name: "Sitabuldi – Zero Mile (CBD)", short: "Sitabuldi", poly: [[21.158, 79.07], [21.158, 79.095], [21.135, 79.095], [21.135, 79.07]], population: 85000, character: "Commercial core" },
  { id: "oldcity", name: "Itwari – Mahal (Old City)", short: "Itwari–Mahal", poly: [[21.165, 79.095], [21.165, 79.12], [21.14, 79.12], [21.14, 79.095]], population: 240000, character: "Dense old city" },
  { id: "sadar", name: "Sadar – Civil Lines", short: "Sadar", poly: [[21.178, 79.065], [21.178, 79.095], [21.158, 79.095], [21.158, 79.065]], population: 120000, character: "Administrative / cantonment" },
  { id: "dharampeth", name: "Dharampeth – Ramdaspeth", short: "Dharampeth", poly: [[21.15, 79.05], [21.15, 79.07], [21.13, 79.07], [21.13, 79.05]], population: 95000, character: "Established residential" },
  { id: "seminary", name: "Seminary Hills – Futala", short: "Seminary Hills", poly: [[21.175, 79.04], [21.175, 79.065], [21.15, 79.065], [21.15, 79.04]], population: 60000, character: "Forested hills + lakefront" },
  { id: "ambazari", name: "Ambazari – VNIT", short: "Ambazari", poly: [[21.135, 79.028], [21.135, 79.055], [21.112, 79.055], [21.112, 79.028]], population: 70000, character: "Lake + institutional campus" },
  { id: "pratapnagar", name: "Pratap Nagar – Khamla", short: "Pratap Nagar", poly: [[21.13, 79.055], [21.13, 79.08], [21.105, 79.08], [21.105, 79.055]], population: 130000, character: "Mid-density residential" },
  { id: "manishnagar", name: "Manish Nagar – Somalwada", short: "Manish Nagar", poly: [[21.105, 79.062], [21.105, 79.088], [21.08, 79.088], [21.08, 79.062]], population: 110000, character: "Rapid apartment growth" },
  { id: "besa", name: "Besa – Beltarodi", short: "Besa", poly: [[21.08, 79.07], [21.08, 79.1], [21.05, 79.1], [21.05, 79.07]], population: 95000, character: "Peri-urban boom" },
  { id: "mihan", name: "MIHAN – Jamtha", short: "MIHAN", poly: [[21.065, 79.01], [21.065, 79.07], [21.025, 79.07], [21.025, 79.01]], population: 40000, character: "SEZ / industrial" },
  { id: "airport", name: "Airport – Sonegaon", short: "Airport", poly: [[21.108, 79.035], [21.108, 79.062], [21.078, 79.062], [21.078, 79.035]], population: 55000, character: "Airport + logistics" },
  { id: "nandanvan", name: "Nandanvan – Sakkardara", short: "Nandanvan", poly: [[21.14, 79.095], [21.14, 79.125], [21.115, 79.125], [21.115, 79.095]], population: 180000, character: "Dense east residential" },
  { id: "wathoda", name: "Wathoda – Hudkeshwar", short: "Wathoda", poly: [[21.125, 79.125], [21.125, 79.16], [21.095, 79.16], [21.095, 79.125]], population: 120000, character: "New layouts, ex-farmland" },
  { id: "kalamna", name: "Kalamna – Pardi", short: "Kalamna", poly: [[21.18, 79.125], [21.18, 79.16], [21.15, 79.16], [21.15, 79.125]], population: 90000, character: "Market yard + logistics" },
  { id: "jaripatka", name: "Jaripatka – Indora", short: "Jaripatka", poly: [[21.195, 79.085], [21.195, 79.115], [21.17, 79.115], [21.17, 79.085]], population: 150000, character: "Dense north residential" },
  { id: "gorewada", name: "Gorewada – Koradi Rd", short: "Gorewada", poly: [[21.235, 79.02], [21.235, 79.075], [21.185, 79.075], [21.185, 79.02]], population: 45000, character: "Reserve forest + new layouts" },
  { id: "hingna", name: "Hingna MIDC – Wadi", short: "Hingna MIDC", poly: [[21.135, 78.955], [21.135, 79.0], [21.095, 79.0], [21.095, 78.955]], population: 80000, character: "Industrial estate" },
  { id: "kamptee", name: "Kamptee Rd – Uppalwadi", short: "Kamptee Rd", poly: [[21.21, 79.1], [21.21, 79.14], [21.178, 79.14], [21.178, 79.1]], population: 100000, character: "Highway corridor" },
];

export interface Landmark {
  name: string;
  lat: number;
  lon: number;
  kind: "city" | "water" | "forest" | "industry" | "transport" | "growth";
}

export const LANDMARKS: Landmark[] = [
  { name: "Zero Mile", lat: 21.1458, lon: 79.0882, kind: "city" },
  { name: "Itwari", lat: 21.153, lon: 79.108, kind: "city" },
  { name: "Ambazari Lake", lat: 21.129, lon: 79.043, kind: "water" },
  { name: "Futala Lake", lat: 21.158, lon: 79.047, kind: "water" },
  { name: "Seminary Hills", lat: 21.163, lon: 79.061, kind: "forest" },
  { name: "Gorewada Reserve", lat: 21.205, lon: 79.032, kind: "forest" },
  { name: "Airport", lat: 21.092, lon: 79.049, kind: "transport" },
  { name: "MIHAN SEZ", lat: 21.045, lon: 79.03, kind: "industry" },
  { name: "Hingna MIDC", lat: 21.108, lon: 78.976, kind: "industry" },
  { name: "Koradi TPS", lat: 21.246, lon: 79.088, kind: "industry" },
  { name: "Besa", lat: 21.064, lon: 79.086, kind: "growth" },
  { name: "Wathoda", lat: 21.112, lon: 79.142, kind: "growth" },
  { name: "Manish Nagar", lat: 21.09, lon: 79.075, kind: "growth" },
];

// Inter-annual anomalies (pre-monsoon composites). Positive LST = hotter season.
export const YEAR_ANOMALY: Record<Year, { lst: number; ndvi: number; note: string }> = {
  2019: { lst: 0.6, ndvi: -0.02, note: "Severe heat-wave; Nagpur crossed 47°C in May" },
  2020: { lst: -0.45, ndvi: 0.015, note: "Good 2019 monsoon carry-over; lockdown haze" },
  2021: { lst: -0.2, ndvi: 0.01, note: "Near-normal season" },
  2022: { lst: 0.5, ndvi: -0.012, note: "Early March–April heat-wave" },
  2023: { lst: -0.1, ndvi: 0.0, note: "Unseasonal April showers" },
  2024: { lst: 0.75, ndvi: -0.015, note: "Prolonged May heat spell (45–46°C)" },
};

export const LST_TREND_PER_YEAR = 0.18; // background warming + densification °C/yr

export const CLASSES_NDVI = [
  { key: "water", label: "Water", min: -1, max: 0.0, color: "#38bdf8" },
  { key: "bare", label: "Bare / Built", min: 0.0, max: 0.2, color: "#a16207" },
  { key: "sparse", label: "Sparse veg.", min: 0.2, max: 0.4, color: "#bef264" },
  { key: "moderate", label: "Moderate veg.", min: 0.4, max: 0.6, color: "#4ade80" },
  { key: "dense", label: "Dense canopy", min: 0.6, max: 1.01, color: "#166534" },
];
