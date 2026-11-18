# Dockerfiles

## 1
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')"]
(нужен для того, чтобы при docker ps видеть статус контейнера)

Документация: hub.docker.com - ищем образы, примеры их сборок и тд

## 2 (multi-stage)
COPY --from=build /app/dist /usr/share/nginx/html - используем файлы, которые создались после работы билдера
USER в scratch пишем <10000
в scratch запускаем скрипты по абсолютному пути ["/server"]
openssl rand -hex 24 (команда для генерации паролей для баз данных)
Сервис	      Порт
PostgreSQL	  5432
Redis	        6379
MySQL	        3306
MongoDB	      27017
nginx / HTTP  80
HTTPS         443
RabbitMQ	    5672 (AMQP), 15672 (UI)
FastAPI/uvicorn, Django	8000
Flask	        5000
Node/Express	3000
Spring Boot, Tomcat	8080

## 3 docker-compose
Healthcheck: код выхода 0 = healthy; `CMD-SHELL` нужен для `|` и переменных (`$$VAR`); `start_period` не считает провалы при старте.
`depends_on` без условия ждёт только запуск контейнера, `service_healthy` ждёт готовность сервиса.
Хост в URL подключения = имя сервиса из compose, не `localhost`; внутри сети используется внутренний порт, `ports` нужен только для доступа с хоста.

## 4 CI/CD

**Идея:** каждый push автоматически проверяется, собирается и (если всё хорошо) доставляется. Человек не запускает ничего руками.

**Триггер:** push в main или pull request. Для PR обычно только проверки, для main ещё и публикация образа.

**Стадии по порядку:**
1. **Checkout:** runner (чистая временная машина) скачивает код репозитория.
2. **Установка зависимостей:** с кэшем, чтобы не качать заново.
3. **Линтер:** проверка стиля и очевидных ошибок. Самый быстрый шаг, падает раньше всех.
4. **Тесты:** юнит-тесты. Если упали, пайплайн останавливается, дальше не идём.
5. **Сборка Docker-образа:** с кэшем слоёв.
6. **Сканирование образа** на уязвимости (Trivy), если требуется.
7. **Логин в registry и push:** тег по SHA коммита (и/или версии), не только `latest`.
8. **Деплой:** отдельная job после успешной сборки (`needs:`): зайти на сервер, `docker compose pull && docker compose up -d`.

Что нужно	                                                                  Где смотреть
Синтаксис workflow (on, jobs, permissions, concurrency, needs, if)	        docs.github.com/actions, раздел Workflow syntax
Готовые actions (checkout, login-action, build-push-action)	                страница каждого action на GitHub Marketplace или в его репозитории
Сборка и пуш Docker-образов в CI                                            docs.docker.com/build/ci/github-actions/
Публикация в GHCR	                                                          docs.github.com/packages, раздел про Container registry
Переменные, секреты, контексты (${{ secrets.X }}, github.ref)             	docs.github.com/actions, разделы Secrets и Contexts

**CI для DevOps:** главное, чтобы всё собиралось, поднималось и отвечало. Smoke test = один сквозной сценарий через весь стек, а не глубокая проверка логики. Логику проверяют юнит-тесты разработчиков. Smoke-скрипт лучше держать отдельным файлом (`scripts/smoke.sh`), чтобы запускать его и локально, и в CI.