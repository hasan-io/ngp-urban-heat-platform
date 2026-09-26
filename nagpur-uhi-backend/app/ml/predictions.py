"""Feature engineering for the LST surface model and scenario deltas."""
from __future__ import annotations

import numpy as np

from app.services.satellite_data_service import SatelliteCube
from app.utils import constants as C
from app.utils.geospatial_utils import box_mean, to_km

FEATURES = ["ndvi", "ndbi", "ndvi_1km", "ndbi_1km", "ndbi_std_1km", "water_1km", "dist_center_km", "x_km", "y_km", "year_index"]
_static_cache: dict[int, dict] = {}


def static_features(cube: SatelliteCube) -> dict:
    key = id(cube)
    if key not in _static_cache:
        lon2d, lat2d = np.meshgrid(cube.lon, cube.lat)
        x, y = to_km(lat2d, lon2d)
        _static_cache[key] = {"water_1km": box_mean(cube.water.astype(np.float32)), "dist_center_km": np.hypot(x, y).astype(np.float32),
                              "x_km": x.astype(np.float32), "y_km": y.astype(np.float32)}
    return _static_cache[key]


def feature_stack(cube: SatelliteCube, year: int, ndvi: np.ndarray | None = None, ndbi: np.ndarray | None = None) -> np.ndarray:
    """(H, W, F) predictors; NDVI/NDBI may be overridden for what-if evaluation."""
    s = static_features(cube)
    ndvi = cube.ndvi(year) if ndvi is None else ndvi
    ndbi = cube.ndbi(year) if ndbi is None else ndbi
    m = box_mean(ndbi)
    std = np.sqrt(np.maximum(0, box_mean(ndbi ** 2) - m ** 2))
    yi = np.full(cube.shape, (year - C.BASE_YEAR) / 5.0, dtype=np.float32)
    layers = [ndvi, ndbi, box_mean(ndvi), m, std, s["water_1km"], s["dist_center_km"], s["x_km"], s["y_km"], yi]
    return np.stack([np.nan_to_num(l.astype(np.float32)) for l in layers], axis=-1)


def design_matrix(cube: SatelliteCube, year: int, **override):
    F = feature_stack(cube, year, **override)
    rows = np.flatnonzero(cube.valid_mask(year).ravel())
    return F.reshape(-1, F.shape[-1])[rows], cube.lst(year).ravel()[rows].astype(np.float32), rows


def spatial_blocks(cube: SatelliteCube, rows: np.ndarray, block_cells: int = 10) -> np.ndarray:
    h, w = cube.shape
    r, c = np.divmod(rows, w)
    return (r // block_cells) * ((w + block_cells - 1) // block_cells) + c // block_cells


def apply_intervention(cube: SatelliteCube, year: int, zone_mask: np.ndarray, veg_pct: float, built_pct: float):
    """Translate cover changes (percentage points) into index deltas inside the zone."""
    ndvi = cube.ndvi(year).copy(); ndbi = cube.ndbi(year).copy()
    ndvi[zone_mask] = np.clip(ndvi[zone_mask] + C.NDVI_PER_VEG_FRACTION * veg_pct / 100.0, -0.1, 0.9)
    ndbi[zone_mask] = np.clip(ndbi[zone_mask] + C.NDBI_PER_BUILT_FRACTION * built_pct / 100.0, -0.5, 0.7)
    return ndvi, ndbi
