// Dependency-free ML core: histogram-based regression trees (LightGBM-style binning),
// Random Forest, Gradient Boosting, ridge-regularised OLS, metrics, permutation
// importance and partial dependence. Fast enough to train in the browser (< 1 s).
import { mulberry32 } from "@/data/noise";

export const N_BINS = 64;

// ------------------------------------------------------------------ binning
export interface Binner { thresholds: Float32Array[]; nBins: number }

export function fitBinner(cols: Float32Array[], rows: Int32Array, nBins = N_BINS): Binner {
  const thresholds = cols.map((col) => {
    const sample = new Float32Array(rows.length);
    for (let i = 0; i < rows.length; i++) sample[i] = col[rows[i]];
    sample.sort();
    const thr = new Float32Array(nBins - 1);
    for (let b = 1; b < nBins; b++) thr[b - 1] = sample[Math.min(sample.length - 1, Math.floor((b / nBins) * sample.length))];
    return thr;
  });
  return { thresholds, nBins };
}

export function binColumn(thr: Float32Array, col: Float32Array): Uint8Array {
  const out = new Uint8Array(col.length);
  for (let i = 0; i < col.length; i++) {
    const v = col[i];
    let lo = 0, hi = thr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (thr[mid] <= v) lo = mid + 1; else hi = mid; }
    out[i] = lo;
  }
  return out;
}

export const binCols = (b: Binner, cols: Float32Array[]) => cols.map((c, f) => binColumn(b.thresholds[f], c));

// ------------------------------------------------------------------ tree
export interface Tree { feat: Int16Array; thr: Uint8Array; left: Int32Array; right: Int32Array; value: Float32Array }
interface TreeParams { maxDepth: number; minLeaf: number; featFrac: number; rng: () => number }

function growTree(binned: Uint8Array[], y: Float32Array, idx: Int32Array, p: TreeParams, nBins: number, importance: Float64Array): Tree {
  const F = binned.length;
  const maxNodes = 2 ** (p.maxDepth + 1);
  const feat = new Int16Array(maxNodes).fill(-1), thr = new Uint8Array(maxNodes);
  const left = new Int32Array(maxNodes).fill(-1), right = new Int32Array(maxNodes).fill(-1), value = new Float32Array(maxNodes);
  const hCount = new Int32Array(nBins), hSum = new Float64Array(nBins);
  const tmp = new Int32Array(idx.length);
  const nFeat = Math.max(1, Math.round(F * p.featFrac));
  const order = new Int32Array(F);
  let nNodes = 0;

  const build = (lo: number, hi: number, depth: number): number => {
    const node = nNodes++;
    const n = hi - lo;
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += y[idx[i]];
    value[node] = sum / n;
    if (depth >= p.maxDepth || n < 2 * p.minLeaf) return node;
    for (let f = 0; f < F; f++) order[f] = f;
    for (let f = 0; f < nFeat; f++) { const j = f + Math.floor(p.rng() * (F - f)); const t = order[f]; order[f] = order[j]; order[j] = t; }
    const parentScore = (sum * sum) / n;
    let bestGain = 1e-7, bestF = -1, bestB = -1;
    for (let k = 0; k < nFeat; k++) {
      const f = order[k], col = binned[f];
      hCount.fill(0); hSum.fill(0);
      for (let i = lo; i < hi; i++) { const b = col[idx[i]]; hCount[b]++; hSum[b] += y[idx[i]]; }
      let nL = 0, sL = 0;
      for (let b = 0; b < nBins - 1; b++) {
        nL += hCount[b]; sL += hSum[b];
        if (nL < p.minLeaf) continue;
        const nR = n - nL;
        if (nR < p.minLeaf) break;
        const sR = sum - sL;
        const gain = (sL * sL) / nL + (sR * sR) / nR - parentScore;
        if (gain > bestGain) { bestGain = gain; bestF = f; bestB = b; }
      }
    }
    if (bestF < 0) return node;
    const col = binned[bestF];
    let l = lo, r = 0;
    for (let i = lo; i < hi; i++) { const v = idx[i]; if (col[v] <= bestB) idx[l++] = v; else tmp[r++] = v; }
    for (let i = 0; i < r; i++) idx[l + i] = tmp[i];
    importance[bestF] += bestGain;
    feat[node] = bestF; thr[node] = bestB;
    left[node] = build(lo, l, depth + 1);
    right[node] = build(l, hi, depth + 1);
    return node;
  };
  build(0, idx.length, 0);
  return { feat: feat.subarray(0, nNodes), thr: thr.subarray(0, nNodes), left: left.subarray(0, nNodes), right: right.subarray(0, nNodes), value: value.subarray(0, nNodes) };
}

