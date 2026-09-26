"""Satellite data products. Two families:
  * /api/data/*            → enveloped analytical products (GeoJSON + compact grid)
  * /api/summary, /api/raster/{metric}/{year}, /api/scenes → raw cube contract used by the
    frontend's live raster loader (src/data/live.ts). These return plain JSON (no envelope)."""
from fastapi import APIRouter, Depends, Query

from app.api.deps import cube_dep, year_param
from app.services import analysis_service as ana
from app.services import calculation_service as calc
from app.utils import constants as C
from app.utils.raster_utils import grid_payload
from app.utils.response_utils import ApiError, ok

router = APIRouter(prefix="/data", tags=["data"])
cube_router = APIRouter(tags=["raster-cube"])


@router.get("/lst")
def lst(year: int = Depends(year_param), include_grid: bool = Query(True), cube=Depends(cube_dep)):
    return ok(ana.layer_product(cube, "lst", year, include_grid))


@router.get("/ndvi")
def ndvi(year: int = Depends(year_param), include_grid: bool = Query(True), cube=Depends(cube_dep)):
    return ok(ana.layer_product(cube, "ndvi", year, include_grid))


@router.get("/ndbi")
def ndbi(year: int = Depends(year_param), include_grid: bool = Query(True), cube=Depends(cube_dep)):
    return ok(ana.layer_product(cube, "ndbi", year, include_grid))


@router.get("/delta-lst")
def delta_lst(year1: int = Query(C.BASE_YEAR), year2: int = Query(C.LATEST_YEAR), cube=Depends(cube_dep)):
    for y in (year1, year2):
        if y not in C.YEARS:
            raise ApiError(f"Year must be between {C.YEARS[0]} and {C.YEARS[-1]}", 400)
    d = cube.lst(year2) - cube.lst(year1)
    v = cube.valid_mask(year1) & cube.valid_mask(year2)
    px = cube.cell_area_km2
    zones = ana.zone_feature_collection(cube)
    for f in zones["features"]:
        m = cube.zone_mask(f["id"]) & v
        f["properties"]["delta_lst"] = float(d[m].mean()) if m.any() else None
    return ok({"year1": year1, "year2": year2, "unit": "°C", "stats": {"mean": float(d[v].mean()), "min": float(d[v].min()), "max": float(d[v].max()),
               "warmedOver2Km2": float((d[v] > 2).sum() * px), "cooledUnderMinus1Km2": float((d[v] < -1).sum() * px)},
               "grid": grid_payload(d, cube.lat, cube.lon), "zones": zones, "bounds": list(cube.bounds)})


@router.get("/persistent-hotspots")
def persistent_hotspots(year_range: str = Query("2019-2024"), min_years: int | None = Query(None, ge=1, le=6), cube=Depends(cube_dep)):
    try:
        y0, y1 = (int(v) for v in year_range.split("-"))
    except ValueError as e:
        raise ApiError("year_range must look like 2019-2024", 400) from e
    if y0 not in C.YEARS or y1 not in C.YEARS or y1 < y0:
        raise ApiError("year_range must be within 2019-2024", 400)
    pers = calc.persistence(cube)
    total = len(cube.available_years())
    need = min_years or total
    comps = calc.persistent_components(cube, need)
    mask = cube.land & (pers >= need)
    return ok({"yearRange": year_range, "yearsRequired": need, "yearsAvailable": total, "cellCount": int(mask.sum()), "areaKm2": float(mask.sum() * cube.cell_area_km2),
               "components": ana.components_geojson(cube, comps), "cells": ana.cells_geojson(cube, mask, pers.astype(float), "years_hot"),
               "persistenceGrid": grid_payload(pers.astype(float), cube.lat, cube.lon, 0)})


@router.get("/hotspots")
def hotspots_layer(year: int = Depends(year_param), cube=Depends(cube_dep)):
    mask = calc.hotspot_mask(cube, year)
    return ok({"year": year, "threshold": calc.hotspot_threshold(cube, year), "cellCount": int(mask.sum()), "components": ana.components_geojson(cube, calc.hotspot_components(cube, year)),
               "grid": grid_payload(mask.astype(float), cube.lat, cube.lon, 0)})


# -------------------------------------------------------------- raw cube contract (frontend live loader)
@cube_router.get("/summary")
def summary(cube=Depends(cube_dep)):
    return cube.summary()


@cube_router.get("/raster/{metric}/{year}")
def raster(metric: str, year: int, cube=Depends(cube_dep)):
    if year not in C.YEARS:
        raise ApiError(f"Year must be between {C.YEARS[0]} and {C.YEARS[-1]}", 400)
    if metric == "water":
        arr = cube.water.astype("float32")
    elif metric == "hotspot":
        arr = calc.persistence(cube).astype("float32")
    elif metric == "dlst":
        arr = cube.lst(year) - cube.lst(C.BASE_YEAR)
    elif metric in ("lst", "ndvi", "ndbi"):
        arr = cube.layer(metric, year)
    else:
        raise ApiError(f"Unknown metric '{metric}'", 404)
    p = grid_payload(arr, cube.lat, cube.lon)
    return {"metric": metric, "year": year, **p}


@cube_router.get("/scenes")
def scenes(cube=Depends(cube_dep)):
    out = []
    for y in cube.available_years():
        out.extend(cube.quality(y).get("scenes", []))
    return out
