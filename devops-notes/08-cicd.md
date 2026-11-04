# CI/CD (GitHub Actions)

[← К оглавлению](README.md)

Про ветки, pull request, конфликты и защиту `main` см. [01-git.md](01-git.md). Про подготовку сервера и ручной деплой см. [10-vps-setup.md](10-vps-setup.md), про Ansible см. [11-ansible.md](11-ansible.md).

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
- **`workflow_dispatch`**: кнопка «Run workflow» появляется только когда файл есть в главной ветке (`main`). Новый workflow с ручным запуском сначала мержат, потом запускают.
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
- **Входные параметры ручного запуска** (`inputs`) описываются под `workflow_dispatch`, читаются как `${{ inputs.имя }}`:

  ```yaml
  on:
    workflow_dispatch:
      inputs:
        tag:
          description: "Полный SHA коммита"
          required: false
          type: string
  ```
- **Передать значение между шагами:** `echo "TAG=$TAG" >> "$GITHUB_ENV"`, в следующих шагах доступно как `$TAG`. Краткий итог запуска: `echo "текст" >> "$GITHUB_STEP_SUMMARY"`.
- **Значение по умолчанию в bash:** `${A:-B}` означает «A, а если пусто, то B» (так тег по умолчанию берётся из `$GITHUB_SHA`).

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
- **Образы публикуются только когда сработал `publish`**: у `guestbook-ci` на push в `main` стоит фильтр `paths`, поэтому коммит, не менявший `guestbook-new/`, образов не создаёт. SHA для деплоя берут у коммита, который их публиковал: `git log -1 --format=%H -- guestbook-new`.
- Проверить, что образ с тегом существует, не скачивая его: `docker buildx imagetools inspect ghcr.io/<owner>/guestbook-api:<sha>`.
- На сервере вход в GHCR вручную: токен (PAT) с правом `read:packages`, `docker login ghcr.io -u <user>`. В автоматическом деплое (раздел 8) вместо PAT используется короткий `GITHUB_TOKEN` самого запуска: он не истекает «через 30 дней» и не лежит нигде постоянно.
- **Параметры `build-push-action`:** `context` (папка сборки, как `build:` в Compose), `push: true` (отправить в реестр), `load: true` (загрузить собранный образ в локальный Docker раннера, нужно для сканирования; Buildx по умолчанию не кладёт образ в `docker images`), `tags` (имена), `cache-from` / `cache-to` (кэш слоёв в хранилище GitHub Actions; `scope` разделяет кэш разных образов, `mode=max` сохраняет и промежуточные стадии), `no-cache: true` (не использовать кэш вообще).

## 5. Безопасность образов в пайплайне

