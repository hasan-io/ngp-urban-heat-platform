"""ML smoke tests (skipped when scikit-learn is missing)."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    import sklearn  # noqa: F401
    HAVE_SK = True
except ImportError:
    HAVE_SK = False

from nagpur_uhi.synthetic import generate


def _cube():
    return generate(grid_res_m=400)


def test_lst_models():
    if not HAVE_SK:
        return
    from nagpur_uhi.ml import train_lst_models
    res = train_lst_models(_cube(), 2024, n_splits=3)
    cv = res["cv"]
    assert all(0.6 < m["r2"] < 1.0 for m in cv.values())
    assert res["best"] in cv
    top = [d["key"] for d in res["permutation_importance"][:3]]
    assert "ndbi" in top                                   # built-up is the dominant driver
    assert np.isfinite(res["residual"][np.isfinite(res["residual"])]).all()


def test_clusters_islands_anomalies():
    if not HAVE_SK:
        return
    from nagpur_uhi.ml import cluster_land_cover, detect_anomalies, segment_heat_islands
    cube = _cube()
    lc = cluster_land_cover(cube, k=5)
    assert len(lc["classes"]) == 6 and lc["classes"][0]["label"] == "Water"
    assert lc["open_to_built_km2"] > lc["built_to_open_km2"]   # urbanisation
    isl = segment_heat_islands(cube)
    assert len(isl["islands"]) >= 3 and isl["islands"][0]["area_km2"] >= isl["islands"][-1]["area_km2"]
    an = detect_anomalies(cube, 2024)
    assert an["n_flagged"] > 0


def test_forecast_and_whatif():
    if not HAVE_SK:
        return
    from nagpur_uhi.ml import MLScenarioModel, forecast_lst
    cube = _cube()
    fc = forecast_lst(cube, 2030)
    assert fc["city_mean_target"] > fc["city_mean_last"]
    assert all(np.isfinite(b["rmse"]) and b["rmse"] < 3 for b in fc["backtest"])
    sm = MLScenarioModel.from_cube(cube)
    r = sm.run("besa", veg_delta_pct=20)
    assert r["d_lst_ml"] < 0 and r["d_lst_linear"] < 0
    assert sm.run("cbd", built_delta_pct=20)["d_lst_ml"] > 0


if __name__ == "__main__":
    if not HAVE_SK:
        print("scikit-learn not installed — ML tests skipped")
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok  {name}")
    print("all tests passed")
