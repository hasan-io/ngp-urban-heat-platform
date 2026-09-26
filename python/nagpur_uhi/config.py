"""Configuration for the Nagpur Urban Heat Island (UHI) analysis pipeline.

Everything that describes *where*, *when* and *how strict* lives here so the
other modules stay free of magic numbers.
"""
from __future__ import annotations

from pathlib import Path

# --------------------------------------------------------------------------- paths
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"            # clipped per-scene GeoTIFFs (Component 1)
PROC_DIR = DATA_DIR / "processed"     # annual composites / data cube
OUT_DIR = DATA_DIR / "outputs"        # JSON, PNG, GeoTIFF products

# --------------------------------------------------------------------------- area of interest
AOI_NAME = "Nagpur"
# west, south, east, north (WGS 84). Covers NMC limits + MIHAN, Hingna, Koradi periphery.
AOI_BBOX = (78.94, 21.02, 79.22, 21.26)
CITY_CENTER = (21.1458, 79.0882)      # Zero Mile (lat, lon)
CRS_ANALYSIS = "EPSG:32644"           # WGS 84 / UTM zone 44N — metric, for co-registration
CRS_WEB = "EPSG:4326"                 # lat/lon for the web front-end
KM_PER_DEG_LAT = 111.0
KM_PER_DEG_LON = 104.0                # at ~21° N

GRID_RES_M = 200                      # analysis grid cell size (m)
NATIVE_RES_M = 30                     # Landsat optical / resampled thermal

# --------------------------------------------------------------------------- time window
YEARS = [2019, 2020, 2021, 2022, 2023, 2024]
SEASON_START = "03-01"                # pre-monsoon window (MM-DD) — clearest skies, peak heat
SEASON_END = "05-31"

# --------------------------------------------------------------------------- data sources
STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
STAC_LANDSAT = "landsat-c2-l2"        # Landsat 8/9 Collection 2 Level-2 (SR + ST)
STAC_SENTINEL = "sentinel-2-l2a"
GEE_LANDSAT = ["LANDSAT/LC08/C02/T1_L2", "LANDSAT/LC09/C02/T1_L2"]
GEE_SENTINEL = "COPERNICUS/S2_SR_HARMONIZED"
LANDSAT_PATH_ROW = (144, 45)          # WRS-2 footprint covering Nagpur
SENTINEL_TILES = ("44QLJ", "44QKJ")

# Landsat Collection-2 Level-2 scale factors (USGS)
SR_SCALE, SR_OFFSET = 2.75e-05, -0.2
ST_SCALE, ST_OFFSET = 3.41802e-03, 149.0

# Landsat 8 TIRS band-10 constants (for the Level-1 single-channel fallback)
L8_B10 = dict(ML=3.3420e-04, AL=0.1, K1=774.8853, K2=1321.0789, wavelength_um=10.895)

# --------------------------------------------------------------------------- QA / thresholds
MAX_SCENE_CLOUD = 45.0                # reject scenes above this AOI cloud %
PARTIAL_SCENE_CLOUD = 20.0            # 20–45 % → used with heavy masking
MIN_CLEAR_OBS = 3                     # pixels with fewer clear obs are flagged low-confidence
MASK_DILATION_PX = 1                  # grow cloud/shadow mask by this many pixels

HOT_PERCENTILE = 90                   # hotspot = top decile of land LST in a year
PERSISTENT_YEARS = 5                  # hotspot in >= N of the 6 years → persistent
HOT_ABS_C = 42.0                      # absolute "hot" threshold for area statistics
GREEN_NDVI = 0.40                     # NDVI above → "green"
BUILT_NDBI = 0.10                     # NDBI above → "built-up"

# NDVI land-cover classes (label, lower, upper)
NDVI_CLASSES = [
    ("water", -1.0, 0.0),
    ("bare_built", 0.0, 0.2),
    ("sparse_veg", 0.2, 0.4),
    ("moderate_veg", 0.4, 0.6),
    ("dense_canopy", 0.6, 1.01),
]

