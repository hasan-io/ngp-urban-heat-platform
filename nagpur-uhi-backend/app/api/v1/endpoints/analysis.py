from fastapi import APIRouter, Depends, Query

from app.api.deps import cube_dep, year_param
from app.services import calculation_service as calc
from app.utils.response_utils import ApiError, ok

router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.get("/scatter/{kind}")
def scatter(kind: str, year: int = Depends(year_param), n: int = Query(1100, ge=100, le=5000), cube=Depends(cube_dep)):
    if kind not in ("ndvi-lst", "ndbi-lst"):
        raise ApiError("kind must be ndvi-lst or ndbi-lst", 404)
    return ok(calc.correlation(cube, year, kind.split("-")[0], n))


@router.get("/trends")
def trends(cube=Depends(cube_dep)):
    return ok(calc.trends(cube))


@router.get("/regression")
def regression(year: int = Depends(year_param), cube=Depends(cube_dep)):
    return ok(calc.pixel_regression(cube, year))
