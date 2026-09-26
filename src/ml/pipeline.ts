// ML experiments run in the browser on the Nagpur cube.
import { linearFit, type Dataset } from "@/data/engine";
import { LANDMARKS, YEARS, ZONES, type Year } from "@/data/nagpur";
import { dbscanGrid, kmeans, standardizeRowMajor } from "./cluster";
import { buildFeatures, FEATURES, FEATURE_INDEX, landRows } from "./features";
import { GradientBoosting, LinearModel, RandomForest, gather, metrics, partialDependence, permutationImportance, spatialBlockSplit, type Metrics, type Regressor } from "./trees";

const NDVI_PER_VEG = 0.72;
const NDBI_PER_BUILT = 0.75;

// ============================================================== 1. LST prediction models
export interface ModelRow { name: string; kind: Regressor["kind"]; test: Metrics; train: Metrics; ms: number }
export interface LstModelResult {
  year: Year;
  split: { nTrain: number; nTest: number; nBlocks: number; nTestBlocks: number; blockKm: number };
  models: ModelRow[];
  best: ModelRow;
  permutation: { key: string; label: string; group: string; value: number }[];
  impurity: { key: string; label: string; rf: number; gbm: number }[];
  coef: { key: string; label: string; value: number }[];
  scatter: { obs: number; pred: number }[];
  residual: Float32Array; // observed − predicted (best model), all cells (0 on water)
  pd: { ndvi: { x: number; linear: number; rf: number; gbm: number }[]; ndbi: { x: number; linear: number; rf: number; gbm: number }[] };
  models_: { linear: LinearModel; rf: RandomForest; gbm: GradientBoosting };
  cols: Float32Array[];
}

export function trainLstModels(ds: Dataset, year: Year): LstModelResult {
  const cols = buildFeatures(ds, year);
  const y = ds.rasters[year].lst;
  const rows = landRows(ds);
  const block = 10;
  const split = spatialBlockSplit(rows, ds.w, block, 0.22);
  const yTest = gather(y, split.test), yTrain = gather(y, split.train);

  const linear = new LinearModel(), rf = new RandomForest(), gbm = new GradientBoosting();
  const fitEval = (m: Regressor): ModelRow => {
    const t0 = performance.now();
    m.fit(cols, y, split.train);
    const ms = performance.now() - t0;
    return { name: m.name, kind: m.kind, test: metrics(yTest, m.predict(cols, split.test)), train: metrics(yTrain, m.predict(cols, split.train)), ms };
  };
  const models = [fitEval(linear), fitEval(rf), fitEval(gbm)];
  const best = models.reduce((a, b) => (b.test.rmse < a.test.rmse ? b : a));
  const bestModel: Regressor = best.kind === "rf" ? rf : best.kind === "gbm" ? gbm : linear;

  const perm = permutationImportance(bestModel, cols, y, split.test);
  const permutation = FEATURES.map((f, i) => ({ key: f.key, label: f.label, group: f.group, value: perm[i] })).sort((a, b) => b.value - a.value);
  const impurity = FEATURES.map((f, i) => ({ key: f.key, label: f.label, rf: rf.importance[i], gbm: gbm.importance[i] }));
  const coef = FEATURES.map((f, i) => ({ key: f.key, label: f.label, value: linear.coef[i] }));

  const predTest = bestModel.predict(cols, split.test);
  const scatter: { obs: number; pred: number }[] = [];
  const step = Math.max(1, Math.floor(split.test.length / 700));
  for (let i = 0; i < split.test.length; i += step) scatter.push({ obs: yTest[i], pred: predTest[i] });

  const residual = new Float32Array(ds.n);
  const predAll = bestModel.predict(cols, rows);
  for (let i = 0; i < rows.length; i++) residual[rows[i]] = y[rows[i]] - predAll[i];

  // partial dependence on a 600-row sample
  const sample = new Int32Array(600);
  for (let i = 0; i < 600; i++) sample[i] = rows[Math.floor((i + 0.5) * (rows.length / 600))];
  const gridV = Array.from({ length: 17 }, (_, i) => +(i * 0.05).toFixed(2));
  const gridB = Array.from({ length: 19 }, (_, i) => +(-0.4 + i * 0.05).toFixed(2));
  const pdFor = (f: number, grid: number[]) => {
    const l = partialDependence(linear, cols, sample, f, grid), r = partialDependence(rf, cols, sample, f, grid), g = partialDependence(gbm, cols, sample, f, grid);
    return grid.map((x, i) => ({ x, linear: l[i], rf: r[i], gbm: g[i] }));
  };
  const pd = { ndvi: pdFor(FEATURE_INDEX.ndvi, gridV), ndbi: pdFor(FEATURE_INDEX.ndbi, gridB) };

  return {
    year, split: { nTrain: split.train.length, nTest: split.test.length, nBlocks: split.nBlocks, nTestBlocks: split.nTestBlocks, blockKm: (block * 0.2) },
    models, best, permutation, impurity, coef, scatter, residual, pd, models_: { linear, rf, gbm }, cols,
  };
}

