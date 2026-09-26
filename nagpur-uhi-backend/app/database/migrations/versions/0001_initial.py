"""initial schema: zones, zone_stats, hotspots, reports, ml_models

Revision ID: 0001_initial
Revises:
Create Date: 2025-01-01
"""
import sqlalchemy as sa
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("zones",
        sa.Column("id", sa.String(64), primary_key=True), sa.Column("name", sa.String(128)), sa.Column("short", sa.String(64)), sa.Column("character", sa.String(128)),
        sa.Column("lat", sa.Float), sa.Column("lon", sa.Float), sa.Column("area_km2", sa.Float), sa.Column("population", sa.Integer), sa.Column("boundary_geojson", sa.JSON))
    op.create_table("zone_stats",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True), sa.Column("zone_id", sa.String(64), sa.ForeignKey("zones.id"), index=True), sa.Column("year", sa.Integer, index=True),
        sa.Column("lst_mean", sa.Float), sa.Column("lst_min", sa.Float), sa.Column("lst_max", sa.Float), sa.Column("lst_std", sa.Float),
        sa.Column("ndvi_mean", sa.Float), sa.Column("ndvi_class", sa.String(32)), sa.Column("ndbi_mean", sa.Float), sa.Column("ndbi_class", sa.String(32)),
        sa.Column("hot_fraction", sa.Float), sa.Column("cloud_cover", sa.Float), sa.Column("valid_pixels", sa.Float), sa.Column("data_quality", sa.Float),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()), sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()))
    op.create_index("ix_zone_stats_zone_year", "zone_stats", ["zone_id", "year"], unique=True)
    op.create_table("hotspots",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True), sa.Column("zone_id", sa.String(64), sa.ForeignKey("zones.id"), index=True), sa.Column("year", sa.Integer, index=True),
        sa.Column("temperature", sa.Float), sa.Column("peak_temperature", sa.Float), sa.Column("persistence", sa.Integer), sa.Column("persistence_fraction", sa.Float),
        sa.Column("priority", sa.String(16)), sa.Column("rank", sa.Integer), sa.Column("area_km2", sa.Float))
    op.create_index("ix_hotspots_year_rank", "hotspots", ["year", "rank"])
    op.create_table("reports", sa.Column("id", sa.String(64), primary_key=True), sa.Column("report_type", sa.String(32)), sa.Column("year", sa.Integer, index=True),
        sa.Column("content", sa.JSON), sa.Column("generated_at", sa.DateTime, server_default=sa.func.now()))
    op.create_table("ml_models", sa.Column("id", sa.String(64), primary_key=True), sa.Column("model_type", sa.String(64)), sa.Column("version", sa.String(32)),
        sa.Column("accuracy", sa.Float), sa.Column("r_squared", sa.Float), sa.Column("model_path", sa.String(256)), sa.Column("metadata_json", sa.JSON), sa.Column("trained_at", sa.DateTime, server_default=sa.func.now()))


def downgrade() -> None:
    for t in ("ml_models", "reports", "hotspots", "zone_stats", "zones"):
        op.drop_table(t)
