"""Component 3 — Temporal analysis & hotspot detection.

* multi-temporal comparison    difference(cube, "lst", 2019, 2024)
* change detection             change_classes(cube, 2019, 2024)  → driver labels per pixel
* persistent hotspots          hotspot_persistence(cube)         → years in top decile
* local hotspot statistic      getis_ord_gi_star(lst, land)      → z-scores (clusters)
* rate of change               per_pixel_trend(stack, years), city_trend(series)
* extrapolation                extrapolate(trend, 2030)
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Sequence

import numpy as np

from . import config as C
from .cube import Cube

# ---------------------------------------------------------------------------- differences


def difference(cube: Cube, metric: str, year_a: int, year_b: int) -> np.ndarray:
    """Δmetric = year_b − year_a (positive = increase)."""
    return (cube.layer(metric, year_b) - cube.layer(metric, year_a)).astype(np.float32)


CHANGE_CLASSES = {
    0: "stable",
    1: "vegetation_loss",         # ΔNDVI < −0.10
    2: "new_construction",        # ΔNDBI > +0.10
    3: "tree_loss_and_construction",
    4: "greening_or_cooling",     # ΔNDVI > +0.10 or ΔLST < −1
    5: "background_warming",      # ΔLST > +2 without land-cover change
}


def change_classes(cube: Cube, year_a: int, year_b: int, dv: float = 0.10, db: float = 0.10, dl: float = 2.0) -> np.ndarray:
    """Label every pixel with the dominant driver of change between two years."""
    d_ndvi = difference(cube, "ndvi", year_a, year_b)
    d_ndbi = difference(cube, "ndbi", year_a, year_b)
    d_lst = difference(cube, "lst", year_a, year_b)
    cls = np.zeros(cube.shape, dtype=np.int8)
    veg_loss = d_ndvi < -dv
    built = d_ndbi > db
    cls[veg_loss] = 1
    cls[built] = 2
    cls[veg_loss & built] = 3
    cls[(d_ndvi > dv) | (d_lst < -1.0)] = 4
    cls[(cls == 0) & (d_lst > dl)] = 5
    cls[cube.water] = 0
    return cls


def change_summary(cube: Cube, year_a: int, year_b: int) -> dict:
    d_lst = difference(cube, "lst", year_a, year_b)
    d_ndvi = difference(cube, "ndvi", year_a, year_b)
    d_ndbi = difference(cube, "ndbi", year_a, year_b)
    land = cube.land
    px = cube.pixel_area_km2
    cls = change_classes(cube, year_a, year_b)
    return {
        "years": [year_a, year_b],
        "mean_dlst": float(np.nanmean(d_lst[land])),
        "heated_gt2_km2": float(np.nansum(d_lst[land] > 2.0) * px),
        "cooled_lt_minus1_km2": float(np.nansum(d_lst[land] < -1.0) * px),
        "veg_lost_km2": float(np.nansum(d_ndvi[land] < -0.10) * px),
        "new_built_km2": float(np.nansum(d_ndbi[land] > 0.10) * px),
        "class_area_km2": {name: float((cls == k).sum() * px) for k, name in CHANGE_CLASSES.items()},
    }


# ---------------------------------------------------------------------------- hotspots


def hotspot_mask(cube: Cube, year: int, percentile: float = C.HOT_PERCENTILE) -> np.ndarray:
    """Top-decile LST pixels (land only) for a given year."""
    lst = cube.lst[year]
    thr = np.nanpercentile(lst[cube.land & np.isfinite(lst)], percentile)
    return cube.land & (lst >= thr)


def hotspot_persistence(cube: Cube, percentile: float = C.HOT_PERCENTILE) -> np.ndarray:
    """Number of years (0..N) each pixel sat inside the hottest decile."""
    count = np.zeros(cube.shape, dtype=np.int8)
    for y in cube.years:
        count += hotspot_mask(cube, y, percentile)
    return count


def persistent_hotspots(cube: Cube, min_years: int = C.PERSISTENT_YEARS) -> np.ndarray:
    return hotspot_persistence(cube) >= min_years


def getis_ord_gi_star(values: np.ndarray, mask: np.ndarray, radius_px: int = 3) -> np.ndarray:
    """Getis-Ord Gi* z-scores with a square binary neighbourhood.

    |z| > 1.96 → statistically significant hot (positive) or cold (negative) cluster at 95 %.
    Implemented with box sums so it needs only numpy (SciPy used when available).
    """
    x = np.where(mask & np.isfinite(values), values, 0.0).astype(np.float64)
    w = (mask & np.isfinite(values)).astype(np.float64)
    n = w.sum()
    xbar = x.sum() / n
    s = np.sqrt((x ** 2).sum() / n - xbar ** 2)
    size = 2 * radius_px + 1
    try:
        from scipy.ndimage import uniform_filter

        box = lambda a: uniform_filter(a, size=size, mode="constant") * size ** 2
    except ImportError:  # pragma: no cover
        def box(a):
            p = np.pad(a, radius_px)
            ii = np.pad(p, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
            h, wd = a.shape
            return ii[size:size + h, size:size + wd] - ii[:h, size:size + wd] - ii[size:size + h, :wd] + ii[:h, :wd]
    sum_wx = box(x)
    sum_w = box(w)
    num = sum_wx - xbar * sum_w
    den = s * np.sqrt(np.maximum((n * sum_w - sum_w ** 2) / (n - 1), 1e-12))
    z = np.where(mask, num / den, np.nan)
    return z.astype(np.float32)


def significant_clusters(z: np.ndarray, z_crit: float = 1.96) -> np.ndarray:
    """+1 hot cluster, −1 cold cluster, 0 not significant."""
    out = np.zeros(z.shape, dtype=np.int8)
    out[z > z_crit] = 1
    out[z < -z_crit] = -1
    return out


# ---------------------------------------------------------------------------- trends


@dataclass
class Trend:
    slope: float          # units per year
    intercept: float
    r2: float

    def at(self, year: float) -> float:
        return self.intercept + self.slope * year


def city_trend(years: Sequence[int], values: Sequence[float]) -> Trend:
    t = np.asarray(years, dtype=np.float64)
    y = np.asarray(values, dtype=np.float64)
    slope, intercept = np.polyfit(t, y, 1)
    pred = intercept + slope * t
    ss_res = ((y - pred) ** 2).sum()
    ss_tot = ((y - y.mean()) ** 2).sum()
    return Trend(float(slope), float(intercept), float(1 - ss_res / ss_tot) if ss_tot else 0.0)


def per_pixel_trend(stack: np.ndarray, years: Sequence[int]):
    """Vectorised least-squares slope / intercept / R² for a (T, H, W) stack.

    Pixels with any NaN across the series get NaN (keeps the statistics honest).
    """
    t = np.asarray(years, dtype=np.float64)
    tc = t - t.mean()
    y = stack.astype(np.float64)
    valid = np.isfinite(y).all(axis=0)
    ym = y.mean(axis=0)
    cov = (tc[:, None, None] * (y - ym)).sum(axis=0)
    slope = cov / (tc ** 2).sum()
    intercept = ym - slope * t.mean()
    pred = intercept[None] + slope[None] * t[:, None, None]
    ss_res = ((y - pred) ** 2).sum(axis=0)
    ss_tot = ((y - ym) ** 2).sum(axis=0)
    with np.errstate(divide="ignore", invalid="ignore"):
        r2 = np.where(ss_tot > 0, 1 - ss_res / ss_tot, 0.0)
    for a in (slope, intercept, r2):
        a[~valid] = np.nan
    return slope.astype(np.float32), intercept.astype(np.float32), r2.astype(np.float32)


def extrapolate(trend: Trend, target_year: int) -> float:
    """“Agar same rate se change hota raha toh …” — linear projection."""
    return trend.at(target_year)


def trend_report(cube: Cube, horizon_years: Sequence[int] = (2026, 2028, 2030)) -> Dict[str, dict]:
    from .indices import city_stats

    stats = {y: city_stats(cube, y) for y in cube.years}
    out = {}
    for metric, attr in (("lst", "lst_mean"), ("ndvi", "ndvi_mean"), ("ndbi", "ndbi_mean")):
        series = [getattr(stats[y], attr) for y in cube.years]
        tr = city_trend(cube.years, series)
        out[metric] = {"slope_per_year": tr.slope, "intercept": tr.intercept, "r2": tr.r2,
                       "observed": dict(zip(cube.years, series)),
                       "projected": {int(h): extrapolate(tr, h) for h in horizon_years}}
    return out


def zone_trends(cube: Cube, zone_idx: np.ndarray, n_zones: int) -> List[dict]:
    """Per-zone slopes for LST / NDVI / NDBI (used for the 2030 BAU baseline)."""
    rows = []
    for zi in range(n_zones):
        m = (zone_idx == zi) & cube.land
        if not m.any():
            rows.append({"zone": zi, "lst": None, "ndvi": None, "ndbi": None})
            continue
        row = {"zone": zi}
        for metric in ("lst", "ndvi", "ndbi"):
            series = [float(np.nanmean(cube.layer(metric, y)[m])) for y in cube.years]
            row[metric] = city_trend(cube.years, series).slope
        rows.append(row)
    return rows
