"""Request / response schemas. Field names follow the finalized frontend (camelCase, see
frontend `src/api/types.ts`); snake_case aliases from the original backend brief are accepted."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.utils import constants as C


class ScenarioRequest(BaseModel):
    """Accepts both {zoneId, baseline, vegetationChange, builtUpChange} (frontend)
    and {zone_id, baseline_year, vegetation_change, built_up_change, method} (brief)."""
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    zone_id: str = Field(alias="zoneId")
    baseline: Literal["2024", "2030"] = "2024"
    vegetation_change: float = Field(0.0, alias="vegetationChange")
    built_up_change: float = Field(0.0, alias="builtUpChange")
    method: Literal["linear", "ml", "both"] = "both"

    @model_validator(mode="before")
    @classmethod
    def _aliases(cls, v: Any):
        if isinstance(v, dict):
            v = dict(v)
            if "baseline_year" in v and "baseline" not in v:
                v["baseline"] = str(v.pop("baseline_year"))
            if "baseline" in v:
                v["baseline"] = str(v["baseline"])
        return v

    @field_validator("vegetation_change")
    @classmethod
    def _veg(cls, v: float):
        lo, hi = C.VEG_RANGE
        if not lo <= v <= hi:
            raise ValueError(f"Vegetation change must be between {lo:.0f} and {hi:.0f}")
        return v

    @field_validator("built_up_change")
    @classmethod
    def _built(cls, v: float):
        lo, hi = C.BUILT_RANGE
        if not lo <= v <= hi:
            raise ValueError(f"Built-up change must be between {lo:.0f} and {hi:.0f}")
        return v


class ReportRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    year: int = C.LATEST_YEAR
    report_type: Literal["full", "executive", "technical"] = Field("full", alias="reportType")
    include_sections: Optional[list[str]] = Field(None, alias="includeSections")
    format: Literal["json"] = "json"

    @field_validator("year")
    @classmethod
    def _year(cls, v: int):
        if v not in C.YEARS:
            raise ValueError(f"Year must be between {C.YEARS[0]} and {C.YEARS[-1]}")
        return v


class Envelope(BaseModel):
    success: bool
    data: Any
    error: Optional[str]
    timestamp: str
