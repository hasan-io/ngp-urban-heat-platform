import base64

ENVELOPE = {"success", "data", "error", "timestamp"}


def _ok(r):
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == ENVELOPE and body["success"] is True and body["error"] is None
    return body["data"]


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok" and r.json()["years_available"] == [2019, 2020, 2021, 2022, 2023, 2024]


def test_overview_contract(client):
    d = _ok(client.get("/api/overview?year=2024"))
    assert set(d["kpis"]) >= {"averageTemperature", "maximumTemperature", "hotspotCount", "vegetationChange", "averageNdvi", "averageNdbi"}
    assert 30 < d["kpis"]["averageTemperature"] < 47 and d["kpis"]["hotspotCount"] > 0
    assert set(d["quality"]) >= {"label", "completeness", "clearScenes", "residualCloud"} and d["source"] == "api"


def test_year_validation(client):
    r = client.get("/api/overview?year=2030")
    assert r.status_code == 400 and r.json()["success"] is False and "2019" in r.json()["error"]


def test_hotspots(client):
    d = _ok(client.get("/api/hotspots/top?year=2024&limit=8"))
    assert len(d) == 8 and d[0]["rank"] == 1 and d[0]["temperature"] >= d[-1]["temperature"]
    assert set(d[0]) >= {"zoneId", "zone", "temperature", "peakTemperature", "severity", "persistence", "areaKm2", "priority"}
    comps = _ok(client.get("/api/hotspots/components?year=2024"))["components"]
    assert len(comps) >= 8


def test_data_products(client):
    d = _ok(client.get("/api/data/lst?year=2024"))
    assert d["grid"]["shape"] == [133, 146] and d["zones"]["type"] == "FeatureCollection" and 30 < d["stats"]["mean"] < 47
    d = _ok(client.get("/api/data/delta-lst?year1=2019&year2=2024"))
    assert d["stats"]["mean"] > 0
    d = _ok(client.get("/api/data/persistent-hotspots?year_range=2019-2024"))
    assert d["yearsRequired"] == 6 and d["cellCount"] > 0 and d["components"]["type"] == "FeatureCollection"
    assert client.get("/api/data/persistent-hotspots?year_range=nonsense").status_code == 400


def test_zones(client):
    d = _ok(client.get("/api/zones"))
    assert d["count"] >= 16
    s = _ok(client.get("/api/zones/besa/stats?year=2024"))
    assert s["stats"]["lst_min"] <= s["stats"]["lst_mean"] <= s["stats"]["lst_max"] and "trend" in s
    r = client.get("/api/zones/invalid-zone/stats?year=2024")
    assert r.status_code == 404 and "invalid-zone" in r.json()["error"]


def test_analysis(client):
    for kind, sign in (("ndvi-lst", -1), ("ndbi-lst", 1)):
        d = _ok(client.get(f"/api/analysis/scatter/{kind}?year=2024"))
        assert d["n"] == 1100 and len(d["points"]) == 1100 and sign * d["slope"] > 0 and 0 < d["r2"] <= 1 and "equation" in d
    t = _ok(client.get("/api/analysis/trends"))
    assert t["years"] == [2019, 2020, 2021, 2022, 2023, 2024] and t["metrics"]["lst"]["slope_per_year"] > 0
    assert t["projection"][-1]["year"] == 2030 and t["projection"][-1]["lo"] < t["projection"][-1]["lst"] < t["projection"][-1]["hi"]


def test_scenario(client):
    d = _ok(client.post("/api/scenario/predict", json={"zoneId": "besa", "baseline": "2024", "vegetationChange": 20, "builtUpChange": -5}))
    assert d["deltaLst"] < -0.5 and d["confidence"] in {"High", "Medium", "Indicative"} and d["before"]["lst"] > d["after"]["lst"]
    assert d["mlEstimate"] is not None and d["mlEstimate"]["deltaLst"] < 0 and "explanation" in d
    d2 = _ok(client.post("/api/scenario/predict", json={"zone_id": "cbd", "baseline_year": 2030, "vegetation_change": 0, "built_up_change": 10, "method": "linear"}))
    assert d2["deltaLst"] > 0 and d2["baselineYear"] == 2030
    assert client.post("/api/scenario/predict", json={"zoneId": "besa", "vegetationChange": 60}).status_code == 400
    assert client.post("/api/scenario/predict", json={"zoneId": "besa", "builtUpChange": -40}).status_code == 400
    assert client.post("/api/scenario/predict", json={"zoneId": "nope"}).status_code == 404
    s = _ok(client.get("/api/scenario/sensitivity-curve?zone_id=besa&baseline_year=2024"))
    pts = s["points"]
    assert pts[0]["vegetationChange"] == -30 and pts[-1]["vegetationChange"] == 50 and len(pts) == 17
    assert pts[-1]["linear"] < pts[0]["linear"] and any(p["ml"] is not None for p in pts)
    ra = _ok(client.get("/api/scenario/rasters?zone_id=besa&vegetation_change=20&built_up_change=0"))
    assert ra["after"]["zoneMeanLst"] < ra["before"]["zoneMeanLst"]
    png = base64.b64decode(ra["before"]["image"].split(",", 1)[1])
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_insights_and_reports(client):
    d = _ok(client.get("/api/insights/findings?year=2024"))
    assert 6 <= len(d["findings"]) <= 8 and all(f["tone"] in {"hot", "green", "violet", "sky"} for f in d["findings"]) and len(d["recommendations"]) == 3
    r = _ok(client.get("/api/insights/hotspot-rankings?year=2024"))
    assert r[0]["rank"] == 1 and "rationale" in r[0]
    s = _ok(client.get("/api/insights/seasonal-patterns"))
    assert len(s["series"]) == 6 and s["seasons"][0]["available"] is True
    rep = _ok(client.post("/api/reports/generate", json={"year": 2024}))
    assert rep["id"].startswith("NMC-UHI-2024") and len(rep["sections"]) == 8 and rep["status"] == "completed" and "content" in rep
    assert _ok(client.get(f"/api/reports/{rep['id']}"))["id"] == rep["id"]
    ex = _ok(client.post("/api/reports/generate", json={"year": 2023, "report_type": "executive"}))
    assert len(ex["sections"]) == 4


def test_raster_cube_contract(client):
    s = client.get("/api/summary").json()
    assert s["meta"]["bbox"] == [78.94, 21.02, 79.22, 21.26] and s["meta"]["years"] == [2019, 2020, 2021, 2022, 2023, 2024]
    r = client.get("/api/raster/water/2024").json()
    assert r["shape"] == [133, 146] and len(r["values"]) == 133
    assert client.get("/api/raster/lst/2024").json()["metric"] == "lst"
    assert isinstance(client.get("/api/scenes").json(), list)


def test_cache_speedup(client):
    client.post("/api/cache/clear")
    t1 = float(client.get("/api/data/persistent-hotspots").headers["X-Response-Time-ms"])
    t2 = float(client.get("/api/data/persistent-hotspots").headers["X-Response-Time-ms"])
    assert t2 <= t1
