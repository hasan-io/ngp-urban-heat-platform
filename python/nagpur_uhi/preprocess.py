"""Component 1b — Cloud removal, cleaning, georeferencing and time-series stacking.

Pure-array functions (testable without GDAL) plus a `build_cube_from_raw` driver that
turns the per-scene GeoTIFFs written by `fetch.py` into a `Cube` of annual composites.

Steps per scene
  1. QA bit-mask   → clear-sky boolean (cloud, cirrus, shadow, dilated cloud)
  2. Scale factors → surface reflectance / surface temperature (Kelvin → °C)
  3. Indices       → NDVI, NDBI, water flag (see indices.py)
  4. Reproject     → common analysis grid (EPSG:4326 lat/lon at GRID_RES_M), average resampling
Per year
  5. Median composite across all clear observations + per-pixel observation count
"""
from __future__ import annotations

from pathlib import Path
from typing import Dict, Iterable, List, Optional

import numpy as np

from . import config as C
from .cube import Cube, make_grid
from .indices import lst_from_collection2, ndbi as _ndbi, ndvi as _ndvi

# ---------------------------------------------------------------------------- QA masks

# Landsat Collection-2 QA_PIXEL bit positions
QA_FILL, QA_DILATED_CLOUD, QA_CIRRUS, QA_CLOUD, QA_SHADOW, QA_SNOW, QA_CLEAR, QA_WATER = 0, 1, 2, 3, 4, 5, 6, 7
# Sentinel-2 Scene Classification Layer classes
SCL_NODATA, SCL_SATURATED, SCL_SHADOW, SCL_WATER = 0, 1, 3, 6
SCL_CLOUD_MED, SCL_CLOUD_HIGH, SCL_CIRRUS, SCL_SNOW = 8, 9, 10, 11


def landsat_clear_mask(qa_pixel: np.ndarray) -> np.ndarray:
    """True where the pixel is usable (no fill / cloud / cirrus / shadow / snow)."""
    qa = qa_pixel.astype(np.uint32)
    bad = 0
    for bit in (QA_FILL, QA_DILATED_CLOUD, QA_CIRRUS, QA_CLOUD, QA_SHADOW, QA_SNOW):
        bad |= 1 << bit
    return (qa & bad) == 0


def landsat_water_mask(qa_pixel: np.ndarray) -> np.ndarray:
    return (qa_pixel.astype(np.uint32) & (1 << QA_WATER)) != 0


def sentinel_clear_mask(scl: np.ndarray) -> np.ndarray:
    bad = np.isin(scl, [SCL_NODATA, SCL_SATURATED, SCL_SHADOW, SCL_CLOUD_MED, SCL_CLOUD_HIGH, SCL_CIRRUS, SCL_SNOW])
    return ~bad


def sentinel_water_mask(scl: np.ndarray) -> np.ndarray:
    return scl == SCL_WATER


def dilate(mask: np.ndarray, iterations: int = C.MASK_DILATION_PX) -> np.ndarray:
    """Grow a boolean *bad-pixel* mask by `iterations` pixels (3×3 structuring element).

    Cloud edges are optically thin and bias LST low; growing the mask removes them.
    Uses SciPy when present, otherwise a numpy roll-based fallback.
    """
    if iterations <= 0:
        return mask
    try:
        from scipy.ndimage import binary_dilation

        return binary_dilation(mask, iterations=iterations)
    except ImportError:  # pragma: no cover
        out = mask.copy()
        for _ in range(iterations):
            grown = out.copy()
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    grown |= np.roll(np.roll(out, dr, 0), dc, 1)
            out = grown
        return out


def scale_sr(dn: np.ndarray) -> np.ndarray:
    """Landsat C2 L2 digital numbers → surface reflectance (0–1)."""
    sr = dn.astype(np.float32) * C.SR_SCALE + C.SR_OFFSET
    return np.clip(sr, 0.0, 1.0)


def scale_st(dn: np.ndarray) -> np.ndarray:
    """Landsat C2 L2 ST_B10 digital numbers → °C (wraps indices.lst_from_collection2)."""
    return lst_from_collection2(dn)


def aoi_cloud_fraction(clear: np.ndarray) -> float:
    return float(1.0 - clear.mean()) * 100.0


# ---------------------------------------------------------------------------- per-scene products


