# nagpur_uhi — Python analytics for the Smart Geospatial Platform (Nagpur)

Satellite-driven Urban Heat Island pipeline: **Landsat 8/9 + Sentinel-2 → LST / NDVI / NDBI →
temporal trends & hotspots → what-if scenarios → JSON / PNG / GeoTIFF / REST API**.

```
python/
├── nagpur_uhi/
│   ├── config.py      AOI, years, thresholds, analysis zones, scale factors
│   ├── cube.py        Cube = chronological stack of annual composites (save/load .npz)
│   ├── fetch.py       C1a  Planetary Computer STAC + Google Earth Engine back-ends
│   ├── preprocess.py  C1b  QA cloud masks, scale factors, reprojection, median composites
│   ├── indices.py     C2   NDVI, NDBI, LST (C2-L2 + single-channel), stats, OLS regression
│   ├── temporal.py    C3   change detection, per-pixel trends, persistence, Getis-Ord Gi*
│   ├── zones.py            zonal statistics, A-vs-B comparison, GeoJSON
│   ├── scenario.py    C4   what-if model (vegetation / built-up / buildings, 2030 BAU)
│   ├── ml.py          ML   RF / GBM vs OLS (spatial CV), K-means land cover, DBSCAN islands, IsolationForest, forecast
│   ├── export.py      C5   JSON bundle, PNG maps, GeoTIFFs
│   ├── api.py         C5   FastAPI REST back-end for the React interface
│   ├── synthetic.py        offline demo cube calibrated to Nagpur geography
│   └── cli.py              command-line entry point
├── tests/test_pipeline.py · tests/test_ml.py
└── requirements.txt
```

## Quick start (offline demo — numpy only)

```bash
cd python
pip install numpy
python -m nagpur_uhi run-all --source demo          # fetch(catalogue) → build cube → analyze
python -m nagpur_uhi scenario --zone besa --veg 20 --built -5 --curve
python -m nagpur_uhi compare  --a cbd --b seminary --year 2024
python tests/test_pipeline.py
```

## Machine learning

```bash
pip install scikit-learn
python -m nagpur_uhi ml --year 2024 --forecast 2030      # full ML report (≈30 s)
python -m nagpur_uhi ml --json > ml.json                  # machine-readable
python tests/test_ml.py
```

| Model | Purpose | Notes |
|---|---|---|
| `LinearRegression` · `RandomForestRegressor` · `HistGradientBoostingRegressor` | predict LST from 12 features (NDVI, NDBI, 1 km context, distance to water / centre / roads, industrial proximity, position) | **spatial GroupKFold** over 2 km blocks (random splits leak under autocorrelation); permutation importance; partial dependence shows saturating canopy cooling & NDBI threshold |
| `KMeans` (k = 5 + water) | unsupervised land-cover classes on 2019 + 2024 pooled | one centroid set → comparable 2019→2024 **transition matrix** (open → built-up km²) |
| `DBSCAN` (ε = 1.5 cells, minPts = 4) | segment persistent-hotspot pixels into contiguous **heat islands** | area, mean / peak LST, persistence, dominant zone |
| `IsolationForest` | pixels far hotter than their land cover explains (model residuals) | flags industrial / unexplained heat sources |
| hybrid GBM + linear trend | **2030 forecast**: GBM learns the spatial anomaly `LST − cityMean(year)`, trend extrapolates the mean, NDVI/NDBI projected per pixel | back-tested on 2024 vs per-pixel trend & persistence baselines |
| `MLScenarioModel` | non-linear what-if (Δ vegetation / built-up) with neighbourhood features recomputed | compare with the linear model; trees don't extrapolate outside observed ranges |

## Real satellite data

### Option A — Microsoft Planetary Computer (no account)

```bash
pip install -r requirements.txt
python -m nagpur_uhi fetch --source pc --years 2019 2024   # streams AOI windows of Landsat C2-L2 + S2-L2A COGs
python -m nagpur_uhi build --source raw                     # QA mask → indices → 200 m grid → median composites
python -m nagpur_uhi analyze --png --geotiff
```

### Option B — Google Earth Engine (server-side compositing)

```bash
pip install earthengine-api rasterio && earthengine authenticate
python -m nagpur_uhi fetch --source gee     # downloads annual NDVI/NDBI/LST/WATER/COUNT composites
python -m nagpur_uhi build --source gee
python -m nagpur_uhi analyze --png
```

## Method summary

| Step | Implementation |
|---|---|
| Cloud removal | Landsat `QA_PIXEL` bits 1–5 (dilated cloud, cirrus, cloud, shadow, snow); Sentinel-2 `SCL` classes 0,1,3,8,9,10,11; 1-px mask dilation; scenes > 45 % cloud rejected |
| Georeferencing | scenes read in native UTM 44N, warped to a common WGS-84 grid (200 m, average resampling) |
| Time series | per-pixel **median** of all clear pre-monsoon (Mar–May) observations per year + observation count |
| NDVI / NDBI | `(NIR−Red)/(NIR+Red)`, `(SWIR1−NIR)/(SWIR1+NIR)` |
| LST | Collection-2 `ST_B10 × 0.00341802 + 149 − 273.15`; fallback single-channel: DN → radiance → BT → NDVI-threshold emissivity |
| Cross-correlation | Pearson matrix + OLS `LST = a + b₁·NDVI + b₂·NDBI` (R², RMSE) |
| Change detection | Δ rasters, driver classes (veg loss / new construction / both / greening / background warming) |
| Hotspots | top-decile LST per year → persistence count; Getis-Ord Gi* z-scores for significant clusters |
| Trends | city & zone OLS slopes, vectorised per-pixel slope/R², linear extrapolation to 2030 |
| Scenario | Δveg, Δbuilt (or N buildings × 3,500 m²) → ΔNDVI = 0.72·Δveg, ΔNDBI = 0.75·Δbuilt → ΔLST via b₁, b₂; optional 2030 BAU baseline from zone trends |

## Serving the web interface

```bash
pip install fastapi uvicorn matplotlib
python -m nagpur_uhi serve --port 8000
# GET  /api/summary   /api/zones   /api/compare?a=cbd&b=seminary
# GET  /api/raster/lst/2024.png    (Leaflet ImageOverlay; bounds in X-Bounds header)
# POST /api/scenario  {"zone":"besa","veg":20,"built":-5,"baseline":2030}
# GET  /api/ml                     ML report · POST /api/ml/scenario {"zone":"besa","veg":20}
```

`data/outputs/nagpur_uhi_analysis.json` has the same schema as the API responses, so the
React app can either call the API or load the static bundle.

## Connecting the web interface

Start the service (`python -m nagpur_uhi serve --port 8000`), open the interface, click the
**Demonstration dataset** badge in the header, enter `http://localhost:8000`, *Test connection*,
*Connect & load*. The interface validates the contract (AOI bounds, 2019–2024 seasons), streams the
18 index rasters + water mask, rebuilds every statistic and retrains the in-browser models on the
live grid. The URL is remembered and reconnected on the next visit (silent fallback to demo data).

## How the web interface relates to this package

The interface ships a dependency-free TypeScript port of the same models (`src/ml/`) so that
what-if analysis stays interactive without a server round-trip; this package is the production
runtime (native 30 m resolution, scikit-learn, GeoTIFF export). The **Methodology** section of the
interface documents architecture, model cards, live validation and the runbook above, and embeds
this package's source for reproducibility.
