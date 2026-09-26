// Unsupervised learning: k-means (k-means++ init) and DBSCAN on the analysis grid.
import { mulberry32 } from "@/data/noise";

export interface KMeansResult { labels: Int32Array; centroids: Float32Array; inertia: number; iterations: number }

/** Lloyd's k-means on row-major `X` (n × d) with k-means++ seeding. */
export function kmeans(X: Float32Array, n: number, d: number, k: number, opts: { iters?: number; seed?: number } = {}): KMeansResult {
  const iters = opts.iters ?? 40;
  const rng = mulberry32(opts.seed ?? 11);
  const centroids = new Float32Array(k * d);
  // k-means++
  const dist = new Float64Array(n).fill(Infinity);
  let first = Math.floor(rng() * n);
  centroids.set(X.subarray(first * d, first * d + d), 0);
  for (let c = 1; c < k; c++) {
    let total = 0;
    const prev = (c - 1) * d;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < d; j++) { const t = X[i * d + j] - centroids[prev + j]; s += t * t; }
      if (s < dist[i]) dist[i] = s;
      total += dist[i];
    }
    let r = rng() * total, pick = n - 1;
    for (let i = 0; i < n; i++) { r -= dist[i]; if (r <= 0) { pick = i; break; } }
    centroids.set(X.subarray(pick * d, pick * d + d), c * d);
  }
  const labels = new Int32Array(n).fill(-1);
  const sums = new Float64Array(k * d), counts = new Int32Array(k);
  let inertia = 0, it = 0;
  for (; it < iters; it++) {
    let changed = 0;
    inertia = 0;
    sums.fill(0); counts.fill(0);
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        let s = 0;
        for (let j = 0; j < d; j++) { const t = X[i * d + j] - centroids[c * d + j]; s += t * t; }
        if (s < bd) { bd = s; best = c; }
      }
      if (labels[i] !== best) { labels[i] = best; changed++; }
      inertia += bd;
      counts[best]++;
      for (let j = 0; j < d; j++) sums[best * d + j] += X[i * d + j];
    }
    for (let c = 0; c < k; c++) if (counts[c]) for (let j = 0; j < d; j++) centroids[c * d + j] = sums[c * d + j] / counts[c];
    if (!changed) break;
  }
  return { labels, centroids, inertia, iterations: it + 1 };
}

export interface DbscanResult { labels: Int32Array; nClusters: number; nNoise: number }

/** DBSCAN over candidate cells of a w×h lattice. eps in cells (Euclidean), labels: −2 not a candidate, −1 noise, ≥0 cluster id (sorted by size). */
export function dbscanGrid(candidate: ArrayLike<number>, w: number, h: number, eps = 1.5, minPts = 4): DbscanResult {
  const n = w * h;
  const R = Math.floor(eps);
  const offsets: [number, number][] = [];
  for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) if ((dr || dc) && dr * dr + dc * dc <= eps * eps) offsets.push([dr, dc]);
  const labels = new Int32Array(n).fill(-2);
  for (let i = 0; i < n; i++) if (candidate[i]) labels[i] = -3; // unvisited candidate
  const neighbours = (i: number, out: number[]) => {
    out.length = 0;
    const r = Math.floor(i / w), c = i % w;
    for (const [dr, dc] of offsets) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= h || cc < 0 || cc >= w) continue;
      const j = rr * w + cc;
      if (candidate[j]) out.push(j);
    }
  };
  const nb: number[] = [], nb2: number[] = [];
  let cid = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== -3) continue;
    neighbours(i, nb);
    if (nb.length + 1 < minPts) { labels[i] = -1; continue; }
    labels[i] = cid;
    const queue = nb.slice();
    while (queue.length) {
      const j = queue.pop()!;
      if (labels[j] === -1) labels[j] = cid; // border point
      if (labels[j] !== -3) continue;
      labels[j] = cid;
      neighbours(j, nb2);
      if (nb2.length + 1 >= minPts) for (const q of nb2) if (labels[q] === -3 || labels[q] === -1) queue.push(q);
    }
    cid++;
  }
  // relabel by size (largest first)
  const sizes = new Int32Array(cid);
  for (let i = 0; i < n; i++) if (labels[i] >= 0) sizes[labels[i]]++;
  const order = Array.from(sizes.keys()).sort((a, b) => sizes[b] - sizes[a]);
  const remap = new Int32Array(cid);
  order.forEach((old, rank) => (remap[old] = rank));
  let nNoise = 0;
  for (let i = 0; i < n; i++) { if (labels[i] >= 0) labels[i] = remap[labels[i]]; else if (labels[i] === -1) nNoise++; }
  return { labels, nClusters: cid, nNoise };
}

/** z-score columns into a row-major matrix (for k-means). */
export function standardizeRowMajor(cols: ArrayLike<number>[], rows: Int32Array): { X: Float32Array; mean: number[]; std: number[] } {
  const d = cols.length, n = rows.length;
  const mean = cols.map((c) => { let s = 0; for (let i = 0; i < n; i++) s += c[rows[i]]; return s / n; });
  const std = cols.map((c, j) => { let s = 0; for (let i = 0; i < n; i++) s += (c[rows[i]] - mean[j]) ** 2; return Math.sqrt(s / n) || 1; });
  const X = new Float32Array(n * d);
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) X[i * d + j] = (cols[j][rows[i]] - mean[j]) / std[j];
  return { X, mean, std };
}
