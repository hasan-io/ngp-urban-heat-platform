from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.orm_models import Report


class ReportRepository:
    def __init__(self, db: Session):
        self.db = db

    def save(self, report_id: str, report_type: str, year: int, content: dict) -> Report:
        row = Report(id=report_id, report_type=report_type, year=year, content=content)
        self.db.add(row)
        self.db.commit()
        return row

    def get(self, report_id: str) -> Report | None:
        return self.db.get(Report, report_id)

    def recent(self, limit: int = 20) -> list[Report]:
        return list(self.db.scalars(select(Report).order_by(Report.generated_at.desc()).limit(limit)))
