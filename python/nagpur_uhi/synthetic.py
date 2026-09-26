"""Synthetic Nagpur data cube — offline demo & pipeline tests.

A physically-motivated land-cover model calibrated to Nagpur's geography (reserve
forests, lakes, CBD, MIHAN SEZ, growth corridors, industrial heat) produces the
same `Cube` structure the real Landsat/Sentinel pipeline emits, so every downstream
module runs unchanged:

    python -m nagpur_uhi run-all --source demo
"""
from __future__ import annotations

import numpy as np

from . import config as C
from .cube import Cube, make_grid

# (lat, lon, rx_km, ry_km, rot_deg, strength)
FORESTS = [
    (21.205, 79.032, 2.8, 2.3, 20, 1.0), (21.163, 79.061, 1.0, 0.8, 10, 0.95), (21.117, 79.030, 1.7, 1.1, -15, 0.9),
    (21.156, 79.054, 0.45, 0.4, 0, 0.7), (21.151, 79.069, 0.7, 0.55, 0, 0.5), (21.125, 79.051, 0.6, 0.5, 0, 0.6),
    (21.075, 78.962, 2.2, 1.6, 30, 0.75), (21.245, 78.975, 2.2, 1.5, -10, 0.6), (21.098, 79.008, 1.6, 1.0, 40, 0.6),
    (21.058, 79.175, 2.0, 1.4, 15, 0.5), (21.238, 79.125, 1.3, 0.9, 0, 0.5), (21.110, 78.945, 1.4, 1.0, 0, 0.45),
]
LAKES = [
    (21.129, 79.043, 0.95, 0.42, -25), (21.158, 79.047, 0.45, 0.33, 0), (21.197, 79.047, 0.6, 0.38, 30),
    (21.148, 79.101, 0.22, 0.2, 0), (21.103, 79.062, 0.24, 0.2, 0), (21.125, 79.108, 0.2, 0.18, 0),
    (21.155, 79.112, 0.15, 0.14, 0), (21.247, 79.098, 0.75, 0.4, -10),
]
URBAN_CORES = [
    (21.148, 79.090, 3.6, 3.0, 10, 1.0), (21.140, 79.060, 1.5, 1.2, 0, 0.8), (21.128, 79.120, 1.9, 1.5, 0, 0.85),
    (21.115, 79.066, 1.5, 1.3, 0, 0.75), (21.181, 79.100, 1.9, 1.4, 0, 0.8), (21.120, 79.042, 1.1, 0.9, 0, 0.65),
    (21.106, 79.096, 1.3, 1.1, 0, 0.7), (21.150, 79.000, 1.2, 1.0, 0, 0.6), (21.225, 79.195, 1.6, 1.3, 0, 0.7),
    (21.102, 79.122, 1.2, 1.0, 0, 0.55),
]
# (lat, lon, rx, ry, rot, strength, extra_heat_C, growth_share)
INDUSTRIAL = [
    (21.045, 79.030, 2.3, 1.8, 20, 0.85, 2.2, 0.6), (21.108, 78.976, 1.6, 1.1, -20, 0.9, 2.6, 0.0),
    (21.168, 79.132, 1.0, 0.8, 0, 0.8, 1.8, 0.0), (21.187, 79.116, 1.0, 0.8, 0, 0.8, 1.9, 0.0),
    (21.246, 79.088, 0.9, 0.65, 0, 0.95, 3.4, 0.0), (21.028, 78.985, 1.4, 0.9, 35, 0.6, 1.8, 0.4),
]
AIRPORT = (21.092, 79.049, 1.7, 0.55, -50, 1.0)
# (lat, lon, rx, ry, rot, strength, base_share_in_2019)
GROWTH = [
    (21.064, 79.086, 2.0, 1.6, 15, 1.0, 0.2), (21.090, 79.075, 1.3, 1.1, 0, 0.8, 0.45), (21.045, 79.062, 1.6, 1.2, -30, 0.8, 0.25),
    (21.112, 79.142, 1.7, 1.3, 0, 0.9, 0.25), (21.098, 79.118, 1.0, 0.9, 0, 0.6, 0.4), (21.212, 79.080, 1.4, 1.1, 0, 0.7, 0.3),
    (21.158, 78.990, 1.3, 1.0, 0, 0.6, 0.35), (21.160, 79.148, 1.4, 1.0, 0, 0.7, 0.35), (21.060, 79.020, 1.3, 1.0, 0, 0.7, 0.2),
    (21.190, 79.070, 1.2, 1.0, 0, 0.6, 0.4), (21.112, 78.958, 1.2, 0.9, 0, 0.5, 0.3), (21.085, 79.110, 1.2, 1.0, 0, 0.6, 0.3),
]
ROADS = [  # (strength, half_width_km, [(lat, lon), ...])
    (0.6, 0.35, [(21.146, 79.082), (21.12, 79.07), (21.09, 79.06), (21.05, 79.045), (21.02, 79.03)]),
    (0.55, 0.32, [(21.15, 79.09), (21.18, 79.1), (21.21, 79.12), (21.26, 79.17)]),
    (0.5, 0.3, [(21.146, 79.082), (21.148, 79.05), (21.15, 79.01), (21.16, 78.94)]),
    (0.5, 0.3, [(21.148, 79.09), (21.15, 79.13), (21.155, 79.17), (21.16, 79.22)]),
    (0.45, 0.28, [(21.145, 79.1), (21.12, 79.12), (21.09, 79.15), (21.06, 79.19)]),
    (0.45, 0.28, [(21.15, 79.08), (21.17, 79.06), (21.2, 79.03), (21.24, 78.98)]),
    (0.45, 0.28, [(21.14, 79.07), (21.13, 79.04), (21.12, 79.0), (21.11, 78.95)]),
    (0.4, 0.26, [(21.16, 79.08), (21.2, 79.085), (21.26, 79.09)]),
    (0.35, 0.25, [(21.226, 79.09), (21.2, 79.155), (21.14, 79.181), (21.08, 79.155), (21.054, 79.09), (21.08, 79.025), (21.14, 78.999), (21.2, 79.025), (21.226, 79.09)]),
    (0.4, 0.22, [(21.185, 79.085), (21.173, 79.115), (21.145, 79.128), (21.117, 79.115), (21.105, 79.085), (21.117, 79.055), (21.145, 79.042), (21.173, 79.055), (21.185, 79.085)]),
]
RIVERS = [
    (1.0, 0.18, [(21.128, 79.05), (21.135, 79.062), (21.14, 79.08), (21.145, 79.1), (21.14, 79.13), (21.135, 79.17), (21.13, 79.22)]),
    (0.8, 0.15, [(21.19, 78.99), (21.185, 79.04), (21.18, 79.09), (21.17, 79.13), (21.16, 79.17)]),
    (0.6, 0.12, [(21.07, 79.14), (21.09, 79.17), (21.11, 79.2)]),
]
# seasonal anomalies (°C, NDVI) per year
ANOMALY = {2019: (0.6, -0.02), 2020: (-0.45, 0.015), 2021: (-0.2, 0.01), 2022: (0.5, -0.012), 2023: (-0.1, 0.0), 2024: (0.75, -0.015)}
LST_TREND = 0.18  # °C / yr background + densification