Про Trivy и hadolint подробно: [07-docker.md, раздел 9](07-docker.md#9-безопасность-образов).

Если Trivy падает на пакеты, исправление которых уже вышло (статус `fixed`): в финальном стейдже Dockerfile **до** `USER` выполнить `apk upgrade --no-cache` (hadolint ругается на него правилом DL3017, поэтому сверху комментарий `# hadolint ignore=DL3017`). Если локально пакеты обновились, а в CI проверка всё равно красная, причина почти всегда **устаревший кэш слоёв**: слой с `apk upgrade` закэшировался, когда в репозитории Alpine была старая версия (см. раздел 7 и раздел 10).

## 6. Безопасность в CI

- **Секреты:** никогда не в Git. Для CI используются GitHub Secrets (`${{ secrets.NAME }}`) и тестовые значения из `.env.example`. Если секрет попал в историю, удаления файла недостаточно: ключ нужно **перевыпустить**.
- **Минимальные права токена:** `permissions: contents: read` на уровне workflow; расширенные права (`packages: write`) только в том job, которому они нужны. Указанное в `permissions` ограничивает всё остальное до `none`.
- **Секреты и ввод пользователя в `run:`** передаются через `env:`, а не подставляются в команду как `${{ ... }}`. Иначе значение с кавычками или `;` превращается в код (инъекция команд).
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
| `image-scan` красный, таблица Trivy, статус `fixed`                           | в образе пакеты с известными уязвимостями, исправление уже вышло | `apk upgrade --no-cache` в финальном стейдже до `USER` + `# hadolint ignore=DL3017`, или свежий тег базового образа, см. [07-docker.md](07-docker.md#9-безопасность-образов) |
| Trivy красный, хотя локально после `docker build --no-cache` пакеты обновлены | устаревший кэш слоёв `type=gha` (слой `apk upgrade` закэширован со старыми версиями) | `gh cache delete --all`, затем перезапуск; в `image-scan` добавить `no-cache: true` |
| Trivy красный, `fixed version` есть в отчёте, но `apk list -u` пуст           | в вашей ветке Alpine обновления ещё нет                           | подождать, поднять тег базового образа или временно `.trivyignore` с номером CVE и комментарием |
| Конфликт слияния в редакторе                                                  | в `main` и в ветке изменена одна и та же строка                  | оставить итог, удалить маркеры `<<<<<<<`, `=======`, `>>>>>>>`     |
| `Invalid workflow file`                                                       | ошибка YAML (отступы, опечатка в ключе)                          | проверить отступы и имена ключей                                   |
| На PR `Checks 0` и крутится «Checking for the ability to merge»               | задержка на стороне GitHub                                       | подождать 1-2 минуты, Ctrl+F5; проверить вкладку Actions           |
| Из одного PR запустилось несколько workflow                                   | сработали триггеры нескольких файлов, нет `paths`                | добавить `paths` в `pull_request`, `concurrency`                   |
| Обязательная проверка висит «Expected»                                        | workflow не запустился из-за `paths`                             | делать обязательными только проверки без `paths`                   |
| Пустой коммит в `main` не запустил пайплайн                                   | у `push` стоит `paths`, а файлы не менялись                      | `gh run rerun`, `gh workflow run` (если есть `workflow_dispatch`)  |
| Нет кнопки «Run workflow» у нового workflow                                   | файл ещё не в `main`                                             | сначала смержить файл в `main`                                     |
| В VS Code подчёркнуты все `uses:`: `Unable to resolve action ..., repository or version not found`, а запуски на GitHub зелёные | расширение GitHub Actions не может обратиться к GitHub API (нет входа, лимит запросов, нет сети из WSL) | войти в GitHub в VS Code, посмотреть Output → GitHub Actions; на работу CI не влияет |

## 8. CD: деплой на сервер из GitHub Actions

Деплой запускается **вручную** (`workflow_dispatch`) и принимает полный SHA коммита, образы которого нужно выкатить. Откат это тот же запуск со старым SHA.

```
Run workflow (tag = SHA) → проверка формата SHA → образы с этим тегом есть в GHCR?
  → SSH на сервер под deploy → Ansible (ansible/deploy.yml) → docker compose pull/up --wait
  → проверка https://<домен>/api/health через Caddy
```

**Файлы:**

| Файл | Роль |
|------|------|
| `.github/workflows/deploy.yml` | оркестрация: проверки, SSH, запуск Ansible, финальная проверка |
| `ansible/deploy.yml` | что делать на сервере: папка, compose-файл, `.env`, вход в GHCR, `compose up`, health |
| `ansible/templates/env.j2` | шаблон `.env` (`PORT`, `REDIS_*`, `TAG`, `BIND_ADDR`) |
| `ansible/site.yml` | разовая подготовка сервера: пользователь `deploy`, ключи, UFW, Docker, Caddy, sshd |

### Входные параметры и секреты

| Что | Тип | Откуда берётся |
|-----|-----|----------------|
| `tag` | input запуска | SHA образов; пусто = HEAD выбранной ветки |
| `host` | input запуска | IP сервера; пусто = переменная `VPS_HOST` |
| `VPS_HOST` | variable (не секрет) | IP текущего сервера, `gh variable set VPS_HOST --body "<IP>"` |
| `DEPLOY_SSH_KEY` | secret | приватный ключ CI, `gh secret set DEPLOY_SSH_KEY < ~/ci_deploy_key` |
| `REDIS_PASSWORD` | secret | пароль Redis для `.env` на сервере |
| `GITHUB_TOKEN` | встроенный | вход в GHCR и для проверки образов, и для `docker login` на сервере |

### Разовая подготовка

1. Отдельный SSH-ключ для CI (не личный): `ssh-keygen -t ed25519 -f ~/ci_deploy_key -N "" -C github-actions-deploy`. Приватный файл в репозиторий не кладём.
2. Публичную часть записать в `site.yml` (`ci_pubkey`) и передавать **вместе** с личным ключом: `key: "{{ ssh_pubkey }}\n{{ ci_pubkey }}"`. У задачи `authorized_key` стоит `exclusive: true`, поэтому любой ключ, которого нет в списке, при следующем прогоне `site.yml` удаляется (так пропал бы ключ CI).
3. Прогнать `site.yml`, чтобы ключ оказался на сервере.
4. Добавить секреты и переменную (таблица выше).

### Как устроен workflow

- **`concurrency: group: deploy-production`, `cancel-in-progress: false`**: два деплоя не идут одновременно, второй ждёт, первый не обрывается на середине.
- **`environment: production`**: привязка к окружению GitHub; позже можно включить обязательное подтверждение.
- **`permissions: packages: read`** на уровне job: токен только читает образы.
- **Проверка SHA** регулярным выражением `^[0-9a-f]{40}$` до любых действий с сервером; такая же проверка есть и в `assert` плейбука.
- **Проверка образов** `docker buildx imagetools inspect ...:$TAG` для `guestbook-api` и `guestbook-frontend`: падаем сразу, если для этого SHA образов нет (например, коммит менял только README, и `publish` не запускался).
- **Ansible** ставится через `pipx` с ограничением версии (`ansible-core>=2.18,<2.19`) и коллекцией `community.docker` (модуль `docker_compose_v2`).
- **SSH:** ключ из секрета пишется в файл с `umask 077`; отпечаток сервера берётся `ssh-keyscan`, это доверие «при первом контакте». Для учебного стенда допустимо, для боевого сервера отпечаток нужно проверять заранее.
- **Inventory создаётся на лету** (`[vps]` с IP из `VPS_HOST`): адрес не хранится в репозитории, а у почасового VPS он меняется при каждом пересоздании.
- **Секреты в Ansible** собираются командой `jq -n --arg ...  '$ARGS.named'` в файл `extra_vars.json` и передаются через `-e @файл`. Локальный `secrets.yml` в `.gitignore` и на раннере не существует, поэтому плейбук не подключает его через `vars_files`: секреты всегда приходят снаружи.
- **Токен для GHCR на сервере**: `GITHUB_TOKEN` запуска (`ghcr_user` = `github.actor`). После окончания job он перестаёт действовать, но образы уже скачаны; следующий деплой логинится заново.
- **В плейбуке**: `no_log: true` на задачах с паролем и токеном; `.env` с правами `0600`; `assert` проверяет `app_tag`, `redis_password`, `ghcr_user`, `ghcr_token`; `pull: missing` и `build: never` (образ скачивается только если нужного тега ещё нет, на сервере ничего не собирается); `wait: true` ждёт healthy.
- **Финальная проверка**: `curl -fsS --retry ... https://<домен>/api/health`. Проходит вся цепочка: DNS, Caddy, TLS, Nginx, API, Redis.

### Запуск и откат

- **Запуск:** Actions → deploy → Run workflow; в `tag` вставить SHA, в `host` при необходимости IP.
- **Откат:** запустить тот же workflow со старым SHA. Пересборка не нужна, образ лежит в GHCR. Откат по `latest` невозможен: плавающий тег не указывает на прошлую версию.
- **Где взять SHA:** `git log -1 --format=%H -- guestbook-new` (последний коммит, публиковавший образы) или GitHub → Packages → теги образа.
- **Локально без GitHub** (удобно, чтобы отделить ошибки плейбука от ошибок workflow):

  ```bash
  cd ansible
  ansible-playbook deploy.yml -e @secrets.yml -e app_tag=<полный sha>
  # если secrets.yml зашифрован: добавить --ask-vault-pass
  ```

### Почасовой VPS: что делать после пересоздания

1. Обновить IP в DuckDNS.
2. Прогнать `site.yml` (пользователь, ключи, UFW, Docker, Caddy).
3. `gh variable set VPS_HOST --body "<новый IP>"` (или указать `host` при запуске).
4. Запустить deploy с нужным SHA.

Новый сервер = новый отпечаток SSH; `ssh-keyscan` в workflow его подхватывает. Не забывать про лимиты Let's Encrypt при частых пересозданиях: сертификат запрашивается заново (см. [10-vps-setup.md](10-vps-setup.md)).

### Типичные ошибки CD (дополнять по ходу первых запусков)

| Симптом | Вероятная причина | Решение |
|---------|-------------------|---------|
| падает шаг `imagetools inspect` | для SHA нет образов (коммит не менял `guestbook-new/`) или нет прав `packages: read` | взять SHA из `git log -1 --format=%H -- guestbook-new`, проверить Packages и `permissions` |
| `test -s ~/.ssh/known_hosts` красный | сервер не запущен, неверный `VPS_HOST`, закрыт порт 22 | проверить IP и UFW |
| `Permission denied (publickey)` | ключа CI нет на сервере (не прогнан `site.yml`) или в секрет попал не весь ключ | прогнать `site.yml`, пересоздать секрет из файла целиком |
| после повторного прогона `site.yml` CI перестал заходить | в `authorized_key` с `exclusive: true` не указан `ci_pubkey` | передавать оба ключа через `\n` |
| assert: нужны `app_tag`, `redis_password` ... | не передан `-e @extra_vars.json` или SHA не 40 hex | проверить шаги подготовки и значение `tag` |
| `secrets.yml` not found | в плейбуке остался `vars_files: secrets.yml`, а файла на раннере нет | убрать `vars_files`, передавать секреты через `-e` |
| `unauthorized` при `docker compose pull` на сервере | у `GITHUB_TOKEN` нет доступа к пакету | проверить, что образ связан с репозиторием (label `org.opencontainers.image.source`) и права `packages: read` |
| финальный `curl` красный | DNS на старом IP, Caddy не получил сертификат (закрыт порт 80), стек не healthy | `journalctl -u caddy` на сервере, `docker compose ps` |

### Что можно добавить дальше

- Автозапуск после успешного `guestbook-ci` на `main` (триггер `workflow_run`).
- Обязательное подтверждение деплоя в окружении `production` (required reviewers).
- Запись в Summary, какой SHA сейчас на сервере, и проверка, не откатываем ли мы случайно на более старую версию.

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

## 10. Команды `gh` и мелочи

```bash
gh run list --limit 5                    # последние запуски и их id
gh run rerun <run-id> --failed           # перезапустить упавшие job
gh run view <run-id> --log-failed        # лог упавших шагов
gh workflow list                         # workflow, которые видит GitHub
gh workflow run guestbook-ci.yml --ref <ветка>   # ручной запуск (нужен workflow_dispatch)

gh cache list                            # кэши Actions с id и размерами
gh cache delete <id>                     # удалить один
gh cache delete --all                    # удалить все (кэш пересоберётся при следующем запуске)

gh secret set NAME                       # секрет, значение вводится скрыто
gh secret set NAME < файл                # секрет из файла (например, приватный ключ)
gh variable set NAME --body "значение"   # переменная (не секрет)
gh secret list; gh variable list
```

- **Пустой коммит** для запуска пайплайна: `git commit --allow-empty -m "ci: trigger pipeline"` и `git push`. На `pull_request` сработает всегда; на push в `main` не сработает из-за `paths`. Чаще проще `gh run rerun` или `gh workflow run`.
- **Очистить локальный кэш Docker** (не путать с кэшем Actions): `docker builder prune`; сборка без кэша: `docker build --no-cache`.
- **Проверить образ до пуша** тем же сканером, что в CI:

  ```bash
  docker build -t guestbook-frontend:scan guestbook-new/frontend
  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
    aquasec/trivy image --severity HIGH,CRITICAL --ignore-unfixed guestbook-frontend:scan
  ```
- **Проверить, что обновилось в образе:** `docker run --rm --entrypoint sh <образ> -c 'apk info -v | grep <пакет>'`, а доступные обновления: `docker run --rm --user root --entrypoint sh <образ> -c 'apk update >/dev/null && apk list -u'`.