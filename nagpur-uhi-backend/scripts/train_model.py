"""Train (or retrain) the non-linear LST model and register it in the database.
    python scripts/train_model.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.database.database import init_db, session_scope  # noqa: E402
from app.ml import models as ml_models  # noqa: E402
from app.repositories.satellite_data_repository import SatelliteDataRepository  # noqa: E402
from app.services.satellite_data_service import get_cube  # noqa: E402

if __name__ == "__main__":
    init_db()
    m = ml_models.train(get_cube())
    ml_models.set_model(m)
    with session_scope() as db:
        SatelliteDataRepository(db).register_model(id=f"lst-{m.metadata['backend']}-{m.metadata['version']}", model_type="lst_surface_regressor", version=m.metadata["version"],
                                                   accuracy=m.metadata["accuracy"], r_squared=m.metadata["r_squared"], model_path=str(ml_models.get_settings().models_dir / ml_models.MODEL_FILE), metadata_json=m.metadata)
    print(f"model: {m.metadata['backend']}  R²={m.r2:.3f}  RMSE={m.metadata['rmse']:.2f}  → data/models/")
