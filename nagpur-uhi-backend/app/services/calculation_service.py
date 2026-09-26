"""Derived statistics: city KPIs, zone statistics, hotspot detection (95th percentile + connected
components), persistence, trends/projections and correlation diagnostics."""
from __future__ import annotations

import numpy as np
from scipy import ndimage

from app.services.cache_service import analysis_cache
from app.services.satellite_data_service import SatelliteCube
from app.utils import constants as C
from app.utils.calculations import classify, linear_fit, multiple_regression


# ---------------------------------------------------------------- city statistics
def hotspot_threshold(cube: SatelliteCube, year: int) -> float:
    lst = cube.lst(year)
    return float(np.nanpercentile(lst[cube.valid_mask(year)], C.HOTSPOT_PERCENTILE))


def hotspot_mask(cube: SatelliteCube, year: int) -> np.ndarray:
    return analysis_cache.get_or_set(f"hotmask_{year}", lambda: cube.valid_mask(year) & (cube.lst(year) >= hotspot_threshold(cube, year)))


def persistence(cube: SatelliteCube) -> np.ndarray:
    """Number of seasons (0–6) each cell was inside the hotspot mask."""
    def _calc():
        count = np.zeros(cube.shape, dtype=np.int16)
        for y in cube.available_years():
            count += hotspot_mask(cube, y)
        return count
    return analysis_cache.get_or_set("persistence", _calc)


def city_stats(cube: SatelliteCube, year: int) -> dict:
    def _calc():
        lst, ndvi, ndbi = cube.lst(year), cube.ndvi(year), cube.ndbi(year)
        valid = cube.valid_mask(year)
        L = lst[valid]
        mask = hotspot_mask(cube, year)
        base = cube.valid_mask(C.BASE_YEAR)
        px = cube.cell_area_km2
        return {
            "year": year, "lst_mean": float(L.mean()), "lst_max": float(L.max()), "lst_min": float(L.min()), "lst_std": float(L.std()),
            "lst_p95": hotspot_threshold(cube, year), "ndvi_mean": float(ndvi[valid].mean()), "ndbi_mean": float(ndbi[valid].mean()),
            "hotspot_cells": int(mask.sum()), "hotspot_area_km2": float(mask.sum() * px),
            "hot_area_km2": float((L > C.HOT_ABS_C).sum() * px), "green_area_km2": float((ndvi[valid] > C.GREEN_NDVI).sum() * px),
            "built_area_km2": float((ndbi[valid] > C.BUILT_NDBI).sum() * px),
            "vegetation_change_vs_base": float(ndvi[valid].mean() - cube.ndvi(C.BASE_YEAR)[base].mean()),
            "valid_pixels_pct": float(valid.sum() / max(1, cube.land.sum()) * 100),
        }
    return analysis_cache.get_or_set(f"city_{year}", _calc)


# ---------------------------------------------------------------- hotspot components
def hotspot_components(cube: SatelliteCube, year: int, min_cells: int = 2) -> list[dict]:
    """Connected-component labelling (8-connectivity) of the hotspot mask."""
    def _calc():
        mask = hotspot_mask(cube, year)
        labels, n = ndimage.label(mask, structure=np.ones((3, 3)))
        lst = cube.lst(year)
        pers = persistence(cube)
        lon2d, lat2d = np.meshgrid(cube.lon, cube.lat)
        out = []
        for lab in range(1, n + 1):
            m = labels == lab
            cells = int(m.sum())
            if cells < min_cells:
                continue
            zi = cube.zone_index[m]
            zi = zi[zi >= 0]
            zone = cube.zones[int(np.bincount(zi).argmax())]["properties"] if len(zi) else None
            out.append({"id": lab, "cells": cells, "area_km2": cells * cube.cell_area_km2, "mean_lst": float(lst[m].mean()),
                        "peak_lst": float(lst[m].max()), "persistence_years": float(pers[m].mean()),
                        "centroid": {"lat": float(lat2d[m].mean()), "lon": float(lon2d[m].mean())},
                        "bbox": [float(lon2d[m].min()), float(lat2d[m].min()), float(lon2d[m].max()), float(lat2d[m].max())],
                        "zone_id": zone["zone_id"] if zone else None, "zone": zone["name"] if zone else "periphery"})
        # rank by intensity × size
        out.sort(key=lambda d: -(d["mean_lst"] - 30) * np.sqrt(d["cells"]))
        for r, d in enumerate(out, start=1):
            d["rank"] = r
        return out
    return analysis_cache.get_or_set(f"components_{year}", _calc)


