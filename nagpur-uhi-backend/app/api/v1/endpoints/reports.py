from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import cube_dep
from app.database.database import get_db
from app.models.pydantic_models import ReportRequest
from app.repositories.report_repository import ReportRepository
from app.services import report_service
from app.utils.response_utils import NotFound, ok

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("/generate")
def generate(body: ReportRequest, cube=Depends(cube_dep), db: Session = Depends(get_db)):
    report = report_service.generate(cube, body.year, body.report_type, body.include_sections)
    ReportRepository(db).save(report["id"], body.report_type, body.year, report)
    return ok(report)


@router.get("/{report_id}")
def get_report(report_id: str, db: Session = Depends(get_db)):
    row = ReportRepository(db).get(report_id)
    if not row:
        raise NotFound(f"Report '{report_id}' not found")
    return ok(row.content)


@router.get("")
def recent(db: Session = Depends(get_db)):
    return ok([{"id": r.id, "reportType": r.report_type, "year": r.year, "generatedAt": r.generated_at.isoformat()} for r in ReportRepository(db).recent()])
