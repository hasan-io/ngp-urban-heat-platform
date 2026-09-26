from fastapi import APIRouter, Depends, Query

from app.api.deps import cube_dep, year_param
from app.services import analysis_service as ana
from app.services import calculation_service as calc
from app.utils.response_utils import ok

router = APIRouter(prefix="/hotspots", tags=["hotspots"])


@router.get("/top")
def top(year: int = Depends(year_param), limit: int = Query(8, ge=1, le=50), cube=Depends(cube_dep)):
    return ok(ana.zone_rankings(cube, year)[:limit])


@router.get("/components")
def components(year: int = Depends(year_param), cube=Depends(cube_dep)):
    return ok({"year": year, "threshold": calc.hotspot_threshold(cube, year), "components": calc.hotspot_components(cube, year)})
