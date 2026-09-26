"""Command-line interface.

    python -m nagpur_uhi fetch     --source pc|gee|demo [--years 2019 2024] [--no-download]
    python -m nagpur_uhi build     --source raw|gee|demo          # → data/processed/cube.npz
    python -m nagpur_uhi analyze   [--png] [--geotiff]            # → data/outputs/…
    python -m nagpur_uhi scenario  --zone besa --veg 20 --built -5 [--buildings 5] [--baseline 2030]
    python -m nagpur_uhi compare   --a cbd --b seminary [--year 2024]
    python -m nagpur_uhi serve     [--port 8000]                  # FastAPI backend
    python -m nagpur_uhi run-all   --source demo --png
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import config as C
from .cube import Cube

CUBE_PATH = C.PROC_DIR / "cube.npz"


def _load_cube() -> Cube:
    if not CUBE_PATH.exists():
        sys.exit(f"{CUBE_PATH} not found — run `python -m nagpur_uhi build --source demo` first")
    return Cube.load(CUBE_PATH)


# ---------------------------------------------------------------------------- commands
def cmd_fetch(a):
    C.ensure_dirs()
    years = list(range(a.years[0], a.years[-1] + 1)) if a.years else C.YEARS
    if a.source == "pc":
        from .fetch import fetch_pc

        recs = fetch_pc(years, download=not a.no_download)
        print(f"{len(recs)} scenes catalogued → {C.RAW_DIR / 'scenes.json'}")
    elif a.source == "gee":
        from .fetch import fetch_gee

        for p in fetch_gee(years):
            print("composite:", p)
    else:
        from .fetch import write_catalogue
        from .synthetic import demo_catalogue

        recs = demo_catalogue(years)
        print(f"{len(recs)} demo scenes → {write_catalogue(recs)}")


def cmd_build(a):
    C.ensure_dirs()
    if a.source == "raw":
        from .preprocess import build_cube_from_raw

        cube = build_cube_from_raw()
    elif a.source == "gee":
        from .preprocess import cube_from_gee_composites

        cube = cube_from_gee_composites()
    else:
        from .synthetic import generate

        cube = generate(grid_res_m=a.res)
    path = cube.save(CUBE_PATH)
    print(f"cube {cube.shape} × {len(cube.years)} years → {path}")
    for y in cube.years:
        import numpy as np

        print(f"  {y}: LST mean {np.nanmean(cube.lst[y]):.2f} °C  NDVI {np.nanmean(cube.ndvi[y]):.3f}  NDBI {np.nanmean(cube.ndbi[y]):.3f}")


def cmd_analyze(a):
    from .export import analysis_bundle, write_all_geotiffs, write_bundle, write_png_maps
    from .fetch import read_catalogue
    from .preprocess import quality_report

    cube = _load_cube()
    quality = quality_report(cube, read_catalogue())
    bundle = analysis_bundle(cube, quality, include_rasters=a.rasters)
    path = write_bundle(bundle)
    print(f"analysis bundle → {path}")
    _print_report(bundle)
    if a.png:
        for p in write_png_maps(cube):
            print("map:", p)
    if a.geotiff:
        for p in write_all_geotiffs(cube):
            print("geotiff:", p)


def _print_report(b: dict):
    yrs = b["meta"]["years"]
    y0, y1 = str(yrs[0]), str(yrs[-1])
    c0, c1 = b["city"][y0], b["city"][y1]
    reg = b["regression"][y1]
    tr = b["trends"]["lst"]
    print("\n=== Nagpur UHI report ===")
    print(f"Mean LST {y0}: {c0['lst_mean']:.2f} °C → {y1}: {c1['lst_mean']:.2f} °C  (Δ {c1['lst_mean'] - c0['lst_mean']:+.2f} °C)")
    print(f"Green area (NDVI>{C.GREEN_NDVI}): {c0['green_area_km2']:.0f} → {c1['green_area_km2']:.0f} km²   Built (NDBI>{C.BUILT_NDBI}): {c0['built_area_km2']:.0f} → {c1['built_area_km2']:.0f} km²")
    print(f"LST ~ NDVI + NDBI ({y1}): a={reg['intercept']:.2f} b_ndvi={reg['b_ndvi']:.2f} b_ndbi={reg['b_ndbi']:.2f}  R²={reg['r2']:.3f} RMSE={reg['rmse']:.2f} °C  r(NDVI,LST)={reg['r_lst_ndvi']:.2f}")
    print(f"City LST trend: {tr['slope_per_year']:+.3f} °C/yr (R² {tr['r2']:.2f}) → 2030 ≈ {tr['projected']['2030']:.1f} °C")
    print(f"Persistent hotspots (≥{C.PERSISTENT_YEARS} yrs): {b['hotspots']['persistent_km2']:.1f} km²; Gi* significant clusters: {b['hotspots']['significant_cluster_km2']:.1f} km²")
    print("\nZones by ΔLST:")
    for z in sorted(b["zones"], key=lambda r: -r["d_lst"])[:8]:
        print(f"  {z['name']:<34s} ΔLST {z['d_lst']:+.2f} °C  ΔNDVI {z['d_ndvi']:+.3f}  ΔNDBI {z['d_ndbi']:+.3f}  persistent {z['persistent_fraction'] * 100:4.0f}%")


def cmd_scenario(a):
    from .scenario import ScenarioModel
    from .zones import rasterize_zones

    cube = _load_cube()
    model = ScenarioModel.from_cube(cube, rasterize_zones(cube))
    r = model.run(a.zone, a.veg, a.built, buildings=a.buildings, baseline_year=a.baseline)
    print(json.dumps(r.to_dict(), indent=2))
    if a.curve:
        print("\nsensitivity (veg % → ΔLST):")
        for row in model.sensitivity(a.zone, a.built, baseline_year=a.baseline):
            print(f"  {row['veg_delta_pct']:+4d}%  combined {row['d_lst_combined']:+.2f} °C   veg-only {row['d_lst_veg_only']:+.2f} °C")


def cmd_compare(a):
    from .zones import compare_zones, describe_zone, rasterize_zones, zonal_stats

    cube = _load_cube()
    rows = zonal_stats(cube, rasterize_zones(cube))
    year = a.year or cube.years[-1]
    print(json.dumps(compare_zones(rows, a.a, a.b, year), indent=2))
    for zid in (a.a, a.b):
        print(describe_zone(next(r for r in rows if r["id"] == zid), year))


def cmd_ml(a):
    from .ml import ml_report

    cube = _load_cube()
    rep = ml_report(cube, year=a.year, target_year=a.forecast)
    if a.json:
        print(json.dumps(rep, indent=1, default=float))
        return
    lm = rep["lst_model"]
    print(f"\n=== ML report · {lm['year']} · spatial GroupKFold over {lm['n_blocks']} blocks (2 km) ===")
    for name, m in lm["cv"].items():
        print(f"  {name:<20s} R² {m['r2']:.3f} ± {m['r2_std']:.3f}   RMSE {m['rmse']:.3f} °C   MAE {m['mae']:.3f}{'   ◀ best' if name == lm['best'] else ''}")
    print("  permutation importance:", ", ".join(f"{d['key']} {d['value']:.2f}" for d in lm["permutation_importance"][:6]))
    lc = rep["land_cover"]
    print(f"\n=== K-means land cover (k={lc['k']}) ===")
    for c in lc["classes"]:
        y0, y1 = lc["years"][0], lc["years"][-1]
        print(f"  {c['label']:<28s} {c['area_km2'][y0]:6.1f} → {c['area_km2'][y1]:6.1f} km²   LST {c['lst'][y1]:.1f} °C")
    print(f"  open/vegetated → built-up: {lc['open_to_built_km2']:.1f} km²   built → open: {lc['built_to_open_km2']:.1f} km²")
    isl = rep["heat_islands"]
    print(f"\n=== DBSCAN heat islands (≥{isl['min_years']} yrs in top decile, eps {isl['eps_cells']} cells) · {len(isl['islands'])} islands, {isl['n_noise']} noise px ===")
    for i in isl["islands"][:6]:
        print(f"  #{i['rank']} {i['zone']:<16s} {i['area_km2']:5.1f} km²  mean {i['mean_lst']:.1f}  peak {i['peak_lst']:.1f} °C  persistence {i['persistence_years']:.1f} yrs")
    an = rep["anomalies"]
    print(f"\n=== IsolationForest anomalies · {an['n_flagged']} px ({an['flagged_km2']:.1f} km²) hotter than land cover explains ===")
    for t in an["top"][:5]:
        print(f"  {t['zone']:<16s} {t['lat']:.4f}N {t['lon']:.4f}E  LST {t['lst']:.1f}  residual {t['residual']:+.1f} °C")
    fc = rep["forecast"]
    print(f"\n=== Forecast {fc['target_year']} (hybrid GBM + trend) ===")
    for b in fc["backtest"]:
        print(f"  back-test {b['name']:<26s} RMSE {b['rmse']:.2f}  bias {b['bias']:+.2f}  pattern RMSE {b['pattern_rmse']:.2f}  R² {b['r2']:.2f}")
    print(f"  city mean {fc['city_mean_last']:.2f} → {fc['city_mean_target']:.2f} °C   area > {C.HOT_ABS_C:.0f} °C: {fc['hot_km2_last']:.0f} → {fc['hot_km2_target']:.0f} km²")
    print("\n=== ML what-if · Besa (vegetation Δ → ΔLST, ML vs linear) ===")
    for r in rep["ml_whatif_besa"]:
        print(f"  {r['pct']:+4d}%  veg: ML {r['veg']['d_lst_ml']:+.2f} / lin {r['veg']['d_lst_linear']:+.2f}    built: ML {r['built']['d_lst_ml']:+.2f} / lin {r['built']['d_lst_linear']:+.2f}")


def cmd_serve(a):
    try:
        import uvicorn
    except ImportError:
        sys.exit("pip install fastapi uvicorn")
    uvicorn.run("nagpur_uhi.api:app", host=a.host, port=a.port, reload=False)


def cmd_run_all(a):
    a.no_download = False
    cmd_fetch(a)
    a.source = "raw" if a.source == "pc" else a.source
    a.res = C.GRID_RES_M
    cmd_build(a)
    a.rasters, a.geotiff = False, a.geotiff
    cmd_analyze(a)


# ---------------------------------------------------------------------------- parser
def main(argv=None):
    p = argparse.ArgumentParser(prog="nagpur_uhi", description="Nagpur Urban Heat Island geospatial pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("fetch", help="Component 1a: download scenes / composites")
    f.add_argument("--source", choices=["pc", "gee", "demo"], default="demo")
    f.add_argument("--years", nargs="+", type=int)
    f.add_argument("--no-download", action="store_true", help="catalogue only")
    f.set_defaults(fn=cmd_fetch)

    b = sub.add_parser("build", help="Component 1b: mask, georeference, composite → cube")
    b.add_argument("--source", choices=["raw", "gee", "demo"], default="demo")
    b.add_argument("--res", type=float, default=C.GRID_RES_M, help="grid resolution (m)")
    b.set_defaults(fn=cmd_build)

    an = sub.add_parser("analyze", help="Components 2–3: indices, correlation, trends, hotspots, zones")
    an.add_argument("--png", action="store_true")
    an.add_argument("--geotiff", action="store_true")
    an.add_argument("--rasters", action="store_true", help="embed rasters in the JSON bundle")
    an.set_defaults(fn=cmd_analyze)

    s = sub.add_parser("scenario", help="Component 4: what-if")
    s.add_argument("--zone", default="besa", choices=[z["id"] for z in C.ZONES])
    s.add_argument("--veg", type=float, default=0.0, help="vegetation cover change (percentage points)")
    s.add_argument("--built", type=float, default=0.0, help="built-up cover change (percentage points)")
    s.add_argument("--buildings", type=int, default=0, help="number of ~3,500 m² buildings added (+) / demolished (−)")
    s.add_argument("--baseline", type=int, default=None, help="e.g. 2030 for business-as-usual baseline")
    s.add_argument("--curve", action="store_true", help="print sensitivity curve")
    s.set_defaults(fn=cmd_scenario)

    c = sub.add_parser("compare", help="Component 5: zone A vs zone B")
    c.add_argument("--a", default="cbd")
    c.add_argument("--b", default="seminary")
    c.add_argument("--year", type=int)
    c.set_defaults(fn=cmd_compare)

    ml = sub.add_parser("ml", help="ML: model comparison, clustering, heat islands, anomalies, forecast")
    ml.add_argument("--year", type=int, default=None)
    ml.add_argument("--forecast", type=int, default=2030)
    ml.add_argument("--json", action="store_true")
    ml.set_defaults(fn=cmd_ml)

    sv = sub.add_parser("serve", help="Component 5: REST API for the web front-end")
    sv.add_argument("--host", default="0.0.0.0")
    sv.add_argument("--port", type=int, default=8000)
    sv.set_defaults(fn=cmd_serve)

    r = sub.add_parser("run-all", help="fetch → build → analyze")
    r.add_argument("--source", choices=["pc", "gee", "demo"], default="demo")
    r.add_argument("--years", nargs="+", type=int)
    r.add_argument("--png", action="store_true")
    r.add_argument("--geotiff", action="store_true")
    r.set_defaults(fn=cmd_run_all)

    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
