"""Coordinate helpers: analysis grid, km projection, zone rasterisation, neighbourhood means."""
from __future__ import annotations

import numpy as np

from app.utils import constants as C


def make_grid(bbox=C.AOI_BBOX, res_m: float = C.GRID_RES_M):
    """Cell-centre lat (descending) / lon (ascending) vectors for a regular WGS-84 grid."""
    west, south, east, north = bbox
    ncols = int(round((east - west) * C.KM_PER_DEG_LON * 1000 / res_m))
    nrows = int(round((north - south) * C.KM_PER_DEG_LAT * 1000 / res_m))
    lon = west + (np.arange(ncols) + 0.5) * (east - west) / ncols
    lat = north - (np.arange(nrows) + 0.5) * (north - south) / nrows
    return lat.astype(np.float64), lon.astype(np.float64)


def cell_area_km2(lat: np.ndarray, lon: np.ndarray) -> float:
    dlat = abs(lat[0] - lat[1]) if len(lat) > 1 else 0.0
    dlon = abs(lon[1] - lon[0]) if len(lon) > 1 else 0.0
    return dlat * C.KM_PER_DEG_LAT * dlon * C.KM_PER_DEG_LON


def bounds_from_vectors(lat: np.ndarray, lon: np.ndarray):
    dlat = abs(lat[0] - lat[1]); dlon = abs(lon[1] - lon[0])
    return (float(lon[0] - dlon / 2), float(lat[-1] - dlat / 2), float(lon[-1] + dlon / 2), float(lat[0] + dlat / 2))


def to_km(lat, lon):
    return (np.asarray(lon) - C.CITY_CENTER[1]) * C.KM_PER_DEG_LON, (np.asarray(lat) - C.CITY_CENTER[0]) * C.KM_PER_DEG_LAT


def latlon_to_cell(lat: float, lon: float, lat_vec: np.ndarray, lon_vec: np.ndarray):
    west, south, east, north = bounds_from_vectors(lat_vec, lon_vec)
    if not (south <= lat <= north and west <= lon <= east):
        return None
    row = min(len(lat_vec) - 1, int((north - lat) / (north - south) * len(lat_vec)))
    col = min(len(lon_vec) - 1, int((lon - west) / (east - west) * len(lon_vec)))
    return row, col


def points_in_polygon(lon2d: np.ndarray, lat2d: np.ndarray, poly) -> np.ndarray:
    """Vectorised even-odd ray casting; poly = [(lon, lat), ...]."""
    inside = np.zeros(lon2d.shape, dtype=bool)
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % n]
        cond = (y1 > lat2d) != (y2 > lat2d)
        with np.errstate(divide="ignore", invalid="ignore"):
            x_int = (x2 - x1) * (lat2d - y1) / ((y2 - y1) + 1e-12) + x1
        inside ^= cond & (lon2d < x_int)
    return inside


def rasterize_zones(lat: np.ndarray, lon: np.ndarray, zones: list[dict]) -> np.ndarray:
    """Int16 grid holding the zone index (order of `zones`), −1 outside every zone."""
    lon2d, lat2d = np.meshgrid(lon, lat)
    idx = np.full(lon2d.shape, -1, dtype=np.int16)
    for i, z in enumerate(zones):
        ring = z["geometry"]["coordinates"][0]
        m = points_in_polygon(lon2d, lat2d, ring[:-1] if ring[0] == ring[-1] else ring) & (idx == -1)
        idx[m] = i
    return idx


def box_mean(a: np.ndarray, r: int = 2) -> np.ndarray:
    """Mean over a (2r+1)² window via integral image (edges renormalised, NaN → 0)."""
    a = np.nan_to_num(a.astype(np.float64))
    h, w = a.shape
    I = np.zeros((h + 1, w + 1)); I[1:, 1:] = a.cumsum(0).cumsum(1)
    J = np.zeros((h + 1, w + 1)); J[1:, 1:] = np.ones_like(a).cumsum(0).cumsum(1)
    r0 = np.clip(np.arange(h) - r, 0, h); r1 = np.clip(np.arange(h) + r + 1, 0, h)
    c0 = np.clip(np.arange(w) - r, 0, w); c1 = np.clip(np.arange(w) + r + 1, 0, w)
    S = I[r1][:, c1] - I[r0][:, c1] - I[r1][:, c0] + I[r0][:, c0]
    N = J[r1][:, c1] - J[r0][:, c1] - J[r1][:, c0] + J[r0][:, c0]
    return (S / N).astype(np.float32)


def cell_polygon(row: int, col: int, lat: np.ndarray, lon: np.ndarray):
    dlat = abs(lat[0] - lat[1]); dlon = abs(lon[1] - lon[0])
    w, e = lon[col] - dlon / 2, lon[col] + dlon / 2
    s, n = lat[row] - dlat / 2, lat[row] + dlat / 2
    return [[w, s], [e, s], [e, n], [w, n], [w, s]]
