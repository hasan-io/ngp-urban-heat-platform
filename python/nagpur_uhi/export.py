"""Component 5 back-end — export products for the interactive interface.

* `analysis_bundle`   → one JSON document (city stats, zones, regression, trends, hotspots,
                         change detection, data quality) consumed by the React front-end / API
* `write_png_maps`    → colour-mapped LST / NDVI / NDBI / ΔLST / hotspot PNGs (matplotlib)
* `write_geotiff`     → georeferenced rasters for QGIS / ArcGIS (rasterio)
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Optional

import numpy as np

from . import config as C
from .cube import Cube
from .indices import city_stats, fit_lst_model, histogram
from .temporal import change_summary, getis_ord_gi_star, hotspot_persistence, per_pixel_trend, trend_report
from .zones import rasterize_zones, zonal_stats, zones_geojson

# ---------------------------------------------------------------------------- JSON bundle


def _jsonable(o):
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, dict):
        return {str(k): _jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_jsonable(v) for v in o]
    if isinstance(o, float) and not np.isfinite(o):
        return None
    return o


def analysis_bundle(cube: Cube, quality: Optional[Dict[int, dict]] = None, include_rasters: bool = False) -> dict:
    zone_idx = rasterize_zones(cube)
    persistence = hotspot_persistence(cube)
    slope, _, r2 = per_pixel_trend(cube.stack("lst"), cube.years)
    gi = getis_ord_gi_star(cube.lst[cube.years[-1]], cube.land)
    px = cube.pixel_area_km2
    bundle = {
        "meta": {**cube.meta, "aoi": C.AOI_NAME, "bbox": list(cube.bounds), "shape": list(cube.shape), "years": cube.years,
                 "pixel_area_km2": px, "season": [C.SEASON_START, C.SEASON_END], "year_notes": C.YEAR_NOTES},
        "city": {y: city_stats(cube, y).__dict__ for y in cube.years},
        "regression": {y: fit_lst_model(cube, y).to_dict() for y in cube.years},
        "trends": trend_report(cube),
        "change_2019_2024": change_summary(cube, cube.years[0], cube.years[-1]),
        "hotspots": {
            "persistent_km2": float((persistence >= C.PERSISTENT_YEARS).sum() * px),
            "all_years_km2": float((persistence == len(cube.years)).sum() * px),
            "significant_cluster_km2": float(np.nansum(gi > 1.96) * px),
            "histogram": [int((persistence == k).sum()) for k in range(len(cube.years) + 1)],
        },
        "pixel_trend": {"mean_slope_c_per_yr": float(np.nanmean(slope[cube.land])), "share_r2_gt_0_5": float(np.nanmean(r2[cube.land] > 0.5))},
        "zones": zonal_stats(cube, zone_idx),
        "zones_geojson": zones_geojson(),
        "histograms": {y: {"lst": histogram(cube.lst[y], cube.land, 30, 47, 34), "ndvi": histogram(cube.ndvi[y], cube.land, -0.1, 0.8, 30),
                           "ndbi": histogram(cube.ndbi[y], cube.land, -0.45, 0.5, 30)} for y in cube.years},
        "quality": quality or {},
    }
    if include_rasters:
        bundle["rasters"] = {"lat": cube.lat, "lon": cube.lon, "water": cube.water.astype(np.uint8),
                             "hotspot_persistence": persistence,
                             **{f"{m}_{y}": np.round(cube.layer(m, y), 3) for m in ("lst", "ndvi", "ndbi") for y in cube.years}}
    return _jsonable(bundle)


def write_bundle(bundle: dict, path: Path = C.OUT_DIR / "nagpur_uhi_analysis.json") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(bundle, indent=1))
    return path


# ---------------------------------------------------------------------------- PNG maps

COLORMAPS = {
    "lst": ("turbo", 30, 47, "LST (°C)"),
    "ndvi": ("YlGn", -0.1, 0.8, "NDVI"),
    "ndbi": ("PuOr_r", -0.45, 0.5, "NDBI"),
    "dlst": ("coolwarm", -4, 4, "ΔLST (°C)"),
    "hotspot": ("hot", 0, 6, "Years in hottest decile"),
    "gi": ("RdBu_r", -4, 4, "Getis-Ord Gi* z"),
}


def write_png_maps(cube: Cube, out_dir: Path = C.OUT_DIR / "maps", dpi: int = 130) -> list[Path]:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:  # pragma: no cover
        print("matplotlib not installed — skipping PNG maps (pip install matplotlib)")
        return []
    out_dir.mkdir(parents=True, exist_ok=True)
    west, south, east, north = cube.bounds
    extent = (west, east, south, north)
    written = []

    def save(arr, key, title, fname, zones=True):
        cmap, lo, hi, label = COLORMAPS[key]
        fig, ax = plt.subplots(figsize=(7.2, 6.4), facecolor="#0b1220")
        ax.set_facecolor("#0b1220")
        im = ax.imshow(np.where(cube.water & (key in ("lst", "ndvi", "ndbi")), np.nan, arr), cmap=cmap, vmin=lo, vmax=hi, extent=extent, interpolation="nearest")
        ax.imshow(np.where(cube.water, 1.0, np.nan), cmap="Blues_r", vmin=0, vmax=1.6, extent=extent, interpolation="nearest")
        if zones:
            for z in C.ZONES:
                xs = [p[0] for p in z["poly"]] + [z["poly"][0][0]]
                ys = [p[1] for p in z["poly"]] + [z["poly"][0][1]]
                ax.plot(xs, ys, color="white", lw=0.5, alpha=0.6, ls="--")
                ax.text(np.mean(xs[:-1]), np.mean(ys[:-1]), z["short"], color="white", fontsize=5.5, ha="center", va="center", alpha=0.9)
        cb = fig.colorbar(im, ax=ax, fraction=0.04, pad=0.02)
        cb.set_label(label, color="white")
        cb.ax.yaxis.set_tick_params(color="white", labelcolor="white")
        ax.set_title(title, color="white", fontsize=11)
        ax.tick_params(colors="#94a3b8", labelsize=7)
        for s in ax.spines.values():
            s.set_edgecolor("#334155")
        p = out_dir / fname
        fig.savefig(p, dpi=dpi, bbox_inches="tight", facecolor=fig.get_facecolor())
        plt.close(fig)
        written.append(p)

    for y in cube.years:
        for m in ("lst", "ndvi", "ndbi"):
            save(cube.layer(m, y), m, f"Nagpur {m.upper()} — pre-monsoon {y}", f"{m}_{y}.png")
    y0, y1 = cube.years[0], cube.years[-1]
    save(cube.lst[y1] - cube.lst[y0], "dlst", f"ΔLST {y0}→{y1}", f"dlst_{y0}_{y1}.png")
    save(hotspot_persistence(cube).astype(float), "hotspot", "Persistent hotspots (years in top decile)", "hotspot_persistence.png")
    save(getis_ord_gi_star(cube.lst[y1], cube.land), "gi", f"Getis-Ord Gi* hot/cold clusters {y1}", f"gi_star_{y1}.png")
    return written


# ---------------------------------------------------------------------------- GeoTIFF


def write_geotiff(cube: Cube, arr: np.ndarray, path: Path, nodata: float = -9999.0) -> Optional[Path]:
    try:
        import rasterio
        from rasterio.transform import Affine
    except ImportError:  # pragma: no cover
        print("rasterio not installed — skipping GeoTIFF export")
        return None
    a, b, c, d, e, f = cube.transform
    data = np.where(np.isfinite(arr), arr, nodata).astype(np.float32)
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", driver="GTiff", height=cube.shape[0], width=cube.shape[1], count=1, dtype="float32",
                       crs=C.CRS_WEB, transform=Affine(a, b, c, d, e, f), nodata=nodata, compress="deflate") as dst:
        dst.write(data, 1)
    return path


def write_all_geotiffs(cube: Cube, out_dir: Path = C.OUT_DIR / "geotiff") -> list[Path]:
    paths = []
    for y in cube.years:
        for m in ("lst", "ndvi", "ndbi"):
            p = write_geotiff(cube, cube.layer(m, y), out_dir / f"{m}_{y}.tif")
            if p:
                paths.append(p)
    p = write_geotiff(cube, hotspot_persistence(cube).astype(np.float32), out_dir / "hotspot_persistence.tif")
    if p:
        paths.append(p)
    return paths
