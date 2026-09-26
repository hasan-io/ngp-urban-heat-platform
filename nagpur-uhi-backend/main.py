"""Entry point: python main.py"""
import uvicorn

from app.config import get_settings

if __name__ == "__main__":
    s = get_settings()
    uvicorn.run("app.main:app", host=s.api_host, port=s.api_port, reload=s.debug, log_level=s.log_level.lower())
