"""Small in-memory TTL cache (thread-safe). Keys follow the brief: lst_{year}, zone_stats_{zone}_{year}, …"""
from __future__ import annotations

import threading
import time
from typing import Any, Callable, TypeVar

T = TypeVar("T")


class TTLCache:
    def __init__(self, default_ttl: int = 300):
        self._store: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()
        self.default_ttl = default_ttl
        self.hits = 0
        self.misses = 0

    def get(self, key: str):
        with self._lock:
            item = self._store.get(key)
            if item and item[0] > time.time():
                self.hits += 1
                return item[1]
            if item:
                del self._store[key]
            self.misses += 1
            return None

    def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        with self._lock:
            self._store[key] = (time.time() + (ttl or self.default_ttl), value)

    def get_or_set(self, key: str, factory: Callable[[], T], ttl: int | None = None) -> T:
        v = self.get(key)
        if v is None:
            v = factory()
            self.set(key, v, ttl)
        return v

    def clear(self, prefix: str | None = None) -> int:
        with self._lock:
            keys = [k for k in self._store if prefix is None or k.startswith(prefix)]
            for k in keys:
                del self._store[k]
            return len(keys)

    def stats(self) -> dict:
        with self._lock:
            return {"entries": len(self._store), "hits": self.hits, "misses": self.misses}


from app.config import get_settings  # noqa: E402

_s = get_settings()
data_cache = TTLCache(_s.cache_ttl)              # satellite rasters
analysis_cache = TTLCache(_s.analysis_cache_ttl)  # derived analytics