// ============================================================== 2. ML what-if (non-linear response)
export interface WhatIfPoint { pct: number; mlVeg: number; linVeg: number; mlBuilt: number; linBuilt: number }

/** ΔLST in a zone when vegetation / built-up cover changes, evaluated with the ML model (features re-computed
 *  incl. neighbourhood context) versus the linear model. */
export function mlWhatIf(ds: Dataset, trained: LstModelResult, zoneIndex: number, pcts = [-20, -10, 0, 10, 20, 30, 40, 50]): WhatIfPoint[] {
  const { rf, gbm, linear } = trained.models_;
  const ml: Regressor = trained.best.kind === "rf" ? rf : trained.best.kind === "gbm" ? gbm : rf;
  const zoneRows = Int32Array.from(landRows(ds).filter((i) => ds.zoneIndex[i] === zoneIndex));
  const base = ds.rasters[trained.year];
  const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length;
  const baseMl = mean(ml.predict(trained.cols, zoneRows)), baseLin = mean(linear.predict(trained.cols, zoneRows));
  const inZone = new Uint8Array(ds.n);
  zoneRows.forEach((i) => (inZone[i] = 1));
  return pcts.map((pct) => {
    const ndvi = Float32Array.from(base.ndvi), ndbi = Float32Array.from(base.ndbi);
    for (let i = 0; i < ds.n; i++) if (inZone[i]) { ndvi[i] = Math.min(0.9, Math.max(-0.05, ndvi[i] + NDVI_PER_VEG * pct / 100)); }
    const cV = buildFeatures(ds, trained.year, { ndvi });
    for (let i = 0; i < ds.n; i++) if (inZone[i]) { ndbi[i] = Math.min(0.7, Math.max(-0.5, ndbi[i] + NDBI_PER_BUILT * pct / 100)); }
    const cB = buildFeatures(ds, trained.year, { ndbi });
    return { pct, mlVeg: mean(ml.predict(cV, zoneRows)) - baseMl, linVeg: mean(linear.predict(cV, zoneRows)) - baseLin, mlBuilt: mean(ml.predict(cB, zoneRows)) - baseMl, linBuilt: mean(linear.predict(cB, zoneRows)) - baseLin };
  });
}

/** Combined scenario with the ML model: ΔLST in a zone for a simultaneous vegetation + built-up change.
 *  Returns the ML estimate, the 12-feature linear estimate and an in-range flag (trees cannot extrapolate). */