function predictTree(t: Tree, binned: Uint8Array[], row: number): number {
  let node = 0;
  while (t.feat[node] >= 0) node = binned[t.feat[node]][row] <= t.thr[node] ? t.left[node] : t.right[node];
  return t.value[node];
}

// ------------------------------------------------------------------ model interface
export interface Regressor {
  name: string;
  kind: "linear" | "rf" | "gbm";
  fit(cols: Float32Array[], y: Float32Array, rows: Int32Array): this;
  predict(cols: Float32Array[], rows: Int32Array): Float32Array;
  /** Tree models: predict from pre-binned columns (used by PD / permutation to skip re-binning). */
  predictBinned?(binned: Uint8Array[], rows: Int32Array): Float32Array;
  binner?: Binner;
  importance?: Float64Array; // normalised impurity importance (tree models)
  coef?: Float64Array; // standardised coefficients (linear)
}

export class RandomForest implements Regressor {
  name = "Random Forest"; kind = "rf" as const;
  trees: Tree[] = []; binner!: Binner; importance!: Float64Array;
  constructor(public opts = { nTrees: 60, maxDepth: 10, minLeaf: 4, featFrac: 0.45, sampleFrac: 0.6, seed: 1 }) {}
  fit(cols: Float32Array[], y: Float32Array, rows: Int32Array) {
    const { nTrees, maxDepth, minLeaf, featFrac, sampleFrac, seed } = this.opts;
    this.binner = fitBinner(cols, rows);
    const binned = binCols(this.binner, cols);
    const rng = mulberry32(seed);
    const imp = new Float64Array(cols.length);
    const m = Math.round(rows.length * sampleFrac);
    this.trees = [];
    for (let t = 0; t < nTrees; t++) {
      const idx = new Int32Array(m);
      for (let i = 0; i < m; i++) idx[i] = rows[Math.floor(rng() * rows.length)];
      this.trees.push(growTree(binned, y, idx, { maxDepth, minLeaf, featFrac, rng }, this.binner.nBins, imp));
    }
    const s = imp.reduce((a, b) => a + b, 0) || 1;
    this.importance = imp.map((v) => v / s);
    return this;
  }
  predictBinned(binned: Uint8Array[], rows: Int32Array) {
    const out = new Float32Array(rows.length);
    const k = this.trees.length;
    for (let i = 0; i < rows.length; i++) {
      let s = 0;
      for (let t = 0; t < k; t++) s += predictTree(this.trees[t], binned, rows[i]);
      out[i] = s / k;
    }
    return out;
  }
  predict(cols: Float32Array[], rows: Int32Array) { return this.predictBinned(binCols(this.binner, cols), rows); }
}

