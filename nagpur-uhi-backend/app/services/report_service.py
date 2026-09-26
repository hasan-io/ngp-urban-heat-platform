"""Builds structured decision briefs from the analysis stack."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.ml import models as ml_models
from app.services import analysis_service as ana
from app.services import calculation_service as calc
from app.services import prediction_service as pred
from app.services.satellite_data_service import SatelliteCube
from app.utils import constants as C

ALL_SECTIONS = ["summary", "findings", "hotspots", "trends", "recommendations", "scenario", "quality", "methodology"]
TYPE_SECTIONS = {"executive": ["summary", "findings", "hotspots", "recommendations"], "technical": ["summary", "trends", "scenario", "quality", "methodology"], "full": ALL_SECTIONS}


def generate(cube: SatelliteCube, year: int, report_type: str = "full", include: list[str] | None = None) -> dict:
    wanted = [s for s in (include or TYPE_SECTIONS[report_type]) if s in ALL_SECTIONS]
    ov = ana.overview(cube, year)
    ranks = ana.zone_rankings(cube, year)
    fnd = ana.findings(cube, year)
    rec = ana.recommendations(cube, year)
    tr = calc.trends(cube)
    coef = pred.linear_coefficients(cube)
    model = ml_models.get_model(cube, allow_train=False)
    q = cube.quality(year)
    now = datetime.now(timezone.utc)
    k = ov["kpis"]
    sections_map = {
        "summary": {"heading": "Executive summary", "body": f"The {year} pre-monsoon composite records a city-mean land-surface temperature of {k['averageTemperature']:.1f} °C and a mapped maximum of {k['maximumTemperature']:.1f} °C. {k['hotspotCount']:,} cells ({ov['hotspotAreaKm2']:.1f} km²) exceed the hotspot threshold of {ov['hotspotThreshold']:.1f} °C. Since {C.BASE_YEAR} the city mean has changed by {ov['changeSinceBase']['lst']:+.2f} °C while built-up area grew to {ov['areas']['builtKm2']:.0f} km².",
                    "highlights": [f"{k['averageTemperature']:.1f} °C city-mean LST", f"{k['hotspotCount']:,} hotspot cells", f"{ov['quality']['completeness']:.1f}% composite coverage", f"{tr['metrics']['lst']['slope_per_year']:+.2f} °C / year trend"]},
        "findings": {"heading": "Key findings", "body": "\n\n".join(f"{f['title']}: {f['body']}" for f in fnd), "highlights": [f["title"] for f in fnd[:6]]},
        "hotspots": {"heading": "Priority hotspots", "body": "Zones ranked by mean surface temperature with severity derived from temperature and hotspot persistence. These areas require focused mitigation before the next summer season.", "highlights": [f"{r['rank']}. {r['zone']}: {r['temperature']:.1f} °C · {r['severity']} · {r['persistence'] * 100:.0f}% persistent" for r in ranks[:8]],
                     "table": [{k2: r[k2] for k2 in ("rank", "zone", "temperature", "peakTemperature", "severity", "priority", "persistence", "areaKm2", "rationale")} for r in ranks]},
        "trends": {"heading": "Trends & outlook", "body": f"LST trend {tr['metrics']['lst']['slope_per_year']:+.3f} °C/yr (R² {tr['metrics']['lst']['r2']:.2f}); NDVI {tr['metrics']['ndvi']['slope_per_year']:+.4f}/yr; NDBI {tr['metrics']['ndbi']['slope_per_year']:+.4f}/yr. Linear extrapolation gives a 2030 city mean of {tr['metrics']['lst']['projection_2030']:.1f} °C (±{tr['metrics']['lst']['sigma']:.1f} °C seasonal variability). Projections are business-as-usual and not weather forecasts.",
                   "highlights": [f"2030 LST ≈ {tr['metrics']['lst']['projection_2030']:.1f} °C", f"Fastest warming: {max(tr['zones'], key=lambda z: z['d_lst'])['name']}"], "series": tr["city"], "projection": tr["projection"]},
        "recommendations": {"heading": "Planning recommendations", "body": "\n\n".join(f"{r['priority']}: {r['title']} — {r['body']} (Focus: {', '.join(r['zones'])})" for r in rec), "highlights": [f"{r['priority']}: {r['title']}" for r in rec]},
        "scenario": {"heading": "Scenario model", "body": f"Linear coefficients learned from the {coef['year']} pixel regression: {coef['vegetation_coeff']:+.3f} °C per +1% vegetation cover and {coef['built_up_coeff']:+.3f} °C per +1% impervious cover (R² {coef['r2']:.2f}). " + (f"Non-linear {model.metadata.get('backend')} model: held-out R² {model.r2:.2f}, RMSE {model.metadata.get('rmse', 0):.2f} °C (spatial block CV)." if model else "Non-linear model not trained."),
                     "highlights": [f"+20% vegetation ≈ {coef['vegetation_coeff'] * 20:+.2f} °C", f"+10% built-up ≈ {coef['built_up_coeff'] * 10:+.2f} °C"]},
        "quality": {"heading": "Data quality", "body": f"{q['used'] + q['partial']} usable scenes ({q['used']} clear, {q['partial']} partially masked, {q['rejected']} rejected); composite coverage {q['completeness_pct']:.1f}%, residual cloud {q['residual_cloud_pct']:.1f}%. Source: {q['source']}.", "highlights": [f"Quality: {q['quality']}", f"Sensors: {', '.join(q['sensors'])}"]},
        "methodology": {"heading": "Method note", "body": "LST from Landsat 8/9 thermal data (radiance → brightness temperature → NDVI-threshold emissivity → LST); NDVI = (NIR−Red)/(NIR+Red); NDBI = (SWIR1−NIR)/(SWIR1+NIR). Hotspots: cells above the 95th percentile, grouped by 8-connectivity; persistence counts seasons. Trends: OLS over 2019–2024. Values are land-surface temperature at satellite overpass, not air temperature; validate priority sites with ground surveys before procurement."},
    }
    sections = [sections_map[s] for s in wanted]
    report_id = f"NMC-UHI-{year}-{uuid.uuid4().hex[:8].upper()}"
    return {
        # frontend ReportResponse
        "id": report_id, "title": f"Nagpur Urban Heat Island Brief — {year} pre-monsoon composite", "generatedAt": now.strftime("%d %b %Y, %H:%M UTC"),
        "period": f"1 March–31 May {year}", "sections": sections,
        # brief-style envelope
        "report_id": report_id, "status": "completed", "generated_at": now.isoformat(), "report_type": report_type,
        "content": {"title": f"Nagpur Urban Heat Island Brief — {year}", "metadata": {"year": year, "reportType": report_type, "aoi": "Nagpur", "grid_res_m": C.GRID_RES_M, "sections": wanted, "dataSource": q["source"]},
                    "sections": {s: sections_map[s] for s in wanted}},
    }
