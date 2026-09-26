"""Application settings (environment-driven)."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _bool(v: str | None, default: bool) -> bool:
    return default if v is None else v.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    app_name: str = "Nagpur UHI Analysis Platform API"
    version: str = "1.0.0"
    database_url: str = os.getenv("DATABASE_URL", f"sqlite:///{ROOT / 'uhi.db'}")
    api_host: str = os.getenv("API_HOST", "0.0.0.0")
    api_port: int = int(os.getenv("API_PORT", "8000"))
    debug: bool = _bool(os.getenv("DEBUG"), True)
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    cache_ttl: int = int(os.getenv("CACHE_TTL", "300"))            # satellite data
    analysis_cache_ttl: int = int(os.getenv("ANALYSIS_CACHE_TTL", "1800"))
    max_workers: int = int(os.getenv("MAX_WORKERS", "4"))
    cors_origins: list[str] = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",")]
    data_dir: Path = Path(os.getenv("DATA_DIR", ROOT / "data"))
    imagery_dir: Path = Path(os.getenv("IMAGERY_DIR", ROOT / "data" / "satellite_imagery"))
    models_dir: Path = Path(os.getenv("MODELS_DIR", ROOT / "data" / "models"))
    logs_dir: Path = Path(os.getenv("LOGS_DIR", ROOT / "logs"))
    auto_prepare_data: bool = _bool(os.getenv("AUTO_PREPARE_DATA"), True)   # build demo GeoTIFFs if none exist
    auto_train_model: bool = _bool(os.getenv("AUTO_TRAIN_MODEL"), True)
    ml_backend: str = os.getenv("ML_BACKEND", "auto")                        # auto | xgboost | sklearn


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
