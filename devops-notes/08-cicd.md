# CI/CD (GitHub Actions)

[← К оглавлению](README.md)

Про ветки, pull request, конфликты и защиту `main` см. [01-git.md](01-git.md).

## 1. Основные понятия

- **CI** (Continuous Integration): каждое изменение автоматически проверяется (линт, сборка, тесты, сканирование). Красный результат блокирует слияние.
- **CD** (Continuous Delivery/Deployment): проверенная версия автоматически доставляется на сервер.
- **Путь деплоя:** `git push` → CI → образ в реестре → сервер скачивает образ → запуск. Откат: запустить предыдущий образ по тегу с хэшем коммита.
- **Pipeline** (пайплайн): набор автоматических шагов. Читаем его сверху вниз.

## 2. Устройство GitHub Actions

Workflow лежит в `.github/workflows/*.yml` (расширение `.yml` или `.yaml`, строго эта папка).

| Термин            | Что это                                                                        |
|-------------------|--------------------------------------------------------------------------------|
| **Workflow**      | один YAML-файл с автоматизацией                                                |
| **Event** (`on:`) | что запускает: `push`, `pull_request`, `workflow_dispatch`, `schedule`         |
| **Job**           | набор шагов на одном раннере; jobs по умолчанию идут **параллельно**           |
| **Runner**        | виртуальная машина (`ubuntu-latest`), чистая на каждый запуск                  |
| **Step**          | один шаг: `run:` (команда shell) или `uses:` (готовый экшен)                   |
| **Action**        | готовый переиспользуемый блок (`actions/checkout`, `docker/build-push-action`) |

```yaml
name: my-ci

on:
  push:
    branches: [main]
    paths:                              # запускать, только если менялось это
      - "myapp/**"
      - ".github/workflows/my-ci.yml"
  pull_request:
    paths:
      - "myapp/**"
      - ".github/workflows/my-ci.yml"
  workflow_dispatch:                    # кнопка ручного запуска
  # schedule:
  #   - cron: "0 5 * * 1"               # по расписанию (UTC)

permissions:
  contents: read                        # права токена по минимуму

concurrency:                            # новый пуш отменяет прошлый запуск в той же ветке
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 10                 # защита от зависаний
    defaults:
      run:
        working-directory: myapp        # только для шагов run:, не для uses:
    steps:
      - uses: actions/checkout@v7       # скачать код
      - name: Validate
        run: docker compose config > /dev/null
      - name: Show logs
        if: failure()                   # только если что-то упало выше
        run: docker compose logs
      - name: Cleanup
        if: always()                    # выполнять в любом случае
        run: docker compose down -v

  scan:
    needs: build                        # запуститься после успеха job build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
```

Полезное:

- `with:` передаёт параметры экшену; `env:` задаёт переменные окружения; `${{ secrets.NAME }}` читает секрет; `${{ github.sha }}` хэш коммита; `${{ github.actor }}` кто запустил.
- Условие для публикации только на `main`: `if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'`.
- **Один PR запускает все workflow, чьи триггеры сработали**, поэтому нужны `paths`, иначе на любой PR запустятся все проекты.
- **`schedule`** работает только из файла в главной ветке; время в UTC. В публичных репозиториях GitHub отключает расписание после 60 дней без активности (включается кнопкой во вкладке Actions).
- **Matrix** запускает job для каждого значения:

  ```yaml
  strategy:
    fail-fast: false                    # не отменять остальные при падении одного
    matrix:
      include:
        - name: guestbook-api
          context: guestbook-new/api
        - name: todo-app
          context: archive_projects/docker-compose2/app
  # дальше ${{ matrix.name }} и ${{ matrix.context }}
  ```
- **`needs`** задаёт порядок: если упал нужный job, зависимый пропускается.

## 3. Типовой пайплайн для Docker-проекта

1. **Lint** Dockerfile (hadolint).
2. **Validate** Compose (`docker compose config`).
3. **Build** (`docker compose build`).
4. **Smoke test**: поднять стек и проверить, что он реально работает.
5. **Scan** образа (Trivy), падение на HIGH и CRITICAL с исправлением.
6. **Publish** образов в реестр (только на `main`, после всех проверок).

В CI вместо настоящего `.env` берём шаблон: `cp .env.example .env` (в нём тестовые значения, реальных секретов нет).

**Smoke test** на `curl`:

```
docker compose up -d --wait
curl -fsS --retry 10 --retry-connrefused --retry-delay 2 --max-time 5 http://127.0.0.1:5000/health
# запись и чтение: проверка, что работает БД, а не просто отвечает приложение
curl -fsS --max-time 5 -X POST http://127.0.0.1:5000/todos \
  -H "Content-Type: application/json" -d '{"title": "ci"}'
curl -fsS --max-time 5 http://127.0.0.1:5000/todos | grep -q '"ci"'
```

