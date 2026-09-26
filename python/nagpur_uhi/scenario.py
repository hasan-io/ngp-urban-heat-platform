"""Component 4 — Scenario modelling & what-if tool.

The model re-uses the historical relationship fitted in Component 2

    LST = a + b1·NDVI + b2·NDBI

and translates planner-friendly levers (percentage points of vegetation / built-up
cover, or a number of buildings) into index deltas:

    ΔNDVI = 0.72 · Δveg_fraction      ΔNDBI = 0.75 · Δbuilt_fraction
    ΔLST  = b1·ΔNDVI + b2·ΔNDBI

Examples
    >>> model = ScenarioModel.from_cube(cube, zone_idx)
    >>> r = model.run("besa", veg_delta_pct=+20)                 # +20 % canopy
    >>> r = model.run("cbd", built_delta_pct=0, buildings=+5)    # 5 new blocks
    >>> r = model.run("wathoda", veg_delta_pct=15, built_delta_pct=-10, baseline_year=2030)
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Dict, List, Optional

import numpy as np

from . import config as C
from .cube import Cube
from .indices import LSTModel, fit_lst_model
from .temporal import zone_trends


def fractional_vegetation_cover(ndvi_arr: np.ndarray) -> np.ndarray:
    """Vegetation cover fraction — inverse of the composite calibration NDVI = bare + 0.72·V.

    (The Carlson–Ripley Pv in indices.py is kept for emissivity; it saturates below
    NDVI 0.2 and would hide vegetation loss in already-sparse zones.)
    """
    return np.clip((ndvi_arr - C.NDVI_BARE_SOIL) / C.NDVI_PER_VEG_FRACTION, 0.0, 1.0).astype(np.float32)


def fractional_built(ndbi_arr: np.ndarray, lo: float = -0.32, hi: float = 0.43) -> np.ndarray:
    """Impervious fraction — inverse of the composite calibration NDBI = −0.32 + 0.75·B."""
    return np.clip((ndbi_arr - lo) / (hi - lo), 0.0, 1.0).astype(np.float32)


@dataclass
class ScenarioResult:
    zone_id: str
    zone_name: str
    baseline_year: int
    veg_delta_pct: float
    built_delta_pct: float
    buildings_equivalent: int
    before: Dict[str, float]
    after: Dict[str, float]
    d_lst: float
    d_lst_from_vegetation: float
    d_lst_from_built: float
    uncertainty_c: float
    city_mean_effect: float
    offset_of_historic_warming_pct: float
    residents: int
    trees_needed: int
    cover_warning: bool
    lst_raster: Optional[np.ndarray] = field(default=None, repr=False)
    baseline_raster: Optional[np.ndarray] = field(default=None, repr=False)

    def to_dict(self) -> dict:
        d = asdict(self)
        d.pop("lst_raster", None)
        d.pop("baseline_raster", None)
        return d


class ScenarioModel:
    def __init__(self, cube: Cube, zone_idx: np.ndarray, model: LSTModel, zone_slopes: List[dict], zonal_rows: List[dict]):
        self.cube = cube
        self.zone_idx = zone_idx
        self.model = model
        self.zone_slopes = zone_slopes
        self.rows = {r["id"]: r for r in zonal_rows}
        self.ref_year = cube.years[-1]

    @classmethod
    def from_cube(cls, cube: Cube, zone_idx: np.ndarray, zonal_rows: Optional[List[dict]] = None) -> "ScenarioModel":
        from .zones import zonal_stats

        model = fit_lst_model(cube, cube.years[-1])
        slopes = zone_trends(cube, zone_idx, len(C.ZONES))
        rows = zonal_rows if zonal_rows is not None else zonal_stats(cube, zone_idx)
        return cls(cube, zone_idx, model, slopes, rows)

    # ------------------------------------------------------------------ baselines
    def baseline(self, year: int):
        """Observed rasters for the reference year, or a business-as-usual projection
        obtained by extending each zone's own 2019–24 trend (outside zones: city trend)."""
        cube, ref = self.cube, self.ref_year
        lst, ndvi, ndbi = (cube.lst[ref].copy(), cube.ndvi[ref].copy(), cube.ndbi[ref].copy())
        dt = year - ref
        if dt == 0:
            return lst, ndvi, ndbi
        from .temporal import trend_report

        city = trend_report(cube)
        s_l = np.full(cube.shape, city["lst"]["slope_per_year"], dtype=np.float32)
        s_v = np.full(cube.shape, city["ndvi"]["slope_per_year"], dtype=np.float32)
        s_b = np.full(cube.shape, city["ndbi"]["slope_per_year"], dtype=np.float32)
        for row in self.zone_slopes:
            if row["lst"] is None:
                continue
            m = self.zone_idx == row["zone"]
            s_l[m], s_v[m], s_b[m] = row["lst"], row["ndvi"], row["ndbi"]
        s_l[cube.water], s_v[cube.water], s_b[cube.water] = 0.12, 0.0, 0.0
        return lst + s_l * dt, ndvi + s_v * dt, ndbi + s_b * dt

    # ------------------------------------------------------------------ run
    def run(self, zone_id: str, veg_delta_pct: float = 0.0, built_delta_pct: float = 0.0, buildings: int = 0,
            baseline_year: Optional[int] = None) -> ScenarioResult:
        cube, mdl = self.cube, self.model
        year = baseline_year or self.ref_year
        zi = next(i for i, z in enumerate(C.ZONES) if z["id"] == zone_id)
        zone = C.ZONES[zi]
        m = (self.zone_idx == zi) & cube.land
        area_km2 = float(m.sum() * cube.pixel_area_km2)

        # buildings → extra built-up percentage points
        if buildings:
            built_delta_pct += buildings * C.BUILDING_FOOTPRINT_KM2 / area_km2 * 100.0
        buildings_eq = int(round(built_delta_pct / 100.0 * area_km2 / C.BUILDING_FOOTPRINT_KM2))

        lst0, ndvi0, ndbi0 = self.baseline(year)
        veg0 = fractional_vegetation_cover(ndvi0)
        built0 = fractional_built(ndbi0)
        veg1 = np.clip(veg0 + veg_delta_pct / 100.0, 0.0, 0.95)
        built1 = np.clip(built0 + built_delta_pct / 100.0, 0.0, 1.0)
        cover_warning = bool(((veg1 + built1)[m] > 1.05).any())

        d_ndvi = np.where(m, C.NDVI_PER_VEG_FRACTION * (veg1 - veg0), 0.0).astype(np.float32)
        d_ndbi = np.where(m, C.NDBI_PER_BUILT_FRACTION * (built1 - built0), 0.0).astype(np.float32)
        d_lst_v = mdl.b_ndvi * d_ndvi
        d_lst_b = mdl.b_ndbi * d_ndbi
        lst1 = lst0 + d_lst_v + d_lst_b

        before = {"lst": float(np.nanmean(lst0[m])), "ndvi": float(np.nanmean(ndvi0[m])), "ndbi": float(np.nanmean(ndbi0[m])),
                  "veg_cover": float(veg0[m].mean()), "built_cover": float(built0[m].mean())}
        after = {"lst": float(np.nanmean(lst1[m])), "ndvi": float(np.nanmean((ndvi0 + d_ndvi)[m])), "ndbi": float(np.nanmean((ndbi0 + d_ndbi)[m])),
                 "veg_cover": float(veg1[m].mean()), "built_cover": float(built1[m].mean())}
        d_lst = after["lst"] - before["lst"]
        hist = self.rows.get(zone_id, {}).get("d_lst", 0.0) or 0.0
        n_land = int(cube.land.sum())
        return ScenarioResult(
            zone_id=zone_id, zone_name=zone["name"], baseline_year=year,
            veg_delta_pct=veg_delta_pct, built_delta_pct=built_delta_pct, buildings_equivalent=buildings_eq,
            before=before, after=after, d_lst=d_lst,
            d_lst_from_vegetation=float(np.nanmean(d_lst_v[m])), d_lst_from_built=float(np.nanmean(d_lst_b[m])),
            uncertainty_c=abs(d_lst) * 0.18 + mdl.rmse * 0.12,
            city_mean_effect=d_lst * m.sum() / n_land,
            offset_of_historic_warming_pct=(-d_lst / hist * 100.0) if hist else float("nan"),
            residents=zone["population"],
            trees_needed=int(round(veg_delta_pct / 100.0 * area_km2 * 1e6 / 25.0)) if veg_delta_pct > 0 else 0,  # ~25 m² canopy / tree
            cover_warning=cover_warning, lst_raster=lst1.astype(np.float32), baseline_raster=lst0.astype(np.float32),
        )

    def sensitivity(self, zone_id: str, built_delta_pct: float = 0.0, veg_range=range(-30, 51, 5), baseline_year: Optional[int] = None) -> List[dict]:
        """ΔLST as vegetation varies — the curve behind the slider."""
        return [{"veg_delta_pct": v,
                 "d_lst_combined": self.run(zone_id, v, built_delta_pct, baseline_year=baseline_year).d_lst,
                 "d_lst_veg_only": self.run(zone_id, v, 0.0, baseline_year=baseline_year).d_lst}
                for v in veg_range]

    def presets(self, zone_id: str, baseline_year: Optional[int] = None) -> Dict[str, ScenarioResult]:
        table = {
            "miyawaki_drive": (20, 0), "urban_forest_depave": (30, -10), "cool_corridor": (15, -5),
            "new_township": (-15, 25), "redevelopment": (5, 15),
        }
        return {k: self.run(zone_id, v, b, baseline_year=baseline_year) for k, (v, b) in table.items()}