def scene_products(bands: Dict[str, np.ndarray], platform: str) -> Dict[str, np.ndarray]:
    """From raw band arrays produce masked NDVI / NDBI / LST / water for one scene.

    `bands` keys follow fetch.PC_BANDS (Landsat: red, nir08, swir16, lwir11, qa_pixel;
    Sentinel: B04, B08, B11, SCL). Returns float32 arrays with NaN where not clear.
    """
    if platform == "Landsat":
        clear = landsat_clear_mask(bands["qa_pixel"])
        clear &= ~dilate(~clear)
        red, nir, swir = scale_sr(bands["red"]), scale_sr(bands["nir08"]), scale_sr(bands["swir16"])
        lst = scale_st(bands["lwir11"])
        water = landsat_water_mask(bands["qa_pixel"])
    else:
        clear = sentinel_clear_mask(bands["SCL"])
        clear &= ~dilate(~clear)
        red, nir, swir = (bands[k].astype(np.float32) / 10000.0 for k in ("B04", "B08", "B11"))
        lst = None
        water = sentinel_water_mask(bands["SCL"])

    nan = np.float32(np.nan)
    out = {
        "ndvi": np.where(clear, _ndvi(nir, red), nan).astype(np.float32),
        "ndbi": np.where(clear, _ndbi(swir, nir), nan).astype(np.float32),
        "water": np.where(clear, water.astype(np.float32), nan).astype(np.float32),
        "clear": clear,
    }
    if lst is not None:
        out["lst"] = np.where(clear, lst, nan).astype(np.float32)
    return out


# ---------------------------------------------------------------------------- compositing


