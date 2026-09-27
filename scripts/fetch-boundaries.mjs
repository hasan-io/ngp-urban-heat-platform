#!/usr/bin/env node
/**
 * One-time boundary fetcher.
 *   node scripts/fetch-boundaries.mjs
 * Requires devDependency: @turf/turf
 * Source: geoBoundaries (CC-BY 4.0) — https://www.geoboundaries.org
 * Outputs: src/data/boundaries/*.geojson  (committed to repo; not fetched at runtime)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "src", "data", "boundaries");
const ADM2_META_URL = "https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/";

const DISTRICT_FILES = {
  nagpur: "Nagpur",
  bhandara: "Bhandara",
  yavatmal: "Yavatmal",
  chandrapur: "Chandrapur",
};

const VIDARBHA_DISTRICTS = [
  "Amravati", "Akola", "Bhandara", "Buldhana", "Chandrapur",
  "Gadchiroli", "Gondia", "Nagpur", "Wardha", "Washim", "Yavatmal",
];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

function toFeatureCollection(geometry) {
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry }] };
}

/** Normalise district name: strip " District", lowercase, trim. */
function normName(s) {
  return String(s || "").toLowerCase().replace(/\s+district$/i, "").trim();
}

/** Length of the longest common prefix. */
function commonPrefixLength(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Extract one feature by name — exact match first, then fuzzy prefix match. */
function pickDistrict(fc, targetName) {
  const target = normName(targetName);
  const features = fc.features ?? [];

  // Pass 1: exact match on any candidate property key
  for (const f of features) {
    const props = f.properties || {};
    const candidates = [props.shapeName, props.boundaryName, props.name, props.NAME_2, props.DISTRICT];
    for (const c of candidates) {
      if (normName(c) === target) return f;
    }
  }

  // Pass 2: fuzzy match — longest common prefix of at least 4 characters
  const MIN_PREFIX = 4;
  let best = null;
  let bestLen = 0;
  for (const f of features) {
    const props = f.properties || {};
    const candidates = [props.shapeName, props.boundaryName, props.name, props.NAME_2, props.DISTRICT];
    for (const c of candidates) {
      const n = normName(c);
      if (!n) continue;
      const prefixLen = commonPrefixLength(n, target);
      if (prefixLen >= MIN_PREFIX && prefixLen > bestLen) {
        best = f;
        bestLen = prefixLen;
      }
    }
  }
  if (best) {
    const found = best.properties?.shapeName ?? best.properties?.name ?? "?";
    console.log(`   ~ Fuzzy match "${targetName}" → "${found}"`);
    return best;
  }

  console.warn(`   ! Feature not found for "${targetName}"`);
  return null;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log("-> Fetching geoBoundaries ADM2 metadata for India...");
  const meta = await fetchJson(ADM2_META_URL);

  const layer = Array.isArray(meta) ? meta[0] : meta;
  if (!layer || !layer.gjDownloadURL) {
    throw new Error("geoBoundaries ADM2 metadata did not include gjDownloadURL.");
  }
  console.log(`   Layer: ${layer.boundaryName ?? "India ADM2"} · ${layer.boundaryType ?? ""}`);
  console.log(`   GeoJSON: ${layer.gjDownloadURL}`);

  console.log("-> Downloading full India ADM2 GeoJSON (one file, all districts)...");
  const adm2 = await fetchJson(layer.gjDownloadURL);
  const featureCount = (adm2.features ?? []).length;
  console.log(`   ${featureCount} district features loaded.`);

  // ---- 4 standalone districts ----
  for (const [key, officialName] of Object.entries(DISTRICT_FILES)) {
    console.log(`-> Extracting ${officialName} (${key})`);
    const feature = pickDistrict(adm2, officialName);
    if (!feature) throw new Error(`Could not extract "${officialName}" from ADM2 file.`);
    const fc = { type: "FeatureCollection", features: [feature] };
    await fs.writeFile(path.join(OUT_DIR, `${key}.geojson`), JSON.stringify(fc));
  }

  // ---- Vidarbha union ----
  console.log("-> Building Vidarbha union from 11 districts...");
  const features = [];
  for (const name of VIDARBHA_DISTRICTS) {
    const feature = pickDistrict(adm2, name);
    if (!feature) {
      console.warn(`   ! Missing: ${name} — skipping.`);
      continue;
    }
    console.log(`   . ${name}`);
    features.push(feature);
  }
  if (features.length < 11) {
    console.warn(`   ! Only ${features.length}/11 districts loaded. Proceeding anyway.`);
  }

  let merged = features[0];
  for (let i = 1; i < features.length; i++) {
    const u = turf.union(turf.featureCollection([merged, features[i]]));
    if (u) merged = u;
  }
  const simplified = turf.simplify(merged, { tolerance: 0.01, highQuality: true });
  const vidFC = toFeatureCollection(simplified.geometry);
  await fs.writeFile(path.join(OUT_DIR, "vidarbha.geojson"), JSON.stringify(vidFC));

  console.log("\nOK. Commit src/data/boundaries/*.geojson to the repository.");
}

main().catch((e) => { console.error(e); process.exit(1); });