export class GradientBoosting implements Regressor {
  name = "Gradient Boosting"; kind = "gbm" as const;
  trees: Tree[] = []; f0 = 0; binner!: Binner; importance!: Float64Array;
  constructor(public opts = { nTrees: 200, maxDepth: 4, minLeaf: 8, lr: 0.08, sampleFrac: 0.7, featFrac: 1, seed: 2 }) {}
  fit(cols: Float32Array[], y: Float32Array, rows: Int32Array) {
    const { nTrees, maxDepth, minLeaf, lr, sampleFrac, featFrac, seed } = this.opts;
    this.binner = fitBinner(cols, rows);
    const binned = binCols(this.binner, cols);
    const rng = mulberry32(seed);
    const imp = new Float64Array(cols.length);
    const n = cols[0].length;
    const F = new Float32Array(n), resid = new Float32Array(n);
    let mean = 0;
    for (let i = 0; i < rows.length; i++) mean += y[rows[i]];
    this.f0 = mean / rows.length;
    for (let i = 0; i < rows.length; i++) F[rows[i]] = this.f0;
    const m = Math.round(rows.length * sampleFrac);
    const perm = Int32Array.from(rows);
    this.trees = [];
    for (let t = 0; t < nTrees; t++) {
      for (let i = 0; i < rows.length; i++) resid[rows[i]] = y[rows[i]] - F[rows[i]];
      for (let i = 0; i < m; i++) { const j = i + Math.floor(rng() * (rows.length - i)); const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp; }
      const tree = growTree(binned, resid, perm.slice(0, m), { maxDepth, minLeaf, featFrac, rng }, this.binner.nBins, imp);
      this.trees.push(tree);
      for (let i = 0; i < rows.length; i++) F[rows[i]] += lr * predictTree(tree, binned, rows[i]);
    }
    const s = imp.reduce((a, b) => a + b, 0) || 1;
    this.importance = imp.map((v) => v / s);
    return this;
  }
  predictBinned(binned: Uint8Array[], rows: Int32Array) {
    const out = new Float32Array(rows.length);
    const lr = this.opts.lr;
    for (let i = 0; i < rows.length; i++) {
      let s = this.f0;
      for (const t of this.trees) s += lr * predictTree(t, binned, rows[i]);
      out[i] = s;
    }
    return out;
  }
  predict(cols: Float32Array[], rows: Int32Array) { return this.predictBinned(binCols(this.binner, cols), rows); }
}

export class LinearModel implements Regressor {
  name = "Linear (OLS)"; kind = "linear" as const;
  mean!: Float64Array; std!: Float64Array; coef!: Float64Array; intercept = 0;
  constructor(public lambda = 1e-3) {}
  fit(cols: Float32Array[], y: Float32Array, rows: Int32Array) {
    const F = cols.length, n = rows.length;
    this.mean = new Float64Array(F); this.std = new Float64Array(F);
    for (let f = 0; f < F; f++) {
      let s = 0, s2 = 0;
      for (let i = 0; i < n; i++) { const v = cols[f][rows[i]]; s += v; s2 += v * v; }
      this.mean[f] = s / n;
      this.std[f] = Math.sqrt(Math.max(1e-12, s2 / n - this.mean[f] ** 2));
    }
    let ym = 0;
    for (let i = 0; i < n; i++) ym += y[rows[i]];
    ym /= n;
    // normal equations on standardised, centred data: (XᵀX + λI) β = Xᵀy
    const A = Array.from({ length: F }, () => new Float64Array(F + 1));
    const z = new Float64Array(F);
    for (let i = 0; i < n; i++) {
      const r = rows[i], yy = y[r] - ym;
      for (let f = 0; f < F; f++) z[f] = (cols[f][r] - this.mean[f]) / this.std[f];
      for (let a = 0; a < F; a++) { const za = z[a]; const row = A[a]; for (let b = a; b < F; b++) row[b] += za * z[b]; row[F] += za * yy; }
    }
    for (let a = 0; a < F; a++) { for (let b = 0; b < a; b++) A[a][b] = A[b][a]; A[a][a] += this.lambda * n; }
    for (let c = 0; c < F; c++) {
      let piv = c;
      for (let r = c + 1; r < F; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]];
      for (let r = 0; r < F; r++) {
        if (r === c) continue;
        const fct = A[r][c] / A[c][c];
        if (!fct) continue;
        for (let k = c; k <= F; k++) A[r][k] -= fct * A[c][k];
      }
    }
    this.coef = new Float64Array(F);
    for (let f = 0; f < F; f++) this.coef[f] = A[f][F] / A[f][f];
    this.intercept = ym;
    return this;
  }
  predict(cols: Float32Array[], rows: Int32Array) {
    const out = new Float32Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      let s = this.intercept;
      for (let f = 0; f < cols.length; f++) s += this.coef[f] * ((cols[f][rows[i]] - this.mean[f]) / this.std[f]);
      out[i] = s;
    }
    return out;
  }
}