| Флаг curl             | Что делает                                                           |
|-----------------------|----------------------------------------------------------------------|
| `-f`                  | вернуть ошибку на ответ 4xx/5xx (без него `500` считался бы успехом) |
| `-s`                  | не печатать таблицу прогресса                                        |
| `-S`                  | но показывать текст ошибки, если она есть                            |
| `--retry N`           | повторить до N раз при временных ошибках                             |
| `--retry-connrefused` | считать «connection refused» временной ошибкой (сервис ещё стартует) |
| `--retry-delay N`     | пауза между повторами в секундах                                     |
| `--max-time N`        | максимум N секунд на один запрос (чтобы не висеть)                   |
| `-X POST`, `-H`, `-d` | метод, заголовок, тело запроса                                       |

**Важно: длинные флаги пишутся с двумя дефисами.** `-retry-delay 2` curl разбирает как набор коротких флагов, а `2` принимает за адрес (отсюда бесконечные строки с нулями в логе и зависший шаг).

## 4. Публикация образов в GHCR

```yaml
publish:
  needs: [lint-and-build, image-scan]
  if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'
  runs-on: ubuntu-latest
  permissions:
    contents: read
    packages: write                     # право на push в реестр, только этому job
  steps:
    - uses: actions/checkout@v7
    - uses: docker/setup-buildx-action@v4   # сборщик Buildx (нужен для кэша)
    - uses: docker/login-action@v4
      with:
        registry: ghcr.io
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}   # встроенный краткоживущий токен
    - uses: docker/build-push-action@v7
      with:
        context: guestbook-new/api
        push: true
        tags: |
          ghcr.io/${{ github.repository_owner }}/guestbook-api:latest
          ghcr.io/${{ github.repository_owner }}/guestbook-api:${{ github.sha }}
        cache-from: type=gha,scope=api
        cache-to: type=gha,mode=max,scope=api
```

- Тег `latest` удобен, тег с `github.sha` нужен для **точного отката** и воспроизводимости.
- Адрес реестра `ghcr.io` (опечатка `ghrc.io` даёт `denied`). Имя образа должно быть в нижнем регистре.
- На сервере вход в GHCR: токен (PAT) с правом `read:packages`, `docker login ghcr.io -u <user>`.
- **Параметры `build-push-action`:** `context` (папка сборки, как `build:` в Compose), `push: true` (отправить в реестр), `load: true` (загрузить собранный образ в локальный Docker раннера, нужно для сканирования; Buildx по умолчанию не кладёт образ в `docker images`), `tags` (имена), `cache-from` / `cache-to` (кэш слоёв в хранилище GitHub Actions; `scope` разделяет кэш разных образов, `mode=max` сохраняет и промежуточные стадии).

## 5. Безопасность образов в пайплайне

