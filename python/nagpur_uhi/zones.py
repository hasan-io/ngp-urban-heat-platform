"""Analysis zones — rasterisation, zonal statistics and GeoJSON export.

Zones are defined as polygons in `config.ZONES`. A pure-numpy ray-casting rasteriser
keeps this module free of GDAL; `rasterio.features.rasterize` is used when available.
"""
from __future__ import annotations

from typing import Dict, List

import numpy as np

from . import config as C
from .cube import Cube
from .temporal import hotspot_mask, hotspot_persistence


def zones_geojson() -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "id": z["id"],
             "properties": {k: v for k, v in z.items() if k != "poly"},
             "geometry": {"type": "Polygon", "coordinates": [[list(p) for p in z["poly"]] + [list(z["poly"][0])]]}}
            for z in C.ZONES
        ],
    }


def _points_in_polygon(lon: np.ndarray, lat: np.ndarray, poly) -> np.ndarray:
    """Vectorised even-odd ray casting. lon/lat are 2-D grids, poly is [(lon, lat), ...]."""
    inside = np.zeros(lon.shape, dtype=bool)
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        cond = (y1 > lat) != (y2 > lat)
        with np.errstate(divide="ignore", invalid="ignore"):
            x_int = (x2 - x1) * (lat - y1) / ((y2 - y1) + 1e-12) + x1
        inside ^= cond & (lon < x_int)
    return inside


def rasterize_zones(cube: Cube) -> np.ndarray:
    """Int16 grid: index into config.ZONES, −1 outside every zone."""
    lon2d, lat2d = np.meshgrid(cube.lon, cube.lat)
    idx = np.full(cube.shape, -1, dtype=np.int16)
    try:
        from rasterio import features
        from rasterio.transform import from_bounds

        west, south, east, north = cube.bounds
        tr = from_bounds(west, south, east, north, cube.shape[1], cube.shape[0])
        shapes = [({"type": "Polygon", "coordinates": [[list(p) for p in z["poly"]] + [list(z["poly"][0])]]}, i)
                  for i, z in enumerate(C.ZONES)]
        idx = features.rasterize(shapes, out_shape=cube.shape, transform=tr, fill=-1, dtype="int16")
    except ImportError:
        for i, z in enumerate(C.ZONES):
            m = _points_in_polygon(lon2d, lat2d, z["poly"]) & (idx == -1)
            idx[m] = i
    return idx


def zonal_stats(cube: Cube, zone_idx: np.ndarray) -> List[Dict]:
    """Per-zone, per-year means + change + hotspot metrics — feeds the info panels."""
    persistence = hotspot_persistence(cube)
    hot_by_year = {y: hotspot_mask(cube, y) for y in cube.years}
    px = cube.pixel_area_km2
    rows = []
    for zi, z in enumerate(C.ZONES):
        m_all = zone_idx == zi
        m = m_all & cube.land
        if not m.any():
            continue
        by_year = {}
        for y in cube.years:
            by_year[y] = {
                "lst": float(np.nanmean(cube.lst[y][m])),
                "ndvi": float(np.nanmean(cube.ndvi[y][m])),
                "ndbi": float(np.nanmean(cube.ndbi[y][m])),
                "hot_fraction": float(hot_by_year[y][m].mean()),
                "clear_obs": float(np.nanmean(cube.count[y][m])),
            }
        y0, y1 = cube.years[0], cube.years[-1]
        t = np.asarray(cube.years, dtype=float)
        slope = lambda k: float(np.polyfit(t, [by_year[y][k] for y in cube.years], 1)[0])
        rows.append({
            "index": zi, "id": z["id"], "name": z["name"], "short": z["short"], "character": z["character"],
            "population": z["population"], "area_km2": float(m_all.sum() * px), "water_km2": float((m_all & cube.water).sum() * px),
            "centroid": [float(np.mean([p[1] for p in z["poly"]])), float(np.mean([p[0] for p in z["poly"]]))],
            "by_year": by_year,
            "d_lst": by_year[y1]["lst"] - by_year[y0]["lst"],
            "d_ndvi": by_year[y1]["ndvi"] - by_year[y0]["ndvi"],
            "d_ndbi": by_year[y1]["ndbi"] - by_year[y0]["ndbi"],
            "lst_slope": slope("lst"), "ndvi_slope": slope("ndvi"), "ndbi_slope": slope("ndbi"),
            "persistent_fraction": float((persistence[m] >= C.PERSISTENT_YEARS).mean()),
            "persistent_km2": float((persistence[m] >= C.PERSISTENT_YEARS).sum() * px),
        })
    return rows


def rank_zones(rows: List[Dict], key: str, year: int | None = None, reverse: bool = True) -> List[Dict]:
    if year is not None:
        return sorted(rows, key=lambda r: r["by_year"][year][key], reverse=reverse)
    return sorted(rows, key=lambda r: r[key], reverse=reverse)


def compare_zones(rows: List[Dict], id_a: str, id_b: str, year: int) -> dict:
    """“Zone A kitna garam hai vs Zone B?” — side-by-side deltas."""
    a = next(r for r in rows if r["id"] == id_a)
    b = next(r for r in rows if r["id"] == id_b)
    ya, yb = a["by_year"][year], b["by_year"][year]
    return {
        "year": year, "a": a["name"], "b": b["name"],
        "lst_a": ya["lst"], "lst_b": yb["lst"], "lst_gap": ya["lst"] - yb["lst"],
        "ndvi_gap": ya["ndvi"] - yb["ndvi"], "ndbi_gap": ya["ndbi"] - yb["ndbi"],
        "d_lst_a": a["d_lst"], "d_lst_b": b["d_lst"],
        "persistent_a": a["persistent_fraction"], "persistent_b": b["persistent_fraction"],
    }


def describe_zone(row: Dict, year: int) -> str:
    """Human-readable info-panel sentence, e.g. “This zone: +2.5 °C, −12 % NDVI, +8 % NDBI”."""
    y0 = min(row["by_year"])
    b0, b1 = row["by_year"][y0], row["by_year"][year]
    pct = lambda a, b: (b - a) / abs(a) * 100 if a else float("nan")
    return (f"{row['name']}: {b1['lst'] - b0['lst']:+.1f} °C temperature change, "
            f"{pct(b0['ndvi'], b1['ndvi']):+.0f}% NDVI, {pct(b0['ndbi'], b1['ndbi']):+.0f}% NDBI since {y0}; "
            f"{row['persistent_fraction'] * 100:.0f}% of the zone is a persistent hotspot.")