# ---------------------------------------------------------------------------- noise
def _hash(ix, iy, seed):
    h = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263 + int(seed) * 1442695041) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h ^= h >> 16
    return h / 4294967295.0


def value_noise(x, y, seed):
    x0, y0 = np.floor(x), np.floor(y)
    fx, fy = x - x0, y - y0
    ix, iy = x0.astype(np.int64), y0.astype(np.int64)
    a, b, c, d = _hash(ix, iy, seed), _hash(ix + 1, iy, seed), _hash(ix, iy + 1, seed), _hash(ix + 1, iy + 1, seed)
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    return ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy) * 2 - 1


def fbm(x, y, seed, octaves=4, lacunarity=2.1, gain=0.5):
    amp, freq, total, norm = 1.0, 1.0, np.zeros_like(x), 0.0
    for i in range(octaves):
        total = total + amp * value_noise(x * freq + i * 17.3, y * freq - i * 9.1, seed + i * 101)
        norm += amp
        amp *= gain
        freq *= lacunarity
    return total / norm


# ---------------------------------------------------------------------------- geometry
def _km(lat, lon):
    return (lon - C.CITY_CENTER[1]) * C.KM_PER_DEG_LON, (lat - C.CITY_CENTER[0]) * C.KM_PER_DEG_LAT


def ellipse_dist(x, y, lat, lon, rx, ry, rot=0.0):
    ex, ey = _km(lat, lon)
    r = np.deg2rad(rot)
    c, s = np.cos(r), np.sin(r)
    dx, dy = x - ex, y - ey
    xr, yr = dx * c + dy * s, -dx * s + dy * c
    return np.sqrt((xr / rx) ** 2 + (yr / ry) ** 2)