Про Trivy и hadolint подробно: [07-docker.md, раздел 9](07-docker.md#9-безопасность-образов).

## 6. Безопасность в CI

- **Секреты:** никогда не в Git. Для CI используются GitHub Secrets (`${{ secrets.NAME }}`) и тестовые значения из `.env.example`. Если секрет попал в историю, удаления файла недостаточно: ключ нужно **перевыпустить**.
- **Минимальные права токена:** `permissions: contents: read` на уровне workflow; расширенные права (`packages: write`) только в том job, которому они нужны. Указанное в `permissions` ограничивает всё остальное до `none`.
- **Сканирование секретов:** `gitleaks` с `fetch-depth: 0` (нужна вся история, а не последний коммит) на каждый пуш и PR.
- **Закрепление экшенов по хэшу коммита** (`uses: owner/action@<40 символов> # v1.2.3`): тег можно переместить на другой код, хэш нельзя. Минимум для экшенов безопасности (Trivy).
- **Dependabot** (`.github/dependabot.yml`) раз в неделю открывает PR с обновлениями:

  ```yaml
  version: 2
  updates:
    - package-ecosystem: "github-actions"
      directory: "/"
      schedule:
        interval: "weekly"
    - package-ecosystem: "docker"            # FROM в Dockerfile
      directory: "/myapp/api"
      schedule:
        interval: "weekly"
    - package-ecosystem: "docker-compose"    # image: в compose-файле
      directory: "/myapp"
      schedule:
        interval: "weekly"
    - package-ecosystem: "npm"               # или "pip" для requirements.txt
      directory: "/myapp/api"
      schedule:
        interval: "weekly"
  ```

  Каждый `directory` должен существовать, иначе Dependabot выдаст ошибку.
- **Регулярное сканирование:** новые уязвимости находят и без изменений в коде, поэтому Trivy запускают ещё и по `schedule`.

## 7. Как читать упавший пайплайн

1. Найти **первый красный шаг** (последующие часто серые или красные из-за него).
2. Прочитать **конец лога** этого шага: там причина.
3. Воспроизвести локально теми же командами (`docker compose config`, `docker compose up -d --build --wait`).

**Каталог ошибок:**

| Симптом                                                                       | Причина                                                          | Решение                                                            |
|-------------------------------------------------------------------------------|------------------------------------------------------------------|--------------------------------------------------------------------|
| `Set up job` красный, `unable to find version`                                | неверный тег экшена (нет `v`, версии не существует)              | сверить тег на странице экшена                                     |
| `docker compose config > dev/null` падает                                     | потерян `/` в `/dev/null`                                        | исправить путь                                                     |
| `REDIS_PASSWORD is not set`                                                   | пустое значение в `.env.example`                                 | задать тестовое значение                                           |
| `denied` при push в GHCR                                                      | опечатка `ghrc.io` вместо `ghcr.io`, нет `packages: write`       | исправить адрес / права                                            |
| `Unexpected value 'worklflow_dispatch'`                                       | опечатка в ключе workflow                                        | исправить ключ                                                     |
| `invalid --security-opt`                                                      | опечатка `no-new-priveledges`                                    | `no-new-privileges`                                                |
| Шаг с `curl` висит, в логе нули и растущее время                              | `-retry-delay` с одним дефисом, нет `--max-time`                 | `--retry-delay`, добавить `--max-time`, `timeout-minutes`          |
| `container ... is unhealthy`                                                  | ошибка в самой команде healthcheck или приложение не стартует    | `docker inspect ... .State.Health`, поле `Output`                  |
| `additional properties 'xxx' not allowed` / `mapping key ... already defined` | съехали отступы в YAML                                           | выровнять уровни, только пробелы, `docker compose config` локально |
| `image-scan` красный, таблица Trivy                                           | в образе пакеты с известными уязвимостями, исправление уже вышло | пересобрать на свежей базе или `apk upgrade`, см. [07-docker.md](07-docker.md#9-безопасность-образов) |
| Конфликт слияния в редакторе                                                  | в `main` и в ветке изменена одна и та же строка                  | оставить итог, удалить маркеры `<<<<<<<`, `=======`, `>>>>>>>`     |
| `Invalid workflow file`                                                       | ошибка YAML (отступы, опечатка в ключе)                          | проверить отступы и имена ключей                                   |
| На PR `Checks 0` и крутится «Checking for the ability to merge»               | задержка на стороне GitHub                                       | подождать 1-2 минуты, Ctrl+F5; проверить вкладку Actions           |
| Из одного PR запустилось несколько workflow                                   | сработали триггеры нескольких файлов, нет `paths`                | добавить `paths` в `pull_request`, `concurrency`                   |
| Обязательная проверка висит «Expected»                                        | workflow не запустился из-за `paths`                             | делать обязательными только проверки без `paths`                   |

## 8. Основы CD (дальнейший план)

- Для деплоя создаётся **отдельный SSH-ключ** (не личный) и кладётся в GitHub Secrets, а публичная часть на сервер.
- Деплой-workflow по успешному CI заходит на сервер и выполняет `docker compose pull && docker compose up -d`.
- **Environment `production`** с ручным подтверждением защищает от случайного деплоя.
- **Откат:** развернуть предыдущий образ по тегу с хэшем коммита (поэтому образы публикуются с `${{ github.sha }}`).
- Сервер за reverse proxy (Caddy) с доменом и HTTPS; порт приложения привязан к `127.0.0.1`.

## 9. Pull request от Dependabot

- Ветки `dependabot/...` не удаляют вручную: каждая принадлежит открытому PR. Правильно работать через сам PR.
- Порядок оценки: тип обновления (patch, minor, **major**), зелёный ли CI, release notes в тексте PR.
- Мажорные версии осторожно: может ломаться API (Express 4 → 5, Redis-клиент 4 → 5+). Мажорная версия БД (Postgres 16 → 18) несовместима с существующим томом без миграции (`pg_dump` и восстановление или `pg_upgrade`).
- Для Node выбирай **LTS** (чётные версии); нечётные («Current») живут недолго.
- Команды Dependabot в комментарии к PR:

  ```
  @dependabot rebase                       # пересобрать PR на свежем main
  @dependabot recreate                     # пересоздать PR с нуля
  @dependabot close                        # закрыть PR
  @dependabot ignore this major version    # закрыть и не предлагать эту мажорную версию
  @dependabot ignore this dependency       # закрыть и не предлагать эту зависимость
  ```

  При `ignore ...` Dependabot сам удалит ветку.
- Чтобы ветки не копились: **Settings → General → Pull Requests → Automatically delete head branches**.
- Ограничить поток PR в `dependabot.yml`:

  ```yaml
      open-pull-requests-limit: 3
      groups:
        python-deps:
          patterns: ["*"]          # мелкие обновления одним PR
  ```
