from fastapi import APIRouter

from app.api.v1.endpoints import analysis, data, health, hotspots, insights, overview, reports, scenario, zones

api_router = APIRouter(prefix="/api")
for r in (health.router, overview.router, data.router, data.cube_router, hotspots.router, zones.router, analysis.router, scenario.router, insights.router, reports.router):
    api_router.include_router(r)