def median_composite(layers: List[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """Per-pixel median across scenes ignoring NaN. Returns (median, valid_count)."""
    if not layers:
        raise ValueError("no layers to composite")
    stack = np.stack(layers).astype(np.float32)
    count = np.isfinite(stack).sum(axis=0).astype(np.int16)
    with np.errstate(all="ignore"):
        med = np.nanmedian(stack, axis=0)
    med[count == 0] = np.nan
    return med.astype(np.float32), count


def fill_gaps(arr: np.ndarray, iterations: int = 3) -> np.ndarray:
    """Fill isolated NaN holes with the mean of valid 3×3 neighbours (small gaps only)."""
    out = arr.copy()
    for _ in range(iterations):
        nan = ~np.isfinite(out)
        if not nan.any():
            break
        acc = np.zeros_like(out)
        cnt = np.zeros_like(out)
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                sh = np.roll(np.roll(out, dr, 0), dc, 1)
                ok = np.isfinite(sh)
                acc[ok] += sh[ok]
                cnt += ok
        fill = np.where(cnt > 0, acc / np.maximum(cnt, 1), np.nan)
        out[nan] = fill[nan]
    return out


# ---------------------------------------------------------------------------- georeferencing


def reproject_to_grid(arr: np.ndarray, src_transform, src_crs, lat: np.ndarray, lon: np.ndarray, average: bool = True) -> np.ndarray:
    """Warp a scene-grid array onto the common analysis grid (EPSG:4326)."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import reproject

    west, south, east, north = lon[0] - (lon[1] - lon[0]) / 2, lat[-1] - (lat[0] - lat[1]) / 2, \
        lon[-1] + (lon[1] - lon[0]) / 2, lat[0] + (lat[0] - lat[1]) / 2
    dst_transform = rasterio.transform.from_bounds(west, south, east, north, len(lon), len(lat))
    dst = np.full((len(lat), len(lon)), np.nan, dtype=np.float32)
    reproject(source=np.ascontiguousarray(arr, dtype=np.float32), destination=dst, src_transform=src_transform, src_crs=src_crs,
              src_nodata=np.nan, dst_transform=dst_transform, dst_crs=C.CRS_WEB, dst_nodata=np.nan,
              resampling=Resampling.average if average else Resampling.nearest)
    return dst


def build_cube_from_raw(years: Iterable[int] = C.YEARS, grid_res_m: float = C.GRID_RES_M, catalogue: Optional[list] = None) -> Cube:
    """Drive steps 1–5 over every scene in data/raw/<year>/ and return the Cube."""
    import rasterio

    from .fetch import read_catalogue

    lat, lon = make_grid(res_m=grid_res_m)
    records = catalogue or read_catalogue()
    ndvi_y, ndbi_y, lst_y, count_y, water_layers = {}, {}, {}, {}, []
    years = list(years)
    for year in years:
        per_metric: Dict[str, List[np.ndarray]] = {"ndvi": [], "ndbi": [], "lst": [], "water": []}
        for rec in [r for r in records if r.year == year and r.path]:
            with rasterio.open(rec.path) as src:
                bands = {name: src.read(i + 1) for i, name in enumerate(rec.bands)}
                prod = scene_products(bands, rec.platform)
                for m in ("ndvi", "ndbi", "lst", "water"):
                    if m in prod:
                        per_metric[m].append(reproject_to_grid(prod[m], src.transform, src.crs, lat, lon))
            print(f"[{year}] {rec.id}: clear {100 - aoi_cloud_fraction(prod['clear']):.1f}%")
        if not per_metric["lst"]:
            raise RuntimeError(f"{year}: no Landsat thermal scenes — run fetch first")
        ndvi_y[year], _ = median_composite(per_metric["ndvi"])
        ndbi_y[year], _ = median_composite(per_metric["ndbi"])
        lst_y[year], count_y[year] = median_composite(per_metric["lst"])
        ndvi_y[year], ndbi_y[year], lst_y[year] = (fill_gaps(a) for a in (ndvi_y[year], ndbi_y[year], lst_y[year]))
        w, _ = median_composite(per_metric["water"])
        water_layers.append(w)
    water = np.nanmean(np.stack(water_layers), axis=0) > 0.5
    cube = Cube(years=years, lat=lat, lon=lon, ndvi=ndvi_y, ndbi=ndbi_y, lst=lst_y, count=count_y, water=water,
                meta={"source": "landsat+sentinel", "grid_res_m": grid_res_m, "crs": C.CRS_WEB, "season": [C.SEASON_START, C.SEASON_END]})
    return cube


def cube_from_gee_composites(years: Iterable[int] = C.YEARS, grid_res_m: float = C.GRID_RES_M) -> Cube:
    """Build the Cube from the GEE composite GeoTIFFs (bands NDVI, NDBI, LST, WATER, COUNT)."""
    import rasterio

    lat, lon = make_grid(res_m=grid_res_m)
    years = list(years)
    ndvi_y, ndbi_y, lst_y, count_y, waters = {}, {}, {}, {}, []
    for year in years:
        path = C.PROC_DIR / "gee" / f"composite_{year}.tif"
        with rasterio.open(path) as src:
            names = {d: i + 1 for i, d in enumerate(src.descriptions)} if all(src.descriptions) else {"NDVI": 1, "NDBI": 2, "LST": 3, "WATER": 4, "COUNT": 5}
            rp = lambda b, avg=True: reproject_to_grid(src.read(names[b]).astype(np.float32), src.transform, src.crs, lat, lon, avg)
            ndvi_y[year], ndbi_y[year], lst_y[year] = fill_gaps(rp("NDVI")), fill_gaps(rp("NDBI")), fill_gaps(rp("LST"))
            count_y[year] = np.nan_to_num(rp("COUNT")).astype(np.int16)
            waters.append(rp("WATER"))
    water = np.nanmean(np.stack(waters), axis=0) > 0.5
    return Cube(years=years, lat=lat, lon=lon, ndvi=ndvi_y, ndbi=ndbi_y, lst=lst_y, count=count_y, water=water,
                meta={"source": "gee", "grid_res_m": grid_res_m, "crs": C.CRS_WEB})


def quality_report(cube: Cube, catalogue: Optional[list] = None) -> Dict[int, dict]:
    """Data-quality indicators per year (cloud, availability, completeness) for the UI."""
    from .fetch import read_catalogue

    records = catalogue if catalogue is not None else read_catalogue()
    report = {}
    for y in cube.years:
        recs = [r for r in records if r.year == y]
        used = sum(r.status == "used" for r in recs)
        partial = sum(r.status == "partial" for r in recs)
        rejected = sum(r.status == "rejected" for r in recs)
        cnt = cube.count[y]
        completeness = float((cnt[cube.land] >= C.MIN_CLEAR_OBS).mean() * 100) if cube.land.any() else 0.0
        mean_cloud = float(np.mean([r.cloud for r in recs])) if recs else float("nan")
        sensors = sorted({r.sensor for r in recs if r.status != "rejected"})
        report[y] = dict(year=y, scenes=len(recs), used=used, partial=partial, rejected=rejected, mean_scene_cloud=mean_cloud,
                         completeness_pct=completeness, mean_clear_obs=float(np.nanmean(cnt[cube.land])) if cube.land.any() else 0.0,
                         sensors=sensors, quality="High" if completeness > 97 else "Good" if completeness > 94 else "Fair")
    return report
