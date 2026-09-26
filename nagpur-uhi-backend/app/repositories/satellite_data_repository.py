from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.orm_models import Hotspot, MLModel


class SatelliteDataRepository:
    """Persists derived products (hotspot rankings, model registry)."""

    def __init__(self, db: Session):
        self.db = db

    def replace_hotspots(self, year: int, rows: list[dict]) -> None:
        self.db.execute(delete(Hotspot).where(Hotspot.year == year))
        for r in rows:
            self.db.add(Hotspot(year=year, **r))
        self.db.commit()

    def hotspots(self, year: int, limit: int | None = None) -> list[Hotspot]:
        q = select(Hotspot).where(Hotspot.year == year).order_by(Hotspot.rank)
        if limit:
            q = q.limit(limit)
        return list(self.db.scalars(q))

    def register_model(self, **values) -> MLModel:
        row = self.db.get(MLModel, values["id"]) or MLModel(id=values["id"])
        for k, v in values.items():
            setattr(row, k, v)
        self.db.add(row)
        self.db.commit()
        return row

    def latest_model(self, model_type: str) -> MLModel | None:
        return self.db.scalars(select(MLModel).where(MLModel.model_type == model_type).order_by(MLModel.trained_at.desc())).first()
