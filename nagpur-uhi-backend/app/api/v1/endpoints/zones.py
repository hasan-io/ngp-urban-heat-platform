from fastapi import APIRouter, Depends

from app.api.deps import cube_dep, require_zone, year_param
from app.services import analysis_service as ana
from app.services import calculation_service as calc
from app.utils.response_utils import ok

router = APIRouter(tags=["zones"])


@router.get("/zones")
def zones(cube=Depends(cube_dep)):
    fc = ana.zone_feature_collection(cube)
    return ok({"count": len(fc["features"]), "zones": [{"zoneId": f["id"], **f["properties"], "boundary": f["geometry"]} for f in fc["features"]], "geojson": fc})


@router.get("/zones/{zone_id}/stats")
def zone_stats(zone_id: str, year: int = Depends(year_param), cube=Depends(cube_dep)):
    z = require_zone(cube, zone_id)
    st = calc.zone_stats(cube, zone_id, year)
    s = calc.zone_series(cube, zone_id)
    return ok({"id": zone_id, "zoneId": zone_id, "name": z["properties"]["name"], "character": z["properties"].get("character"), "population": z["properties"].get("population"), "year": year,
               "stats": {"lst": st["lst_mean"], "ndvi": st["ndvi_mean"], "ndbi": st["ndbi_mean"], "hotFrac": st["hot_fraction"], **st},
               "change": s["change"], "trend": {k: v["slope"] for k, v in s["trend"].items()}, "trendDetail": s["trend"], "series": {"years": s["years"], **s["series"]},
               "persistentHotspotFraction": st["persistent_fraction"]})


@router.get("/landmarks")
def landmarks(cube=Depends(cube_dep)):
    return ok(cube.landmarks)
