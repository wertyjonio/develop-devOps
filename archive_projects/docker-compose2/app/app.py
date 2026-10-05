import os
import time

import psycopg2
from psycopg2.extras import RealDictCursor
from flask import Flask, jsonify, request

app = Flask(__name__)

# Все настройки берём из переменных окружения — так проще потом
# передавать их через docker-compose.
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5432"),
    "dbname": os.getenv("DB_NAME", "todos"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "postgres"),
}


def get_conn():
    return psycopg2.connect(**DB_CONFIG)


def init_db(retries=10, delay=3):
    """Создаёт таблицу. Ждёт, пока база поднимется (в контейнерах она стартует не мгновенно)."""
    for attempt in range(1, retries + 1):
        try:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS todos (
                        id SERIAL PRIMARY KEY,
                        title TEXT NOT NULL,
                        done BOOLEAN NOT NULL DEFAULT FALSE,
                        created_at TIMESTAMP NOT NULL DEFAULT NOW()
                    )
                    """
                )
            print("База данных готова")
            return
        except psycopg2.OperationalError as e:
            print(f"[{attempt}/{retries}] БД недоступна: {e}")
            time.sleep(delay)
    raise RuntimeError("Не удалось подключиться к базе данных")


@app.get("/health")
def health():
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
        return jsonify(status="ok", db="up")
    except psycopg2.OperationalError:
        return jsonify(status="error", db="down"), 503


@app.get("/todos")
def list_todos():
    with get_conn() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM todos ORDER BY id")
        return jsonify(cur.fetchall())


@app.post("/todos")
def create_todo():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify(error="title is required"), 400
    with get_conn() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("INSERT INTO todos (title) VALUES (%s) RETURNING *", (title,))
        return jsonify(cur.fetchone()), 201


@app.patch("/todos/<int:todo_id>")
def toggle_todo(todo_id):
    with get_conn() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("UPDATE todos SET done = NOT done WHERE id = %s RETURNING *", (todo_id,))
        row = cur.fetchone()
        if row is None:
            return jsonify(error="not found"), 404
        return jsonify(row)


@app.delete("/todos/<int:todo_id>")
def delete_todo(todo_id):
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM todos WHERE id = %s", (todo_id,))
        if cur.rowcount == 0:
            return jsonify(error="not found"), 404
        return "", 204


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)
