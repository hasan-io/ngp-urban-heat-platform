"""SQLAlchemy ORM schema (SQLite locally, PostgreSQL in production)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Zone(Base):
    __tablename__ = "zones"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    short: Mapped[str] = mapped_column(String(64), default="")
    character: Mapped[str] = mapped_column(String(128), default="")
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    area_km2: Mapped[float] = mapped_column(Float, default=0.0)
    population: Mapped[int] = mapped_column(Integer, default=0)
    boundary_geojson: Mapped[dict] = mapped_column(JSON)
    stats: Mapped[list["ZoneStat"]] = relationship(back_populates="zone", cascade="all, delete-orphan")


class ZoneStat(Base):
    __tablename__ = "zone_stats"
    __table_args__ = (Index("ix_zone_stats_zone_year", "zone_id", "year", unique=True),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    zone_id: Mapped[str] = mapped_column(ForeignKey("zones.id"), index=True)
    year: Mapped[int] = mapped_column(Integer, index=True)
    lst_mean: Mapped[float] = mapped_column(Float)
    lst_min: Mapped[float] = mapped_column(Float)
    lst_max: Mapped[float] = mapped_column(Float)
    lst_std: Mapped[float] = mapped_column(Float)
    ndvi_mean: Mapped[float] = mapped_column(Float)
    ndvi_class: Mapped[str] = mapped_column(String(32))
    ndbi_mean: Mapped[float] = mapped_column(Float)
    ndbi_class: Mapped[str] = mapped_column(String(32))
    hot_fraction: Mapped[float] = mapped_column(Float, default=0.0)
    cloud_cover: Mapped[float] = mapped_column(Float, default=0.0)
    valid_pixels: Mapped[float] = mapped_column(Float, default=100.0)
    data_quality: Mapped[float] = mapped_column(Float, default=1.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    zone: Mapped[Zone] = relationship(back_populates="stats")


class Hotspot(Base):
    __tablename__ = "hotspots"
    __table_args__ = (Index("ix_hotspots_year_rank", "year", "rank"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    zone_id: Mapped[str] = mapped_column(ForeignKey("zones.id"), index=True)
    year: Mapped[int] = mapped_column(Integer, index=True)
    temperature: Mapped[float] = mapped_column(Float)
    peak_temperature: Mapped[float] = mapped_column(Float, default=0.0)
    persistence: Mapped[int] = mapped_column(Integer)          # 0–6 years (zone mean, rounded)
    persistence_fraction: Mapped[float] = mapped_column(Float, default=0.0)
    priority: Mapped[str] = mapped_column(String(16))
    rank: Mapped[int] = mapped_column(Integer)
    area_km2: Mapped[float] = mapped_column(Float, default=0.0)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    report_type: Mapped[str] = mapped_column(String(32))
    year: Mapped[int] = mapped_column(Integer, index=True)
    content: Mapped[dict] = mapped_column(JSON)
    generated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class MLModel(Base):
    __tablename__ = "ml_models"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    model_type: Mapped[str] = mapped_column(String(64))
    version: Mapped[str] = mapped_column(String(32))
    accuracy: Mapped[float] = mapped_column(Float)
    r_squared: Mapped[float] = mapped_column(Float)
    model_path: Mapped[str] = mapped_column(String(256))
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    trained_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
