"""Build analysis-ready GeoTIFFs (LST / NDVI / NDBI / WATER per year) + metadata.json.

  python scripts/prepare_data.py --source raw    # from Landsat Collection-2 scenes in data/raw/<year>/<scene>/
  python scripts/prepare_data.py --source demo   # calibrated demonstration cube (no downloads needed)

RAW layout (one folder per scene, Landsat C2 L2 or L1 band files):
  data/raw/2024/LC08_L2SP_144045_20240412_02_T1/  *_SR_B4.TIF *_SR_B5.TIF *_SR_B6.TIF *_ST_B10.TIF (or *_B10.TIF) *_QA_PIXEL.TIF
Each scene is cloud-masked with QA_PIXEL, converted to NDVI/NDBI/LST, warped onto the analysis grid;
the per-pixel median across scenes gives the seasonal composite.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.config import get_settings  # noqa: E402
from app.utils import calculations as F  # noqa: E402
from app.utils import constants as C  # noqa: E402
from app.utils.geospatial_utils import make_grid  # noqa: E402
from app.utils.raster_utils import write_geotiff  # noqa: E402


def _write_year(out_dir: Path, year: int, lat, lon, lst, ndvi, ndbi, water, meta: dict) -> None:
    d = out_dir / str(year)
    tags = {"year": year, "season": "pre-monsoon Mar-May", "source": meta.get("source")}
    write_geotiff(d / f"LST_{year}.tif", lst, lat, lon, tags={**tags, "unit": "degC"})
    write_geotiff(d / f"NDVI_{year}.tif", ndvi, lat, lon, tags=tags)
    write_geotiff(d / f"NDBI_{year}.tif", ndbi, lat, lon, tags=tags)
    write_geotiff(d / f"WATER_{year}.tif", water.astype(np.float32), lat, lon, tags=tags)
    (d / "metadata.json").write_text(json.dumps(meta, indent=1))


# ------------------------------------------------------------------ demo (calibrated synthetic)
def prepare_demo(out_dir: Path, res_m: float = C.GRID_RES_M) -> None:
    sys.path.insert(0, str(ROOT.parent / "python"))
    try:
        from nagpur_uhi.synthetic import demo_catalogue, generate
    except ImportError as e:
        raise SystemExit("Demo generator not found: expected ../python/nagpur_uhi (repository layout). Use --source raw with Landsat scenes instead.") from e
    cube = generate(grid_res_m=res_m)
    cat = demo_catalogue(C.YEARS)
    for y in C.YEARS:
        recs = [r for r in cat if r.year == y]
        used = sum(r.status == "used" for r in recs); partial = sum(r.status == "partial" for r in recs); rejected = len(recs) - used - partial
        clear = used + partial * 0.5
        meta = {"year": y, "source": "synthetic-calibrated", "note": "Model-generated composite calibrated to Nagpur geography — replace with --source raw for operational use.",
                "scenes": [{"id": r.id, "platform": r.platform, "sensor": r.sensor, "date": r.date, "year": r.year, "cloud": r.cloud, "status": r.status, "bands": r.bands} for r in recs],
                "used": used, "partial": partial, "rejected": rejected, "mean_scene_cloud": float(np.mean([r.cloud for r in recs])),
                "completeness_pct": float(min(99.8, 88 + clear * 0.6)), "residual_cloud_pct": float(max(0.2, 3.5 - clear * 0.12)),
                "sensors": sorted({r.sensor for r in recs if r.status != "rejected"}), "quality": "High" if 88 + clear * 0.6 > 97 else "Good"}
        _write_year(out_dir, y, cube.lat, cube.lon, cube.lst[y], cube.ndvi[y], cube.ndbi[y], cube.water, meta)
        print(f"[{y}] wrote demo composites → {out_dir / str(y)}")


# ------------------------------------------------------------------ raw Landsat
def _find(scene: Path, suffix: str) -> Path | None:
    hits = sorted(scene.glob(f"*{suffix}"))
    return hits[0] if hits else None


def prepare_raw(raw_dir: Path, out_dir: Path, res_m: float = C.GRID_RES_M, max_cloud: float = 45.0) -> None:
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_bounds
    from rasterio.warp import reproject

    lat, lon = make_grid(res_m=res_m)
    west, south, east, north = lon[0] - (lon[1] - lon[0]) / 2, lat[-1] - (lat[0] - lat[1]) / 2, lon[-1] + (lon[1] - lon[0]) / 2, lat[0] + (lat[0] - lat[1]) / 2
    dst_transform = from_bounds(west, south, east, north, len(lon), len(lat))

    def warp(arr, src, average=True):
        dst = np.full((len(lat), len(lon)), np.nan, dtype=np.float32)
        reproject(arr.astype(np.float32), dst, src_transform=src.transform, src_crs=src.crs, src_nodata=np.nan, dst_transform=dst_transform,
                  dst_crs="EPSG:4326", dst_nodata=np.nan, resampling=Resampling.average if average else Resampling.nearest)
        return dst

    for y in C.YEARS:
        scenes = sorted(p for p in (raw_dir / str(y)).glob("*") if p.is_dir()) if (raw_dir / str(y)).exists() else []
        if not scenes:
            print(f"[{y}] no scenes in {raw_dir / str(y)} — skipped"); continue
        stacks = {"lst": [], "ndvi": [], "ndbi": [], "water": []}
        records = []
        for sc in scenes:
            qa_p, red_p, nir_p, swir_p = _find(sc, "QA_PIXEL.TIF"), _find(sc, "B4.TIF"), _find(sc, "B5.TIF"), _find(sc, "B6.TIF")
            st_p, b10_p = _find(sc, "ST_B10.TIF"), _find(sc, "_B10.TIF")
            if not all((qa_p, red_p, nir_p, swir_p)) or not (st_p or b10_p):
                print(f"  {sc.name}: missing bands — skipped"); continue
            with rasterio.open(qa_p) as s:
                qa = s.read(1); src = s
                clear = F.landsat_clear_mask(qa); water = F.landsat_water_mask(qa)
                cloud_pct = float((~clear).mean() * 100)
                status = "rejected" if cloud_pct > max_cloud else "partial" if cloud_pct > 20 else "used"
                records.append({"id": sc.name, "platform": "Landsat", "sensor": "landsat-9" if sc.name.startswith("LC09") else "landsat-8", "date": f"{sc.name[17:21]}-{sc.name[21:23]}-{sc.name[23:25]}" if len(sc.name) > 25 else "", "year": y, "cloud": round(cloud_pct, 1), "status": status, "bands": ["B4", "B5", "B6", "B10", "QA_PIXEL"]})
                if status == "rejected":
                    continue
                def rd(p):
                    with rasterio.open(p) as b:
                        return b.read(1)
                red, nir, swir = (F.scale_surface_reflectance(rd(p)) for p in (red_p, nir_p, swir_p))
                lst = F.lst_from_collection2(rd(st_p)) if st_p else F.lst_from_level1(rd(b10_p), red, nir)
                nan = np.float32(np.nan)
                stacks["ndvi"].append(warp(np.where(clear, F.ndvi(nir, red), nan), src)); stacks["ndbi"].append(warp(np.where(clear, F.ndbi(swir, nir), nan), src))
                stacks["lst"].append(warp(np.where(clear, lst, nan), src)); stacks["water"].append(warp(np.where(clear, water.astype(np.float32), nan), src))
            print(f"  {sc.name}: cloud {cloud_pct:.1f}% → {status}")
        if not stacks["lst"]:
            print(f"[{y}] no usable scenes"); continue
        med = {k: np.nanmedian(np.stack(v), axis=0).astype(np.float32) for k, v in stacks.items()}
        count = np.isfinite(np.stack(stacks["lst"])).sum(axis=0)
        used = sum(r["status"] == "used" for r in records); partial = sum(r["status"] == "partial" for r in records)
        completeness = float((count >= 3).mean() * 100)
        meta = {"year": y, "source": "landsat-c2", "scenes": records, "used": used, "partial": partial, "rejected": len(records) - used - partial,
                "mean_scene_cloud": float(np.mean([r["cloud"] for r in records])), "completeness_pct": completeness, "residual_cloud_pct": float((~np.isfinite(med["lst"])).mean() * 100),
                "sensors": sorted({r["sensor"] for r in records if r["status"] != "rejected"}), "quality": "High" if completeness > 97 else "Good" if completeness > 94 else "Fair"}
        _write_year(out_dir, y, lat, lon, med["lst"], med["ndvi"], med["ndbi"], np.nan_to_num(med["water"]) > 0.5, meta)
        print(f"[{y}] wrote composites from {len(stacks['lst'])} scenes → {out_dir / str(y)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["demo", "raw"], default="demo")
    ap.add_argument("--raw-dir", default=str(ROOT / "data" / "raw"))
    ap.add_argument("--res", type=float, default=C.GRID_RES_M)
    a = ap.parse_args()
    out = get_settings().imagery_dir
    (prepare_demo if a.source == "demo" else lambda o, r: prepare_raw(Path(a.raw_dir), o, r))(out, a.res)