export function mlScenario(ds: Dataset, trained: LstModelResult, zoneIndex: number, vegPct: number, builtPct: number): { ml: number; linear: number; inRange: boolean } {
  const { rf, gbm, linear } = trained.models_;
  const model: Regressor = trained.best.kind === "rf" ? rf : trained.best.kind === "gbm" ? gbm : gbm;
  const zoneRows = Int32Array.from(landRows(ds).filter((i) => ds.zoneIndex[i] === zoneIndex));
  if (!zoneRows.length) return { ml: 0, linear: 0, inRange: true };
  const base = ds.rasters[trained.year];
  const ndvi = Float32Array.from(base.ndvi), ndbi = Float32Array.from(base.ndbi);
  let lo = Infinity, hi = -Infinity, blo = Infinity, bhi = -Infinity;
  const land = landRows(ds);
  for (let k = 0; k < land.length; k++) { const i = land[k]; if (base.ndvi[i] < lo) lo = base.ndvi[i]; if (base.ndvi[i] > hi) hi = base.ndvi[i]; if (base.ndbi[i] < blo) blo = base.ndbi[i]; if (base.ndbi[i] > bhi) bhi = base.ndbi[i]; }
  let inRange = true;
  for (let k = 0; k < zoneRows.length; k++) {
    const i = zoneRows[k];
    ndvi[i] = Math.min(0.9, Math.max(-0.05, ndvi[i] + NDVI_PER_VEG * vegPct / 100));
    ndbi[i] = Math.min(0.7, Math.max(-0.5, ndbi[i] + NDBI_PER_BUILT * builtPct / 100));
    if (ndvi[i] < lo - 0.02 || ndvi[i] > hi + 0.02 || ndbi[i] < blo - 0.02 || ndbi[i] > bhi + 0.02) inRange = false;
  }
  const cols = buildFeatures(ds, trained.year, { ndvi, ndbi });
  const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length;
  return { ml: mean(model.predict(cols, zoneRows)) - mean(model.predict(trained.cols, zoneRows)), linear: mean(linear.predict(cols, zoneRows)) - mean(linear.predict(trained.cols, zoneRows)), inRange };
}

// ============================================================== 3. Land-cover clustering (k-means)
export interface ClusterInfo { id: number; label: string; color: string; ndvi: number; ndbi: number; area: Record<Year, number>; lst: Record<Year, number> }
export interface LandCoverResult {
  k: number; labels: Record<Year, Int32Array>; classes: ClusterInfo[]; palette: string[];
  transition: number[][]; // km² from class (row, 2019) to class (col, 2024)
  elbow: { k: number; inertia: number }[]; iterations: number;
  vegToBuiltKm2: number; builtToVegKm2: number;
}

const LC_LABELS = ["Dense canopy", "Moderate vegetation", "Sparse veg. / open", "Mixed built-up", "Dense built-up / industrial"];
const LC_COLORS = ["#166534", "#4ade80", "#d9f99d", "#fb923c", "#a21caf"];

export function landCover(ds: Dataset, k = 5): LandCoverResult {
  // Water is known from the QA mask → fixed class 0; k-means partitions the *land* into k spectral classes
  // using 2019 + 2024 pooled so both years share one set of centroids (comparable transition matrix).
  const yearsUsed: Year[] = [2019, 2024];
  const feats = yearsUsed.map((y) => buildFeatures(ds, y).slice(0, 4)); // ndvi, ndbi, ndvi_1km, ndbi_1km
  const land = landRows(ds);
  const nL = land.length;
  const pooled = [0, 1, 2, 3].map((j) => { const a = new Float32Array(nL * 2); for (let i = 0; i < nL; i++) { a[i] = feats[0][j][land[i]]; a[nL + i] = feats[1][j][land[i]]; } return a; });
  const rows = new Int32Array(nL * 2);
  for (let i = 0; i < rows.length; i++) rows[i] = i;
  const { X } = standardizeRowMajor(pooled, rows);
  const elbow = [2, 3, 4, 5, 6, 7, 8].map((kk) => ({ k: kk, inertia: kmeans(X, rows.length, 4, kk, { iters: 15, seed: 21 }).inertia / rows.length }));
  const km = kmeans(X, rows.length, 4, k, { iters: 60, seed: 21 });
  const cent = Array.from({ length: k }, (_, c) => ({ c, ndvi: 0, ndbi: 0, n: 0 }));
  for (let i = 0; i < rows.length; i++) { const c = km.labels[i]; cent[c].ndvi += pooled[0][i]; cent[c].ndbi += pooled[1][i]; cent[c].n++; }
  cent.forEach((s) => { s.ndvi /= s.n || 1; s.ndbi /= s.n || 1; });
  // order clusters by "builtness" (NDBI − NDVI): greenest first → most built last
  const order = [...cent].sort((a, b) => a.ndbi - a.ndvi - (b.ndbi - b.ndvi)).map((s) => s.c);
  const rank = new Int32Array(k);
  order.forEach((c, r) => (rank[c] = r + 1)); // 0 reserved for water
  const labelIdx = (r: number) => Math.round(((r - 1) / Math.max(1, k - 1)) * (LC_LABELS.length - 1));
  const labels = {} as Record<Year, Int32Array>;
  yearsUsed.forEach((y, yi) => { const l = new Int32Array(ds.n); for (let i = 0; i < nL; i++) l[land[i]] = rank[km.labels[yi * nL + i]]; labels[y] = l; });
  const classes: ClusterInfo[] = [];
  for (let r = 0; r <= k; r++) {
    const area = {} as Record<Year, number>, lst = {} as Record<Year, number>;
    for (const y of yearsUsed) { let n = 0, s = 0; for (let i = 0; i < ds.n; i++) if (labels[y][i] === r) { n++; s += ds.rasters[y].lst[i]; } area[y] = n * ds.cellAreaKm2; lst[y] = n ? s / n : NaN; }
    if (r === 0) { classes.push({ id: 0, label: "Water", color: "#38bdf8", ndvi: -0.12, ndbi: -0.46, area, lst }); continue; }
    const c = order[r - 1], li = labelIdx(r);
    const dup = Array.from({ length: k }, (_, q) => labelIdx(q + 1)).filter((v) => v === li).length > 1;
    classes.push({ id: r, label: LC_LABELS[li] + (dup ? ` ${r}` : ""), color: LC_COLORS[li], ndvi: cent[c].ndvi, ndbi: cent[c].ndbi, area, lst });
  }
  const transition = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0));
  for (let i = 0; i < ds.n; i++) transition[labels[2019][i]][labels[2024][i]] += ds.cellAreaKm2;
  const isBuilt = (r: number) => /built/i.test(classes[r].label);
  let vegToBuilt = 0, builtToVeg = 0;
  for (let a = 1; a <= k; a++) for (let b = 1; b <= k; b++) { if (!isBuilt(a) && isBuilt(b)) vegToBuilt += transition[a][b]; if (isBuilt(a) && !isBuilt(b)) builtToVeg += transition[a][b]; }
  return { k, labels, classes, palette: classes.map((c) => c.color), transition, elbow, iterations: km.iterations, vegToBuiltKm2: vegToBuilt, builtToVegKm2: builtToVeg };
}

