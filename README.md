# develop-devOps

My hands-on DevOps learning lab: containerized projects, CI pipelines, systemd automation and a personal Linux/Docker reference. I'm learning DevOps by building things, breaking them and writing down what I figure out.

[![guestbook-ci](https://github.com/wertyjonio/develop-devOps/actions/workflows/guestbook-ci.yml/badge.svg)](https://github.com/wertyjonio/develop-devOps/actions/workflows/guestbook-ci.yml)

## Projects

| Project | What it demonstrates | Stack |
|---------|----------------------|-------|
| **[Guestbook](guestbook-new/)** (main project) | Three-container app behind a reverse proxy: multi-stage builds, healthchecks, internal-only services, persistent storage, CI pipeline | Vite, Node.js/Express, Redis, Nginx, Docker Compose, GitHub Actions |
| **[Guestbook v1](archive_projects/docker_compose_frontend/)** | Earlier iteration of the guestbook: static HTML frontend on Nginx, Node.js API, Redis with AOF persistence and healthchecks. Superseded by the main version above (multi-stage build, Redis password, SPA routing) | Nginx, Node.js/Express, Redis, Docker Compose |
| **[Todo API](archive_projects/docker-compose2/)** | REST API with a database, startup ordering via healthchecks, config kept out of code (`.env`), layer caching | Flask, PostgreSQL 16, Docker Compose |
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
- Secrets live in `.env` (git-ignored); a safe `.env.example` template is committed.

Run it locally:

```bash
cd guestbook-new
cp .env.example .env     # set your own REDIS_PASSWORD
docker compose up -d --build
# open http://localhost:8081
```

## CI pipeline

The `guestbook-ci` workflow runs on every push and pull request that touches `guestbook-new/`:

1. **Lint** both Dockerfiles with [hadolint](https://github.com/hadolint/hadolint).
2. **Validate** the Compose file (`docker compose config`).
3. **Build** all images.
4. **Smoke test:** start the whole stack and check `/api/health` through Nginx.
5. Print container logs on failure and always clean up.

No real secrets are used in CI: the pipeline runs with the template values from `.env.example`.

## Skills practiced so far

- **Linux:** shell scripting, processes and signals, systemd services and timers, networking, SSH and firewall hardening
- **Containers:** Dockerfiles, multi-stage builds, Docker Compose, networks, volumes, healthchecks, Docker Hub
- **Data stores:** PostgreSQL and Redis in containers, persistent volumes
- **Web:** Nginx as a static server and reverse proxy
- **CI:** GitHub Actions workflows, path filters, job dependencies, reading and fixing failing pipelines
- **Deployment:** deploying a container image to a cloud platform (Render)
- **Security hygiene:** keeping secrets out of Git, GitHub push protection, least-privilege setups

## Roadmap

- [x] Docker and Docker Compose fundamentals
- [x] CI with GitHub Actions (lint, build, smoke test)
- [ ] Publish images to GitHub Container Registry
- [ ] Secret scanning (gitleaks) and image vulnerability scanning (Trivy) in CI
- [ ] Run containers as a non-root user
- [ ] Deploy to a VPS with a domain and HTTPS (Caddy)
- [ ] Automate server setup with Ansible
- [ ] Provision infrastructure with Terraform
- [ ] Monitoring with Prometheus and Grafana
- [ ] Kubernetes basics (k3s / minikube)

## Repository layout

```
.
├── .github/workflows/          # CI pipelines
├── guestbook-new/              # main project (own README inside)
├── archive_projects/
│   ├── docker_compose_frontend/   # Guestbook v1
│   ├── docker-compose2/           # Todo API
│   ├── flask-app2/                # Catnip
│   └── smart-backup/              # Smart Backup
├── linux_notes.md              # personal Linux / Docker reference
└── README.md
```
