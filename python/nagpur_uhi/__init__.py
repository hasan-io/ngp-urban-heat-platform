"""Nagpur Urban Heat Island geospatial pipeline.

Components
  1. fetch / preprocess  — Landsat 8/9 + Sentinel-2 download, cloud masking, georeferencing, time-series cube
  2. indices             — LST, NDVI, NDBI, correlation, OLS regression
  3. temporal            — change detection, per-pixel trends, persistent hotspots, Getis-Ord Gi*
  4. scenario            — what-if modelling (vegetation / built-up / buildings)
  5. zones / export / api — zonal stats, JSON/PNG/GeoTIFF products, REST API for the web UI
"""
from .cube import Cube  # noqa: F401

__version__ = "1.0.0"
