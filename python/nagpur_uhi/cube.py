"""The `Cube` — a chronological stack of annual composites on a common grid.

Component 1 ends by producing a Cube; every later component reads from it.
Layout: dict[year] -> 2-D float32 array (rows = north→south, cols = west→east).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List

import numpy as np

from . import config as C

Metric = str  # "lst" | "ndvi" | "ndbi"


@dataclass
class Cube:
    years: List[int]
    lat: np.ndarray                     # (H,) cell-centre latitudes, descending
    lon: np.ndarray                     # (W,) cell-centre longitudes, ascending
    ndvi: Dict[int, np.ndarray]
    ndbi: Dict[int, np.ndarray]
    lst: Dict[int, np.ndarray]          # °C
    count: Dict[int, np.ndarray]        # clear observations per pixel
    water: np.ndarray                   # bool (H, W) permanent water
    meta: dict = field(default_factory=dict)

    # ------------------------------------------------------------------ geometry
    @property
    def shape(self):
        return self.water.shape

    @property
    def bounds(self):
        dy = abs(self.lat[0] - self.lat[1]) if len(self.lat) > 1 else 0
        dx = abs(self.lon[1] - self.lon[0]) if len(self.lon) > 1 else 0
        return (self.lon[0] - dx / 2, self.lat[-1] - dy / 2, self.lon[-1] + dx / 2, self.lat[0] + dy / 2)

    @property
    def transform(self):
        """GDAL-style affine (a, b, c, d, e, f) for GeoTIFF export."""
        west, south, east, north = self.bounds
        dx = (east - west) / self.shape[1]
        dy = (north - south) / self.shape[0]
        return (dx, 0.0, west, 0.0, -dy, north)

    @property
    def pixel_area_km2(self) -> float:
        west, south, east, north = self.bounds
        w_km = (east - west) / self.shape[1] * C.KM_PER_DEG_LON
        h_km = (north - south) / self.shape[0] * C.KM_PER_DEG_LAT
        return w_km * h_km

    @property
    def land(self) -> np.ndarray:
        return ~self.water

    # ------------------------------------------------------------------ access
    def layer(self, metric: Metric, year: int) -> np.ndarray:
        return getattr(self, metric)[year]

    def stack(self, metric: Metric, years: Iterable[int] | None = None) -> np.ndarray:
        ys = list(years) if years is not None else self.years
        return np.stack([getattr(self, metric)[y] for y in ys]).astype(np.float32)

    def cell_of(self, lat: float, lon: float):
        west, south, east, north = self.bounds
        if not (south <= lat <= north and west <= lon <= east):
            return None
        row = min(self.shape[0] - 1, int((north - lat) / (north - south) * self.shape[0]))
        col = min(self.shape[1] - 1, int((lon - west) / (east - west) * self.shape[1]))
        return row, col

    # ------------------------------------------------------------------ io
    def save(self, path: Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        arrays = {"lat": self.lat, "lon": self.lon, "water": self.water, "years": np.array(self.years)}
        for y in self.years:
            for m in ("ndvi", "ndbi", "lst", "count"):
                arrays[f"{m}_{y}"] = getattr(self, m)[y]
        np.savez_compressed(path, meta=np.array([repr(self.meta)]), **arrays)
        return path

    @classmethod
    def load(cls, path: Path) -> "Cube":
        z = np.load(Path(path), allow_pickle=False)
        years = [int(y) for y in z["years"]]
        import ast

        meta = ast.literal_eval(str(z["meta"][0])) if "meta" in z else {}
        return cls(
            years=years, lat=z["lat"], lon=z["lon"],
            ndvi={y: z[f"ndvi_{y}"] for y in years},
            ndbi={y: z[f"ndbi_{y}"] for y in years},
            lst={y: z[f"lst_{y}"] for y in years},
            count={y: z[f"count_{y}"] for y in years},
            water=z["water"].astype(bool), meta=meta,
        )


def make_grid(bbox=C.AOI_BBOX, res_m: float = C.GRID_RES_M):
    """Cell-centre latitude/longitude vectors for a regular lat/lon grid over the AOI."""
    west, south, east, north = bbox
    ncols = int(round((east - west) * C.KM_PER_DEG_LON * 1000 / res_m))
    nrows = int(round((north - south) * C.KM_PER_DEG_LAT * 1000 / res_m))
    lon = west + (np.arange(ncols) + 0.5) * (east - west) / ncols
    lat = north - (np.arange(nrows) + 0.5) * (north - south) / nrows
    return lat.astype(np.float64), lon.astype(np.float64)
