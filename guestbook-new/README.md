# Guestbook: Vite + Node.js + Redis with Docker Compose

[![guestbook-ci](https://github.com/wertyjonio/develop-devOps/actions/workflows/guestbook-ci.yml/badge.svg)](https://github.com/wertyjonio/develop-devOps/actions/workflows/guestbook-ci.yml)

A small multi-container web app built to practice Docker, Docker Compose and CI/CD. Visitors can leave messages in a guestbook; the page also shows a visit counter and the live health of the backend.

It runs three containers:

- **frontend**: a Vite single-page app, built in a multi-stage Docker build and served by **Nginx**, which also acts as a reverse proxy for the API
- **api**: a **Node.js (Express)** REST API
- **redis**: **Redis** as the data store

```
browser ──> frontend (nginx) ──/api/──> api (node :3000) ──> redis (:6379)
            published on                 internal only        internal only
            127.0.0.1:8081
```

Two Compose networks keep the services apart:

| Network   | Members           | Purpose |
|-----------|-------------------|---------|
| `edge`    | frontend, api     | Nginx proxies requests to the API |
| `backend` | api, redis        | the API talks to the database |

The frontend and Redis share no network, so the frontend cannot reach the database even if it is compromised.

## Features

- Leave a message with a name and text (validated on the server, stored in Redis)
- The 50 most recent messages are shown, newest first
- Visit counter stored in Redis
- Live status indicator (API and Redis health)
- Two client-side routes (`/` and `/about`), so refreshing a deep link works thanks to the SPA fallback in the Nginx config
- Only the frontend publishes a port, and by default only on `127.0.0.1`; the API and Redis are reachable only inside the Compose networks
- Redis is password-protected and its data survives restarts (named volume + AOF persistence)

## Tech stack

- **Frontend:** Vite, vanilla JavaScript, History API router
- **Backend:** Node.js, Express
- **Database:** Redis 7.4
- **Web server / proxy:** Nginx
- **Infrastructure:** Docker, Docker Compose
- **CI/CD:** GitHub Actions, GitHub Container Registry, hadolint, Trivy, gitleaks

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

`redis` and `api` should be `healthy`; `frontend` should be `running`.

### Stop

```bash
docker compose down        # stop and remove containers, keep the data
docker compose down -v     # also delete the Redis volume (all messages)
```

## Configuration

The API and Redis read their settings from environment variables, provided through `.env` (template: `.env.example`). The `.env` file is ignored by git.

| Variable         | Description                                                      | Example in `.env.example` |
|------------------|------------------------------------------------------------------|---------------------------|
| `PORT`           | port the API listens on inside the container                     | `3000`                    |
| `REDIS_HOST`     | Redis hostname (the Compose service name)                        | `redis`                   |
| `REDIS_PORT`     | Redis port                                                       | `6379`                    |
| `REDIS_PASSWORD` | password for Redis, shared by Redis and the API                  | `change_me`               |
| `BIND_ADDR`      | optional: host address the frontend port is bound to (default `127.0.0.1`; set `0.0.0.0` to expose it on your network) | not set |

If you change `PORT`, update `proxy_pass` in `frontend/nginx.conf` as well.

## API

All endpoints are reachable through the frontend under the `/api` prefix, for example `http://localhost:8081/api/health`.

| Method | Path        | Description                                                  |
|--------|-------------|--------------------------------------------------------------|
| GET    | `/health`   | API and Redis health check                                   |
| GET    | `/stats`    | visit counter and message count (read-only)                  |
| POST   | `/visit`    | count one visit (the frontend calls it once per tab session) |
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
| `frontend` | built from `./frontend` | Multi-stage build: the first stage (Node) installs dependencies and runs `vite build`; the final stage contains only Nginx and the built `dist/` files, with no Node.js. Nginx runs as a non-root user, serves the static files, falls back to `index.html` for client-side routes (`try_files $uri $uri/ /index.html`) and forwards `/api/` to the `api` service (reverse proxy). It is the only service with a published port. Starts after the API is healthy. |
| `api`      | built from `./api` | Express app running as the unprivileged `node` user. The final image contains no npm. Configuration comes from `.env`. A healthcheck calls `/health`. Starts only after Redis reports `healthy`. |
| `redis`    | `redis:7.4-alpine` | Runs as a non-root user with `--appendonly yes` and a password. Data lives in the `redis-data` named volume mounted at `/data`. A healthcheck tells Compose when it is ready. |

Startup order: `redis` (healthy) -> `api` (healthy) -> `frontend`.

Dockerfile practices used here: dependencies are installed before the source is copied (so the layer cache is reused), `npm ci` for reproducible installs, multi-stage builds, `.dockerignore` files to keep `node_modules`, `.env` and build output out of the images, and an unprivileged user in every final image.

## Security hardening

Applied to the services in `docker-compose.yml`:

- **Non-root:** no container runs its main process as root.
- **No capabilities:** `cap_drop: [ALL]` removes all extra Linux capabilities; `no-new-privileges` prevents privilege escalation through setuid binaries.
- **Read-only root filesystem:** `read_only: true`, with a `tmpfs` for `/tmp` where a service needs scratch space; Redis writes only to its data volume.
- **Resource limits:** memory and CPU limits per container, so a leak or a runaway process cannot take down the host.
- **Log rotation:** `json-file` logs are capped (10 MB x 3 files per container), so logs cannot fill the disk.
- **Network segmentation:** separate `edge` and `backend` networks; Redis is not reachable from the frontend.
- **Minimal exposure:** only the frontend publishes a port, bound to `127.0.0.1` by default (Docker bypasses host firewalls like UFW for published ports, so a public server should expose it through a reverse proxy).
- **`init: true`** for the API, so signals are forwarded and zombie processes are reaped.
- **Secrets stay out of the repo:** `.env` is git-ignored, `.env.example` holds safe placeholders.

## CI/CD

The `guestbook-ci` workflow runs on every push and pull request that touches this folder:

1. **Lint** both Dockerfiles with hadolint.
2. **Validate** the Compose file (`docker compose config`).
3. **Build** the images.
4. **Smoke test:** start the whole stack and check `/api/health` through Nginx.
5. **Scan** the images with Trivy; fixable HIGH and CRITICAL vulnerabilities fail the pipeline.
6. **Publish** (only on pushes to `main`, after everything above passes): push the images to GitHub Container Registry as `guestbook-api` and `guestbook-frontend`, tagged `latest` and with the commit SHA.

A separate `security` workflow scans the whole git history for leaked secrets with gitleaks. CI uses the template values from `.env.example`, and publishing uses the built-in short-lived `GITHUB_TOKEN`, so no real secrets are stored in the pipeline.

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
- **Network segmentation:** try to resolve Redis from the frontend, for example `docker compose exec frontend getent hosts redis` (it fails), then run the same command in `api` (it succeeds).
- **Non-root:** `docker compose top` shows the user of every process; none of them is `root`.
- **Read-only filesystem:** `docker compose exec api touch /app/test.txt` fails with `Read-only file system`, while `touch /tmp/test.txt` works because `/tmp` is a `tmpfs`.
- **Resource usage:** `docker stats --no-stream` shows memory use against the configured limits.

## Useful commands

```bash
docker compose logs -f api         # follow the API logs
docker compose logs frontend       # Nginx logs
docker compose up -d --build       # rebuild images after code changes
docker compose config              # validate and print the final configuration
docker compose top                 # processes and the users they run as
docker compose exec frontend nginx -t   # check the Nginx config
```

## Troubleshooting

- **`frontend` keeps restarting:** check `docker compose logs frontend`. Lines with `[emerg]` point to a problem in `nginx.conf` (a typo in a directive or variable, a missing `;`).
- **`host not found in upstream "api"`:** the name in `proxy_pass` does not match the Compose service name, or the services are not on a shared network.
- **`502 Bad Gateway`:** the API is not running; check `docker compose logs api`.
- **`api` stays `unhealthy` and `frontend` never starts:** the frontend waits for a healthy API. Inspect the health check with `docker inspect --format '{{json .State.Health}}' <container>` and check `/health`.
- **`Read-only file system` in the logs:** the service writes somewhere other than a volume or `tmpfs`; add that path to the service's `tmpfs`.
- **`Operation not permitted` right after start:** the service needs a Linux capability that `cap_drop: [ALL]` removed; add back only the one it needs with `cap_add`.
- **Redis fails to start with a permission error on `/data`:** the volume was created with a different owner; recreate it with `docker compose down -v` (this deletes the data).
- **404 after refreshing `/about`:** the SPA fallback in `nginx.conf` is missing or wrong.
- **Red status indicator on the page:** the API cannot reach Redis; check `REDIS_HOST` and `REDIS_PASSWORD` in `.env` and make sure Redis is `healthy`.

## What this project covers

- multi-stage Dockerfiles and layer caching
- multi-service setups with Docker Compose: services, networks, volumes, environment files
- healthchecks and startup ordering with `depends_on`
- Nginx as a static file server and reverse proxy, including the SPA fallback
- passing a secret through every layer (`.env`, Compose, application code, healthcheck)
- container hardening: non-root users, dropped capabilities, read-only filesystems, resource limits, network segmentation
- a CI/CD pipeline: linting, build, smoke test, vulnerability and secret scanning, publishing images to a registry

## Ideas for next steps

- deploy to a VPS with automatic delivery from GitHub Actions
- add HTTPS and a domain (Caddy or Traefik)
- add monitoring with Prometheus and Grafana
- keep action versions and base images up to date with Dependabot
- require pull requests and passing checks before merging into `main`