# Nagpur Urban Heat Island Analysis Platform — Backend

FastAPI service that powers the finalized React frontend with real satellite-derived analytics:
Landsat/Sentinel composites (2019–2024) → LST / NDVI / NDBI → hotspots, trends, correlations →
linear + XGBoost scenario modelling → insights and reports.

```
nagpur-uhi-backend/
├── app/
│   ├── main.py                 FastAPI app, CORS, logging, error envelopes, start-up pipeline
│   ├── config.py               settings from .env
│   ├── api/v1/endpoints/       overview · data · hotspots · zones · analysis · scenario · insights · reports · health
│   ├── services/               satellite_data (GeoTIFF cube) · calculation · analysis · prediction · scenario · report · cache
│   ├── ml/                     feature engineering, XGBoost training / loading (spatial block CV)
│   ├── models/                 Pydantic schemas · SQLAlchemy ORM · enums
│   ├── database/               engine/session + Alembic migrations
│   ├── repositories/           zone / satellite-data / report queries
│   └── utils/                  constants · calculations (LST/NDVI/NDBI) · raster · geospatial · response
├── data/
│   ├── zones.json              18 planning zones (GeoJSON) — same ids as the frontend
│   ├── landmarks.json
│   ├── satellite_imagery/{year}/LST_{year}.tif NDVI_{year}.tif NDBI_{year}.tif WATER_{year}.tif metadata.json
│   └── models/lst_prediction_model.pkl · model_metadata.json
├── scripts/prepare_data.py     raw Landsat scenes → analysis-ready GeoTIFFs (or calibrated demo cube)
├── scripts/train_model.py
├── tests/                      16 tests (formulas + every endpoint contract)
├── main.py · requirements.txt · .env.example · alembic.ini
```

## Run locally

```bash
cd nagpur-uhi-backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python main.py                       # http://localhost:8000  ·  docs at /docs
```

First start (≈5 s): builds the SQLite schema, prepares composites if `data/satellite_imagery/` is empty
(`AUTO_PREPARE_DATA=true` → calibrated demonstration GeoTIFFs), seeds zones / zone statistics / hotspot
rankings, trains the XGBoost LST model (`AUTO_TRAIN_MODEL=true`) and warms the analysis cache.

### Real satellite data

```bash
# place Landsat Collection-2 scenes (band files) under data/raw/<year>/<scene_id>/
#   *_SR_B4.TIF *_SR_B5.TIF *_SR_B6.TIF *_ST_B10.TIF (or *_B10.TIF)  *_QA_PIXEL.TIF
python scripts/prepare_data.py --source raw    # QA cloud mask → indices/LST → warp to grid → seasonal median
python scripts/train_model.py                  # retrain on the new composites
```
Scenes can be obtained from USGS EarthExplorer, Microsoft Planetary Computer (`landsat-c2-l2`) or Google Earth
Engine (`LANDSAT/LC08/C02/T1_L2`). Any CRS/resolution is accepted — rasters are warped onto the WGS-84 analysis
grid (200 m, AOI 78.94–79.22 °E / 21.02–21.26 °N) on load, so native 30 m UTM-44N products work unchanged.

## Connect the frontend

```bash
# frontend repository root
echo "VITE_API_BASE_URL=http://localhost:8000" >> .env.local
echo "VITE_USE_MOCK_API=false"                >> .env.local
npm run dev
```
The frontend's `uhiApi` client (axios) then calls this service for every page; its live raster loader
(header → *Data source* → `http://localhost:8000`) streams the real LST/NDVI/NDBI grids for the maps.

## API (base `/api`) — every response is `{success, data, error, timestamp}`

