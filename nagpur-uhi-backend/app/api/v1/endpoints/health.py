from fastapi import APIRouter

from app import __version__
from app.ml import models as ml_models
from app.services.cache_service import analysis_cache, data_cache
from app.services.satellite_data_service import get_cube
from app.utils.response_utils import now_iso

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    cube = get_cube()
    model = ml_models.get_model(allow_train=False)
    return {"status": "ok", "timestamp": now_iso(), "version": __version__, "years_available": cube.available_years(), "grid": list(cube.shape),
            "model": None if model is None else {"backend": model.metadata.get("backend"), "r_squared": model.r2, "trained_at": model.metadata.get("trained_at")},
            "cache": {"data": data_cache.stats(), "analysis": analysis_cache.stats()}}


@router.post("/cache/clear")
def clear_cache():
    return {"status": "ok", "cleared": data_cache.clear() + analysis_cache.clear(), "timestamp": now_iso()}
