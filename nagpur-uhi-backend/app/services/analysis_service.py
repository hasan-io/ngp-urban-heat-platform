"""Higher-level analytics for the interface: overview KPIs, zone/hotspot rankings, insights,
recommendations, seasonal patterns, GeoJSON products."""
from __future__ import annotations

import numpy as np

from app.services import calculation_service as calc
from app.services.cache_service import analysis_cache
from app.services.satellite_data_service import SatelliteCube
from app.utils import constants as C
from app.utils.geospatial_utils import cell_polygon
from app.utils.raster_utils import grid_payload


def _quality_block(cube: SatelliteCube, year: int) -> dict:
    q = cube.quality(year)
    return {"label": q["quality"], "completeness": round(q["completeness_pct"], 1), "clearScenes": int(q["used"] + q["partial"]),
            "residualCloud": round(q["residual_cloud_pct"], 1), "validPixels": round(q["valid_pixels_pct"], 1), "source": q["source"]}


# ---------------------------------------------------------------- overview
def overview(cube: SatelliteCube, year: int) -> dict:
    c = calc.city_stats(cube, year)
    base = calc.city_stats(cube, C.BASE_YEAR)
    return {
        "year": year,
        "kpis": {"averageTemperature": c["lst_mean"], "maximumTemperature": c["lst_max"], "minimumTemperature": c["lst_min"],
                 "hotspotCount": c["hotspot_cells"], "vegetationChange": c["ndvi_mean"] - base["ndvi_mean"],
                 "averageNdvi": c["ndvi_mean"], "averageNdbi": c["ndbi_mean"]},
        # snake_case mirrors from the brief
        "avg_temperature": c["lst_mean"], "max_temperature": c["lst_max"], "min_temperature": c["lst_min"], "hotspot_count": c["hotspot_cells"],
        "vegetation_change": c["ndvi_mean"] - base["ndvi_mean"], "ndvi_avg": c["ndvi_mean"], "ndbi_avg": c["ndbi_mean"],
        "hotspotThreshold": c["lst_p95"], "hotspotAreaKm2": c["hotspot_area_km2"], "areas": {"hotKm2": c["hot_area_km2"], "greenKm2": c["green_area_km2"], "builtKm2": c["built_area_km2"]},
        "changeSinceBase": {"lst": c["lst_mean"] - base["lst_mean"], "ndvi": c["ndvi_mean"] - base["ndvi_mean"], "ndbi": c["ndbi_mean"] - base["ndbi_mean"]},
        "quality": _quality_block(cube, year), "data_quality": _quality_block(cube, year), "note": C.YEAR_NOTES.get(year, ""), "source": "api",
    }


# ---------------------------------------------------------------- zone rankings (hotspots)
def _priority(t: float, pers_frac: float) -> tuple[str, str]:
    if t >= 43 or pers_frac >= 0.75:
        return "Critical", "CRITICAL"
    if t >= 40.5 or pers_frac >= 0.4:
        return "High", "HIGH"
    if t >= 38.5:
        return "Moderate", "MEDIUM"
    return "Moderate", "LOW"


def zone_rankings(cube: SatelliteCube, year: int) -> list[dict]:
    def _calc():
        rows = []
        comps = calc.hotspot_components(cube, year)
        for z in cube.zones:
            p = z["properties"]
            st = calc.zone_stats(cube, p["zone_id"], year)
            if st is None:
                continue
            sev, pri = _priority(st["lst_mean"], st["persistent_fraction"])
            n_comp = sum(1 for c in comps if c["zone_id"] == p["zone_id"])
            rationale = []
            if st["lst_mean"] >= 42: rationale.append("very high mean surface temperature")
            if st["persistent_fraction"] >= 0.5: rationale.append(f"{st['persistent_fraction'] * 100:.0f}% of area persistently hot")
            if st["ndvi_mean"] < 0.15: rationale.append("very low canopy")
            if st["ndbi_mean"] > 0.1: rationale.append("dense impervious cover")
            if n_comp: rationale.append(f"{n_comp} hotspot cluster{'s' if n_comp > 1 else ''}")
            rows.append({"zoneId": p["zone_id"], "zone": p["name"], "short": p.get("short"), "character": p.get("character"), "temperature": st["lst_mean"],
                         "peakTemperature": st["lst_max"], "severity": sev, "priority": pri, "persistence": st["persistent_fraction"],
                         "persistenceYears": st["persistence_years_mean"], "hotFraction": st["hot_fraction"], "areaKm2": st["area_km2"],
                         "ndvi": st["ndvi_mean"], "ndbi": st["ndbi_mean"], "population": int(p.get("population", 0)), "clusters": n_comp,
                         "rationale": "; ".join(rationale) or "moderate heat exposure"})
        rows.sort(key=lambda r: -r["temperature"])
        for i, r in enumerate(rows, start=1):
            r["rank"] = i
        return rows
    return analysis_cache.get_or_set(f"hotspots_{year}", _calc)


