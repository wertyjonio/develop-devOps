# Todo API: Flask + PostgreSQL + Docker Compose

[![todo-ci](https://github.com/wertyjonio/develop-devOps/actions/workflows/todo-ci.yml/badge.svg)](https://github.com/wertyjonio/develop-devOps/actions/workflows/todo-ci.yml)

A small learning project for practicing DevOps: a REST API for a todo list built with Flask and backed by PostgreSQL, fully containerized and started with a single Docker Compose command. The project has a GitHub Actions CI pipeline: linting, build, a smoke test that writes and reads data, and an image vulnerability scan.

## Tech stack

- **Python 3.12**, Flask, psycopg2
- **PostgreSQL 16**
- **Docker**, **Docker Compose**
- **GitHub Actions**, hadolint, Trivy

## Project structure

```
.
├── app/
│   ├── app.py              # application code
│   ├── requirements.txt    # Python dependencies
│   └── Dockerfile          # application image
├── docker-compose.yml      # app and db services
├── .env.example            # environment variables template
├── .gitignore
└── README.md
```

The project's workflow lives in the repository root: `.github/workflows/todo-ci.yml`.

## Getting started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with the Compose plugin (`docker compose`, v2)

### Run

```bash
git clone <repository-url>
cd <project-folder>

cp .env.example .env        # then set your own DB_PASSWORD in .env
docker compose up -d --build --wait
```

The `--wait` flag waits until the services are `healthy`. Check the result:

```bash
docker compose ps
# app and db should be healthy

curl localhost:5000/health
# {"db":"up","status":"ok"}
```

### Stop

```bash
docker compose down         # stop and remove containers, keep the database data
docker compose down -v      # also delete the database volume
```

## Environment variables

Set in the `.env` file (template: `.env.example`). The `.env` file is ignored by git.

| Variable      | Description                                          | Example    |
|---------------|------------------------------------------------------|------------|
| `DB_HOST`     | database host (the Compose service name)             | `db`       |
| `DB_PORT`     | database port                                        | `5432`     |
| `DB_NAME`     | database name                                        | `todos`    |
| `DB_USER`     | database user                                        | `postgres` |
| `DB_PASSWORD` | database user password                               | —          |

> Set the password before the first run: Postgres creates the user only when the volume is initialized. If you change the password in `.env` later, run `docker compose down -v` and start the project again (this deletes the data).

## API

| Method   | Path          | Description                                      |
|----------|---------------|--------------------------------------------------|
| `GET`    | `/health`     | checks the app and the database connection       |
| `GET`    | `/todos`      | list all tasks                                   |
| `POST`   | `/todos`      | create a task (`{"title": "..."}`)               |
| `PATCH`  | `/todos/<id>` | toggle the completion status (done)              |
| `DELETE` | `/todos/<id>` | delete a task                                    |

### Examples

```bash
# create a task
curl -X POST localhost:5000/todos \
  -H "Content-Type: application/json" \
  -d '{"title": "Learn Docker Compose"}'

# list tasks
curl localhost:5000/todos

# mark as done (calling it again toggles it back)
curl -X PATCH localhost:5000/todos/1

# delete
curl -X DELETE localhost:5000/todos/1
```

## How it works

- **`db`**: the official `postgres:16` image. Data is stored in the named volume `pgdata`, so it survives restarts and container re-creation. No port is published: the database is reachable only by the app inside the Compose network. Healthcheck via `pg_isready`.
- **`app`**: the image is built from `app/Dockerfile`. Port `5000` is published to the host and settings come from `.env`. The service has its own healthcheck that calls `/health` through Python (`urllib`), so it does not depend on `curl` being present in the image.
- **Startup order**: `app` starts only after `db` passes the `pg_isready` check (`depends_on` with `condition: service_healthy`), meaning the database is actually ready to accept connections. Thanks to the healthcheck on `app`, `docker compose up --wait` waits for a ready application, not just a running process.
- The `pip install` layer in the Dockerfile comes before copying the source code, so when only the code changes, dependencies are taken from the cache and a rebuild takes seconds.

## CI

The `todo-ci` workflow runs on pushes to `main` and on pull requests when project files or the workflow itself change, and it can also be started manually. A new push to the same branch cancels the previous unfinished run (`concurrency`). The token is given minimal permissions (`contents: read`).

**Job `lint-and-build`:**

1. **Lint** `app/Dockerfile` with hadolint.
2. **Prepare `.env`** from the `.env.example` template: no real secrets are used in CI.
3. **Validate** the Compose file (`docker compose config`).
4. **Build** the images.
5. **Smoke test:** start the stack and wait for `healthy`, check `/health`, then create a task with `POST /todos` and verify it appears in `GET /todos`. This checks not only that the app responds, but also that writing and reading through PostgreSQL works.
6. On failure the container logs are printed, and cleanup (`docker compose down -v`) always runs.

**Job `image-scan`** (runs after `lint-and-build` succeeds):

1. Build the app image with the GitHub Actions layer cache.
2. Scan the image with [Trivy](https://github.com/aquasecurity/trivy): fixable HIGH and CRITICAL vulnerabilities fail the pipeline. The Trivy action is pinned to a commit hash.

## Useful commands

```bash
docker compose ps                                   # service status
docker compose logs -f app                          # follow the app logs
docker compose exec db psql -U postgres -d todos    # PostgreSQL console
docker compose up -d --build                        # rebuild after changes
docker compose config                               # validate and print the final configuration
docker inspect --format '{{json .State.Health}}' docker-compose2-app-1   # healthcheck results with the error text
```

## Troubleshooting

- **`container ... is unhealthy`:** look at the healthcheck results with `docker inspect --format '{{json .State.Health}}' <container>`. The `Output` field contains the error text of the check command.
- **`additional properties ... not allowed` or `mapping key ... already defined` from `docker compose config`:** almost always the YAML indentation is off. Make sure `healthcheck`, `depends_on` and the other keys are at the same level inside their own service, and use spaces only.
- **A `curl` step hangs in CI with endless progress lines:** check the flag spelling (`--retry-delay`, not `-retry-delay`) and set `--max-time` so a single attempt cannot hang.

## What this project covers

- writing Dockerfiles and using layer caching
- Docker Compose: services, networks, volumes, environment files
- healthchecks for both the database and the application, and startup ordering
- keeping configuration out of the code (`.env`, `.env.example`)
- CI on GitHub Actions: path filters, job dependencies, `concurrency`, token permissions, a smoke test that checks writes and reads, image scanning with Trivy