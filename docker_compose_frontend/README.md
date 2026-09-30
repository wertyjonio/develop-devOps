# Guestbook — a multi-container app with Docker Compose

A small guestbook website made to practice Docker and Docker Compose. Visitors can leave messages, and the page shows a visit counter and the live health of the backend.

The project runs three containers: a static frontend served by **Nginx**, a **Node.js (Express)** API, and **Redis** for storage.

```
browser ──> frontend (nginx :80) ──/api/──> api (node :3000) ──> redis (:6379)
            published on :8080              internal only        internal only
```

## Features

- Leave a message with a name and text (validated on the server, stored in Redis)
- The 50 most recent messages are shown, newest first
- Visit counter stored in Redis
- Live status indicator (API and Redis health)
- Only the frontend is exposed to the host; the API and Redis are reachable only inside the Compose network
- Redis data persists across restarts (named volume + AOF persistence)

## Tech stack

- **Frontend:** plain HTML, CSS and JavaScript, served by Nginx
- **Backend:** Node.js 20, Express
- **Database:** Redis 7
- **Infrastructure:** Docker, Docker Compose

## Project structure

```
.
├── api/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
├── frontend/
│   ├── Dockerfile
│   ├── index.html
│   └── nginx.conf
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

cp .env.example .env
docker compose up -d --build
```

Then open **http://localhost:8080** (the host port is set in `docker-compose.yml`).

Check that everything is up:

```bash
docker compose ps
```

`redis` should be `healthy`, `api` and `frontend` should be `running`.

### Stop

```bash
docker compose down        # stop and remove containers, keep the data
docker compose down -v     # also delete the Redis volume (all messages)
```

## Configuration

The API reads its settings from environment variables, provided through the `.env` file (template: `.env.example`). The `.env` file is ignored by git.

| Variable     | Description                                    | Default in `.env.example` |
|--------------|------------------------------------------------|---------------------------|
| `PORT`       | port the API listens on inside the container   | `3000`                    |
| `REDIS_HOST` | Redis hostname (the Compose service name)      | `redis`                   |
| `REDIS_PORT` | Redis port                                     | `6379`                    |

If you change `PORT`, update `proxy_pass` in `frontend/nginx.conf` as well.

## API

All endpoints are available through the frontend under the `/api` prefix, e.g. `http://localhost:8080/api/health`.

| Method | Path        | Description                                                   |
|--------|-------------|---------------------------------------------------------------|
| GET    | `/health`   | API and Redis health check                                    |
| GET    | `/stats`    | visit counter (incremented on every call) and message count   |
| GET    | `/messages` | last 50 messages, newest first                                |
| POST   | `/messages` | create a message: `{"name": "...", "text": "..."}`            |

Validation: `name` is required (max 30 characters), `text` is required (max 300 characters).

### Examples

```bash
curl localhost:8080/api/health

curl -X POST localhost:8080/api/messages \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "text": "Hello from curl!"}'

curl localhost:8080/api/messages
```

## How it works

| Service    | Image / build        | Notes |
|------------|----------------------|-------|
| `frontend` | built from `./frontend` (`nginx:alpine`) | Serves `index.html` and acts as a reverse proxy: requests to `/api/` are forwarded to the `api` service, so the browser talks to a single origin (no CORS setup needed). The only service with a published port. |
| `api`      | built from `./api` (`node:20-alpine`)    | Express app. Configuration comes from `.env`. Starts only after Redis reports `healthy`. |
| `redis`    | `redis:7-alpine`                         | Runs with `--appendonly yes` so writes are logged to disk. Data is stored in the `redis-data` named volume mounted at `/data`. A `redis-cli ping` healthcheck tells Compose when it is ready. |

Startup order: `redis` (healthy) → `api` → `frontend`.

## Try it

- **Persistence:** leave a message, run `docker compose down` and then `docker compose up -d`. The message is still there.
- **Inspect the data:**
  ```bash
  docker compose exec redis redis-cli lrange messages 0 -1
  docker compose exec redis redis-cli get visits
  ```
- **Failure behavior:** run `docker compose stop redis` and watch the status indicator turn red and the API logs show Redis errors. Run `docker compose start redis` and the app recovers on its own.
- **Isolation:** `curl localhost:3000` from the host should fail, because the API port is not published.

## Useful commands

```bash
docker compose logs -f api         # follow the API logs
docker compose logs frontend       # Nginx access and error logs
docker compose up -d --build       # rebuild images after code changes
docker compose config              # validate and print the final configuration
docker compose exec redis redis-cli
```

## Troubleshooting

- **`host not found in upstream "api"` in the frontend logs:** the service name in `nginx.conf` does not match the Compose service name, or the services are not on the same network.
- **`502 Bad Gateway`:** the API is not running; check `docker compose logs api`.
- **Red status indicator on the page:** the API cannot reach Redis; check `REDIS_HOST` in `.env` and that Redis is `healthy`.

## What this project covers

- writing Dockerfiles and using layer caching (dependencies are installed before the code is copied)
- multi-service setups with Docker Compose: services, networks, volumes, environment files
- healthchecks and startup ordering with `depends_on`
- Nginx as a static file server and reverse proxy
- keeping configuration out of the code (`.env` / `.env.example`)
- keeping internal services off the public network

## Ideas for next steps

- build and publish images to a registry with GitHub Actions
- add HTTPS and a domain (Caddy or Traefik)
- protect Redis with a password
- add monitoring with Prometheus and Grafana
- deploy to a VPS