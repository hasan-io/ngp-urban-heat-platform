"""Component 2 — Geospatial analysis & index calculation.

    NDVI = (NIR − Red) / (NIR + Red)                 vegetation greenness
    NDBI = (SWIR1 − NIR) / (SWIR1 + NIR)             built-up / impervious surfaces
    LST  = surface temperature from the thermal band

Two LST routes are provided:
  * `lst_from_collection2` — Landsat Collection-2 Level-2 `ST_B10` already is an
    atmospherically- and emissivity-corrected surface temperature. Preferred.
  * `lst_single_channel`   — the classic Level-1 chain (DN → radiance → brightness
    temperature → emissivity correction with the NDVI-threshold method), kept for
    transparency and for sensors without a Level-2 product.

Also: city-wide statistics, LST/NDVI/NDBI cross-correlation and the OLS model
    LST = a + b1·NDVI + b2·NDBI
whose coefficients power the what-if tool (Component 4).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Dict, Optional

import numpy as np

from . import config as C
from .cube import Cube

_EPS = 1e-6


# ---------------------------------------------------------------------------- spectral indices


def normalized_difference(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a = a.astype(np.float32)
    b = b.astype(np.float32)
    with np.errstate(divide="ignore", invalid="ignore"):
        nd = (a - b) / (a + b + _EPS)
    return np.clip(nd, -1.0, 1.0)


def ndvi(nir: np.ndarray, red: np.ndarray) -> np.ndarray:
    return normalized_difference(nir, red)


def ndbi(swir1: np.ndarray, nir: np.ndarray) -> np.ndarray:
    return normalized_difference(swir1, nir)


def mndwi(green: np.ndarray, swir1: np.ndarray) -> np.ndarray:
    """Modified NDWI — positive over open water (used to build the water mask)."""
    return normalized_difference(green, swir1)


# ---------------------------------------------------------------------------- land surface temperature


def lst_from_collection2(st_b10_dn: np.ndarray) -> np.ndarray:
    """Landsat C2 L2 ST_B10 digital numbers → °C."""
    k = st_b10_dn.astype(np.float32) * C.ST_SCALE + C.ST_OFFSET
    k = np.where(st_b10_dn <= 0, np.nan, k)  # 0 = fill
    return (k - 273.15).astype(np.float32)


def toa_radiance(dn: np.ndarray, ML: float = C.L8_B10["ML"], AL: float = C.L8_B10["AL"]) -> np.ndarray:
    """Level-1 DN → top-of-atmosphere spectral radiance (W m⁻² sr⁻¹ µm⁻¹)."""
    return dn.astype(np.float32) * ML + AL


def brightness_temperature(radiance: np.ndarray, K1: float = C.L8_B10["K1"], K2: float = C.L8_B10["K2"]) -> np.ndarray:
    """Radiance → at-sensor brightness temperature (Kelvin) via inverse Planck."""
    with np.errstate(divide="ignore", invalid="ignore"):
        return (K2 / np.log(K1 / radiance + 1.0)).astype(np.float32)


def fractional_vegetation(ndvi_arr: np.ndarray, ndvi_soil: float = 0.2, ndvi_veg: float = 0.5) -> np.ndarray:
    """Pv = ((NDVI − NDVIs) / (NDVIv − NDVIs))² clipped to 0–1 (Carlson & Ripley 1997)."""
    pv = ((ndvi_arr - ndvi_soil) / (ndvi_veg - ndvi_soil)) ** 2
    return np.clip(pv, 0.0, 1.0).astype(np.float32)


def emissivity_from_ndvi(ndvi_arr: np.ndarray, e_soil: float = 0.966, e_veg: float = 0.986, c_rough: float = 0.005) -> np.ndarray:
    """NDVI-threshold emissivity (Sobrino et al. 2004) for the ~10.9 µm band."""
    pv = fractional_vegetation(ndvi_arr)
    eps = e_veg * pv + e_soil * (1.0 - pv) + c_rough  # cavity term for mixed pixels
    eps = np.where(ndvi_arr < 0.0, 0.991, eps)         # water
    eps = np.where(ndvi_arr > 0.5, 0.990, eps)         # fully vegetated
    return eps.astype(np.float32)


def lst_single_channel(bt_kelvin: np.ndarray, emissivity: np.ndarray, wavelength_um: float = C.L8_B10["wavelength_um"]) -> np.ndarray:
    """LST = BT / (1 + (λ·BT/ρ)·ln ε) − 273.15, ρ = h·c/σ = 1.438 × 10⁻² m·K."""
    rho = 1.438e-2
    lam = wavelength_um * 1e-6
    with np.errstate(divide="ignore", invalid="ignore"):
        lst_k = bt_kelvin / (1.0 + (lam * bt_kelvin / rho) * np.log(emissivity))
    return (lst_k - 273.15).astype(np.float32)


def lst_level1_chain(b10_dn: np.ndarray, ndvi_arr: np.ndarray) -> np.ndarray:
    """Convenience: DN → radiance → BT → emissivity-corrected LST (°C)."""
    return lst_single_channel(brightness_temperature(toa_radiance(b10_dn)), emissivity_from_ndvi(ndvi_arr))


# ---------------------------------------------------------------------------- statistics


@dataclass
class CityStats:
    year: int
    lst_mean: float
    lst_p90: float
    lst_max: float
    lst_min: float
    ndvi_mean: float
    ndbi_mean: float
    hot_area_km2: float        # LST > HOT_ABS_C
    green_area_km2: float      # NDVI > GREEN_NDVI
    built_area_km2: float      # NDBI > BUILT_NDBI
    class_area_km2: Dict[str, float]


def city_stats(cube: Cube, year: int) -> CityStats:
    lst, nd, nb = cube.lst[year], cube.ndvi[year], cube.ndbi[year]
    land = cube.land & np.isfinite(lst)
    px = cube.pixel_area_km2
    classes = {}
    for label, lo, hi in C.NDVI_CLASSES:
        classes[label] = float(np.nansum((nd >= lo) & (nd < hi)) * px)
    return CityStats(
        year=year,
        lst_mean=float(np.nanmean(lst)), lst_p90=float(np.nanpercentile(lst[land], C.HOT_PERCENTILE)),
        lst_max=float(np.nanmax(lst)), lst_min=float(np.nanmin(lst)),
        ndvi_mean=float(np.nanmean(nd)), ndbi_mean=float(np.nanmean(nb)),
        hot_area_km2=float(np.nansum(lst > C.HOT_ABS_C) * px),
        green_area_km2=float(np.nansum(nd > C.GREEN_NDVI) * px),
        built_area_km2=float(np.nansum(nb > C.BUILT_NDBI) * px),
        class_area_km2=classes,
    )


def correlation_matrix(cube: Cube, year: int) -> Dict[str, float]:
    """Pearson r between LST, NDVI and NDBI over land pixels. Answers: “jahan NDVI low, wahan LST high?”"""
    m = cube.land & np.isfinite(cube.lst[year]) & np.isfinite(cube.ndvi[year]) & np.isfinite(cube.ndbi[year])
    x = np.vstack([cube.lst[year][m], cube.ndvi[year][m], cube.ndbi[year][m]])
    r = np.corrcoef(x)
    return {"lst_ndvi": float(r[0, 1]), "lst_ndbi": float(r[0, 2]), "ndvi_ndbi": float(r[1, 2])}


@dataclass
class LSTModel:
    year: int
    intercept: float
    b_ndvi: float
    b_ndbi: float
    r2: float
    rmse: float
    n: int
    r_lst_ndvi: float
    r_lst_ndbi: float
    r_ndvi_ndbi: float

    def predict(self, ndvi_arr: np.ndarray, ndbi_arr: np.ndarray) -> np.ndarray:
        return self.intercept + self.b_ndvi * ndvi_arr + self.b_ndbi * ndbi_arr

    def to_dict(self) -> dict:
        return asdict(self)


def fit_lst_model(cube: Cube, year: int, sample: Optional[int] = None, seed: int = 0) -> LSTModel:
    """Ordinary least squares  LST = a + b1·NDVI + b2·NDBI  over land pixels."""
    m = cube.land & np.isfinite(cube.lst[year]) & np.isfinite(cube.ndvi[year]) & np.isfinite(cube.ndbi[year])
    y = cube.lst[year][m].astype(np.float64)
    x1 = cube.ndvi[year][m].astype(np.float64)
    x2 = cube.ndbi[year][m].astype(np.float64)
    if sample and len(y) > sample:
        idx = np.random.default_rng(seed).choice(len(y), sample, replace=False)
        y, x1, x2 = y[idx], x1[idx], x2[idx]
    X = np.column_stack([np.ones_like(y), x1, x2])
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    pred = X @ beta
    ss_res = float(((y - pred) ** 2).sum())
    ss_tot = float(((y - y.mean()) ** 2).sum())
    corr = correlation_matrix(cube, year)
    return LSTModel(year=year, intercept=float(beta[0]), b_ndvi=float(beta[1]), b_ndbi=float(beta[2]),
                    r2=1.0 - ss_res / ss_tot, rmse=float(np.sqrt(ss_res / len(y))), n=int(len(y)),
                    r_lst_ndvi=corr["lst_ndvi"], r_lst_ndbi=corr["lst_ndbi"], r_ndvi_ndbi=corr["ndvi_ndbi"])


def histogram(arr: np.ndarray, mask: np.ndarray, lo: float, hi: float, bins: int = 30):
    counts, edges = np.histogram(arr[mask & np.isfinite(arr)], bins=bins, range=(lo, hi))
    centres = (edges[:-1] + edges[1:]) / 2
    return [{"x": float(c), "count": int(n)} for c, n in zip(centres, counts)]
