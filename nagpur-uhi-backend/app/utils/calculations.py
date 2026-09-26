"""Remote-sensing formulas: NDVI, NDBI and the Landsat land-surface-temperature chain.

All functions are pure numpy so they can be unit-tested and reused by the data-preparation
script (raw Landsat bands → analysis-ready GeoTIFFs) and by the API services.
"""
from __future__ import annotations

import numpy as np

from app.utils import constants as C

_EPS = 1e-6


# ---------------------------------------------------------------- spectral indices
def normalized_difference(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a = a.astype(np.float32); b = b.astype(np.float32)
    with np.errstate(divide="ignore", invalid="ignore"):
        nd = (a - b) / (a + b + _EPS)
    return np.clip(nd, -1.0, 1.0)


def ndvi(nir: np.ndarray, red: np.ndarray) -> np.ndarray:
    """NDVI = (NIR − Red) / (NIR + Red). Landsat 8/9: B5, B4."""
    return normalized_difference(nir, red)


def ndbi(swir1: np.ndarray, nir: np.ndarray) -> np.ndarray:
    """NDBI = (SWIR1 − NIR) / (SWIR1 + NIR). Landsat 8/9: B6, B5. Positive → built-up."""
    return normalized_difference(swir1, nir)


def scale_surface_reflectance(dn: np.ndarray) -> np.ndarray:
    """Collection-2 Level-2 digital numbers → reflectance 0–1."""
    return np.clip(dn.astype(np.float32) * C.SR_SCALE + C.SR_OFFSET, 0.0, 1.0)


# ---------------------------------------------------------------- LST chain (Level-1 thermal)
def dn_to_radiance(dn: np.ndarray, ML: float = C.L8_B10["ML"], AL: float = C.L8_B10["AL"]) -> np.ndarray:
    """Step 1 — TOA spectral radiance Lλ = ML·Qcal + AL  (W m⁻² sr⁻¹ µm⁻¹)."""
    return dn.astype(np.float32) * ML + AL


def radiance_to_brightness_temperature(radiance: np.ndarray, K1: float = C.L8_B10["K1"], K2: float = C.L8_B10["K2"]) -> np.ndarray:
    """Step 2 — at-sensor brightness temperature BT = K2 / ln(K1/Lλ + 1)  (Kelvin)."""
    with np.errstate(divide="ignore", invalid="ignore"):
        return (K2 / np.log(K1 / radiance + 1.0)).astype(np.float32)


def fractional_vegetation(ndvi_arr: np.ndarray, ndvi_soil: float = 0.2, ndvi_veg: float = 0.5) -> np.ndarray:
    """Step 3 — Pv = ((NDVI − NDVIs)/(NDVIv − NDVIs))² (Carlson & Ripley 1997)."""
    pv = ((ndvi_arr - ndvi_soil) / (ndvi_veg - ndvi_soil)) ** 2
    return np.clip(pv, 0.0, 1.0).astype(np.float32)


def land_surface_emissivity(ndvi_arr: np.ndarray, e_soil: float = 0.966, e_veg: float = 0.986, c_rough: float = 0.005) -> np.ndarray:
    """Step 4 — NDVI-threshold emissivity (Sobrino et al. 2004): ε = εv·Pv + εs·(1 − Pv) + C."""
    pv = fractional_vegetation(ndvi_arr)
    eps = e_veg * pv + e_soil * (1.0 - pv) + c_rough
    eps = np.where(ndvi_arr < 0.0, 0.991, eps)   # water
    eps = np.where(ndvi_arr > 0.5, 0.990, eps)   # full canopy
    return eps.astype(np.float32)


def brightness_to_lst_celsius(bt_kelvin: np.ndarray, emissivity: np.ndarray, wavelength_um: float = C.L8_B10["wavelength_um"]) -> np.ndarray:
    """Steps 5–6 — LST = BT / (1 + (λ·BT/ρ)·ln ε) − 273.15, ρ = h·c/σ = 1.438×10⁻² m·K."""
    rho = 1.438e-2
    lam = wavelength_um * 1e-6
    with np.errstate(divide="ignore", invalid="ignore"):
        lst_k = bt_kelvin / (1.0 + (lam * bt_kelvin / rho) * np.log(emissivity))
    return (lst_k - 273.15).astype(np.float32)


def lst_from_level1(b10_dn: np.ndarray, red: np.ndarray, nir: np.ndarray) -> np.ndarray:
    """Full chain DN → radiance → BT → NDVI → emissivity → LST (°C)."""
    bt = radiance_to_brightness_temperature(dn_to_radiance(b10_dn))
    eps = land_surface_emissivity(ndvi(nir, red))
    return brightness_to_lst_celsius(bt, eps)


def lst_from_collection2(st_b10_dn: np.ndarray) -> np.ndarray:
    """Collection-2 Level-2 ST_B10 (already emissivity/atmosphere corrected) → °C."""
    k = st_b10_dn.astype(np.float32) * C.ST_SCALE + C.ST_OFFSET
    k = np.where(st_b10_dn <= 0, np.nan, k)
    return (k - 273.15).astype(np.float32)


# ---------------------------------------------------------------- QA masks
def landsat_clear_mask(qa_pixel: np.ndarray) -> np.ndarray:
    """True where QA_PIXEL has none of: fill, dilated cloud, cirrus, cloud, shadow, snow (bits 0–5)."""
    bad = sum(1 << b for b in range(6))
    return (qa_pixel.astype(np.uint32) & bad) == 0


def landsat_water_mask(qa_pixel: np.ndarray) -> np.ndarray:
    return (qa_pixel.astype(np.uint32) & (1 << 7)) != 0


# ---------------------------------------------------------------- classification & statistics
def classify(value: float, classes) -> str:
    for label, lo, hi in classes:
        if lo <= value < hi:
            return label
    return classes[-1][0]


def cover_fractions(ndvi_arr: np.ndarray, ndbi_arr: np.ndarray):
    """Vegetation / impervious cover fractions — inverse of the composite calibration."""
    veg = np.clip((ndvi_arr - C.NDVI_BARE_SOIL) / C.NDVI_PER_VEG_FRACTION, 0, 1)
    built = np.clip((ndbi_arr - C.NDBI_BARE_MIN) / (C.NDBI_BUILT_MAX - C.NDBI_BARE_MIN), 0, 1)
    return veg.astype(np.float32), built.astype(np.float32)


def linear_fit(x, y):
    """OLS slope/intercept/R² for 1-D series."""
    x = np.asarray(x, dtype=np.float64); y = np.asarray(y, dtype=np.float64)
    slope, intercept = np.polyfit(x, y, 1)
    pred = intercept + slope * x
    ss_res = float(((y - pred) ** 2).sum()); ss_tot = float(((y - y.mean()) ** 2).sum())
    return float(slope), float(intercept), (1.0 - ss_res / ss_tot) if ss_tot else 0.0


def multiple_regression(y: np.ndarray, *xs: np.ndarray):
    """OLS y = a + Σ bᵢ·xᵢ. Returns coefficients [a, b1, …], R², RMSE."""
    X = np.column_stack([np.ones_like(y)] + [x.astype(np.float64) for x in xs])
    beta, *_ = np.linalg.lstsq(X, y.astype(np.float64), rcond=None)
    pred = X @ beta
    ss_res = float(((y - pred) ** 2).sum()); ss_tot = float(((y - y.mean()) ** 2).sum())
    return beta, 1.0 - ss_res / ss_tot, float(np.sqrt(ss_res / len(y)))
