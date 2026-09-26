"""Raster I/O and image encoding: GeoTIFF reading (rasterio), reprojection to the analysis grid,
colour ramps and base64 PNG encoding for map overlays."""
from __future__ import annotations

import base64
import io
from pathlib import Path

import numpy as np
from PIL import Image

from app.utils import constants as C
from app.utils.geospatial_utils import bounds_from_vectors

# colour stops (t, hex) — mirror the frontend ramps so overlays look identical
RAMPS = {
    "lst": ([(0, "#1e3a8a"), (0.18, "#0ea5e9"), (0.36, "#22c55e"), (0.54, "#facc15"), (0.72, "#f97316"), (0.88, "#dc2626"), (1, "#7f1d1d")], (30.0, 47.0)),
    "ndvi": ([(0, "#7c2d12"), (0.2, "#d6a35c"), (0.42, "#d9f99d"), (0.62, "#4ade80"), (0.82, "#15803d"), (1, "#052e16")], (-0.1, 0.8)),
    "ndbi": ([(0, "#0f766e"), (0.3, "#a7f3d0"), (0.48, "#f1f5f9"), (0.68, "#fb923c"), (0.86, "#c026d3"), (1, "#4a044e")], (-0.45, 0.5)),
    "dlst": ([(0, "#1d4ed8"), (0.5, "#f8fafc"), (1, "#b91c1c")], (-4.0, 4.0)),
    "hotspot": ([(0, "#0f172a"), (0.5, "#f59e0b"), (1, "#dc2626")], (0.0, 6.0)),
}
WATER_RGB = (12, 42, 74)


def _hex(h: str):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def colorize(values: np.ndarray, ramp: str, water: np.ndarray | None = None, vmin=None, vmax=None) -> np.ndarray:
    stops, (lo, hi) = RAMPS[ramp]
    lo = lo if vmin is None else vmin; hi = hi if vmax is None else vmax
    t = np.clip((np.nan_to_num(values, nan=lo) - lo) / (hi - lo), 0, 1)
    ts = np.array([s[0] for s in stops]); cols = np.array([_hex(s[1]) for s in stops], dtype=np.float32)
    rgb = np.stack([np.interp(t, ts, cols[:, k]) for k in range(3)], axis=-1)
    rgba = np.concatenate([rgb, np.full(rgb.shape[:-1] + (1,), 255.0)], axis=-1)
    rgba[~np.isfinite(values)] = (0, 0, 0, 0)
    if water is not None:
        rgba[water] = (*WATER_RGB, 255)
    return rgba.astype(np.uint8)


def to_png_base64(rgba: np.ndarray, scale: int = 3) -> str:
    img = Image.fromarray(rgba, mode="RGBA")
    if scale > 1:
        img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    buf = io.BytesIO(); img.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


# ---------------------------------------------------------------- GeoTIFF
def read_geotiff(path: Path, lat: np.ndarray | None = None, lon: np.ndarray | None = None) -> np.ndarray:
    """Read band 1 of a GeoTIFF. If a target lat/lon grid is given and the file's grid differs
    (other CRS / resolution, e.g. native 30 m UTM 44N), warp it onto the analysis grid."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import reproject
    from rasterio.transform import from_bounds

    with rasterio.open(path) as src:
        data = src.read(1).astype(np.float32)
        nodata = src.nodata
        if nodata is not None:
            data[data == nodata] = np.nan
        if lat is None or lon is None:
            return data
        same = (src.crs and src.crs.to_epsg() == 4326 and src.height == len(lat) and src.width == len(lon))
        if same:
            return data
        west, south, east, north = bounds_from_vectors(lat, lon)
        dst = np.full((len(lat), len(lon)), np.nan, dtype=np.float32)
        reproject(source=data, destination=dst, src_transform=src.transform, src_crs=src.crs, src_nodata=np.nan,
                  dst_transform=from_bounds(west, south, east, north, len(lon), len(lat)), dst_crs="EPSG:4326",
                  dst_nodata=np.nan, resampling=Resampling.average)
        return dst


def write_geotiff(path: Path, arr: np.ndarray, lat: np.ndarray, lon: np.ndarray, nodata: float = -9999.0, tags: dict | None = None) -> Path:
    import rasterio
    from rasterio.transform import from_bounds

    west, south, east, north = bounds_from_vectors(lat, lon)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = np.where(np.isfinite(arr), arr, nodata).astype(np.float32)
    with rasterio.open(path, "w", driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1, dtype="float32",
                       crs="EPSG:4326", transform=from_bounds(west, south, east, north, arr.shape[1], arr.shape[0]),
                       nodata=nodata, compress="deflate") as dst:
        dst.write(data, 1)
        if tags:
            dst.update_tags(**{k: str(v) for k, v in tags.items()})
    return path


def grid_payload(values: np.ndarray, lat: np.ndarray, lon: np.ndarray, decimals: int = 3, nodata: float = -9999.0) -> dict:
    """Compact JSON grid used by the frontend raster loader."""
    return {"bounds": list(bounds_from_vectors(lat, lon)), "shape": list(values.shape), "resolution_m": C.GRID_RES_M,
            "nodata": nodata, "values": np.round(np.nan_to_num(values, nan=nodata), decimals).tolist()}
