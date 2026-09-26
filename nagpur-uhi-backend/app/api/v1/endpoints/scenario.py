from fastapi import APIRouter, Depends, Query

from app.api.deps import cube_dep
from app.models.pydantic_models import ScenarioRequest
from app.services import scenario_service as sc
from app.utils import constants as C
from app.utils.response_utils import ApiError, ok

router = APIRouter(prefix="/scenario", tags=["scenario"])


def _check_ranges(veg: float, built: float):
    if not C.VEG_RANGE[0] <= veg <= C.VEG_RANGE[1]:
        raise ApiError(f"Vegetation change must be between {C.VEG_RANGE[0]:.0f} and {C.VEG_RANGE[1]:.0f}", 400)
    if not C.BUILT_RANGE[0] <= built <= C.BUILT_RANGE[1]:
        raise ApiError(f"Built-up change must be between {C.BUILT_RANGE[0]:.0f} and {C.BUILT_RANGE[1]:.0f}", 400)


@router.post("/predict")
def predict(body: ScenarioRequest, cube=Depends(cube_dep)):
    return ok(sc.predict(cube, body.zone_id, body.baseline, body.vegetation_change, body.built_up_change, body.method))


@router.get("/sensitivity-curve")
def sensitivity(zone_id: str = Query(...), baseline_year: str = Query("2024"), built_up_change: float = Query(0.0), cube=Depends(cube_dep)):
    baseline = "2030" if str(baseline_year) == "2030" else "2024"
    _check_ranges(0, built_up_change)
    return ok(sc.sensitivity_curve(cube, zone_id, baseline, built_up_change))


@router.get("/rasters")
def rasters(zone_id: str = Query(...), vegetation_change: float = Query(0.0), built_up_change: float = Query(0.0), baseline_year: str = Query("2024"), cube=Depends(cube_dep)):
    _check_ranges(vegetation_change, built_up_change)
    return ok(sc.rasters(cube, zone_id, vegetation_change, built_up_change, "2030" if str(baseline_year) == "2030" else "2024"))
