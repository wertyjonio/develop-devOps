import os
import secrets
import string
import time
from contextlib import asynccontextmanager

import psycopg
import redis
from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, HttpUrl

DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.environ["REDIS_URL"]
BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")

rds = redis.Redis.from_url(REDIS_URL, decode_responses=True)
ALPHABET = string.ascii_letters + string.digits


def get_conn():
    return psycopg.connect(DATABASE_URL, connect_timeout=3)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Создаём таблицу при старте (с небольшими ретраями)
    for attempt in range(10):
        try:
            with get_conn() as conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS links (
                        code TEXT PRIMARY KEY,
                        url  TEXT NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
            break
        except psycopg.OperationalError:
            if attempt == 9:
                raise
            time.sleep(1)
    yield


app = FastAPI(title="URL shortener", lifespan=lifespan)


class LinkIn(BaseModel):
    url: HttpUrl


@app.get("/health")
def health(response: Response):
    status = {"postgres": "ok", "redis": "ok"}
    try:
        with get_conn() as conn:
            conn.execute("SELECT 1")
    except Exception as e:
        status["postgres"] = f"error: {e.__class__.__name__}"
    try:
        rds.ping()
    except Exception as e:
        status["redis"] = f"error: {e.__class__.__name__}"

    if any(v != "ok" for v in status.values()):
        response.status_code = 503
    return status


@app.post("/links", status_code=201)
def create_link(body: LinkIn):
    url = str(body.url)
    with get_conn() as conn:
        for _ in range(5):  # на случай коллизии кода
            code = "".join(secrets.choice(ALPHABET) for _ in range(6))
            try:
                conn.execute(
                    "INSERT INTO links (code, url) VALUES (%s, %s)", (code, url)
                )
                break
            except psycopg.errors.UniqueViolation:
                conn.rollback()
        else:
            raise HTTPException(500, "could not generate code")
    return {"code": code, "short_url": f"{BASE_URL}/{code}", "url": url}


@app.get("/links/{code}/stats")
def stats(code: str):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT url, created_at FROM links WHERE code = %s", (code,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "not found")
    clicks = int(rds.get(f"clicks:{code}") or 0)
    return {"code": code, "url": row[0], "created_at": row[1], "clicks": clicks}


@app.get("/{code}")
def redirect(code: str):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT url FROM links WHERE code = %s", (code,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "not found")
    rds.incr(f"clicks:{code}")
    return RedirectResponse(row[0], status_code=307)
