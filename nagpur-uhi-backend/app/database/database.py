"""Engine / session factory. SQLite by default; set DATABASE_URL for PostgreSQL."""
from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.models.orm_models import Base

settings = get_settings()
_is_sqlite = settings.database_url.startswith("sqlite")
engine = create_engine(settings.database_url, pool_pre_ping=True, future=True,
                       connect_args={"check_same_thread": False} if _is_sqlite else {},
                       **({} if _is_sqlite else {"pool_size": 5, "max_overflow": 10}))
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def init_db() -> None:
    """Create tables if missing (Alembic migrations are provided for managed environments)."""
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Session:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