def persistent_components(cube: SatelliteCube, min_years: int | None = None) -> list[dict]:
    years = cube.available_years()
    need = len(years) if min_years is None else min_years
    pers = persistence(cube)
    mask = cube.land & (pers >= need)
    labels, n = ndimage.label(mask, structure=np.ones((3, 3)))
    lst = cube.lst(years[-1])
    lon2d, lat2d = np.meshgrid(cube.lon, cube.lat)
    out = []
    for lab in range(1, n + 1):
        m = labels == lab
        zi = cube.zone_index[m]; zi = zi[zi >= 0]
        zone = cube.zones[int(np.bincount(zi).argmax())]["properties"] if len(zi) else None
        out.append({"id": lab, "cells": int(m.sum()), "area_km2": float(m.sum() * cube.cell_area_km2), "mean_lst": float(lst[m].mean()),
                    "years_hot": need, "centroid": {"lat": float(lat2d[m].mean()), "lon": float(lon2d[m].mean())},
                    "bbox": [float(lon2d[m].min()), float(lat2d[m].min()), float(lon2d[m].max()), float(lat2d[m].max())],
                    "zone_id": zone["zone_id"] if zone else None, "zone": zone["name"] if zone else "periphery"})
    out.sort(key=lambda d: -d["area_km2"])
    return out


# ---------------------------------------------------------------- zone statistics
def zone_stats(cube: SatelliteCube, zone_id: str, year: int) -> dict:
    def _calc():
        m = cube.zone_mask(zone_id) & cube.valid_mask(year)
        if not m.any():
            return None
        lst, ndvi, ndbi = cube.lst(year)[m], cube.ndvi(year)[m], cube.ndbi(year)[m]
        pers = persistence(cube)[m]
        hot = hotspot_mask(cube, year)[m]
        q = cube.quality(year)
        return {
            "lst_mean": float(lst.mean()), "lst_min": float(lst.min()), "lst_max": float(lst.max()), "lst_std": float(lst.std()),
            "ndvi_mean": float(ndvi.mean()), "ndvi_class": classify(float(ndvi.mean()), C.NDVI_CLASSES),
            "ndbi_mean": float(ndbi.mean()), "ndbi_class": classify(float(ndbi.mean()), C.NDBI_CLASSES),
            "hot_fraction": float(hot.mean()), "persistent_fraction": float((pers >= C.PERSISTENT_YEARS).mean()),
            "persistence_years_mean": float(pers.mean()), "cells": int(m.sum()), "area_km2": float(cube.zone_mask(zone_id).sum() * cube.cell_area_km2),
            "cloud_cover": float(q["residual_cloud_pct"]), "valid_pixels": float(m.sum() / max(1, cube.zone_mask(zone_id).sum()) * 100),
            "data_quality": float(q["completeness_pct"]) / 100.0,
        }
    return analysis_cache.get_or_set(f"zone_stats_{zone_id}_{year}", _calc)


def zone_series(cube: SatelliteCube, zone_id: str) -> dict:
    years = cube.available_years()
    rows = [zone_stats(cube, zone_id, y) for y in years]
    series = {"lst": [r["lst_mean"] for r in rows], "ndvi": [r["ndvi_mean"] for r in rows], "ndbi": [r["ndbi_mean"] for r in rows]}
    trend = {k: dict(zip(("slope", "intercept", "r2"), linear_fit(years, v))) for k, v in series.items()}
    return {"years": years, "series": series, "trend": trend,
            "change": {k: v[-1] - v[0] for k, v in series.items()}}