// ============================================================== 4. Heat-island segmentation (DBSCAN)
export interface Island { id: number; name: string; zone: string; cells: number; areaKm2: number; meanLst: number; peakLst: number; meanNdvi: number; meanNdbi: number; persistence: number; centroid: [number, number]; residents: number }
export interface IslandResult { labels: Int32Array; raster: Float32Array; islands: Island[]; nNoise: number; nCandidates: number; palette: string[]; minYears: number; eps: number; minPts: number }

const ISLAND_PALETTE = ["#0f172a", "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#f43f5e", "#84cc16", "#14b8a6", "#8b5cf6"];

export function heatIslands(ds: Dataset, minYears = 4, eps = 1.5, minPts = 4): IslandResult {
  const candidate = new Uint8Array(ds.n);
  let nCandidates = 0;
  for (let i = 0; i < ds.n; i++) if (!ds.water[i] && ds.hotCount[i] >= minYears) { candidate[i] = 1; nCandidates++; }
  const { labels, nClusters, nNoise } = dbscanGrid(candidate, ds.w, ds.h, eps, minPts);
  const r24 = ds.rasters[2024];
  const acc = Array.from({ length: nClusters }, () => ({ cells: 0, lst: 0, peak: -Infinity, ndvi: 0, ndbi: 0, pers: 0, lat: 0, lon: 0, zones: new Map<number, number>() }));
  for (let i = 0; i < ds.n; i++) {
    const c = labels[i];
    if (c < 0) continue;
    const a = acc[c];
    a.cells++; a.lst += r24.lst[i]; a.peak = Math.max(a.peak, r24.lst[i]); a.ndvi += r24.ndvi[i]; a.ndbi += r24.ndbi[i]; a.pers += ds.hotCount[i]; a.lat += ds.lat[i]; a.lon += ds.lon[i];
    const z = ds.zoneIndex[i];
    a.zones.set(z, (a.zones.get(z) ?? 0) + 1);
  }
  const islands: Island[] = acc.map((a, id) => {
    const lat = a.lat / a.cells, lon = a.lon / a.cells;
    let zi = -1, zc = 0;
    a.zones.forEach((n, z) => { if (z >= 0 && n > zc) { zc = n; zi = z; } });
    let lm = "", best = 2.5;
    for (const l of LANDMARKS) { const d = Math.hypot((l.lat - lat) * 111, (l.lon - lon) * 104); if (d < best) { best = d; lm = l.name; } }
    const zoneName = zi >= 0 ? ZONES[zi].short : "periphery";
    return {
      id, name: lm ? `${lm}${lm.includes(zoneName) ? "" : ` · ${zoneName}`}` : zoneName, zone: zoneName, cells: a.cells, areaKm2: a.cells * ds.cellAreaKm2,
      meanLst: a.lst / a.cells, peakLst: a.peak, meanNdvi: a.ndvi / a.cells, meanNdbi: a.ndbi / a.cells, persistence: a.pers / a.cells, centroid: [lat, lon],
      residents: zi >= 0 ? Math.round((ZONES[zi].population * zc) / Math.max(1, ds.zones[zi].cells)) : 0,
    };
  });
  const raster = new Float32Array(ds.n);
  for (let i = 0; i < ds.n; i++) raster[i] = labels[i] >= 0 ? (labels[i] % (ISLAND_PALETTE.length - 1)) + 1 : 0;
  return { labels, raster, islands, nNoise, nCandidates, palette: ISLAND_PALETTE, minYears, eps, minPts };
}