# ---------------------------------------------------------------- insights
def findings(cube: SatelliteCube, year: int) -> list[dict]:
    c, b = calc.city_stats(cube, year), calc.city_stats(cube, C.BASE_YEAR)
    tr = calc.trends(cube)
    reg = calc.pixel_regression(cube, year)
    ranks = zone_rankings(cube, year)
    pers = calc.persistence(cube)
    pers_km2 = float((cube.land & (pers >= C.PERSISTENT_YEARS)).sum() * cube.cell_area_km2)
    comps = calc.hotspot_components(cube, year)
    fastest = max(tr["zones"], key=lambda z: z["d_lst"])
    greenest = min(ranks, key=lambda r: r["temperature"])
    out = [
        {"title": "Surface heat is rising", "tone": "hot", "body": f"City-mean LST in {year} is {c['lst_mean']:.1f} °C, {c['lst_mean'] - b['lst_mean']:+.2f} °C versus {C.BASE_YEAR}. The 2019–2024 trend is {tr['metrics']['lst']['slope_per_year']:+.2f} °C per year (R² {tr['metrics']['lst']['r2']:.2f}), projecting {tr['metrics']['lst']['projection_2030']:.1f} °C by 2030 if unchanged."},
        {"title": "Hotspots are structural", "tone": "hot", "body": f"{pers_km2:.1f} km² stayed above the 95th-percentile threshold in at least {C.PERSISTENT_YEARS} of 6 seasons. In {year} the hottest {100 - C.HOTSPOT_PERCENTILE:.0f}% of land ({c['hotspot_area_km2']:.1f} km², threshold {c['lst_p95']:.1f} °C) forms {len(comps)} connected clusters."},
        {"title": f"{ranks[0]['zone']} leads the ranking", "tone": "hot", "body": f"Mean LST {ranks[0]['temperature']:.1f} °C (peak {ranks[0]['peakTemperature']:.1f} °C) with {ranks[0]['persistence'] * 100:.0f}% of its area persistently hot — {ranks[0]['rationale']}."},
        {"title": "Vegetation cools measurably", "tone": "green", "body": f"NDVI and LST are inversely related (r = {np.sign(reg['b_ndvi']) * np.sqrt(max(0, calc.correlation(cube, year, 'ndvi')['r2'])):.2f}); each +0.1 NDVI is associated with {reg['b_ndvi'] * 0.1:+.2f} °C. Green cover (NDVI > 0.4) is {c['green_area_km2']:.0f} km² versus {b['green_area_km2']:.0f} km² in {C.BASE_YEAR}."},
        {"title": "Built-up expansion drives warming", "tone": "violet", "body": f"Built-up area (NDBI > 0.1) grew from {b['built_area_km2']:.0f} to {c['built_area_km2']:.0f} km². Each +0.1 NDBI adds {reg['b_ndbi'] * 0.1:+.2f} °C; the fastest-warming zone is {fastest['name']} ({fastest['d_lst']:+.1f} °C since {C.BASE_YEAR})."},
        {"title": "Cooling assets exist", "tone": "green", "body": f"{greenest['zone']} is the coolest zone at {greenest['temperature']:.1f} °C (NDVI {greenest['ndvi']:.2f}); forest, lake and campus canopy form the city's cooling network and should be protected."},
        {"title": "Model explains most variance", "tone": "sky", "body": f"A two-variable regression LST ~ NDVI + NDBI reaches R² {reg['r2']:.2f} (RMSE {reg['rmse']:.2f} °C) over {reg['n']:,} land cells, supporting land-cover levers as the primary planning instrument."},
        {"title": "Data confidence", "tone": "sky", "body": f"The {year} composite has {cube.quality(year)['completeness_pct']:.1f}% coverage from {cube.quality(year)['used'] + cube.quality(year)['partial']} usable scenes (residual cloud {cube.quality(year)['residual_cloud_pct']:.1f}%). Values are land-surface temperature at overpass, not air temperature."},
    ]
    return out


def recommendations(cube: SatelliteCube, year: int) -> list[dict]:
    ranks = zone_rankings(cube, year)
    tr = calc.trends(cube)
    critical = [r for r in ranks if r["severity"] == "Critical"][:4]
    growth = sorted(tr["zones"], key=lambda z: -z["ndbi_slope"])[:4]
    cool = sorted(ranks, key=lambda r: -r["ndvi"])[:3]
    return [
        {"priority": "Immediate", "title": "Cool the persistent dense hotspots", "body": "Cool-roof programme on commercial and dense residential roofs, shaded transit stops and market areas, pocket Miyawaki forests on vacant plots, and heat-health outreach before the next pre-monsoon season.", "zones": [r["short"] or r["zone"] for r in critical]},
        {"priority": "Near term", "title": "Condition growth approvals on cooling performance", "body": "Require ≥15% canopy, permeable parking, shaded streets and roof-albedo targets in rapidly urbanising corridors; monitor construction-driven NDBI change annually.", "zones": [next((z["properties"].get("short") or z["properties"]["name"]) for z in cube.zones if z["properties"]["zone_id"] == g["zone_id"]) for g in growth]},
        {"priority": "Monitor", "title": "Protect the cooling network", "body": "Maintain reserve forest, lake margins and institutional canopy; treat them as heat-mitigation infrastructure rather than developable land.", "zones": [r["short"] or r["zone"] for r in cool]},
    ]


