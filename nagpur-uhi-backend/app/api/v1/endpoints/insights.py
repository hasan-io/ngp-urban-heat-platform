from fastapi import APIRouter, Depends, Query

from app.api.deps import cube_dep, require_zone, year_param
from app.services import analysis_service as ana
from app.utils.response_utils import ok

router = APIRouter(prefix="/insights", tags=["insights"])


@router.get("/findings")
def findings(year: int = Depends(year_param), cube=Depends(cube_dep)):
    q = cube.quality(year)
    return ok({"year": year, "findings": ana.findings(cube, year), "recommendations": ana.recommendations(cube, year),
               "quality": {"label": q["quality"], "completeness": round(q["completeness_pct"], 1), "clearScenes": int(q["used"] + q["partial"]), "residualCloud": round(q["residual_cloud_pct"], 1)}})


@router.get("/hotspot-rankings")
def rankings(year: int = Depends(year_param), cube=Depends(cube_dep)):
    return ok(ana.zone_rankings(cube, year))


@router.get("/seasonal-patterns")
def seasonal(zone_id: str | None = Query(None), cube=Depends(cube_dep)):
    if zone_id:
        require_zone(cube, zone_id)
    return ok(ana.seasonal_patterns(cube, zone_id))
