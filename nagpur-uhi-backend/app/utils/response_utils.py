"""Uniform API envelope: {success, data, error, timestamp} and typed HTTP errors."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi.responses import JSONResponse


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def ok(data: Any) -> dict:
    return {"success": True, "data": data, "error": None, "timestamp": now_iso()}


def fail(message: str, status: int) -> JSONResponse:
    return JSONResponse(status_code=status, content={"success": False, "data": None, "error": message, "timestamp": now_iso()})


class ApiError(Exception):
    status_code = 400

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.message = message
        if status_code:
            self.status_code = status_code


class NotFound(ApiError):
    status_code = 404


class DataUnavailable(ApiError):
    status_code = 503


class ProcessingTimeout(ApiError):
    status_code = 504
