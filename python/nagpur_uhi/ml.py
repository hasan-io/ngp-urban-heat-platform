"""Machine-learning layer (scikit-learn) on top of the Nagpur cube.

    LST prediction      LinearRegression vs RandomForestRegressor vs HistGradientBoostingRegressor
                        evaluated with *spatial block* GroupKFold (no leakage from autocorrelation),
                        permutation importance, partial dependence
    Land-cover classes  KMeans on spectral + neighbourhood features (water fixed from the QA mask),
                        2019→2024 transition matrix
    Heat islands        DBSCAN on persistent-hotspot pixels → contiguous islands with statistics
    Anomalies           IsolationForest on model residuals → unexplained heat sources
    Forecast            hybrid: GBM learns the spatial anomaly LST − cityMean(year) from land-cover
                        features; the city mean is extrapolated linearly (trees cannot extrapolate);
                        NDVI/NDBI of the target year from per-pixel trends; back-tested on 2024
    ML what-if          `MLScenarioModel` — non-linear ΔLST for vegetation / built-up changes with
                        neighbourhood features recomputed

    python -m nagpur_uhi ml --year 2024 --forecast 2030
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence

import numpy as np

from . import config as C
from .cube import Cube
from .temporal import city_trend, hotspot_persistence

FEATURES = [
    ("ndvi", "NDVI"), ("ndbi", "NDBI"), ("ndvi_1km", "NDVI 1 km mean"), ("ndbi_1km", "NDBI 1 km mean"),
    ("ndbi_std_1km", "NDBI 1 km texture"), ("water_1km", "Water share 1 km"), ("dist_water", "Distance to water (km)"),
    ("dist_center", "Distance to centre (km)"), ("dist_road", "Distance to major road (km)"),
    ("industrial", "Industrial land-use proximity"), ("x_km", "Easting (km)"), ("y_km", "Northing (km)"),
]
FEATURE_KEYS = [k for k, _ in FEATURES]


def _sk():
    try:
        import sklearn  # noqa: F401
    except ImportError as e:  # pragma: no cover
        raise SystemExit("pip install scikit-learn") from e


# ---------------------------------------------------------------------------- feature engineering
def box_mean(a: np.ndarray, r: int = 2) -> np.ndarray:
    """Mean over a (2r+1)² window via integral image; edges renormalised. NaNs treated as 0."""
    a = np.nan_to_num(a.astype(np.float64))
    h, w = a.shape
    I = np.zeros((h + 1, w + 1))
    I[1:, 1:] = a.cumsum(0).cumsum(1)
    ones = np.ones_like(a)
    J = np.zeros((h + 1, w + 1))
    J[1:, 1:] = ones.cumsum(0).cumsum(1)
    r0 = np.clip(np.arange(h) - r, 0, h); r1 = np.clip(np.arange(h) + r + 1, 0, h)
    c0 = np.clip(np.arange(w) - r, 0, w); c1 = np.clip(np.arange(w) + r + 1, 0, w)
    S = I[r1][:, c1] - I[r0][:, c1] - I[r1][:, c0] + I[r0][:, c0]
    N = J[r1][:, c1] - J[r0][:, c1] - J[r1][:, c0] + J[r0][:, c0]
    return (S / N).astype(np.float32)


def _km_grids(cube: Cube):
    lon2d, lat2d = np.meshgrid(cube.lon, cube.lat)
    x = (lon2d - C.CITY_CENTER[1]) * C.KM_PER_DEG_LON
    y = (lat2d - C.CITY_CENTER[0]) * C.KM_PER_DEG_LAT
    return x, y


def _polyline_dist(x, y, pts_latlon):
    best = np.full(x.shape, np.inf)
    P = [((lon - C.CITY_CENTER[1]) * C.KM_PER_DEG_LON, (lat - C.CITY_CENTER[0]) * C.KM_PER_DEG_LAT) for lat, lon in pts_latlon]
    for (ax, ay), (bx, by) in zip(P[:-1], P[1:]):
        vx, vy = bx - ax, by - ay
        l2 = vx * vx + vy * vy or 1e-9
        t = np.clip(((x - ax) * vx + (y - ay) * vy) / l2, 0, 1)
        best = np.minimum(best, np.hypot(x - (ax + t * vx), y - (ay + t * vy)))
    return best


_static_cache: Dict[int, dict] = {}


def static_features(cube: Cube) -> dict:
    """Geography that does not change between years (cached per cube)."""
    key = id(cube)
    if key in _static_cache:
        return _static_cache[key]
    _sk()
    from sklearn.neighbors import KDTree

    x, y = _km_grids(cube)
    wx, wy = x[cube.water], y[cube.water]
    if len(wx):
        d, _ = KDTree(np.column_stack([wx, wy])).query(np.column_stack([x.ravel(), y.ravel()]), k=1)
        dist_water = d[:, 0].reshape(x.shape)
    else:
        dist_water = np.full(x.shape, 10.0)
    dist_road = np.min([_polyline_dist(x, y, pts) for pts in C.MAJOR_ROADS], axis=0)
    industrial = np.zeros_like(x)
    for lat, lon, radius_km, strength in C.INDUSTRIAL_SITES:
        d = np.hypot(x - (lon - C.CITY_CENTER[1]) * C.KM_PER_DEG_LON, y - (lat - C.CITY_CENTER[0]) * C.KM_PER_DEG_LAT)
        industrial = np.maximum(industrial, strength * np.exp(-((d / radius_km) ** 2)))
    out = dict(water_1km=box_mean(cube.water.astype(np.float32)), dist_water=dist_water.astype(np.float32),
               dist_center=np.hypot(x, y).astype(np.float32), dist_road=dist_road.astype(np.float32),
               industrial=industrial.astype(np.float32), x_km=x.astype(np.float32), y_km=y.astype(np.float32))
    _static_cache[key] = out
    return out


def feature_stack(cube: Cube, year: int, ndvi: Optional[np.ndarray] = None, ndbi: Optional[np.ndarray] = None) -> np.ndarray:
    """(H, W, F) feature array for one year; NDVI/NDBI can be overridden for scenarios."""
    s = static_features(cube)
    ndvi = cube.ndvi[year] if ndvi is None else ndvi
    ndbi = cube.ndbi[year] if ndbi is None else ndbi
    ndbi_m = box_mean(ndbi)
    ndbi_std = np.sqrt(np.maximum(0, box_mean(ndbi ** 2) - ndbi_m ** 2))
    layers = [ndvi, ndbi, box_mean(ndvi), ndbi_m, ndbi_std, s["water_1km"], s["dist_water"], s["dist_center"], s["dist_road"], s["industrial"], s["x_km"], s["y_km"]]
    return np.stack([np.nan_to_num(l.astype(np.float32)) for l in layers], axis=-1)


def design_matrix(cube: Cube, year: int, **override):
    """X (n_land, F), y (n_land,), rows (flat land indices)."""
    F = feature_stack(cube, year, **override)
    land = cube.land & np.isfinite(cube.lst[year])
    rows = np.flatnonzero(land.ravel())
    return F.reshape(-1, F.shape[-1])[rows], cube.lst[year].ravel()[rows], rows


def spatial_blocks(cube: Cube, rows: np.ndarray, block_cells: int = 10) -> np.ndarray:
    """Block id per row — whole 2 km squares are held out together."""
    h, w = cube.shape
    r, c = np.divmod(rows, w)
    return (r // block_cells) * ((w + block_cells - 1) // block_cells) + c // block_cells


# ---------------------------------------------------------------------------- LST models
def _models(random_state: int = 0):
    from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
    from sklearn.linear_model import LinearRegression

    return {
        "Linear (OLS)": LinearRegression(),
        "Random Forest": RandomForestRegressor(n_estimators=80, max_depth=10, min_samples_leaf=5, max_features=0.5, n_jobs=-1, random_state=random_state),
        "Gradient Boosting": HistGradientBoostingRegressor(max_iter=300, learning_rate=0.06, max_depth=5, min_samples_leaf=15, l2_regularization=1.0, random_state=random_state),
    }


def _metrics(y, p) -> dict:
    e = y - p
    return dict(r2=float(1 - (e ** 2).sum() / ((y - y.mean()) ** 2).sum()), rmse=float(np.sqrt((e ** 2).mean())), mae=float(np.abs(e).mean()), bias=float(-e.mean()))


def train_lst_models(cube: Cube, year: int, n_splits: int = 5, random_state: int = 0) -> dict:
    """Spatial GroupKFold comparison + refit of the best model with permutation importance & partial dependence."""
    _sk()
    from sklearn.inspection import permutation_importance
    from sklearn.model_selection import GroupKFold

    X, y, rows = design_matrix(cube, year)
    groups = spatial_blocks(cube, rows)
    gkf = GroupKFold(n_splits=n_splits)
    results, fitted = {}, {}
    for name, model in _models(random_state).items():
        folds = []
        for tr, te in gkf.split(X, y, groups):
            model.fit(X[tr], y[tr])
            folds.append(_metrics(y[te], model.predict(X[te])))
        results[name] = {k: float(np.mean([f[k] for f in folds])) for k in folds[0]}
        results[name]["r2_std"] = float(np.std([f["r2"] for f in folds]))
        fitted[name] = model.fit(X, y)
    best = min(results, key=lambda k: results[k]["rmse"])
    # importance on a spatial hold-out fold of the best model
    tr, te = next(gkf.split(X, y, groups))
    fitted[best].fit(X[tr], y[tr])
    pi = permutation_importance(fitted[best], X[te], y[te], n_repeats=5, random_state=random_state, scoring="neg_root_mean_squared_error")
    importance = sorted([{"key": k, "label": l, "value": float(v), "std": float(s)} for (k, l), v, s in zip(FEATURES, pi.importances_mean, pi.importances_std)], key=lambda d: -d["value"])
    fitted[best].fit(X, y)
    pred = fitted[best].predict(X)
    residual = np.full(cube.shape, np.nan, dtype=np.float32)
    residual.ravel()[rows] = y - pred
    sample = X[np.random.default_rng(random_state).choice(len(X), min(800, len(X)), replace=False)]

    def pd_curve(fi: int, grid: Sequence[float], model) -> List[dict]:
        out = []
        for g in grid:
            Xs = sample.copy(); Xs[:, fi] = g
            out.append({"x": float(g), "y": float(model.predict(Xs).mean())})
        return out

    pd = {"ndvi": {n: pd_curve(0, np.linspace(0, 0.8, 17), m) for n, m in fitted.items()},
          "ndbi": {n: pd_curve(1, np.linspace(-0.4, 0.5, 19), m) for n, m in fitted.items()}}
    lin = fitted["Linear (OLS)"]
    return {"year": year, "n": int(len(y)), "n_blocks": int(len(np.unique(groups))), "cv": results, "best": best,
            "permutation_importance": importance, "linear_coef": dict(zip(FEATURE_KEYS, map(float, lin.coef_))),
            "partial_dependence": pd, "residual": residual, "model": fitted[best], "models": fitted}


# ---------------------------------------------------------------------------- land cover clustering
LC_LABELS = ["Dense canopy", "Moderate vegetation", "Sparse veg. / open", "Mixed built-up", "Dense built-up / industrial"]


def cluster_land_cover(cube: Cube, k: int = 5, years: Sequence[int] = (2019, 2024), random_state: int = 0) -> dict:
    """KMeans on [NDVI, NDBI, NDVI-1km, NDBI-1km] of land pixels pooled over `years`; water = class 0."""
    _sk()
    from sklearn.cluster import KMeans
    from sklearn.preprocessing import StandardScaler

    land = cube.land.ravel()
    feats = {y: feature_stack(cube, y)[..., :4].reshape(-1, 4)[land] for y in years}
    pooled = np.vstack([feats[y] for y in years])
    Xs = StandardScaler().fit_transform(pooled)
    km = KMeans(n_clusters=k, n_init=4, random_state=random_state).fit(Xs)
    cent = np.array([pooled[km.labels_ == c].mean(axis=0) for c in range(k)])
    order = np.argsort(cent[:, 1] - cent[:, 0])          # greenest → most built
    rank = {int(c): r + 1 for r, c in enumerate(order)}   # 0 reserved for water
    labels, px, n_land = {}, cube.pixel_area_km2, int(land.sum())
    for i, y in enumerate(years):
        lab = np.zeros(cube.shape[0] * cube.shape[1], dtype=np.int16)
        lab[land] = [rank[int(c)] for c in km.labels_[i * n_land:(i + 1) * n_land]]
        labels[y] = lab.reshape(cube.shape)
    classes = [{"id": 0, "label": "Water", "ndvi": -0.12, "ndbi": -0.46,
                "area_km2": {y: float((labels[y] == 0).sum() * px) for y in years},
                "lst": {y: float(np.nanmean(cube.lst[y][labels[y] == 0])) for y in years}}]
    for r, c in enumerate(order, start=1):
        li = round((r - 1) / max(1, k - 1) * (len(LC_LABELS) - 1))
        classes.append({"id": r, "label": LC_LABELS[li], "ndvi": float(cent[c, 0]), "ndbi": float(cent[c, 1]),
                        "area_km2": {y: float((labels[y] == r).sum() * px) for y in years},
                        "lst": {y: float(np.nanmean(cube.lst[y][labels[y] == r])) for y in years}})
    y0, y1 = years[0], years[-1]
    trans = np.zeros((k + 1, k + 1))
    np.add.at(trans, (labels[y0].ravel(), labels[y1].ravel()), px)
    built = [c["id"] for c in classes if "built" in c["label"].lower()]
    open_ = [c["id"] for c in classes if c["id"] != 0 and c["id"] not in built]
    return {"k": k, "years": list(years), "classes": classes, "labels": labels, "transition_km2": trans.round(2).tolist(),
            "open_to_built_km2": float(trans[np.ix_(open_, built)].sum()), "built_to_open_km2": float(trans[np.ix_(built, open_)].sum()),
            "inertia": float(km.inertia_)}


# ---------------------------------------------------------------------------- heat islands (DBSCAN)
def segment_heat_islands(cube: Cube, min_years: int = 4, eps_cells: float = 1.5, min_samples: int = 4) -> dict:
    _sk()
    from sklearn.cluster import DBSCAN

    from .zones import rasterize_zones

    pers = hotspot_persistence(cube)
    cand = cube.land & (pers >= min_years)
    rr, cc = np.nonzero(cand)
    if len(rr) == 0:
        return {"islands": [], "labels": np.full(cube.shape, -2, dtype=np.int16), "n_noise": 0}
    db = DBSCAN(eps=eps_cells, min_samples=min_samples).fit(np.column_stack([rr, cc]))
    labels = np.full(cube.shape, -2, dtype=np.int16)
    labels[rr, cc] = db.labels_
    zone_idx = rasterize_zones(cube)
    lst = cube.lst[cube.years[-1]]
    lon2d, lat2d = np.meshgrid(cube.lon, cube.lat)
    islands = []
    for cid in range(db.labels_.max() + 1):
        m = labels == cid
        z = zone_idx[m]
        z = z[z >= 0]
        zi = int(np.bincount(z).argmax()) if len(z) else -1
        islands.append({"id": cid, "cells": int(m.sum()), "area_km2": float(m.sum() * cube.pixel_area_km2),
                        "mean_lst": float(np.nanmean(lst[m])), "peak_lst": float(np.nanmax(lst[m])),
                        "mean_ndbi": float(np.nanmean(cube.ndbi[cube.years[-1]][m])), "mean_ndvi": float(np.nanmean(cube.ndvi[cube.years[-1]][m])),
                        "persistence_years": float(pers[m].mean()), "centroid": [float(lat2d[m].mean()), float(lon2d[m].mean())],
                        "zone": C.ZONES[zi]["short"] if zi >= 0 else "periphery"})
    islands.sort(key=lambda d: -d["area_km2"])
    for r, isl in enumerate(islands):
        isl["rank"] = r + 1
    return {"min_years": min_years, "eps_cells": eps_cells, "min_samples": min_samples, "n_candidates": int(cand.sum()),
            "n_noise": int((db.labels_ == -1).sum()), "islands": islands, "labels": labels}


# ---------------------------------------------------------------------------- anomalies
def detect_anomalies(cube: Cube, year: int, model=None, contamination: float = 0.02, random_state: int = 0) -> dict:
    """IsolationForest over (residual, LST, NDBI, NDVI): pixels far hotter than their land cover explains."""
    _sk()
    from sklearn.ensemble import IsolationForest

    from .zones import rasterize_zones

    if model is None:
        model = train_lst_models(cube, year)["model"]
    X, y, rows = design_matrix(cube, year)
    resid = y - model.predict(X)
    Z = np.column_stack([resid, y, X[:, 1], X[:, 0]])
    iso = IsolationForest(contamination=contamination, random_state=random_state).fit(Z)
    score = -iso.score_samples(Z)
    flag = (iso.predict(Z) == -1) & (resid > 0)
    zone_idx = rasterize_zones(cube).ravel()
    lat = np.repeat(cube.lat, cube.shape[1]); lon = np.tile(cube.lon, cube.shape[0])
    top = np.argsort(-resid * flag)[:15]
    return {"year": year, "n_flagged": int(flag.sum()), "flagged_km2": float(flag.sum() * cube.pixel_area_km2),
            "top": [{"lat": float(lat[rows[i]]), "lon": float(lon[rows[i]]), "lst": float(y[i]), "residual": float(resid[i]),
                     "score": float(score[i]), "zone": C.ZONES[zone_idx[rows[i]]]["short"] if zone_idx[rows[i]] >= 0 else "periphery"} for i in top if flag[i]]}


# ---------------------------------------------------------------------------- forecast
def _projected_indices(cube: Cube, years: Sequence[int], to_year: int):
    t = np.asarray(years, dtype=float)
    ndvi = np.stack([cube.ndvi[y] for y in years]); ndbi = np.stack([cube.ndbi[y] for y in years])
    tc = t - t.mean()
    proj = lambda S, lo, hi: np.clip(S.mean(0) + ((tc[:, None, None] * (S - S.mean(0))).sum(0) / (tc ** 2).sum()) * (to_year - t.mean()), lo, hi)
    return proj(ndvi, -0.15, 0.9).astype(np.float32), proj(ndbi, -0.5, 0.7).astype(np.float32)


def forecast_lst(cube: Cube, target_year: int = 2030, random_state: int = 0) -> dict:
    _sk()
    from sklearn.ensemble import HistGradientBoostingRegressor

    def pooled(years):
        Xs, ys = [], []
        for y in years:
            X, yy, _ = design_matrix(cube, y)
            Xs.append(X); ys.append(yy - np.nanmean(cube.lst[y]))
        return np.vstack(Xs), np.concatenate(ys)

    gbm = lambda: HistGradientBoostingRegressor(max_iter=250, learning_rate=0.08, max_depth=4, min_samples_leaf=20, random_state=random_state)
    means = {y: float(np.nanmean(cube.lst[y])) for y in cube.years}
    # back-test: train ≤ second-last year → forecast last year
    last = cube.years[-1]
    train_years = [y for y in cube.years if y < last]
    m_bt = gbm().fit(*pooled(train_years))
    tr = city_trend(train_years, [means[y] for y in train_years])
    nd, nb = _projected_indices(cube, train_years, last)
    Xl, yl, rows = design_matrix(cube, last, ndvi=nd, ndbi=nb)
    ml = tr.at(last) + m_bt.predict(Xl)
    t = np.asarray(train_years, dtype=float)
    L = np.stack([cube.lst[y].ravel()[rows] for y in train_years])
    slope = ((t - t.mean())[:, None] * (L - L.mean(0))).sum(0) / ((t - t.mean()) ** 2).sum()
    lin = L.mean(0) + slope * (last - t.mean())
    persist = cube.lst[train_years[-1]].ravel()[rows]

    def bt(name, p):
        m = _metrics(yl, p)
        m["pattern_rmse"] = float(np.sqrt(((yl - (p - m["bias"])) ** 2).mean()))
        return {"name": name, **m}

    backtest = [bt("Hybrid ML (GBM + trend)", ml), bt("Per-pixel linear trend", lin), bt(f"Persistence ({train_years[-1]})", persist)]
    # final model → target year
    m_all = gbm().fit(*pooled(cube.years))
    tr_all = city_trend(cube.years, [means[y] for y in cube.years])
    nd, nb = _projected_indices(cube, cube.years, target_year)
    Xt, _, rows_t = design_matrix(cube, last, ndvi=nd, ndbi=nb)
    raster = np.full(cube.shape, np.nan, dtype=np.float32)
    raster.ravel()[rows_t] = tr_all.at(target_year) + m_all.predict(Xt)
    resid = np.array([means[y] - tr_all.at(y) for y in cube.years])
    sigma = float(np.sqrt((resid ** 2).sum() / max(1, len(resid) - 2)))
    return {"target_year": target_year, "backtest": backtest, "city_mean_target": float(np.nanmean(raster)),
            "city_mean_last": means[last], "hot_km2_target": float(np.nansum(raster > C.HOT_ABS_C) * cube.pixel_area_km2),
            "hot_km2_last": float(np.nansum(cube.lst[last] > C.HOT_ABS_C) * cube.pixel_area_km2), "trend_sigma": sigma,
            "series": {int(y): {"observed": means[y]} for y in cube.years} | {int(y): {"forecast": tr_all.at(y), "lo": tr_all.at(y) - sigma * (1 + 0.12 * (y - last)), "hi": tr_all.at(y) + sigma * (1 + 0.12 * (y - last))} for y in range(last + 1, target_year + 1)},
            "raster": raster}


# ---------------------------------------------------------------------------- ML what-if
@dataclass
class MLScenarioModel:
    cube: Cube
    model: object
    linear: object
    year: int

    @classmethod
    def from_cube(cls, cube: Cube, year: Optional[int] = None) -> "MLScenarioModel":
        year = year or cube.years[-1]
        res = train_lst_models(cube, year)
        return cls(cube, res["model"], res["models"]["Linear (OLS)"], year)

    def run(self, zone_id: str, veg_delta_pct: float = 0.0, built_delta_pct: float = 0.0) -> dict:
        from .zones import rasterize_zones

        zi = next(i for i, z in enumerate(C.ZONES) if z["id"] == zone_id)
        m = (rasterize_zones(self.cube) == zi) & self.cube.land
        ndvi = self.cube.ndvi[self.year].copy(); ndbi = self.cube.ndbi[self.year].copy()
        ndvi[m] = np.clip(ndvi[m] + C.NDVI_PER_VEG_FRACTION * veg_delta_pct / 100, -0.05, 0.9)
        ndbi[m] = np.clip(ndbi[m] + C.NDBI_PER_BUILT_FRACTION * built_delta_pct / 100, -0.5, 0.7)
        X0, _, rows = design_matrix(self.cube, self.year)
        X1, _, _ = design_matrix(self.cube, self.year, ndvi=ndvi, ndbi=ndbi)
        sel = m.ravel()[rows]
        d_ml = float((self.model.predict(X1[sel]) - self.model.predict(X0[sel])).mean())
        d_lin = float((self.linear.predict(X1[sel]) - self.linear.predict(X0[sel])).mean())
        return {"zone": zone_id, "veg_delta_pct": veg_delta_pct, "built_delta_pct": built_delta_pct, "d_lst_ml": d_ml, "d_lst_linear": d_lin,
                "note": "tree ensembles do not extrapolate beyond observed feature ranges"}

    def response_curve(self, zone_id: str, pcts=(-20, -10, 0, 10, 20, 30, 40, 50)) -> List[dict]:
        return [{"pct": p, "veg": self.run(zone_id, veg_delta_pct=p), "built": self.run(zone_id, built_delta_pct=p)} for p in pcts]


# ---------------------------------------------------------------------------- bundle
def ml_report(cube: Cube, year: Optional[int] = None, target_year: int = 2030) -> dict:
    year = year or cube.years[-1]
    lst = train_lst_models(cube, year)
    lc = cluster_land_cover(cube)
    isl = segment_heat_islands(cube)
    anom = detect_anomalies(cube, year, model=lst["model"])
    fc = forecast_lst(cube, target_year)
    scen = MLScenarioModel(cube, lst["model"], lst["models"]["Linear (OLS)"], year)
    return {
        "lst_model": {k: v for k, v in lst.items() if k not in ("residual", "model", "models")},
        "land_cover": {k: v for k, v in lc.items() if k != "labels"},
        "heat_islands": {k: v for k, v in isl.items() if k != "labels"},
        "anomalies": anom,
        "forecast": {k: v for k, v in fc.items() if k != "raster"},
        "ml_whatif_besa": scen.response_curve("besa", pcts=(-10, 0, 10, 20, 30)),
    }