def polyline_dist(x, y, pts):
    best = np.full(x.shape, np.inf)
    P = [_km(lat, lon) for lat, lon in pts]
    for (ax, ay), (bx, by) in zip(P[:-1], P[1:]):
        vx, vy = bx - ax, by - ay
        l2 = vx * vx + vy * vy or 1e-9
        t = np.clip(((x - ax) * vx + (y - ay) * vy) / l2, 0, 1)
        best = np.minimum(best, np.hypot(x - (ax + t * vx), y - (ay + t * vy)))
    return best


def _smoothstep(a, b, t):
    u = np.clip((t - a) / (b - a), 0, 1)
    return u * u * (3 - 2 * u)


def _soft(d, inner, outer):
    return 1 - _smoothstep(inner, outer, d)


# ---------------------------------------------------------------------------- generator
def generate(grid_res_m: float = C.GRID_RES_M, years=C.YEARS, seed: int = 7) -> Cube:
    lat, lon = make_grid(res_m=grid_res_m)
    lon2d, lat2d = np.meshgrid(lon, lat)
    x, y = _km(lat2d, lon2d)

    core = 1 - np.prod([1 - s * np.exp(-ellipse_dist(x, y, la, lo, rx, ry, rot) ** 2 * 0.9) for la, lo, rx, ry, rot, s in URBAN_CORES], axis=0)
    forest = np.max([s * _soft(ellipse_dist(x, y, la, lo, rx, ry, rot) + 0.12 * value_noise(x * 1.8, y * 1.8, 77 + seed), 0.72, 1.15) for la, lo, rx, ry, rot, s in FORESTS], axis=0)
    water = np.any([ellipse_dist(x, y, la, lo, rx, ry, rot) + 0.1 * value_noise(x * 3, y * 3, 91 + seed) < 1 for la, lo, rx, ry, rot in LAKES], axis=0)
    ind0 = ind1 = np.zeros_like(x)
    heat = np.zeros_like(x)
    for la, lo, rx, ry, rot, s, h, gr in INDUSTRIAL:
        m = s * _soft(ellipse_dist(x, y, la, lo, rx, ry, rot), 0.6, 1.2)
        ind0 = ind0 + m * (1 - gr)
        ind1 = ind1 + m * gr
        heat = np.maximum(heat, m * h)
    ind0, ind1 = np.minimum(ind0, 1), np.minimum(ind1, 1)
    airport = _soft(ellipse_dist(x, y, *AIRPORT[:5]), 0.7, 1.1)
    road = np.max([s * _soft(polyline_dist(x, y, pts), w * 0.5, w * 2.2) for s, w, pts in ROADS], axis=0)
    river = np.max([s * _soft(polyline_dist(x, y, pts), w * 0.4, w * 2) for s, w, pts in RIVERS], axis=0)
    g0 = np.sum([s * base * np.exp(-ellipse_dist(x, y, la, lo, rx, ry, rot) ** 2 * 1.1) for la, lo, rx, ry, rot, s, base in GROWTH], axis=0)
    g1 = np.sum([s * (1 - base) * np.exp(-ellipse_dist(x, y, la, lo, rx, ry, rot) ** 2 * 1.1) for la, lo, rx, ry, rot, s, base in GROWTH], axis=0)
    nB, nV, nL = fbm(x / 1.4, y / 1.4, 11 + seed), fbm(x / 1.1, y / 1.1, 23 + seed), fbm(x / 0.9, y / 0.9, 37 + seed)

    ndvi_y, ndbi_y, lst_y, count_y = {}, {}, {}, {}
    rng = np.random.default_rng(seed)
    for yr in years:
        t = ((yr - years[0]) / max(1, years[-1] - years[0])) ** 0.9
        a_lst, a_ndvi = ANOMALY.get(yr, (0.0, 0.0))
        nY = fbm(x / 0.7 + yr * 3.1, y / 0.7 - yr * 1.7, 500 + yr)
        g = np.minimum(1, g0 + g1 * t)
        ind = np.minimum(1, ind0 + ind1 * t)
        coreD = core * (1 + 0.06 * t)
        B = 1 - (1 - 0.86 * coreD) * (1 - 0.78 * ind) * (1 - 0.5 * road) * (1 - 0.72 * g) * (1 - 0.7 * airport) * 0.95
        B = np.clip(B * (1 - 0.92 * forest) * (1 + 0.14 * nB), 0, 1)
        V = (0.3 + 0.62 * forest + 0.12 * river + 0.06 * nV) * (1 - 0.88 * B) + a_ndvi * 1.3 + 0.02 * nY
        V = np.where(B > 0.3, V * (1 - 0.012 * (yr - years[0])), V)  # tree felling in urbanised areas
        V = np.clip(V, 0, 1)
        ndvi = np.clip(0.06 + 0.72 * V + 0.03 * nY, -0.05, 0.92)
        ndbi = np.clip(-0.32 + 0.75 * B + 0.12 * ind + 0.08 * airport + 0.04 * nB + 0.02 * nY, -0.5, 0.7)
        # non-linear response: canopy cooling saturates with NDVI, impervious heating has a threshold at NDBI ~0.15
        nd = np.maximum(0.0, ndvi)
        lst = (42.25 + 8.0 * ndbi + 1.8 / (1 + np.exp(-(ndbi - 0.15) / 0.07)) - 10.5 * (1 - np.exp(-2.0 * nd))
               + heat + 1.6 * airport + LST_TREND * (yr - years[0]) + a_lst
               + 2.4 * nL + 1.3 * nY + 0.9 * rng.uniform(-1, 1, x.shape))
        # water bodies
        ndvi = np.where(water, -0.12 + 0.04 * nY, ndvi)
        ndbi = np.where(water, -0.46 + 0.04 * nV, ndbi)
        lst = np.where(water, 30.4 + 0.12 * (yr - years[0]) + a_lst * 0.4 + 0.35 * nY, lst)
        ndvi_y[yr], ndbi_y[yr], lst_y[yr] = ndvi.astype(np.float32), ndbi.astype(np.float32), lst.astype(np.float32)
        count_y[yr] = rng.integers(3, 9, x.shape).astype(np.int16)

    return Cube(years=list(years), lat=lat, lon=lon, ndvi=ndvi_y, ndbi=ndbi_y, lst=lst_y, count=count_y, water=water,
                meta={"source": "synthetic", "grid_res_m": grid_res_m, "crs": C.CRS_WEB, "note": "model-generated demo data calibrated to Nagpur geography"})


