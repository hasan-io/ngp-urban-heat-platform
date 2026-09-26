import numpy as np

from app.utils import calculations as F
from app.utils.geospatial_utils import box_mean, make_grid, points_in_polygon


def test_indices():
    nir, red, swir = np.array([0.4, 0.3]), np.array([0.1, 0.3]), np.array([0.2, 0.5])
    assert np.allclose(F.ndvi(nir, red), [0.6, 0.0], atol=1e-4)
    assert np.allclose(F.ndbi(swir, nir), [-1 / 3, 0.25], atol=1e-4)


def test_lst_chain_is_physical():
    dn = np.array([31500, 34000], dtype=np.float32)   # typical Level-1 B10 DNs for a Nagpur pre-monsoon scene
    rad = F.dn_to_radiance(dn)
    bt = F.radiance_to_brightness_temperature(rad)
    eps = F.land_surface_emissivity(np.array([0.1, 0.6]))
    lst = F.brightness_to_lst_celsius(bt, eps)
    assert np.all((0.95 < eps) & (eps < 1.0))
    assert np.all(lst > bt - 273.15)          # emissivity < 1 raises LST above brightness temperature
    assert 30 < lst[0] < 50 and lst[1] > lst[0]
    c2 = F.lst_from_collection2(np.array([44500, 49000]))
    assert 25 < c2[0] < 35 and 38 < c2[1] < 50


def test_qa_mask_bits():
    qa = np.array([0, 1 << 3, 1 << 4, 1 << 2, (1 << 6) | (1 << 7)], dtype=np.uint16)
    assert F.landsat_clear_mask(qa).tolist() == [True, False, False, False, True]
    assert F.landsat_water_mask(qa).tolist() == [False, False, False, False, True]


def test_regression_helpers():
    x = np.arange(6, dtype=float)
    slope, intercept, r2 = F.linear_fit(x, 2 * x + 1)
    assert abs(slope - 2) < 1e-9 and abs(intercept - 1) < 1e-9 and r2 > 0.999
    y = 1 + 2 * x - 3 * x ** 0.5
    beta, r2, _ = F.multiple_regression(y, x, x ** 0.5)
    assert np.allclose(beta, [1, 2, -3], atol=1e-6) and r2 > 0.999


def test_grid_and_geometry():
    lat, lon = make_grid()
    assert lat[0] > lat[-1] and lon[0] < lon[-1]
    lon2d, lat2d = np.meshgrid(lon, lat)
    inside = points_in_polygon(lon2d, lat2d, [(79.07, 21.158), (79.095, 21.158), (79.095, 21.135), (79.07, 21.135)])
    assert 50 < inside.sum() < 400
    a = np.zeros((5, 5)); a[2, 2] = 25
    assert abs(box_mean(a, 1)[2, 2] - 25 / 9) < 1e-6
