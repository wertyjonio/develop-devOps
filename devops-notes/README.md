# Справочник DevOps-инженера

Личный справочник по Git, Linux, сетям, безопасности, автоматизации, Docker и CI/CD.

Окружение: ПК со второй ОС, VS Code + WSL (Ubuntu) + Bash + Git.

## Содержание

| Файл | Темы |
|------|------|
| [01-git.md](01-git.md) | Основы Git, процесс «ветка → PR → merge», конфликты, защита `main`, именование веток |
| [02-files-and-text.md](02-files-and-text.md) | Файлы и навигация, `find`, ссылки, архивы; потоки, пайпы, `grep`/`awk`/`sed` |
| [03-shell-and-scripts.md](03-shell-and-scripts.md) | Переменные окружения, конфиги оболочки, Bash-скрипты |
| [04-users-processes-services.md](04-users-processes-services.md) | Права, пользователи, sudo; процессы и сигналы; apt, systemd, cron |
| [05-network.md](05-network.md) | Интерфейсы, маршруты, bridge, диагностика, tcpdump |
| [06-security.md](06-security.md) | Hardening нового сервера: SSH-ключи, sshd, UFW |
| [07-docker.md](07-docker.md) | Docker, Dockerfile, Compose, healthcheck, hardening, Trivy, диагностика |
| [08-cicd.md](08-cicd.md) | GitHub Actions, пайплайн для Docker, GHCR, безопасность CI, каталог ошибок, основы CD, Dependabot |
| [09-interview-questions.md](09-interview-questions.md) | Вопросы для собеседований по Docker и CI |
| [10-vps-setup.md](10-vps-setup.md) | Первичная настройка VPS по шагам: вход по ключу, пользователь `deploy`, hardening `sshd`, UFW, обход UFW в Docker, установка Docker, keepalive и `tmux` против обрывов SSH, чек-лист и каталог ошибок |