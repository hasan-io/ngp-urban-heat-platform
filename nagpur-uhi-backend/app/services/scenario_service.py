"""What-if engine: combined linear + ML prediction, sensitivity curve and before/after rasters."""
from __future__ import annotations

import numpy as np

from app.ml.predictions import apply_intervention
from app.services import calculation_service as calc
from app.services import prediction_service as pred
from app.services.cache_service import analysis_cache
from app.services.satellite_data_service import SatelliteCube
from app.utils import constants as C
from app.utils.raster_utils import colorize, to_png_base64
from app.utils.response_utils import NotFound


def _zone(cube: SatelliteCube, zone_id: str) -> dict:
    pos = cube.zone_position(zone_id)
    if pos is None:
        raise NotFound(f"Zone '{zone_id}' not found")
    return cube.zones[pos]["properties"]


def _confidence(lin: dict, ml: dict | None) -> str:
    score = lin["confidence_score"]
    if ml and not ml["in_observed_range"]:
        score -= 0.15
    if lin["uncertainty"] > 0.8:
        score -= 0.15
    return "High" if score >= 0.8 else "Medium" if score >= 0.6 else "Indicative"


def _explanation(zone: dict, lin: dict, ml: dict | None, veg: float, built: float, baseline: str) -> str:
    parts = []
    if veg:
        parts.append(f"{'adding' if veg > 0 else 'removing'} {abs(veg):.0f} percentage points of vegetation cover ({lin['effect_vegetation']:+.2f} °C)")
    if built:
        parts.append(f"{'adding' if built > 0 else 'removing'} {abs(built):.0f} percentage points of impervious cover ({lin['effect_built_up']:+.2f} °C)")
    if not parts:
        return f"No intervention selected — {zone['name']} stays at its {baseline} baseline of {lin['baseline']['lst']:.1f} °C."
    txt = (f"In {zone['name']}, {' and '.join(parts)} gives a linear estimate of {lin['delta_lst']:+.2f} °C "
           f"(coefficients learned from the {lin['coefficients']['year']} pixel regression, R² {lin['coefficients']['r2']:.2f}).")
    if ml:
        txt += (f" The non-linear model ({ml['backend']}, held-out R² {ml['model_r2']:.2f}) estimates {ml['delta_lst']:+.2f} °C"
                + ("." if ml["in_observed_range"] else "; part of the intervention lies outside the observed feature range, so the linear estimate is preferred."))
    if baseline == "2030":
        txt += " The 2030 baseline extends the zone's 2019–2024 trend (business-as-usual)."
    return txt


def predict(cube: SatelliteCube, zone_id: str, baseline: str, veg: float, built: float, method: str = "both") -> dict:
    zone = _zone(cube, zone_id)
    lin = pred.predict_linear(cube, zone_id, baseline, veg, built)
    ml = pred.predict_ml(cube, zone_id, veg, built) if method in ("ml", "both") else None
    primary = ml if (method == "ml" and ml) else lin
    delta = primary["delta_lst"]
    confidence = _confidence(lin, ml)
    base = lin["baseline"]
    zs = calc.zone_stats(cube, zone_id, cube.available_years()[-1])
    return {
        # --- fields consumed by the frontend Scenario Lab
        "zoneId": zone_id, "zoneName": zone["name"], "baseline": baseline, "baselineYear": base["year"],
        "deltaLst": float(delta), "confidence": confidence, "uncertainty": float(lin["uncertainty"]),
        "before": {"lst": base["lst"], "ndvi": base["ndvi"], "ndbi": base["ndbi"]},
        "after": {"lst": base["lst"] + delta, "ndvi": lin["after"]["ndvi"], "ndbi": lin["after"]["ndbi"]},
        "explanation": _explanation(zone, lin, ml, veg, built, baseline), "layer": "scenario",
        # --- detail (brief)
        "method": primary["method"], "predictedTemperature": float(base["lst"] + delta),
        "effects": {"vegetation": lin["effect_vegetation"], "builtUp": lin["effect_built_up"], "total": lin["delta_lst"]},
        "linear": {"deltaLst": lin["delta_lst"], "confidenceScore": lin["confidence_score"], "coefficients": lin["coefficients"]},
        "mlEstimate": ({"deltaLst": ml["delta_lst"], "modelR2": ml["model_r2"], "backend": ml["backend"], "inObservedRange": ml["in_observed_range"], "evaluatedOnYear": ml["evaluated_on_year"]} if ml else None),
        "intervention": {"vegetationChange": veg, "builtUpChange": built, "vegetationCoverBefore": None if zs is None else None},
        "residents": int(zone.get("population", 0)),
        "cityMeanEffect": float(delta * cube.zone_mask(zone_id).sum() / max(1, cube.land.sum())),
    }


