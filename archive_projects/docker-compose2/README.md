# Todo API — Flask + PostgreSQL + Docker Compose

[![todo-ci](https://github.com/wertyjonio/develop-devOps/actions/workflows/todo-ci.yml/badge.svg)](https://github.com/wertyjonio/develop-devOps/actions/workflows/todo-ci.yml)

Небольшой учебный проект для практики DevOps: REST API для списка задач на Flask с базой данных PostgreSQL, полностью упакованный в контейнеры и запускаемый одной командой через Docker Compose.

## Стек

- **Python 3.12**, Flask, psycopg2
- **PostgreSQL 16**
- **Docker**, **Docker Compose**

## Структура проекта

```
.
├── app/
│   ├── app.py              # код приложения
│   ├── requirements.txt    # Python-зависимости
│   └── Dockerfile          # образ приложения
├── docker-compose.yml      # описание сервисов app и db
├── .env.example            # шаблон переменных окружения
├── .gitignore
└── README.md
```

## Быстрый старт

Нужны установленные [Docker](https://docs.docker.com/get-docker/) и Docker Compose (v2).

```bash
git clone <URL-репозитория>
cd <папка-проекта>

cp .env.example .env        # затем откройте .env и задайте свой DB_PASSWORD
docker compose up -d --build
```

Проверка:

```bash
curl localhost:5000/health
# {"db":"up","status":"ok"}
```

Остановка:

```bash
docker compose down         # остановить, данные БД сохраняются
docker compose down -v      # остановить и удалить данные БД
```

## Переменные окружения

Задаются в файле `.env` (шаблон — `.env.example`). Файл `.env` не попадает в git.

| Переменная    | Описание                                             | Пример    |
|---------------|------------------------------------------------------|-----------|
| `DB_HOST`     | хост БД (имя сервиса в compose)                      | `db`      |
| `DB_PORT`     | порт БД                                              | `5432`    |
| `DB_NAME`     | имя базы данных                                      | `todos`   |
| `DB_USER`     | пользователь БД                                      | `postgres`|
| `DB_PASSWORD` | пароль пользователя БД                               | —         |

> Пароль нужно задать до первого запуска: Postgres создаёт пользователя только при инициализации volume. Если позже поменять пароль в `.env`, выполните `docker compose down -v` и запустите проект заново (данные при этом удалятся).

## API

| Метод    | Путь          | Описание                                   |
|----------|---------------|--------------------------------------------|
| `GET`    | `/health`     | проверка приложения и подключения к БД     |
| `GET`    | `/todos`      | список всех задач                          |
| `POST`   | `/todos`      | создать задачу (`{"title": "..."}`)        |
| `PATCH`  | `/todos/<id>` | переключить статус выполнения (done)       |
| `DELETE` | `/todos/<id>` | удалить задачу                             |

### Примеры

```bash
# создать задачу
curl -X POST localhost:5000/todos \
  -H "Content-Type: application/json" \
  -d '{"title": "Выучить Docker Compose"}'

# список задач
curl localhost:5000/todos

# отметить выполненной (повторный вызов вернёт обратно)
curl -X PATCH localhost:5000/todos/1

# удалить
curl -X DELETE localhost:5000/todos/1
```

## Как это устроено

- **`db`** — официальный образ `postgres:16`. Данные хранятся в именованном volume `pgdata`, поэтому переживают перезапуск и пересоздание контейнера. Порт наружу не публикуется: база доступна только приложению внутри сети compose.
- **`app`** — образ собирается из `app/Dockerfile`. Порт `5000` проброшен на хост, настройки берутся из `.env`.
- **Healthcheck и `depends_on`** — сервис `app` стартует только после того, как `db` прошла проверку `pg_isready`, то есть когда база реально готова принимать подключения.
- Слой с `pip install` в Dockerfile вынесен перед копированием кода, поэтому при изменении кода зависимости берутся из кэша и пересборка занимает секунды.

## Полезные команды

```bash
docker compose ps                                   # статус сервисов
docker compose logs -f app                          # логи приложения
docker compose exec db psql -U postgres -d todos    # консоль PostgreSQL
docker compose up -d --build                        # пересобрать после изменений
docker compose config                               # проверить итоговый конфиг
```

## Что изучалось в проекте

- написание Dockerfile и работа с кэшем слоёв
- Docker Compose: сервисы, сети, volumes, переменные окружения
- healthcheck и порядок запуска сервисов
- хранение конфигурации вне кода (`.env`, `.env.example`)
