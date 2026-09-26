"""Shared endpoint dependencies."""
from __future__ import annotations

from fastapi import Query

from app.services.satellite_data_service import SatelliteCube, get_cube
from app.utils import constants as C
from app.utils.response_utils import ApiError, NotFound


def year_param(year: int = Query(C.LATEST_YEAR, description="Season year 2019–2024")) -> int:
    if year not in C.YEARS:
        raise ApiError(f"Year must be between {C.YEARS[0]} and {C.YEARS[-1]}", 400)
    return year


def cube_dep() -> SatelliteCube:
    return get_cube()


def require_zone(cube: SatelliteCube, zone_id: str) -> dict:
    pos = cube.zone_position(zone_id)
    if pos is None:
        raise NotFound(f"Zone '{zone_id}' not found")
    return cube.zones[pos]