# Calibration used by the scenario model to convert cover fractions into index deltas.
NDVI_BARE_SOIL = 0.06                 # NDVI of a fully bare / built pixel (composite calibration)
NDVI_PER_VEG_FRACTION = 0.72          # d(NDVI) / d(vegetation cover fraction)
NDBI_PER_BUILT_FRACTION = 0.75        # d(NDBI) / d(built-up cover fraction)
BUILDING_FOOTPRINT_KM2 = 0.0035       # ~3,500 m² per mid-rise block incl. paved surrounds

# --------------------------------------------------------------------------- ML feature geography
# Major road corridors (lat, lon polylines) — in production pull from OSM (highway=trunk/primary via osmnx).
MAJOR_ROADS = [
    [(21.146, 79.082), (21.12, 79.07), (21.09, 79.06), (21.05, 79.045), (21.02, 79.03)],          # Wardha Rd / NH-44 S
    [(21.15, 79.09), (21.18, 79.1), (21.21, 79.12), (21.26, 79.17)],                              # Kamptee Rd / NH-44 N
    [(21.146, 79.082), (21.148, 79.05), (21.15, 79.01), (21.16, 78.94)],                          # Amravati Rd
    [(21.148, 79.09), (21.15, 79.13), (21.155, 79.17), (21.16, 79.22)],                           # Bhandara Rd
    [(21.145, 79.1), (21.12, 79.12), (21.09, 79.15), (21.06, 79.19)],                             # Umred Rd
    [(21.15, 79.08), (21.17, 79.06), (21.2, 79.03), (21.24, 78.98)],                              # Katol Rd
    [(21.14, 79.07), (21.13, 79.04), (21.12, 79.0), (21.11, 78.95)],                              # Hingna Rd
    [(21.16, 79.08), (21.2, 79.085), (21.26, 79.09)],                                             # Koradi Rd
    [(21.185, 79.085), (21.173, 79.115), (21.145, 79.128), (21.117, 79.115), (21.105, 79.085), (21.117, 79.055), (21.145, 79.042), (21.173, 79.055), (21.185, 79.085)],  # Inner Ring Rd
]
# Industrial land use (lat, lon, radius_km, strength) — OSM landuse=industrial / MIDC boundaries.
INDUSTRIAL_SITES = [
    (21.045, 79.030, 2.0, 0.85),   # MIHAN SEZ
    (21.108, 78.976, 1.3, 0.90),   # Hingna MIDC
    (21.168, 79.132, 0.9, 0.80),   # Kalamna market yard
    (21.187, 79.116, 0.9, 0.80),   # Uppalwadi industrial
    (21.246, 79.088, 0.8, 0.95),   # Koradi thermal power station
    (21.028, 78.985, 1.1, 0.60),   # Butibori link
]