# ---------------------------------------------------------------- trends
def trends(cube: SatelliteCube) -> dict:
    def _calc():
        years = cube.available_years()
        out = {"years": years, "metrics": {}, "city": []}
        for y in years:
            c = city_stats(cube, y)
            out["city"].append({"year": y, "lst": c["lst_mean"], "ndvi": c["ndvi_mean"], "ndbi": c["ndbi_mean"]})
        for m in ("lst", "ndvi", "ndbi"):
            v = [row[m] for row in out["city"]]
            slope, intercept, r2 = linear_fit(years, v)
            acc = float(np.polyfit(years, v, 2)[0] * 2) if len(years) >= 3 else 0.0   # second derivative
            resid = np.array(v) - (intercept + slope * np.array(years))
            sigma = float(np.sqrt((resid ** 2).sum() / max(1, len(v) - 2)))
            out["metrics"][m] = {"slope_per_year": slope, "intercept": intercept, "r2": r2, "acceleration": acc, "sigma": sigma,
                                 "latest": v[-1], "projection_2030": intercept + slope * C.PROJECTION_YEAR,
                                 "projection_2030_from_latest": v[-1] + slope * (C.PROJECTION_YEAR - years[-1])}
        lm = out["metrics"]["lst"]
        out["projection"] = [{"year": y, "lst": (out["city"][-1]["lst"] if y == years[-1] else lm["intercept"] + lm["slope_per_year"] * y),
                              "lo": (out["city"][-1]["lst"] if y == years[-1] else lm["intercept"] + lm["slope_per_year"] * y) - lm["sigma"] * (1 + 0.12 * (y - years[-1])),
                              "hi": (out["city"][-1]["lst"] if y == years[-1] else lm["intercept"] + lm["slope_per_year"] * y) + lm["sigma"] * (1 + 0.12 * (y - years[-1]))}
                             for y in range(years[-1], C.PROJECTION_YEAR + 1)]
        out["zones"] = []
        for z in cube.zones:
            zid = z["properties"]["zone_id"]
            s = zone_series(cube, zid)
            out["zones"].append({"zone_id": zid, "name": z["properties"]["name"], "lst_slope": s["trend"]["lst"]["slope"],
                                 "ndvi_slope": s["trend"]["ndvi"]["slope"], "ndbi_slope": s["trend"]["ndbi"]["slope"], "d_lst": s["change"]["lst"]})
        return out
    return analysis_cache.get_or_set("trends", _calc)


# ---------------------------------------------------------------- correlation
def correlation(cube: SatelliteCube, year: int, x: str, n_points: int = 1100, seed: int = 42) -> dict:
    def _calc():
        valid = cube.valid_mask(year)
        rows = np.flatnonzero(valid.ravel())
        rng = np.random.default_rng(seed)
        pick = rng.choice(rows, size=min(n_points, len(rows)), replace=False)
        xv = cube.layer(x, year).ravel()[pick].astype(np.float64)
        yv = cube.lst(year).ravel()[pick].astype(np.float64)
        slope, intercept, r2 = linear_fit(xv, yv)
        r = float(np.corrcoef(xv, yv)[0, 1])
        # full-population statistics for reference
        xa = cube.layer(x, year)[valid].astype(np.float64); ya = cube.lst(year)[valid].astype(np.float64)
        r_all = float(np.corrcoef(xa, ya)[0, 1])
        return {"year": year, "x": x, "n": int(len(pick)), "points": [{"x": round(float(a), 4), "y": round(float(b), 3)} for a, b in zip(xv, yv)],
                "slope": slope, "intercept": intercept, "r2": r2, "correlation": r, "correlation_all_pixels": r_all,
                "equation": f"LST = {intercept:.2f} {'−' if slope < 0 else '+'} {abs(slope):.2f}·{x.upper()}"}
    return analysis_cache.get_or_set(f"scatter_{x}_{year}", _calc)


def pixel_regression(cube: SatelliteCube, year: int) -> dict:
    """OLS LST = a + b1·NDVI + b2·NDBI over all valid land cells (basis of the linear scenario model)."""
    def _calc():
        v = cube.valid_mask(year)
        beta, r2, rmse = multiple_regression(cube.lst(year)[v], cube.ndvi(year)[v], cube.ndbi(year)[v])
        return {"year": year, "intercept": float(beta[0]), "b_ndvi": float(beta[1]), "b_ndbi": float(beta[2]), "r2": float(r2), "rmse": rmse, "n": int(v.sum())}
    return analysis_cache.get_or_set(f"regression_{year}", _calc)
