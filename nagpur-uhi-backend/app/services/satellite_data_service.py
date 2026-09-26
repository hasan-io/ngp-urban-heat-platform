"""Loads analysis-ready satellite products (GeoTIFF) for each season and exposes them as a
lightweight in-memory cube: LST / NDVI / NDBI grids, water mask, zone raster and quality metadata.

Files expected under data/satellite_imagery/{year}/:
    LST_{year}.tif  NDVI_{year}.tif  NDBI_{year}.tif  [WATER_{year}.tif]  [metadata.json]
Any CRS / resolution is accepted — rasters are warped onto the WGS-84 analysis grid on load.
"""
from __future__ import annotations

import json
import logging
from functools import cached_property
from pathlib import Path

import numpy as np

from app.config import get_settings
from app.services.cache_service import data_cache
from app.utils import constants as C
from app.utils.geospatial_utils import bounds_from_vectors, cell_area_km2, make_grid, rasterize_zones
from app.utils.raster_utils import read_geotiff
from app.utils.response_utils import DataUnavailable

log = logging.getLogger("uhi.data")
LAYERS = ("lst", "ndvi", "ndbi")


class SatelliteCube:
    def __init__(self, imagery_dir: Path, data_dir: Path):
        self.imagery_dir = imagery_dir
        self.data_dir = data_dir
        self.lat, self.lon = self._grid()
        self.shape = (len(self.lat), len(self.lon))
        self.cell_area_km2 = cell_area_km2(self.lat, self.lon)
        self.bounds = bounds_from_vectors(self.lat, self.lon)

    # ------------------------------------------------------------ grid & static data
    def _grid(self):
        for y in C.YEARS:
            p = self.imagery_dir / str(y) / f"LST_{y}.tif"
            if p.exists():
                try:
                    import rasterio
                    with rasterio.open(p) as src:
                        if src.crs and src.crs.to_epsg() == 4326:
                            t = src.transform
                            lon = t.c + (np.arange(src.width) + 0.5) * t.a
                            lat = t.f + (np.arange(src.height) + 0.5) * t.e
                            return lat.astype(np.float64), lon.astype(np.float64)
                except Exception as e:  # pragma: no cover
                    log.warning("could not read grid from %s: %s", p, e)
                break
        return make_grid()

    def available_years(self) -> list[int]:
        return [y for y in C.YEARS if all((self.imagery_dir / str(y) / f"{l.upper()}_{y}.tif").exists() for l in LAYERS)]

    @cached_property
    def zones(self) -> list[dict]:
        return json.loads((self.data_dir / "zones.json").read_text())["features"]

    @cached_property
    def landmarks(self) -> dict:
        p = self.data_dir / "landmarks.json"
        return json.loads(p.read_text()) if p.exists() else {"type": "FeatureCollection", "features": []}

    @cached_property
    def zone_index(self) -> np.ndarray:
        return rasterize_zones(self.lat, self.lon, self.zones)

    def zone_position(self, zone_id: str) -> int | None:
        for i, z in enumerate(self.zones):
            if z["properties"]["zone_id"] == zone_id:
                return i
        return None

    def zone_mask(self, zone_id: str) -> np.ndarray:
        i = self.zone_position(zone_id)
        return (self.zone_index == i) & self.land if i is not None else np.zeros(self.shape, bool)

    # ------------------------------------------------------------ rasters
    def _path(self, layer: str, year: int) -> Path:
        return self.imagery_dir / str(year) / f"{layer.upper()}_{year}.tif"

    def layer(self, layer: str, year: int) -> np.ndarray:
        if year not in C.YEARS:
            raise DataUnavailable(f"Year must be between {C.YEARS[0]} and {C.YEARS[-1]}", 400)
        key = f"{layer}_{year}"
        cached = data_cache.get(key)
        if cached is not None:
            return cached
        p = self._path(layer, year)
        if not p.exists():
            raise DataUnavailable(f"Satellite data for {year} not available ({p.name} missing)")
        arr = read_geotiff(p, self.lat, self.lon)
        data_cache.set(key, arr)
        return arr

    def lst(self, year: int) -> np.ndarray: return self.layer("lst", year)
    def ndvi(self, year: int) -> np.ndarray: return self.layer("ndvi", year)
    def ndbi(self, year: int) -> np.ndarray: return self.layer("ndbi", year)

    @cached_property
    def water(self) -> np.ndarray:
        """Stable water mask: WATER_{year}.tif majority if provided, else spectral rule NDVI<0 & NDBI<−0.35."""
        masks = []
        for y in self.available_years():
            p = self.imagery_dir / str(y) / f"WATER_{y}.tif"
            if p.exists():
                masks.append(np.nan_to_num(read_geotiff(p, self.lat, self.lon)) > 0.5)
        if masks:
            return np.mean(np.stack(masks), axis=0) > 0.5
        votes = [(self.ndvi(y) < 0.0) & (self.ndbi(y) < -0.35) for y in self.available_years()]
        return np.mean(np.stack(votes), axis=0) > 0.5 if votes else np.zeros(self.shape, bool)

    @property
    def land(self) -> np.ndarray:
        return ~self.water

    def valid_mask(self, year: int) -> np.ndarray:
        return self.land & np.isfinite(self.lst(year)) & np.isfinite(self.ndvi(year)) & np.isfinite(self.ndbi(year))

    # ------------------------------------------------------------ quality
    def quality(self, year: int) -> dict:
        key = f"quality_{year}"
        cached = data_cache.get(key)
        if cached is not None:
            return cached
        p = self.imagery_dir / str(year) / "metadata.json"
        meta = json.loads(p.read_text()) if p.exists() else {}
        lst = self.lst(year)
        valid = float(np.isfinite(lst[self.land]).mean() * 100) if self.land.any() else 0.0
        used, partial, rejected = meta.get("used", 0), meta.get("partial", 0), meta.get("rejected", 0)
        completeness = float(meta.get("completeness_pct", valid))
        q = {
            "year": year, "source": meta.get("source", "geotiff"),
            "scenes": meta.get("scenes", []), "used": used, "partial": partial, "rejected": rejected,
            "mean_scene_cloud": meta.get("mean_scene_cloud"), "residual_cloud_pct": float(meta.get("residual_cloud_pct", max(0.0, 100.0 - valid))),
            "completeness_pct": completeness, "valid_pixels_pct": valid, "sensors": meta.get("sensors", ["Landsat 8", "Landsat 9", "Sentinel-2"]),
            "quality": meta.get("quality") or ("High" if completeness > 97 else "Good" if completeness > 94 else "Fair"),
            "note": C.YEAR_NOTES.get(year, ""),
        }
        data_cache.set(key, q)
        return q

    def summary(self) -> dict:
        years = self.available_years()
        return {"meta": {"aoi": "Nagpur", "bbox": list(self.bounds), "shape": list(self.shape), "years": years,
                         "source": self.quality(years[-1])["source"] if years else "none", "grid_res_m": C.GRID_RES_M,
                         "crs": "EPSG:4326", "season": list(C.SEASON), "pixel_area_km2": self.cell_area_km2, "year_notes": C.YEAR_NOTES},
                "quality": {str(y): {**self.quality(y), "scenes": len(self.quality(y)["scenes"])} for y in years}}


_cube: SatelliteCube | None = None


def get_cube() -> SatelliteCube:
    global _cube
    if _cube is None:
        s = get_settings()
        _cube = SatelliteCube(s.imagery_dir, s.data_dir)
    return _cube


def reset_cube() -> None:
    global _cube
    _cube = None
    data_cache.clear()