// ------------------------------------------------------------------ evaluation helpers
export interface Metrics { r2: number; rmse: number; mae: number; bias: number }

export function metrics(yTrue: Float32Array, yPred: Float32Array): Metrics {
  const n = yTrue.length;
  let m = 0;
  for (let i = 0; i < n; i++) m += yTrue[i];
  m /= n;
  let ssRes = 0, ssTot = 0, abs = 0, bias = 0;
  for (let i = 0; i < n; i++) {
    const e = yTrue[i] - yPred[i];
    ssRes += e * e; abs += Math.abs(e); bias += yPred[i] - yTrue[i]; ssTot += (yTrue[i] - m) ** 2;
  }
  return { r2: 1 - ssRes / ssTot, rmse: Math.sqrt(ssRes / n), mae: abs / n, bias: bias / n };
}

export function gather(src: Float32Array, rows: Int32Array): Float32Array {
  const out = new Float32Array(rows.length);
  for (let i = 0; i < rows.length; i++) out[i] = src[rows[i]];
  return out;
}

/** Permutation importance = increase in RMSE when one feature is shuffled among the test rows. */
export function permutationImportance(model: Regressor, cols: Float32Array[], y: Float32Array, rows: Int32Array, seed = 5): Float64Array {
  const rng = mulberry32(seed);
  const yT = gather(y, rows);
  const base = metrics(yT, model.predict(cols, rows)).rmse;
  const out = new Float64Array(cols.length);
  for (let f = 0; f < cols.length; f++) {
    const shuffled = Float32Array.from(cols[f]);
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const a = rows[i], b = rows[j];
      const t = shuffled[a]; shuffled[a] = shuffled[b]; shuffled[b] = t;
    }
    const cs = cols.slice(); cs[f] = shuffled;
    out[f] = Math.max(0, metrics(yT, model.predict(cs, rows)).rmse - base);
  }
  return out;
}

/** Partial dependence: average prediction over `rows` as feature `f` is forced to each grid value. */
export function partialDependence(model: Regressor, cols: Float32Array[], rows: Int32Array, f: number, grid: number[]): number[] {
  if (model.predictBinned && model.binner) {
    const binned = binCols(model.binner, cols);
    return grid.map((g) => {
      const b = binColumn(model.binner!.thresholds[f], Float32Array.of(g))[0];
      const cs = binned.slice(); cs[f] = new Uint8Array(cols[0].length).fill(b);
      const p = model.predictBinned!(cs, rows);
      let s = 0; for (let i = 0; i < p.length; i++) s += p[i];
      return s / p.length;
    });
  }
  return grid.map((g) => {
    const cs = cols.slice(); cs[f] = new Float32Array(cols[0].length).fill(g);
    const p = model.predict(cs, rows);
    let s = 0; for (let i = 0; i < p.length; i++) s += p[i];
    return s / p.length;
  });
}

/** Spatial block hold-out: the grid is tiled into `block`×`block` cell squares and whole
 *  squares go to the test set — avoids the leakage a random split suffers under spatial autocorrelation. */
export function spatialBlockSplit(rows: Int32Array, w: number, block: number, testFrac: number, seed = 3): { train: Int32Array; test: Int32Array; nBlocks: number; nTestBlocks: number } {
  const rng = mulberry32(seed);
  const nbx = Math.ceil(w / block);
  const isTest = new Map<number, boolean>();
  const train: number[] = [], test: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const bid = Math.floor(Math.floor(r / w) / block) * nbx + Math.floor((r % w) / block);
    if (!isTest.has(bid)) isTest.set(bid, rng() < testFrac);
    (isTest.get(bid) ? test : train).push(r);
  }
  let nTestBlocks = 0;
  isTest.forEach((v) => { if (v) nTestBlocks++; });
  return { train: Int32Array.from(train), test: Int32Array.from(test), nBlocks: isTest.size, nTestBlocks };
}