| Endpoint | Purpose |
|---|---|
| `GET /health` | status, years available, model metadata, cache stats |
| `GET /overview?year=` | KPIs (`kpis.averageTemperature/maximumTemperature/hotspotCount/vegetationChange/averageNdvi/averageNdbi`), areas, quality |
| `GET /data/lst` `ndvi` `ndbi ?year=&include_grid=` | stats, zone GeoJSON with per-zone values, compact grid, quality_info |
| `GET /data/delta-lst?year1=&year2=` | change grid + zone deltas |
| `GET /data/persistent-hotspots?year_range=2019-2024[&min_years=]` | components (GeoJSON), cells, persistence grid |
| `GET /data/hotspots?year=` | annual 95th-percentile mask + components |
| `GET /hotspots/top?year=&limit=` | zone ranking: temperature, peak, severity, priority, persistence, rationale |
| `GET /hotspots/components?year=` | connected hotspot clusters (centroid, area, mean/peak LST, persistence) |
| `GET /zones` · `GET /zones/{id}/stats?year=` · `GET /landmarks` | boundaries, per-zone stats, change, trends, series |
| `GET /analysis/scatter/ndvi-lst` `ndbi-lst ?year=` | 1 100 sampled points, Pearson r, slope/intercept/R², equation |
| `GET /analysis/trends` · `GET /analysis/regression?year=` | city series, slopes, acceleration, σ, 2030 projection band, zone trends |
| `POST /scenario/predict` | `{zoneId, baseline:"2024"\|"2030", vegetationChange, builtUpChange}` (snake_case aliases accepted) → ΔLST, confidence, before/after, effects, ML estimate, explanation |
| `GET /scenario/sensitivity-curve?zone_id=&baseline_year=` | −30…+50 % vegetation: linear, vegetation-only and ML curves |
| `GET /scenario/rasters?zone_id=&vegetation_change=&built_up_change=` | base64 PNG before / after / delta |
| `GET /insights/findings?year=` | 8 findings + 3 recommendations + quality |
| `GET /insights/hotspot-rankings?year=` · `GET /insights/seasonal-patterns[?zone_id=]` | ranking with rationale; pre-monsoon series + UHI intensity |
| `POST /reports/generate` | `{year, report_type: full\|executive\|technical, include_sections}` → report (sections + content) stored in DB |
| `GET /summary` · `GET /raster/{lst\|ndvi\|ndbi\|water\|dlst\|hotspot}/{year}` · `GET /scenes` | raw cube contract for the frontend raster loader (no envelope) |

Errors: `400` invalid year / slider range, `404` unknown zone or report, `503` missing composites, `500` with logged traceback.

## Algorithms (defensible summary)

* **LST** — Landsat B10: `Lλ = ML·DN + AL` → `BT = K2 / ln(K1/Lλ + 1)` → NDVI → `Pv = ((NDVI−0.2)/(0.5−0.2))²` →
  `ε = 0.986·Pv + 0.966·(1−Pv) + 0.005` → `LST = BT / (1 + (λ·BT/ρ)·ln ε) − 273.15`. Collection-2 Level-2 `ST_B10`
  (already corrected) is used when present.
* **NDVI** `(B5−B4)/(B5+B4)`; **NDBI** `(B6−B5)/(B6+B5)`; QA_PIXEL bits 0–5 masked; per-pixel seasonal **median**.
* **Hotspots** — cells above the 95th percentile of land LST; 8-connected components (`scipy.ndimage.label`) ranked by
  intensity × √size; **persistence** = seasons a cell was a hotspot (persistent ≥ 5/6; `persistent-hotspots` = all 6).
* **Trends** — OLS per metric with R², second-order acceleration, σ; 2030 = linear extrapolation with widening band.
* **Correlation** — 1 100 seeded random land cells, Pearson r, OLS line; full-population r also reported.
* **Linear scenario** — pixel regression `LST = a + b₁·NDVI + b₂·NDBI` converted with the cover calibration
  (0.72 NDVI / unit vegetation, 0.75 NDBI / unit impervious) → ≈ −0.06 °C per +1 % vegetation, ≈ +0.09 °C per +1 % built-up
  (learned from data, not hard-coded; brief defaults are the fallback). Confidence from R² and uncertainty.
* **ML scenario** — XGBoost regressor (fallback: scikit-learn HistGradientBoosting) on NDVI, NDBI, 1 km neighbourhood
  means/texture, water share, distance to centre, position, year; validated with **spatial GroupKFold** (2 km blocks) —
  held-out R² ≈ 0.90. What-if: recompute features with the intervention, predict zone cells, take the mean delta;
  out-of-range interventions fall back to the linear estimate.

## Limitations
Land-surface temperature at overpass ≠ air temperature; 200 m analysis grid (30 m native) smooths micro-hotspots;
seasonal medians hide short heat-wave peaks; 2030 values are linear extrapolations; the ML model is trained on six
seasons and can over-fit outside the observed feature range. Demonstration composites (`source: synthetic-calibrated`)
are for development only — run `prepare_data.py --source raw` for operational use.

## Production
`gunicorn -w 4 -k uvicorn.workers.UvicornWorker app.main:app` behind Nginx, `DATABASE_URL=postgresql+psycopg2://…`,
`alembic upgrade head`, `CORS_ORIGINS` restricted to the frontend origin, logs rotate daily in `logs/app.log`.
