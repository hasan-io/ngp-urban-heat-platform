"""Component 1a — Satellite data fetch.

Two interchangeable back-ends:

* **Planetary Computer (STAC)** — no account needed. Searches Landsat 8/9 Collection-2
  Level-2 and Sentinel-2 L2A, then streams *only the AOI window* of each Cloud-Optimised
  GeoTIFF (COG) to disk. Bands: red, NIR, SWIR1, thermal (Landsat) and the QA band.
* **Google Earth Engine** — server-side masking + median compositing, returns the
  finished annual composite (NDVI / NDBI / LST) as a GeoTIFF.

Both write a `scenes.json` catalogue so Component 5 can show cloud cover and
satellite availability per year.

    python -m nagpur_uhi fetch --source pc  --years 2019 2024
    python -m nagpur_uhi fetch --source gee --years 2019 2024
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import List, Optional

from . import config as C

# ---------------------------------------------------------------------------- catalogue records


@dataclass
class SceneRecord:
    id: str
    platform: str            # "Landsat" | "Sentinel"
    sensor: str              # e.g. "landsat-8", "sentinel-2b"
    date: str                # YYYY-MM-DD
    year: int
    cloud: float             # scene / AOI cloud cover %
    status: str              # used | partial | rejected
    path: Optional[str]      # local GeoTIFF (None if rejected)
    bands: List[str]


def _status(cloud: float) -> str:
    if cloud > C.MAX_SCENE_CLOUD:
        return "rejected"
    return "partial" if cloud > C.PARTIAL_SCENE_CLOUD else "used"


def _season(year: int) -> str:
    return f"{year}-{C.SEASON_START}/{year}-{C.SEASON_END}"


def write_catalogue(records: List[SceneRecord], path: Path = C.RAW_DIR / "scenes.json") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([asdict(r) for r in records], indent=2))
    return path


def read_catalogue(path: Path = C.RAW_DIR / "scenes.json") -> List[SceneRecord]:
    if not path.exists():
        return []
    return [SceneRecord(**r) for r in json.loads(path.read_text())]


# ---------------------------------------------------------------------------- Planetary Computer

# asset keys per collection → our canonical band order
PC_BANDS = {
    C.STAC_LANDSAT: ["red", "nir08", "swir16", "lwir11", "qa_pixel"],
    C.STAC_SENTINEL: ["B04", "B08", "B11", "SCL"],
}


def _stac_client():
    try:
        import planetary_computer as pc
        from pystac_client import Client
    except ImportError as e:  # pragma: no cover
        raise SystemExit("pip install pystac-client planetary-computer rasterio") from e
    return Client.open(C.STAC_URL, modifier=pc.sign_inplace)


def search_pc(year: int, collection: str, max_cloud: float = 80.0):
    """Return STAC items intersecting the AOI in the pre-monsoon window, oldest first."""
    client = _stac_client()
    query = {"eo:cloud_cover": {"lt": max_cloud}}
    if collection == C.STAC_LANDSAT:
        query["platform"] = {"in": ["landsat-8", "landsat-9"]}
    search = client.search(collections=[collection], bbox=list(C.AOI_BBOX), datetime=_season(year), query=query)
    return sorted(search.item_collection(), key=lambda it: it.datetime)


def clip_item_to_aoi(item, collection: str, out_dir: Path) -> Path:
    """Stream the AOI window of each required band and stack them into one GeoTIFF."""
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds

    bands = PC_BANDS[collection]
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{item.id}.tif"
    if out_path.exists():
        return out_path

    arrays, profile = [], None
    for key in bands:
        href = item.assets[key].href
        with rasterio.open(href) as src:
            # AOI bounds in the scene's projection → pixel window
            b = transform_bounds("EPSG:4326", src.crs, *C.AOI_BBOX, densify_pts=21)
            win = from_bounds(*b, transform=src.transform).round_offsets().round_lengths()
            if profile is None:  # first band defines the target grid (30 m Landsat / 10 m S2 red)
                profile = src.profile.copy()
                profile.update(height=int(win.height), width=int(win.width), transform=src.window_transform(win),
                               count=len(bands), dtype="float32", compress="deflate", nodata=np.nan, driver="GTiff")
                ref_shape = (int(win.height), int(win.width))
            # resample 20 m SWIR / 100 m thermal onto the reference grid
            data = src.read(1, window=win, out_shape=ref_shape, resampling=Resampling.nearest if key in ("qa_pixel", "SCL") else Resampling.bilinear)
            arrays.append(data.astype("float32"))

    with rasterio.open(out_path, "w", **profile) as dst:
        for i, (arr, key) in enumerate(zip(arrays, bands), start=1):
            dst.write(arr, i)
            dst.set_band_description(i, key)
        dst.update_tags(scene_id=item.id, datetime=item.datetime.isoformat(), platform=item.properties.get("platform", ""),
                        cloud=str(item.properties.get("eo:cloud_cover", "")))
    return out_path


def fetch_pc(years=C.YEARS, collections=(C.STAC_LANDSAT, C.STAC_SENTINEL), download: bool = True) -> List[SceneRecord]:
    records: List[SceneRecord] = []
    for year in years:
        for coll in collections:
            platform = "Landsat" if coll == C.STAC_LANDSAT else "Sentinel"
            for item in search_pc(year, coll):
                cloud = float(item.properties.get("eo:cloud_cover", 100.0))
                status = _status(cloud)
                path = None
                if download and status != "rejected":
                    path = str(clip_item_to_aoi(item, coll, C.RAW_DIR / str(year)))
                records.append(SceneRecord(id=item.id, platform=platform, sensor=item.properties.get("platform", ""),
                                           date=item.datetime.strftime("%Y-%m-%d"), year=year, cloud=cloud,
                                           status=status, path=path, bands=PC_BANDS[coll]))
                print(f"[{year}] {platform:8s} {item.datetime:%Y-%m-%d} cloud={cloud:5.1f}% → {status}")
    write_catalogue(records)
    return records


# ---------------------------------------------------------------------------- Google Earth Engine


def _ee():
    try:
        import ee
    except ImportError as e:  # pragma: no cover
        raise SystemExit("pip install earthengine-api  &&  earthengine authenticate") from e
    try:
        ee.Initialize()
    except Exception:
        ee.Authenticate()
        ee.Initialize()
    return ee


def gee_prepare_landsat(img):
    """Mask clouds with QA_PIXEL, apply C2 L2 scale factors, derive NDVI/NDBI/LST."""
    ee = _ee()
    qa = img.select("QA_PIXEL")
    clear = (qa.bitwiseAnd(1 << 1).eq(0)     # dilated cloud
             .And(qa.bitwiseAnd(1 << 2).eq(0))  # cirrus
             .And(qa.bitwiseAnd(1 << 3).eq(0))  # cloud
             .And(qa.bitwiseAnd(1 << 4).eq(0)))  # cloud shadow
    sr = img.select(["SR_B4", "SR_B5", "SR_B6"]).multiply(C.SR_SCALE).add(C.SR_OFFSET)
    lst = img.select("ST_B10").multiply(C.ST_SCALE).add(C.ST_OFFSET).subtract(273.15).rename("LST")
    ndvi = sr.normalizedDifference(["SR_B5", "SR_B4"]).rename("NDVI")
    ndbi = sr.normalizedDifference(["SR_B6", "SR_B5"]).rename("NDBI")
    water = qa.bitwiseAnd(1 << 7).neq(0).rename("WATER")
    return ee.Image.cat([ndvi, ndbi, lst, water]).updateMask(clear).copyProperties(img, ["system:time_start"])


def gee_prepare_sentinel(img):
    """Mask with the Scene Classification Layer; derive NDVI/NDBI (no thermal band)."""
    ee = _ee()
    scl = img.select("SCL")
    clear = scl.neq(3).And(scl.neq(8)).And(scl.neq(9)).And(scl.neq(10)).And(scl.neq(11)).And(scl.neq(0)).And(scl.neq(1))
    ref = img.select(["B4", "B8", "B11"]).divide(10000)
    ndvi = ref.normalizedDifference(["B8", "B4"]).rename("NDVI")
    ndbi = ref.normalizedDifference(["B11", "B8"]).rename("NDBI")
    water = scl.eq(6).rename("WATER")
    return ee.Image.cat([ndvi, ndbi, water]).updateMask(clear).copyProperties(img, ["system:time_start"])


def gee_annual_composite(year: int, scale_m: int = C.NATIVE_RES_M):
    """Median pre-monsoon composite (NDVI, NDBI, LST, WATER, COUNT) for one year."""
    ee = _ee()
    aoi = ee.Geometry.Rectangle(list(C.AOI_BBOX))
    start, end = f"{year}-{C.SEASON_START}", f"{year}-{C.SEASON_END}"
    landsat = ee.ImageCollection(C.GEE_LANDSAT[0]).merge(ee.ImageCollection(C.GEE_LANDSAT[1])) \
        .filterBounds(aoi).filterDate(start, end).filter(ee.Filter.lt("CLOUD_COVER", C.MAX_SCENE_CLOUD)).map(gee_prepare_landsat)
    s2 = ee.ImageCollection(C.GEE_SENTINEL).filterBounds(aoi).filterDate(start, end) \
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", C.MAX_SCENE_CLOUD)).map(gee_prepare_sentinel)

    lst = landsat.select("LST").median()
    count = landsat.select("LST").count().rename("COUNT")
    # optical indices benefit from the 5-day Sentinel revisit; Landsat fills gaps
    ndvi = s2.select("NDVI").merge(landsat.select("NDVI")).median()
    ndbi = s2.select("NDBI").merge(landsat.select("NDBI")).median()
    water = s2.select("WATER").merge(landsat.select("WATER")).mean().gt(0.5).rename("WATER")
    comp = ee.Image.cat([ndvi.rename("NDVI"), ndbi.rename("NDBI"), lst.rename("LST"), water, count]).clip(aoi)
    return comp.reproject(crs=C.CRS_ANALYSIS, scale=scale_m), landsat.size(), s2.size()


def fetch_gee(years=C.YEARS, scale_m: int = C.NATIVE_RES_M) -> List[Path]:
    """Download the annual composites (≈10 MB each at 30 m) into data/processed/gee/."""
    import urllib.request

    ee = _ee()
    out_dir = C.PROC_DIR / "gee"
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for year in years:
        comp, n_l, n_s2 = gee_annual_composite(year, scale_m)
        print(f"[{year}] Landsat scenes: {n_l.getInfo()}  Sentinel-2 scenes: {n_s2.getInfo()}")
        url = comp.getDownloadURL({"region": ee.Geometry.Rectangle(list(C.AOI_BBOX)), "scale": scale_m,
                                   "crs": C.CRS_ANALYSIS, "format": "GEO_TIFF"})
        path = out_dir / f"composite_{year}.tif"
        urllib.request.urlretrieve(url, path)
        paths.append(path)
        print(f"        → {path}")
    return paths