// ============================================================== 5. Forecast (hybrid ML + trend)
export interface ForecastResult {
  target: number;
  backtest: { name: string; rmse: number; bias: number; patternRmse: number; r2: number }[];
  series: { year: number; obs?: number; ml?: number; lo?: number; hi?: number }[];
  raster: Float32Array; delta: Float32Array;
  stats: { mean2024: number; meanTarget: number; hot2024: number; hotTarget: number; sigma: number };
  zones: { name: string; lst2024: number; lstTarget: number; delta: number }[];
  ms: number;
}

/** LST(cell, year) = cityMean(year) + f(features(cell, year)). f = gradient boosting fitted on pooled years
 *  (the spatial component); cityMean is extrapolated linearly (the climatic/temporal component). NDVI/NDBI of
 *  the target year come from per-pixel linear trends. Trees cannot extrapolate, so the temporal part is kept linear. */
export function forecast(ds: Dataset, target = 2030): ForecastResult {
  const t0 = performance.now();
  const rows = landRows(ds);
  const nL = rows.length;
  const featsByYear = new Map<Year, Float32Array[]>();
  for (const y of YEARS) featsByYear.set(y, buildFeatures(ds, y));

  const pool = (years: readonly Year[]) => {
    const F = FEATURES.length;
    const cols = Array.from({ length: F }, () => new Float32Array(nL * years.length));
    const y = new Float32Array(nL * years.length);
    const r = new Int32Array(nL * years.length);
    years.forEach((yr, k) => {
      const f = featsByYear.get(yr)!;
      const cm = ds.city[yr].lstMean;
      for (let i = 0; i < nL; i++) {
        const idx = k * nL + i;
        for (let j = 0; j < F; j++) cols[j][idx] = f[j][rows[i]];
        y[idx] = ds.rasters[yr].lst[rows[i]] - cm;
        r[idx] = idx;
      }
    });
    return { cols, y, r };
  };
  const gbmOpts = { nTrees: 140, maxDepth: 4, minLeaf: 10, lr: 0.1, sampleFrac: 0.25, featFrac: 1, seed: 9 };

  // ---- projected NDVI / NDBI for an arbitrary year from per-pixel linear trends over `years`
  const project = (years: readonly Year[], to: number) => {
    const ys = years.map((y) => y);
    const ndvi = new Float32Array(ds.n), ndbi = new Float32Array(ds.n);
    for (let i = 0; i < ds.n; i++) {
      const fv = linearFit(ys, years.map((y) => ds.rasters[y].ndvi[i]));
      const fb = linearFit(ys, years.map((y) => ds.rasters[y].ndbi[i]));
      ndvi[i] = Math.min(0.9, Math.max(-0.15, fv.intercept + fv.slope * to));
      ndbi[i] = Math.min(0.7, Math.max(-0.5, fb.intercept + fb.slope * to));
    }
    return buildFeatures(ds, 2024, { ndvi, ndbi });
  };

  // ---- backtest: train on 2019–2023, forecast 2024
  const trainYears = YEARS.filter((y) => y < 2024);
  const bt = pool(trainYears);
  const gbmBt = new GradientBoosting({ ...gbmOpts }).fit(bt.cols, bt.y, bt.r);
  const cmTrend = linearFit(trainYears.map((y) => y), trainYears.map((y) => ds.city[y].lstMean));
  const feats24 = project(trainYears, 2024);
  const predAnom = gbmBt.predict(feats24, rows);
  const obs24 = gather(ds.rasters[2024].lst, rows);
  const mlPred = new Float32Array(nL);
  for (let i = 0; i < nL; i++) mlPred[i] = cmTrend.intercept + cmTrend.slope * 2024 + predAnom[i];
  const persist = gather(ds.rasters[2023].lst, rows);
  const linPred = new Float32Array(nL);
  for (let i = 0; i < nL; i++) { const f = linearFit(trainYears.map((y) => y), trainYears.map((y) => ds.rasters[y].lst[rows[i]])); linPred[i] = f.intercept + f.slope * 2024; }
  const evalBt = (name: string, p: Float32Array) => {
    const m = metrics(obs24, p);
    const corrected = new Float32Array(nL);
    for (let i = 0; i < nL; i++) corrected[i] = p[i] - m.bias;
    return { name, rmse: m.rmse, bias: m.bias, patternRmse: metrics(obs24, corrected).rmse, r2: m.r2 };
  };
  const backtest = [evalBt("Hybrid ML (GBM + trend)", mlPred), evalBt("Per-pixel linear trend", linPred), evalBt("Persistence (2023)", persist)];

  // ---- final model on all years → target
  const full = pool(YEARS);
  const gbm = new GradientBoosting({ ...gbmOpts }).fit(full.cols, full.y, full.r);
  const featsT = project(YEARS, target);
  const anomT = gbm.predict(featsT, rows);
  const trend = ds.trends.lst;
  const resid = YEARS.map((y) => ds.city[y].lstMean - (trend.intercept + trend.slope * y));
  const sigma = Math.sqrt(resid.reduce((s, v) => s + v * v, 0) / Math.max(1, resid.length - 2));
  const cmT = trend.intercept + trend.slope * target;
  const raster = new Float32Array(ds.n), delta = new Float32Array(ds.n);
  let hotT = 0, hot24 = 0, sumT = 0;
  for (let i = 0; i < ds.n; i++) {
    if (ds.water[i]) { raster[i] = ds.rasters[2024].lst[i] + 0.12 * (target - 2024); continue; }
  }
  for (let i = 0; i < nL; i++) {
    const c = rows[i];
    raster[c] = cmT + anomT[i];
    delta[c] = raster[c] - ds.rasters[2024].lst[c];
    sumT += raster[c];
    if (raster[c] > 42) hotT++;
    if (ds.rasters[2024].lst[c] > 42) hot24++;
  }
  const series: ForecastResult["series"] = [];
  for (let y = 2019; y <= target; y++) {
    const row: ForecastResult["series"][number] = { year: y };
    if (y <= 2024) row.obs = ds.city[y as Year].lstMean;
    if (y >= 2024) { const m = y === 2024 ? ds.city[2024].lstMean : trend.intercept + trend.slope * y; const h = y - 2024; row.ml = m; row.lo = m - sigma * (1 + 0.12 * h); row.hi = m + sigma * (1 + 0.12 * h); }
    series.push(row);
  }
  const zones = ds.zones.map((z) => {
    let s = 0, n = 0;
    for (let i = 0; i < ds.n; i++) if (ds.zoneIndex[i] === z.index && !ds.water[i]) { s += raster[i]; n++; }
    const lstT = s / Math.max(1, n);
    return { name: z.zone.name, lst2024: z.byYear[2024].lst, lstTarget: lstT, delta: lstT - z.byYear[2024].lst };
  }).sort((a, b) => b.delta - a.delta);
  return {
    target, backtest, series, raster, delta,
    stats: { mean2024: ds.city[2024].lstMean, meanTarget: sumT / nL, hot2024: hot24 * ds.cellAreaKm2, hotTarget: hotT * ds.cellAreaKm2, sigma },
    zones, ms: performance.now() - t0,
  };
}
