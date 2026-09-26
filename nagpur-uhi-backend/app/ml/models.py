"""Train / load the non-linear LST model (XGBoost, scikit-learn fallback) with spatial block CV."""
from __future__ import annotations

import json
import logging
import pickle
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from app.config import get_settings
from app.ml.predictions import FEATURES, design_matrix, spatial_blocks
from app.services.satellite_data_service import SatelliteCube

log = logging.getLogger("uhi.ml")
MODEL_FILE = "lst_prediction_model.pkl"
META_FILE = "model_metadata.json"


def _new_regressor(backend: str):
    if backend in ("auto", "xgboost"):
        try:
            from xgboost import XGBRegressor
            return XGBRegressor(n_estimators=320, max_depth=5, learning_rate=0.06, subsample=0.8, colsample_bytree=0.8,
                                min_child_weight=5, reg_lambda=1.0, n_jobs=4, random_state=7), "xgboost"
        except ImportError:
            if backend == "xgboost":
                raise
    from sklearn.ensemble import HistGradientBoostingRegressor
    return HistGradientBoostingRegressor(max_iter=300, learning_rate=0.06, max_depth=5, min_samples_leaf=15, random_state=7), "sklearn-hgb"


class LSTModel:
    def __init__(self, model, metadata: dict):
        self.model = model
        self.metadata = metadata

    def predict(self, X: np.ndarray) -> np.ndarray:
        return np.asarray(self.model.predict(X), dtype=np.float32)

    @property
    def r2(self) -> float:
        return float(self.metadata.get("r_squared", 0.0))


def train(cube: SatelliteCube, sample_rows: int = 40_000, seed: int = 7) -> LSTModel:
    from sklearn.model_selection import GroupKFold

    t0 = time.time()
    s = get_settings()
    Xs, ys, gs = [], [], []
    rng = np.random.default_rng(seed)
    years = cube.available_years()
    per_year = max(2000, sample_rows // len(years))
    for y in years:
        X, t, rows = design_matrix(cube, y)
        pick = rng.choice(len(rows), size=min(per_year, len(rows)), replace=False)
        Xs.append(X[pick]); ys.append(t[pick]); gs.append(spatial_blocks(cube, rows[pick]))
    X = np.vstack(Xs); y = np.concatenate(ys); groups = np.concatenate(gs)
    # spatial block cross-validation (random splits leak under spatial autocorrelation)
    folds = []
    for tr, te in GroupKFold(n_splits=4).split(X, y, groups):
        m, _ = _new_regressor(s.ml_backend)
        m.fit(X[tr], y[tr])
        p = m.predict(X[te])
        ss_res = float(((y[te] - p) ** 2).sum()); ss_tot = float(((y[te] - y[te].mean()) ** 2).sum())
        folds.append({"r2": 1 - ss_res / ss_tot, "rmse": float(np.sqrt(ss_res / len(te))), "mae": float(np.abs(y[te] - p).mean())})
    model, backend = _new_regressor(s.ml_backend)
    model.fit(X, y)
    importance = None
    if hasattr(model, "feature_importances_"):
        importance = dict(zip(FEATURES, map(float, model.feature_importances_)))
    meta = {
        "model_type": "lst_surface_regressor", "backend": backend, "version": "1.0", "features": FEATURES,
        "training_rows": int(len(y)), "years": years, "target": "LST (°C)",
        "validation": "spatial GroupKFold (4 folds, 2 km blocks)",
        "r_squared": float(np.mean([f["r2"] for f in folds])), "r_squared_std": float(np.std([f["r2"] for f in folds])),
        "rmse": float(np.mean([f["rmse"] for f in folds])), "mae": float(np.mean([f["mae"] for f in folds])),
        "accuracy": float(np.mean([f["r2"] for f in folds])), "folds": folds, "feature_importance": importance,
        "trained_at": datetime.now(timezone.utc).isoformat(), "train_seconds": round(time.time() - t0, 2),
        "note": "Predicts land-surface temperature from NDVI/NDBI, 1 km neighbourhood context and geography; used for non-linear what-if estimates.",
    }
    s.models_dir.mkdir(parents=True, exist_ok=True)
    with open(s.models_dir / MODEL_FILE, "wb") as f:
        pickle.dump(model, f)
    (s.models_dir / META_FILE).write_text(json.dumps(meta, indent=1))
    log.info("trained %s model: R²=%.3f RMSE=%.2f in %.1fs", backend, meta["r_squared"], meta["rmse"], meta["train_seconds"])
    return LSTModel(model, meta)


def load(models_dir: Path | None = None) -> LSTModel | None:
    d = models_dir or get_settings().models_dir
    p, m = d / MODEL_FILE, d / META_FILE
    if not (p.exists() and m.exists()):
        return None
    try:
        with open(p, "rb") as f:
            return LSTModel(pickle.load(f), json.loads(m.read_text()))
    except Exception as e:  # pragma: no cover
        log.warning("could not load model: %s", e)
        return None


_model: LSTModel | None = None


def get_model(cube: SatelliteCube | None = None, allow_train: bool = True) -> LSTModel | None:
    global _model
    if _model is None:
        _model = load()
    if _model is None and cube is not None and allow_train:
        _model = train(cube)
    return _model


def set_model(m: LSTModel) -> None:
    global _model
    _model = m