# --------------------------------------------------------------------------- analysis zones
# Each zone: id, name, short name, polygon [(lon, lat), ...] (GeoJSON order), population, character
ZONES = [
    dict(id="cbd", name="Sitabuldi – Zero Mile (CBD)", short="Sitabuldi", population=85_000, character="Commercial core",
         poly=[(79.070, 21.158), (79.095, 21.158), (79.095, 21.135), (79.070, 21.135)]),
    dict(id="oldcity", name="Itwari – Mahal (Old City)", short="Itwari–Mahal", population=240_000, character="Dense old city",
         poly=[(79.095, 21.165), (79.120, 21.165), (79.120, 21.140), (79.095, 21.140)]),
    dict(id="sadar", name="Sadar – Civil Lines", short="Sadar", population=120_000, character="Administrative / cantonment",
         poly=[(79.065, 21.178), (79.095, 21.178), (79.095, 21.158), (79.065, 21.158)]),
    dict(id="dharampeth", name="Dharampeth – Ramdaspeth", short="Dharampeth", population=95_000, character="Established residential",
         poly=[(79.050, 21.150), (79.070, 21.150), (79.070, 21.130), (79.050, 21.130)]),
    dict(id="seminary", name="Seminary Hills – Futala", short="Seminary Hills", population=60_000, character="Forested hills + lakefront",
         poly=[(79.040, 21.175), (79.065, 21.175), (79.065, 21.150), (79.040, 21.150)]),
    dict(id="ambazari", name="Ambazari – VNIT", short="Ambazari", population=70_000, character="Lake + institutional campus",
         poly=[(79.028, 21.135), (79.055, 21.135), (79.055, 21.112), (79.028, 21.112)]),
    dict(id="pratapnagar", name="Pratap Nagar – Khamla", short="Pratap Nagar", population=130_000, character="Mid-density residential",
         poly=[(79.055, 21.130), (79.080, 21.130), (79.080, 21.105), (79.055, 21.105)]),
    dict(id="manishnagar", name="Manish Nagar – Somalwada", short="Manish Nagar", population=110_000, character="Rapid apartment growth",
         poly=[(79.062, 21.105), (79.088, 21.105), (79.088, 21.080), (79.062, 21.080)]),
    dict(id="besa", name="Besa – Beltarodi", short="Besa", population=95_000, character="Peri-urban boom",
         poly=[(79.070, 21.080), (79.100, 21.080), (79.100, 21.050), (79.070, 21.050)]),
    dict(id="mihan", name="MIHAN – Jamtha", short="MIHAN", population=40_000, character="SEZ / industrial",
         poly=[(79.010, 21.065), (79.070, 21.065), (79.070, 21.025), (79.010, 21.025)]),
    dict(id="airport", name="Airport – Sonegaon", short="Airport", population=55_000, character="Airport + logistics",
         poly=[(79.035, 21.108), (79.062, 21.108), (79.062, 21.078), (79.035, 21.078)]),
    dict(id="nandanvan", name="Nandanvan – Sakkardara", short="Nandanvan", population=180_000, character="Dense east residential",
         poly=[(79.095, 21.140), (79.125, 21.140), (79.125, 21.115), (79.095, 21.115)]),
    dict(id="wathoda", name="Wathoda – Hudkeshwar", short="Wathoda", population=120_000, character="New layouts, ex-farmland",
         poly=[(79.125, 21.125), (79.160, 21.125), (79.160, 21.095), (79.125, 21.095)]),
    dict(id="kalamna", name="Kalamna – Pardi", short="Kalamna", population=90_000, character="Market yard + logistics",
         poly=[(79.125, 21.180), (79.160, 21.180), (79.160, 21.150), (79.125, 21.150)]),
    dict(id="jaripatka", name="Jaripatka – Indora", short="Jaripatka", population=150_000, character="Dense north residential",
         poly=[(79.085, 21.195), (79.115, 21.195), (79.115, 21.170), (79.085, 21.170)]),
    dict(id="gorewada", name="Gorewada – Koradi Rd", short="Gorewada", population=45_000, character="Reserve forest + new layouts",
         poly=[(79.020, 21.235), (79.075, 21.235), (79.075, 21.185), (79.020, 21.185)]),
    dict(id="hingna", name="Hingna MIDC – Wadi", short="Hingna MIDC", population=80_000, character="Industrial estate",
         poly=[(78.955, 21.135), (79.000, 21.135), (79.000, 21.095), (78.955, 21.095)]),
    dict(id="kamptee", name="Kamptee Rd – Uppalwadi", short="Kamptee Rd", population=100_000, character="Highway corridor",
         poly=[(79.100, 21.210), (79.140, 21.210), (79.140, 21.178), (79.100, 21.178)]),
]

# Inter-annual anomalies of the pre-monsoon season (used by the synthetic generator
# and shown as context in reports).
YEAR_NOTES = {
    2019: "Severe heat-wave; Nagpur crossed 47 °C in May",
    2020: "Good 2019 monsoon carry-over; lockdown haze",
    2021: "Near-normal season",
    2022: "Early March–April heat-wave",
    2023: "Unseasonal April showers",
    2024: "Prolonged May heat spell (45–46 °C)",
}


def ensure_dirs() -> None:
    for d in (RAW_DIR, PROC_DIR, OUT_DIR):
        d.mkdir(parents=True, exist_ok=True)
