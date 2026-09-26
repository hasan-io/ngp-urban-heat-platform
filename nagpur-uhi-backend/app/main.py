"""FastAPI application: logging, CORS, error envelopes and the start-up pipeline
(data preparation → database seeding → zone statistics → hotspot ranking → ML model)."""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from logging.handlers import TimedRotatingFileHandler

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.v1.router import api_router
from app.config import get_settings
from app.database.database import init_db, session_scope
from app.ml import models as ml_models
from app.repositories.satellite_data_repository import SatelliteDataRepository
from app.repositories.zone_repository import ZoneRepository
from app.services import analysis_service as ana
from app.services import calculation_service as calc
from app.services.satellite_data_service import get_cube, reset_cube
from app.utils import constants as C
from app.utils.response_utils import ApiError, fail

settings = get_settings()
log = logging.getLogger("uhi")


def setup_logging() -> None:
    settings.logs_dir.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    root = logging.getLogger()
    root.setLevel(settings.log_level.upper())
    if not any(isinstance(h, TimedRotatingFileHandler) for h in root.handlers):
        fh = TimedRotatingFileHandler(settings.logs_dir / "app.log", when="midnight", backupCount=14, encoding="utf-8")
        fh.setFormatter(fmt); root.addHandler(fh)
    if not any(isinstance(h, logging.StreamHandler) and not isinstance(h, TimedRotatingFileHandler) for h in root.handlers):
        sh = logging.StreamHandler(); sh.setFormatter(fmt); root.addHandler(sh)
    for noisy in ("httpx", "rasterio", "matplotlib", "PIL"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def ensure_data() -> None:
    cube = get_cube()
    if cube.available_years():
        return
    if not settings.auto_prepare_data:
        raise RuntimeError(f"No satellite composites in {settings.imagery_dir}. Run scripts/prepare_data.py")
    log.warning("no composites found in %s — building calibrated demonstration GeoTIFFs", settings.imagery_dir)
    from scripts.prepare_data import prepare_demo
    prepare_demo(settings.imagery_dir)
    reset_cube()


def seed_database() -> None:
    cube = get_cube()
    with session_scope() as db:
        zr = ZoneRepository(db)
        zr.upsert_zones(cube.zones)
        sr = SatelliteDataRepository(db)
        for y in cube.available_years():
            rows = []
            for z in cube.zones:
                zid = z["properties"]["zone_id"]
                st = calc.zone_stats(cube, zid, y)
                if st is None:
                    continue
                zr.set_area(zid, st["area_km2"])
                zr.upsert_stat(zid, y, **{k: st[k] for k in ("lst_mean", "lst_min", "lst_max", "lst_std", "ndvi_mean", "ndvi_class", "ndbi_mean", "ndbi_class", "hot_fraction", "cloud_cover", "valid_pixels", "data_quality")})
            for r in ana.zone_rankings(cube, y):
                rows.append({"zone_id": r["zoneId"], "temperature": r["temperature"], "peak_temperature": r["peakTemperature"], "persistence": int(round(r["persistenceYears"])),
                             "persistence_fraction": r["persistence"], "priority": r["priority"], "rank": r["rank"], "area_km2": r["areaKm2"]})
            db.commit()
            sr.replace_hotspots(y, rows)


def ensure_model() -> None:
    cube = get_cube()
    m = ml_models.get_model(cube, allow_train=settings.auto_train_model)
    if m is None:
        log.warning("ML model unavailable; scenario endpoints will return linear estimates only")
        return
    with session_scope() as db:
        SatelliteDataRepository(db).register_model(id=f"lst-{m.metadata.get('backend')}-{m.metadata.get('version')}", model_type="lst_surface_regressor", version=str(m.metadata.get("version")),
                                                   accuracy=float(m.metadata.get("accuracy", 0)), r_squared=m.r2, model_path=str(settings.models_dir / ml_models.MODEL_FILE), metadata_json=m.metadata)


def warm_cache() -> None:
    cube = get_cube()
    calc.trends(cube)
    for y in (C.LATEST_YEAR, C.BASE_YEAR):
        calc.correlation(cube, y, "ndvi"); calc.correlation(cube, y, "ndbi"); calc.pixel_regression(cube, y)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    t0 = time.time()
    init_db()
    ensure_data()
    seed_database()
    ensure_model()
    warm_cache()
    cube = get_cube()
    log.info("startup complete in %.1fs — years %s, grid %s, source %s", time.time() - t0, cube.available_years(), cube.shape, cube.summary()["meta"]["source"])
    yield


app = FastAPI(title=settings.app_name, version=__version__, lifespan=lifespan,
              description="REST API for the Nagpur Urban Heat Island Analysis Platform: satellite composites, indices, hotspots, trends, scenarios, insights and reports.")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False, allow_methods=["*"], allow_headers=["*"])
app.include_router(api_router)


@app.middleware("http")
async def access_log(request: Request, call_next):
    t0 = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        log.exception("unhandled error %s %s", request.method, request.url.path)
        return fail("Internal server error", 500)
    ms = (time.perf_counter() - t0) * 1000
    logging.getLogger("uhi.access").info("%s %s %s %.1fms", request.method, request.url.path, response.status_code, ms)
    response.headers["X-Response-Time-ms"] = f"{ms:.1f}"
    return response


@app.exception_handler(ApiError)
async def api_error_handler(_: Request, exc: ApiError):
    return fail(exc.message, exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    msg = first.get("msg", "Invalid request")
    msg = msg.replace("Value error, ", "")
    loc = ".".join(str(p) for p in first.get("loc", []) if p not in ("body", "query"))
    return fail(f"{msg}" + (f" ({loc})" if loc and "must be" not in msg else ""), 400)


@app.exception_handler(Exception)
async def generic_handler(request: Request, exc: Exception):
    log.exception("error on %s: %s", request.url.path, exc)
    return fail(str(exc) if settings.debug else "Internal server error", 500)


@app.get("/", include_in_schema=False)
def root():
    return {"service": settings.app_name, "version": __version__, "docs": "/docs", "health": "/api/health"}