def demo_catalogue(years=C.YEARS, seed: int = 20240521):
    """Plausible Landsat/Sentinel acquisition list so quality indicators can be demonstrated offline."""
    import datetime as dt

    from .fetch import SceneRecord, _status

    rng = np.random.default_rng(seed)
    recs = []
    for yr in years:
        def cloud(month):
            base = 0.3 if month == 5 else 0.18 if month == 4 else 0.12
            return float(round(rng.uniform(0, 12), 1)) if rng.random() < 1 - base else float(round(rng.uniform(15, 90), 1))

        d = dt.date(yr, 3, 1) + dt.timedelta(days=int(rng.integers(0, 16)))
        while d.month <= 5:
            c = cloud(d.month)
            recs.append(SceneRecord(f"LC08_L2SP_144045_{d:%Y%m%d}_02_T1", "Landsat", "landsat-8", d.isoformat(), yr, c, _status(c), None, ["red", "nir08", "swir16", "lwir11", "qa_pixel"]))
            if yr >= 2022:
                d9 = d + dt.timedelta(days=8)
                if d9.month <= 5:
                    c9 = cloud(d9.month)
                    recs.append(SceneRecord(f"LC09_L2SP_144045_{d9:%Y%m%d}_02_T1", "Landsat", "landsat-9", d9.isoformat(), yr, c9, _status(c9), None, ["red", "nir08", "swir16", "lwir11", "qa_pixel"]))
            d += dt.timedelta(days=16)
        d = dt.date(yr, 3, 1) + dt.timedelta(days=int(rng.integers(0, 5)))
        k = 0
        while d.month <= 5:
            c = cloud(d.month)
            sat = "sentinel-2a" if k % 2 == 0 else "sentinel-2b"
            recs.append(SceneRecord(f"S2{sat[-1].upper()}_MSIL2A_{d:%Y%m%d}T052651_R105_T44QLJ", "Sentinel", sat, d.isoformat(), yr, c, _status(c), None, ["B04", "B08", "B11", "SCL"]))
            d += dt.timedelta(days=5)
            k += 1
    return sorted(recs, key=lambda r: r.date)
