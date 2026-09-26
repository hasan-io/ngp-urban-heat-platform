"""Smoke tests — run with `python -m pytest python/tests` or plain `python python/tests/test_pipeline.py`."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nagpur_uhi import config as C
from nagpur_uhi.indices import brightness_temperature, emissivity_from_ndvi, fit_lst_model, lst_from_collection2, lst_single_channel, ndbi, ndvi, toa_radiance
from nagpur_uhi.preprocess import landsat_clear_mask, median_composite, sentinel_clear_mask, fill_gaps
from nagpur_uhi.scenario import ScenarioModel
from nagpur_uhi.synthetic import generate
from nagpur_uhi.temporal import change_classes, getis_ord_gi_star, hotspot_persistence, per_pixel_trend
from nagpur_uhi.zones import rasterize_zones, zonal_stats


def test_indices():
    nir, red, swir = np.array([0.4, 0.3]), np.array([0.1, 0.3]), np.array([0.2, 0.5])
    assert np.allclose(ndvi(nir, red), [0.6, 0.0], atol=1e-4)
    assert np.allclose(ndbi(swir, nir), [-1 / 3, 0.25], atol=1e-4)


def test_lst_chain():
    dn = np.array([44500, 49000], dtype=np.int32)          # typical C2 L2 ST_B10 DNs (≈ 27 °C, 43 °C)
    c = lst_from_collection2(dn)
    assert 25 < c[0] < 35 and 35 < c[1] < 50
    bt = brightness_temperature(toa_radiance(np.array([9000, 10500])))
    eps = emissivity_from_ndvi(np.array([0.1, 0.6]))
    lst = lst_single_channel(bt, eps)
    assert np.all(lst > bt - 273.15)                        # emissivity < 1 raises LST above BT
    assert np.all((0.95 < eps) & (eps < 1.0))


def test_masks():
    qa = np.array([0, 1 << 3, 1 << 4, 1 << 2, (1 << 6) | (1 << 7)], dtype=np.uint16)
    assert landsat_clear_mask(qa).tolist() == [True, False, False, False, True]
    assert sentinel_clear_mask(np.array([4, 5, 8, 9, 3, 6])).tolist() == [True, True, False, False, False, True]


def test_composite():
    a = np.array([[1.0, np.nan], [3.0, 4.0]], dtype=np.float32)
    b = np.array([[2.0, np.nan], [np.nan, 6.0]], dtype=np.float32)
    med, cnt = median_composite([a, b])
    assert med[0, 0] == 1.5 and np.isnan(med[0, 1]) and med[1, 0] == 3.0 and med[1, 1] == 5.0
    assert cnt.tolist() == [[2, 0], [1, 2]]
    assert np.isfinite(fill_gaps(med)).all()


def test_end_to_end():
    cube = generate(grid_res_m=400)                         # coarse grid keeps the test fast
    assert cube.shape[0] > 40 and cube.shape[1] > 40
    y0, y1 = cube.years[0], cube.years[-1]
    assert np.nanmean(cube.lst[y1]) > np.nanmean(cube.lst[y0])          # warming trend
    model = fit_lst_model(cube, y1)
    assert model.b_ndvi < 0 < model.b_ndbi and model.r2 > 0.6          # physically sensible, decent fit
    slope, _, r2 = per_pixel_trend(cube.stack("lst"), cube.years)
    assert np.nanmean(slope[cube.land]) > 0
    pers = hotspot_persistence(cube)
    assert pers.max() == len(cube.years)
    z = getis_ord_gi_star(cube.lst[y1], cube.land)
    assert np.nanmax(z) > 1.96
    cls = change_classes(cube, y0, y1)
    assert (cls == 3).any()                                  # somewhere trees were lost AND concrete came up
    zone_idx = rasterize_zones(cube)
    rows = zonal_stats(cube, zone_idx)
    assert len(rows) == len(C.ZONES)
    hottest = max(rows, key=lambda r: r["by_year"][y1]["lst"])
    assert hottest["id"] in ("cbd", "dharampeth", "oldcity", "jaripatka", "nandanvan")
    sm = ScenarioModel.from_cube(cube, zone_idx, rows)
    r = sm.run("besa", veg_delta_pct=20)
    assert r.d_lst < -0.5                                    # +20 % canopy cools by more than half a degree
    r2_ = sm.run("cbd", buildings=25)
    assert r2_.d_lst > 0 and r2_.buildings_equivalent == 25
    r3 = sm.run("wathoda", veg_delta_pct=15, built_delta_pct=-10, baseline_year=2030)
    assert r3.before["lst"] > sm.run("wathoda").before["lst"]  # BAU 2030 baseline is hotter than 2024


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok  {name}")
    print("all tests passed")