def sensitivity_curve(cube: SatelliteCube, zone_id: str, baseline: str, built: float = 0.0) -> dict:
    _zone(cube, zone_id)
    key = f"sensitivity_{zone_id}_{baseline}_{built}"
    def _calc():
        base = pred.zone_baseline(cube, zone_id, baseline)
        points = []
        for v in range(int(C.VEG_RANGE[0]), int(C.VEG_RANGE[1]) + 1, 5):
            lin = pred.predict_linear(cube, zone_id, baseline, v, built)
            veg_only = pred.predict_linear(cube, zone_id, baseline, v, 0.0)
            ml = pred.predict_ml(cube, zone_id, v, built) if v % 10 == 0 else None
            points.append({"vegetationChange": v, "vegetation_change": v, "predictedTemperature": lin["predicted_temperature"], "predicted_temperature": lin["predicted_temperature"],
                           "deltaLst": lin["delta_lst"], "delta_lst": lin["delta_lst"], "linear": lin["delta_lst"], "vegetationOnly": veg_only["delta_lst"],
                           "ml": None if ml is None else ml["delta_lst"], "mlPredictedTemperature": None if ml is None else base["lst"] + ml["delta_lst"]})
        return {"zoneId": zone_id, "baseline": baseline, "builtUpChange": built, "baselineTemperature": base["lst"], "points": points,
                "coefficients": pred.linear_coefficients(cube)}
    return analysis_cache.get_or_set(key, _calc)


def rasters(cube: SatelliteCube, zone_id: str, veg: float, built: float, baseline: str = "2024") -> dict:
    zone = _zone(cube, zone_id)
    year = cube.available_years()[-1]
    lin = pred.predict_linear(cube, zone_id, baseline, veg, built)
    coef = lin["coefficients"]
    zm = cube.zone_mask(zone_id)
    before = cube.lst(year).copy()
    if baseline == "2030":
        tr = calc.zone_series(cube, zone_id)["trend"]["lst"]["slope"]
        before[zm] += tr * (C.PROJECTION_YEAR - year)
    ndvi, ndbi = apply_intervention(cube, year, zm, veg, built)
    after = before.copy()
    after[zm] += coef["b_ndvi"] * (ndvi[zm] - cube.ndvi(year)[zm]) + coef["b_ndbi"] * (ndbi[zm] - cube.ndbi(year)[zm])
    delta = after - before
    dim = np.where(zm, 1.0, 0.45)
    def png(arr, ramp, water=True, vmin=None, vmax=None):
        rgba = colorize(arr, ramp, cube.water if water else None, vmin, vmax)
        rgba[..., 3] = (rgba[..., 3] * dim).astype(np.uint8)
        return to_png_base64(rgba)
    return {"zoneId": zone_id, "zoneName": zone["name"], "baseline": baseline, "bounds": list(cube.bounds), "shape": list(cube.shape),
            "before": {"image": png(before, "lst"), "zoneMeanLst": float(before[zm].mean())},
            "after": {"image": png(after, "lst"), "zoneMeanLst": float(after[zm].mean())},
            "delta": {"image": png(delta, "dlst", water=False), "zoneMeanDelta": float(delta[zm].mean()), "min": float(delta.min()), "max": float(delta.max())},
            "legend": {"lst": {"min": 30, "max": 47, "unit": "°C"}, "delta": {"min": -4, "max": 4, "unit": "°C"}}, "format": "image/png;base64"}
