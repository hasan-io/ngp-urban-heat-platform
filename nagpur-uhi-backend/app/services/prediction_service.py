"""Linear and ML predictors used by the scenario engine.

Linear coefficients are *learned from the data*: the pixel regression LST = a + b₁·NDVI + b₂·NDBI
(calculation_service.pixel_regression) is converted to °C per percentage point of cover with the
composite calibration (0.72 NDVI / unit vegetation fraction, 0.75 NDBI / unit impervious fraction).
For Nagpur this yields ≈ −0.06 °C per +1 % vegetation and ≈ +0.09 °C per +1 % built-up.
"""
from __future__ import annotations

import numpy as np

from app.ml import models as ml_models
from app.ml.predictions import apply_intervention, feature_stack
from app.services import calculation_service as calc
from app.services.satellite_data_service import SatelliteCube
from app.utils import constants as C


def linear_coefficients(cube: SatelliteCube, year: int = C.LATEST_YEAR) -> dict:
    reg = calc.pixel_regression(cube, year)
    veg = reg["b_ndvi"] * C.NDVI_PER_VEG_FRACTION / 100.0
    built = reg["b_ndbi"] * C.NDBI_PER_BUILT_FRACTION / 100.0
    if not np.isfinite(veg) or not np.isfinite(built):
        veg, built = C.DEFAULT_VEG_COEFF, C.DEFAULT_BUILT_COEFF
    return {"vegetation_coeff": float(veg), "built_up_coeff": float(built), "r2": reg["r2"], "rmse": reg["rmse"],
            "b_ndvi": reg["b_ndvi"], "b_ndbi": reg["b_ndbi"], "intercept": reg["intercept"], "n": reg["n"], "year": year}


def zone_baseline(cube: SatelliteCube, zone_id: str, baseline: str) -> dict:
    """Observed latest-season means, or 2030 business-as-usual by extending the zone's own trend."""
    latest = cube.available_years()[-1]
    st = calc.zone_stats(cube, zone_id, latest)
    if baseline == "2024" or st is None:
        return {"year": latest, "lst": st["lst_mean"], "ndvi": st["ndvi_mean"], "ndbi": st["ndbi_mean"], "projected": False}
    s = calc.zone_series(cube, zone_id)
    dt = C.PROJECTION_YEAR - latest
    return {"year": C.PROJECTION_YEAR, "lst": st["lst_mean"] + s["trend"]["lst"]["slope"] * dt,
            "ndvi": st["ndvi_mean"] + s["trend"]["ndvi"]["slope"] * dt, "ndbi": st["ndbi_mean"] + s["trend"]["ndbi"]["slope"] * dt, "projected": True}


def predict_linear(cube: SatelliteCube, zone_id: str, baseline: str, veg_pct: float, built_pct: float) -> dict:
    coef = linear_coefficients(cube)
    base = zone_baseline(cube, zone_id, baseline)
    d_veg = coef["vegetation_coeff"] * veg_pct
    d_built = coef["built_up_coeff"] * built_pct
    delta = d_veg + d_built
    uncertainty = abs(delta) * 0.18 + coef["rmse"] * 0.12
    return {"method": "linear", "delta_lst": float(delta), "effect_vegetation": float(d_veg), "effect_built_up": float(d_built),
            "predicted_temperature": float(base["lst"] + delta), "baseline": base, "uncertainty": float(uncertainty),
            "confidence_score": float(coef["r2"]), "coefficients": coef,
            "after": {"lst": base["lst"] + delta, "ndvi": base["ndvi"] + C.NDVI_PER_VEG_FRACTION * veg_pct / 100, "ndbi": base["ndbi"] + C.NDBI_PER_BUILT_FRACTION * built_pct / 100}}


def predict_ml(cube: SatelliteCube, zone_id: str, veg_pct: float, built_pct: float, year: int = C.LATEST_YEAR) -> dict | None:
    model = ml_models.get_model(cube, allow_train=False)
    if model is None:
        return None
    zm = cube.zone_mask(zone_id) & cube.valid_mask(year)
    if not zm.any():
        return None
    F0 = feature_stack(cube, year)
    ndvi, ndbi = apply_intervention(cube, year, zm, veg_pct, built_pct)
    F1 = feature_stack(cube, year, ndvi=ndvi, ndbi=ndbi)
    sel = zm.ravel()
    p0 = model.predict(F0.reshape(-1, F0.shape[-1])[sel]); p1 = model.predict(F1.reshape(-1, F1.shape[-1])[sel])
    # in-range check: trees do not extrapolate beyond observed feature space
    v = cube.valid_mask(year)
    lo_v, hi_v = float(cube.ndvi(year)[v].min()), float(cube.ndvi(year)[v].max())
    lo_b, hi_b = float(cube.ndbi(year)[v].min()), float(cube.ndbi(year)[v].max())
    in_range = bool((ndvi[zm].min() >= lo_v - 0.02) and (ndvi[zm].max() <= hi_v + 0.02) and (ndbi[zm].min() >= lo_b - 0.02) and (ndbi[zm].max() <= hi_b + 0.02))
    delta = float((p1 - p0).mean())
    return {"method": "ml", "backend": model.metadata.get("backend"), "delta_lst": delta, "predicted_temperature": float(p1.mean()),
            "baseline_prediction": float(p0.mean()), "model_r2": model.r2, "model_rmse": float(model.metadata.get("rmse", 0)),
            "in_observed_range": in_range, "evaluated_on_year": year}
