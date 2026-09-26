"""Nagpur study-area constants shared by every service."""
from __future__ import annotations

YEARS: list[int] = [2019, 2020, 2021, 2022, 2023, 2024]
BASE_YEAR, LATEST_YEAR = YEARS[0], YEARS[-1]
PROJECTION_YEAR = 2030

# AOI (WGS 84): west, south, east, north — identical to the frontend BOUNDS.
AOI_BBOX = (78.94, 21.02, 79.22, 21.26)
CITY_CENTER = (21.1458, 79.0882)          # Zero Mile (lat, lon)
KM_PER_DEG_LAT = 111.0
KM_PER_DEG_LON = 104.0                    # at ~21° N
GRID_RES_M = 200                          # analysis grid (m); Landsat native 30 m is resampled to this
SEASON = ("03-01", "05-31")               # pre-monsoon composite window

# Landsat 8/9 constants
SR_SCALE, SR_OFFSET = 2.75e-05, -0.2                      # Collection-2 L2 surface reflectance
ST_SCALE, ST_OFFSET = 3.41802e-03, 149.0                  # Collection-2 L2 surface temperature (K)
L8_B10 = dict(ML=3.3420e-04, AL=0.1, K1=774.8853, K2=1321.0789, wavelength_um=10.895)  # Level-1 thermal

# Thresholds
HOTSPOT_PERCENTILE = 95.0                 # hotspot = LST above the 95th percentile of land cells
PERSISTENT_YEARS = 5                      # ≥ 5 of 6 seasons → persistent
HOT_ABS_C = 42.0
GREEN_NDVI = 0.40
BUILT_NDBI = 0.10
NDVI_CLASSES = [("Dense", 0.4, 1.01), ("Moderate", 0.2, 0.4), ("Sparse", -1.0, 0.2)]
NDBI_CLASSES = [("Built-up", 0.1, 1.01), ("Mixed", -0.1, 0.1), ("Open / vegetated", -1.0, -0.1)]

# Scenario calibration (fraction of cover → index units, from seasonal composites)
NDVI_PER_VEG_FRACTION = 0.72
NDBI_PER_BUILT_FRACTION = 0.75
NDVI_BARE_SOIL = 0.06
NDBI_BARE_MIN, NDBI_BUILT_MAX = -0.32, 0.43
VEG_RANGE = (-30.0, 50.0)
BUILT_RANGE = (-30.0, 30.0)
# Documented fall-back coefficients (°C per percentage point) if a regression cannot be fitted
DEFAULT_VEG_COEFF, DEFAULT_BUILT_COEFF = -0.06, 0.03

YEAR_NOTES = {
    2019: "Severe heat-wave; Nagpur crossed 47 °C in May",
    2020: "Good 2019 monsoon carry-over; lockdown haze",
    2021: "Near-normal season",
    2022: "Early March–April heat-wave",
    2023: "Unseasonal April showers",
    2024: "Prolonged May heat spell (45–46 °C)",
}
