# Guestbook: Vite + Node.js + Redis with Docker Compose

A small multi-container web app built to practice Docker and Docker Compose. Visitors can leave messages in a guestbook; the page also shows a visit counter and the live health of the backend.

It runs three containers:

- **frontend**: a Vite single-page app, built in a multi-stage Docker build and served by **Nginx**, which also acts as a reverse proxy for the API
- **api**: a **Node.js (Express)** REST API
- **redis**: **Redis** as the data store

```
browser ──> frontend (nginx) ──/api/──> api (node :3000) ──> redis (:6379)
            only published port          internal only        internal only
```

## Features

- Leave a message with a name and text (validated on the server, stored in Redis)
- The 50 most recent messages are shown, newest first
- Visit counter stored in Redis
- Live status indicator (API and Redis health)
- Two client-side routes (`/` and `/about`), so refreshing a deep link works thanks to the SPA fallback in the Nginx config
- Only the frontend is exposed to the host; the API and Redis are reachable only inside the Compose network
- Redis data survives restarts (named volume + AOF persistence)

## Tech stack

- **Frontend:** Vite, vanilla JavaScript, History API router
- **Backend:** Node.js, Express
- **Database:** Redis 7
- **Web server / proxy:** Nginx
- **Infrastructure:** Docker, Docker Compose

## Project structure

```
.
├── api/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── package.json
│   ├── package-lock.json
│   └── server.js
├── frontend/
│   ├── Dockerfile          # multi-stage: node (build) -> nginx (serve)
│   ├── .dockerignore
│   ├── nginx.conf
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   ├── package-lock.json
│   └── src/
│       ├── main.js
│       └── style.css
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

## Getting started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with the Compose plugin (`docker compose`, v2)

### Run

```bash
git clone <repository-url>
cd <project-folder>

cp .env.example .env        # then set your own REDIS_PASSWORD in .env
docker compose up -d --build
```

Open **http://localhost:8081** (the host port is set in `docker-compose.yml`).

Check the status:

```bash
docker compose ps
```

`redis` should be `healthy`; `api` and `frontend` should be `running`.

### Stop

```bash
docker compose down        # stop and remove containers, keep the data
docker compose down -v     # also delete the Redis volume (all messages)
```

## Configuration

The API and Redis read their settings from environment variables, provided through `.env` (template: `.env.example`). The `.env` file is ignored by git.

| Variable         | Description                                    | Example in `.env.example` |
|------------------|------------------------------------------------|---------------------------|
| `PORT`           | port the API listens on inside the container   | `3000`                    |
| `REDIS_HOST`     | Redis hostname (the Compose service name)      | `redis`                   |
| `REDIS_PORT`     | Redis port                                     | `6379`                    |
| `REDIS_PASSWORD` | password for Redis, shared by Redis and the API | `change_me`              |

If you change `PORT`, update `proxy_pass` in `frontend/nginx.conf` as well.

## API

All endpoints are reachable through the frontend under the `/api` prefix, for example `http://localhost:8081/api/health`.

| Method | Path        | Description                                                  |
|--------|-------------|--------------------------------------------------------------|
| GET    | `/health`   | API and Redis health check                                   |
| GET    | `/stats`    | visit counter (incremented on every call) and message count  |
| GET    | `/messages` | last 50 messages, newest first                               |
| POST   | `/messages` | create a message: `{"name": "...", "text": "..."}`           |

Validation: `name` is required (max 30 characters), `text` is required (max 300 characters).

### Examples

```bash
curl localhost:8081/api/health

curl -X POST localhost:8081/api/messages \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "text": "Hello from curl!"}'

curl localhost:8081/api/messages
```

## How it works

| Service    | Image / build | Notes |
|------------|---------------|-------|
| `frontend` | built from `./frontend` | Multi-stage build: the first stage (Node) installs dependencies and runs `vite build`; the final stage contains only Nginx and the built `dist/` files, with no Node.js. Nginx serves the static files, falls back to `index.html` for client-side routes (`try_files $uri $uri/ /index.html`) and forwards `/api/` to the `api` service (reverse proxy). It is the only service with a published port. |
| `api`      | built from `./api` | Express app. Configuration comes from `.env`. Starts only after Redis reports `healthy`. |
| `redis`    | `redis:7-alpine` | Runs with `--appendonly yes` and a password. Data lives in the `redis-data` named volume mounted at `/data`. A healthcheck tells Compose when it is ready. |

Startup order: `redis` (healthy) -> `api` -> `frontend`.

Dockerfile practices used here: dependencies are installed before the source is copied (so the layer cache is reused), `npm ci` for reproducible installs, and `.dockerignore` files to keep `node_modules`, `.env` and build output out of the images.

## Local development (frontend)

For hot reloading, run the Vite dev server against the stack that is already running in Docker:

```bash
cd frontend
npm install
npm run dev
```

The dev server runs on http://localhost:5173 and proxies `/api` to the Nginx container. The target is set in `frontend/vite.config.js`; make sure its port matches the published port in `docker-compose.yml`.

## Things to try

- **Persistence:** leave a message, run `docker compose down` and then `docker compose up -d`. The message is still there.
- **SPA routing:** open `http://localhost:8081/about` directly and refresh. It works because of the `try_files` fallback. Remove the fallback, rebuild, and see the 404.
- **Inspect the data:**
  ```bash
  docker compose exec redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning lrange messages 0 -1'
  ```
- **Failure behavior:** run `docker compose stop redis`, watch the status indicator turn red and read `docker compose logs api`. Run `docker compose start redis` and the app recovers on its own.
- **Isolation:** `curl localhost:3000` from the host should fail, because the API port is not published.

## Useful commands

```bash
docker compose logs -f api         # follow the API logs
docker compose logs frontend       # Nginx logs
docker compose up -d --build       # rebuild images after code changes
docker compose config              # validate and print the final configuration
docker compose exec frontend nginx -t   # check the Nginx config
```

## Troubleshooting

- **`frontend` keeps restarting:** check `docker compose logs frontend`. Lines with `[emerg]` point to a problem in `nginx.conf` (a typo in a directive or variable, a missing `;`).
- **`host not found in upstream "api"`:** the name in `proxy_pass` does not match the Compose service name.
- **`502 Bad Gateway`:** the API is not running; check `docker compose logs api`.
- **404 after refreshing `/about`:** the SPA fallback in `nginx.conf` is missing or wrong.
- **Red status indicator on the page:** the API cannot reach Redis; check `REDIS_HOST` and `REDIS_PASSWORD` in `.env` and make sure Redis is `healthy`.

## What this project covers

- multi-stage Dockerfiles and layer caching
- multi-service setups with Docker Compose: services, networks, volumes, environment files
- healthchecks and startup ordering with `depends_on`
- Nginx as a static server and reverse proxy, including the SPA fallback
- passing a secret through every layer (`.env`, Compose, application code, healthcheck)
- keeping internal services off the public network

## Ideas for next steps

- build and publish images to a registry with GitHub Actions
- run containers as a non-root user
- add HTTPS and a domain (Caddy or Traefik)
- add monitoring with Prometheus and Grafana
- deploy to a VPS
