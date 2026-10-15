# develop-devOps

My hands-on DevOps learning lab: containerized projects, CI pipelines, systemd automation and a personal Linux/Docker reference. I'm learning DevOps by building things, breaking them and writing down what I figure out.

[![guestbook-ci](https://github.com/wertyjonio/develop-devOps/actions/workflows/guestbook-ci.yml/badge.svg)](https://github.com/wertyjonio/develop-devOps/actions/workflows/guestbook-ci.yml)
[![todo-ci](https://github.com/wertyjonio/develop-devOps/actions/workflows/todo-ci.yml/badge.svg)](https://github.com/wertyjonio/develop-devOps/actions/workflows/todo-ci.yml)
[![security](https://github.com/wertyjonio/develop-devOps/actions/workflows/security.yml/badge.svg)](https://github.com/wertyjonio/develop-devOps/actions/workflows/security.yml)

## Projects

| Project | What it demonstrates | Stack |
|---------|----------------------|-------|
| **[Guestbook](guestbook-new/)** (main project) | Three-container app behind a reverse proxy: multi-stage builds, healthchecks, internal-only services, persistent storage, hardened containers, CI pipeline with image publishing | Vite, Node.js/Express, Redis, Nginx, Docker Compose, GitHub Actions |
| **[Todo API](archive_projects/docker-compose2/)** | REST API with a database, startup ordering via healthchecks, config kept out of code (`.env`), layer caching, CI with a smoke test | Flask, PostgreSQL 16, Docker Compose, GitHub Actions |
| **[Guestbook v1](archive_projects/docker_compose_frontend/)** | Earlier iteration of the guestbook: static HTML frontend on Nginx, Node.js API, Redis with AOF persistence and healthchecks. Superseded by the main version above (multi-stage build, Redis password, SPA routing) | Nginx, Node.js/Express, Redis, Docker Compose |
| **[Smart Backup](archive_projects/smart-backup/)** | Backup utility in a minimal Alpine container, run on a schedule by a systemd service and timer (`Persistent=true`), host folders mounted as volumes | Bash, Docker, systemd |
| **[Catnip](archive_projects/flask-app2/)** | Packaging a small Flask app as a custom image, publishing it to Docker Hub and deploying it to a cloud platform | Flask, Docker, Docker Hub, Render |
| [`linux_notes.md`](linux_notes.md) | Personal reference: Git, Linux, networking, systemd, hardening, Docker (in Russian) | Markdown |

The smaller and earlier projects live in [`archive_projects/`](archive_projects/); each has its own README.

## Featured project: Guestbook

```
browser ──> frontend (nginx) ──/api/──> api (node :3000) ──> redis (:6379)
            only published port          internal only        internal only
```

- Multi-stage Docker build: Node builds the Vite app, the final image contains only Nginx and static files.
- Nginx serves the SPA (with a fallback for client-side routes) and acts as a reverse proxy for the API.
- Redis is password-protected, uses AOF persistence and a named volume, and is not reachable from outside the Compose network.
- Startup order is driven by healthchecks, not just container start.
- Hardened containers: non-root users, all Linux capabilities dropped, read-only filesystems, memory and CPU limits, log rotation, and two isolated networks so the frontend cannot reach Redis.
- Secrets live in `.env` (git-ignored); a safe `.env.example` template is committed.

Run it locally:

```bash
cd guestbook-new
cp .env.example .env     # set your own REDIS_PASSWORD
docker compose up -d --build
# open http://localhost:8081
```

## CI/CD and automation

All workflows live in [`.github/workflows/`](.github/workflows/). Project workflows use path filters, so a change in one project does not trigger the pipelines of the others.

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| **guestbook-ci** | push to `main` and pull requests touching `guestbook-new/` | Lint (hadolint), validate Compose, build, smoke test through Nginx, Trivy image scan, publish to GHCR on `main` |
| **todo-ci** | push to `main` and pull requests touching `archive_projects/docker-compose2/` | Lint (hadolint), validate Compose, build, smoke test on `/health` (checks the app and PostgreSQL together), logs on failure, cleanup |
| **security** | every push and pull request | Scans the full git history for leaked secrets with gitleaks |
| **schedule-scan** | weekly (Monday, cron) and manually | Rebuilds the Guestbook images and scans them with Trivy, so new CVEs in base images are found even without code changes |
| **Dependabot** | weekly | Opens pull requests with updates for GitHub Actions, Docker base images and dependencies |

### Guestbook pipeline in detail

1. **Lint** both Dockerfiles with [hadolint](https://github.com/hadolint/hadolint).
2. **Validate** the Compose file (`docker compose config`).
3. **Build** all images.
4. **Smoke test:** start the whole stack and check `/api/health` through Nginx.
5. Print container logs on failure and always clean up.
6. **Scan** the built images with [Trivy](https://github.com/aquasecurity/trivy): fixable HIGH and CRITICAL vulnerabilities fail the pipeline.
7. **Publish** (only on pushes to `main`, after all checks pass): build the images and push them to GitHub Container Registry, tagged `latest` and with the commit SHA. Layers are cached between runs with the GitHub Actions cache.

### Principles

- No real secrets in CI: the checks run with the template values from `.env.example`, and publishing uses the built-in short-lived `GITHUB_TOKEN` with minimal permissions.
- Third-party actions that handle security checks (Trivy) are pinned to a full commit hash.
- Every change goes through a branch and a pull request.

## Skills practiced so far

- **Linux:** shell scripting, processes and signals, systemd services and timers, networking, SSH and firewall hardening
- **Containers:** Dockerfiles, multi-stage builds, Docker Compose, networks, volumes, healthchecks, Docker Hub
- **Container hardening:** non-root users, dropped capabilities, read-only filesystems, resource limits, network segmentation, image vulnerability scanning
- **Data stores:** PostgreSQL and Redis in containers, persistent volumes
- **Web:** Nginx as a static server and reverse proxy
- **CI:** GitHub Actions workflows, path filters, job dependencies, matrix builds, scheduled runs, build caching, publishing images to GHCR, secret scanning, pinning actions by commit hash, reading and fixing failing pipelines
- **Dependency hygiene:** Dependabot for actions, Docker images and packages
- **Git workflow:** feature branches, pull requests, resolving merge conflicts and divergent branches
- **Deployment:** deploying a container image to a cloud platform (Render)
- **Security hygiene:** keeping secrets out of Git, GitHub push protection, least-privilege setups

## Roadmap

- [x] Docker and Docker Compose fundamentals
- [x] CI with GitHub Actions (lint, build, smoke test)
- [x] Publish images to GitHub Container Registry
- [x] Secret scanning (gitleaks) and image vulnerability scanning (Trivy) in CI
- [x] Run containers as a non-root user
- [x] CI for Todo API
- [x] Scheduled Trivy scan and Dependabot configuration
- [ ] Branch protection for `main` (required pull request and checks)
- [ ] Harden the applications (graceful shutdown, healthcheck for the frontend, pinned base images)
- [ ] Deploy to a VPS with a domain and HTTPS (Caddy)
- [ ] Continuous delivery: deploy to the server from GitHub Actions, rollback by commit tag
- [ ] Automate server setup with Ansible
- [ ] Provision infrastructure with Terraform
- [ ] Monitoring with Prometheus and Grafana
- [ ] Kubernetes basics (k3s / minikube)

## Repository layout

```
.
├── .github/
│   ├── workflows/              # guestbook-ci, todo-ci, security, schedule-scan
│   └── dependabot.yml          # automatic dependency update PRs
├── guestbook-new/              # main project (own README inside)
├── archive_projects/
│   ├── docker_compose_frontend/   # Guestbook v1
│   ├── docker-compose2/           # Todo API
│   ├── flask-app2/                # Catnip
│   └── smart-backup/              # Smart Backup
├── linux_notes.md              # personal Linux / Docker reference
└── README.md
```