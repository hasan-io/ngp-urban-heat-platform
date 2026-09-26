from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.orm_models import Zone, ZoneStat


class ZoneRepository:
    def __init__(self, db: Session):
        self.db = db

    def upsert_zones(self, features: list[dict]) -> None:
        for f in features:
            p = f["properties"]
            z = self.db.get(Zone, p["zone_id"]) or Zone(id=p["zone_id"])
            z.name, z.short, z.character = p["name"], p.get("short", ""), p.get("character", "")
            z.lat, z.lon, z.population = p["lat"], p["lon"], int(p.get("population", 0))
            z.area_km2 = float(p.get("area_km2", 0.0))
            z.boundary_geojson = f["geometry"]
            self.db.add(z)
        self.db.commit()

    def set_area(self, zone_id: str, area_km2: float) -> None:
        z = self.db.get(Zone, zone_id)
        if z:
            z.area_km2 = area_km2
            self.db.add(z)

    def all(self) -> list[Zone]:
        return list(self.db.scalars(select(Zone).order_by(Zone.name)))

    def get(self, zone_id: str) -> Zone | None:
        return self.db.get(Zone, zone_id)

    def upsert_stat(self, zone_id: str, year: int, **values) -> ZoneStat:
        row = self.db.scalars(select(ZoneStat).where(ZoneStat.zone_id == zone_id, ZoneStat.year == year)).first()
        if row is None:
            row = ZoneStat(zone_id=zone_id, year=year, **values)
        else:
            for k, v in values.items():
                setattr(row, k, v)
        self.db.add(row)
        return row

    def stat(self, zone_id: str, year: int) -> ZoneStat | None:
        return self.db.scalars(select(ZoneStat).where(ZoneStat.zone_id == zone_id, ZoneStat.year == year)).first()