def seasonal_patterns(cube: SatelliteCube, zone_id: str | None = None) -> dict:
    """Pre-monsoon composites per year plus a data-derived UHI intensity (urban core − peri-urban ring).
    Monsoon / winter composites are not part of the current archive and are reported as unavailable."""
    years = cube.available_years()
    series = []
    for y in years:
        if zone_id:
            st = calc.zone_stats(cube, zone_id, y)
            series.append({"year": y, "lst": st["lst_mean"], "ndvi": st["ndvi_mean"], "ndbi": st["ndbi_mean"]})
        else:
            c = calc.city_stats(cube, y)
            series.append({"year": y, "lst": c["lst_mean"], "ndvi": c["ndvi_mean"], "ndbi": c["ndbi_mean"]})
    core = cube.zone_mask("cbd") | cube.zone_mask("oldcity") | cube.zone_mask("dharampeth")
    ring = cube.land & (cube.zone_index == -1)
    uhi = [{"year": y, "urbanCore": float(cube.lst(y)[core].mean()), "periUrban": float(cube.lst(y)[ring].mean()), "intensity": float(cube.lst(y)[core].mean() - cube.lst(y)[ring].mean())} for y in years]
    return {"zoneId": zone_id, "series": series, "uhiIntensity": uhi,
            "seasons": [{"season": "Pre-monsoon (Mar–May)", "available": True, "meanLst": float(np.mean([s["lst"] for s in series])), "meanUhiIntensity": float(np.mean([u["intensity"] for u in uhi])), "note": "Peak surface heating; source of all composites in this archive."},
                        {"season": "Monsoon (Jun–Sep)", "available": False, "meanLst": None, "meanUhiIntensity": None, "note": "Persistent cloud cover prevents reliable thermal composites; not included."},
                        {"season": "Winter (Nov–Feb)", "available": False, "meanLst": None, "meanUhiIntensity": None, "note": "Add winter composites via the data-preparation script to enable seasonal comparison."}]}


# ---------------------------------------------------------------- GeoJSON products
def zone_feature_collection(cube: SatelliteCube, year: int | None = None) -> dict:
    feats = []
    for z in cube.zones:
        p = dict(z["properties"])
        p["area_km2"] = float(cube.zone_mask(p["zone_id"]).sum() * cube.cell_area_km2)
        if year:
            st = calc.zone_stats(cube, p["zone_id"], year)
            if st:
                p.update({"lst_mean": st["lst_mean"], "lst_max": st["lst_max"], "ndvi_mean": st["ndvi_mean"], "ndbi_mean": st["ndbi_mean"], "persistent_fraction": st["persistent_fraction"]})
        feats.append({"type": "Feature", "id": p["zone_id"], "properties": p, "geometry": z["geometry"]})
    return {"type": "FeatureCollection", "features": feats}


def layer_product(cube: SatelliteCube, layer: str, year: int, include_grid: bool = True) -> dict:
    arr = cube.layer(layer, year)
    v = cube.valid_mask(year)
    stats = {"min": float(arr[v].min()), "mean": float(arr[v].mean()), "max": float(arr[v].max()), "std": float(arr[v].std())}
    out = {"layer": layer, "year": year, "unit": "°C" if layer == "lst" else "index", "stats": stats, "bounds": list(cube.bounds), "resolution_m": C.GRID_RES_M,
           "quality_info": _quality_block(cube, year), "zones": zone_feature_collection(cube, year)}
    if include_grid:
        out["grid"] = grid_payload(arr, cube.lat, cube.lon)
    return out


def components_geojson(cube: SatelliteCube, comps: list[dict]) -> dict:
    return {"type": "FeatureCollection", "features": [{"type": "Feature", "id": c["id"], "properties": {k: v for k, v in c.items() if k not in ("centroid", "bbox")},
             "geometry": {"type": "Polygon", "coordinates": [[[c["bbox"][0], c["bbox"][1]], [c["bbox"][2], c["bbox"][1]], [c["bbox"][2], c["bbox"][3]], [c["bbox"][0], c["bbox"][3]], [c["bbox"][0], c["bbox"][1]]]]},
             "centroid": [c["centroid"]["lon"], c["centroid"]["lat"]]} for c in comps]}


def cells_geojson(cube: SatelliteCube, mask: np.ndarray, values: np.ndarray, prop: str, max_cells: int = 4000) -> dict:
    rows, cols = np.nonzero(mask)
    step = max(1, len(rows) // max_cells)
    feats = [{"type": "Feature", "properties": {prop: float(values[r, c])}, "geometry": {"type": "Polygon", "coordinates": [cell_polygon(int(r), int(c), cube.lat, cube.lon)]}} for r, c in zip(rows[::step], cols[::step])]
    return {"type": "FeatureCollection", "features": feats, "cellCount": int(mask.sum()), "sampled": step > 1}
