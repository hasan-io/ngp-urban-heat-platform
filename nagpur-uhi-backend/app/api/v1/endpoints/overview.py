from fastapi import APIRouter, Depends

from app.api.deps import cube_dep, year_param
from app.services import analysis_service as ana
from app.utils.response_utils import ok

router = APIRouter(tags=["overview"])


@router.get("/overview")
def overview(year: int = Depends(year_param), cube=Depends(cube_dep)):
    return ok(ana.overview(cube, year))
