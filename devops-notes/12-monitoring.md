# 12. Мониторинг: Prometheus + Grafana

Конспект по мониторингу стека guestbook-new: что собирает метрики, где они хранятся, как рисуются дашборды и что делать, когда что-то не работает.

## 1. Как это устроено

```
api (:9100/metrics) ──────┐
redis-exporter (:9121) ───┤ pull каждые 15s
node-exporter (:9100) ────┤
prometheus (:9090) ───────┘
          │
          ▼
     Prometheus (TSDB, хранит 15 дней)
          │ PromQL
          ▼
       Grafana ──> дашборд «Guestbook» (браузер, 127.0.0.1:3000)
```

- **Метрика** это число с именем, метками и временем: `redis_connected_clients{instance="redis-exporter:9121", job="redis"} 2`.
- **Pull-модель:** Prometheus сам ходит по целям (targets) и забирает `/metrics`. Приложению не нужно знать, где Prometheus.
- **Exporter** это переводчик: сервис сам метрик не отдаёт (Redis, ядро Linux), поэтому рядом ставят маленький процесс, который опрашивает его и отдаёт метрики в формате Prometheus.
- **Prometheus** собирает и хранит метрики. **Grafana** только рисует: своих данных не хранит, ходит в Prometheus запросами PromQL.
- Мониторинг показывает состояние. Чтобы система сама сообщала о проблеме, нужны алерты (раздел 8).

| Компонент | Роль | Порт |
|-----------|------|------|
| `api` | метрики приложения | 9100 (отдельный от основного порта 3000) |
| `redis-exporter` | метрики Redis | 9121 |
| `node-exporter` | метрики хоста: диск, CPU, RAM | 9100 |
| `prometheus` | сбор и хранение | 9090 |
| `grafana` | дашборды | 3000 |

## 2. Сети в Compose

| Сеть | Участники | Зачем |
|------|-----------|-------|
| `edge` | frontend, api | прокси Nginx → API |
| `backend` (`internal: true`) | api, redis, redis-exporter | API и экспортёр ходят в Redis, наружу выхода нет |
| `metrics` | api, redis-exporter, node-exporter, prometheus | Prometheus забирает метрики |
| `monitoring` (`internal: true`) | prometheus, grafana | Grafana ходит в Prometheus |

Идея: у каждой пары «кто с кем говорит» своя сеть, остальное изолировано. Redis недоступен из `metrics`, а Grafana не видит API и Redis напрямую.

Важно: Docker **не публикует порты контейнеров из `internal`-сетей**. Если сервис сидит только в такой сети, строка `ports:` формально есть, но с хоста он недоступен. Поэтому Grafana, у которой порт опубликован на `127.0.0.1:3000`, должна быть ещё и в сети без `internal` (например, `edge`).

## 3. Конфиг Prometheus

`prometheus/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ["localhost:9090"]

  - job_name: guestbook-api
    static_configs:
      - targets: ["api:9100"]

  - job_name: redis
    static_configs:
      - targets: ["redis-exporter:9121"]

  - job_name: node
    static_configs:
      - targets: ["node-exporter:9100"]
```

- Адреса это **имена сервисов Compose** и **внутренние порты**: Prometheus и цели находятся в одной сети (`metrics`), порты публиковать не нужно.
- `job_name` становится меткой `job` у каждой метрики.
- Хранение: флаг `--storage.tsdb.retention.time=15d`, данные в томе `prometheus-data`.
- Конфиг монтируется только на чтение (`:ro`). После правки: `docker compose restart prometheus`.

### Метрика `up`

Prometheus сам создаёт `up` для каждой цели: `1` значит, что последний сбор удался, `0` значит, что нет. Это первое, что нужно смотреть.

## 4. Шпаргалка PromQL

| Что хочу | Запрос |
|----------|--------|
| Какие цели живы | `up` |
| Redis жив | `redis_up` |
| Клиентов Redis | `redis_connected_clients` |
| Память Redis | `redis_memory_used_bytes` |
| Команд в секунду | `rate(redis_commands_processed_total[1m])` |
| Диск занят, % | `100 - (node_filesystem_avail_bytes{mountpoint="/",fstype!="rootfs"} / node_filesystem_size_bytes{mountpoint="/",fstype!="rootfs"} * 100)` |
| Свободно на диске, байт | `node_filesystem_avail_bytes{mountpoint="/",fstype!="rootfs"}` |
| Загрузка CPU, % | `100 - avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100` |
| Свободная RAM, % | `node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes * 100` |

Основные понятия:

- **Селектор:** `metric{label="value"}` фильтрует серии по меткам; `!=` исключает, `=~` это регулярка.
- **Counter** (только растёт, например `..._total`): смотрят не значение, а скорость через `rate(metric[1m])`.
- **Gauge** (растёт и падает: память, клиенты): берут значение как есть.
- **`avg`, `sum`, `max`** агрегируют серии (например, по ядрам CPU).
- Диапазон `[1m]` должен быть минимум в 2-4 раза больше `scrape_interval`.

## 5. Grafana и provisioning

Provisioning это настройка Grafana из файлов, а не кликами. Благодаря ему после `docker compose down -v` всё поднимается само.

Структура:

```
grafana/
├── dashboards/
│   └── guestbook.json              # сам дашборд
└── provisioning/
    ├── datasources/datasources.yml # источник данных
    └── dashboards/dashboards.yml   # откуда грузить дашборды
```

`datasources.yml`:

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    uid: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
```

`dashboards.yml`:

```yaml
apiVersion: 1
providers:
  - name: default
    type: file
    options:
      path: /etc/grafana/dashboards
```

В `docker-compose.yml` обе папки монтируются в Grafana с `:ro`, а пароль администратора берётся из `.env` (`GRAFANA_ADMIN_PASSWORD`).

**Фиксированный `uid: prometheus` обязателен.** Без него Grafana генерирует случайный uid при каждом создании с нуля, а JSON дашборда ссылается на старый, и панели показывают «datasource not found».

`access: proxy` значит, что запросы к Prometheus делает сам сервер Grafana (а не браузер), поэтому в URL можно использовать имя сервиса `prometheus`.

## 6. Как собрать дашборд и сохранить в Git

1. **Explore** (`Dashboards → Explore`): пробуем запросы, смотрим, что есть в Metrics browser. Из Explore дашборд не сохраняется.
2. **Dashboards → New → New dashboard → Add visualization**: по одной панели на запрос. Задать Title, тип, **Unit** (bytes (IEC), Percent (0-100)), для процентов Min 0 и Max 100, **Display name** вместо длинной подписи `{__name__=...}`.
3. Панели из других дашбордов переносятся через меню `⋮` → **More… → Copy** и **Add → Paste panel**.
4. **Save dashboard** → **Exit edit**.
5. **Export → Export as JSON** (переключатель «Export the dashboard to use in another instance» выключен, иначе вместо uid будет переменная `${DS_PROMETHEUS}`, которую provisioning не подставляет).
6. Сохранить как `grafana/dashboards/guestbook.json`, проверить, что в панелях `"datasource": {"type": "prometheus", "uid": "prometheus"}`.
7. **Проверка автозагрузки:** `docker compose down -v && docker compose up -d`, через 20-30 секунд дашборд должен появиться сам.

Панели дашборда «Guestbook»: состояние сервисов (`up`, Stat), память Redis, клиенты Redis, занятый диск (Gauge), загрузка CPU, свободная RAM.

## 7. Проверка и команды

```bash
docker compose ps                                            # все ли healthy
docker compose logs grafana --tail 50                        # логи Grafana
docker compose logs grafana | grep -i provisioning           # загрузился ли provisioning
docker compose exec api wget -qO- http://127.0.0.1:9100/metrics | head -20   # метрики API
docker compose exec prometheus wget -qO- 'http://127.0.0.1:9090/api/v1/targets' | grep -o '"health":"[a-z]*"'   # состояние целей
df -h                                                        # место на диске хоста
docker system df                                             # место под образы, контейнеры, тома
```

Что считать «всё хорошо»: в Explore запрос `up` возвращает по одной серии на цель, и у всех значение `1`.

## 8. Деплой мониторинга на сервер

Мониторинг выкатывается тем же плейбуком `ansible/deploy.yml` и тем же workflow `deploy`, что и приложение.

1. **Секреты.** `GRAFANA_ADMIN_PASSWORD` лежит в GitHub Secrets. Workflow собирает `extra_vars.json` (через `jq`, вместе с `redis_password`, `ghcr_user`, `ghcr_token`) и передаёт его в Ansible. Первая задача плейбука `assert` падает с понятным сообщением, если переменной нет.
2. **Файлы.** Модуль `copy` кладёт в `/opt/guestbook` файл `docker-compose.yml` и папки `prometheus/` и `grafana/` (права 0644 для файлов, 0755 для папок). Результат `register` (`prometheus_cfg`, `grafana_cfg`) говорит, изменились ли файлы.
3. **`.env`** собирается из шаблона `env.j2` (права 0600, `no_log: true`). В шаблоне обязательно должна быть строка `GRAFANA_ADMIN_PASSWORD={{ grafana_admin_password }}`, иначе Compose на сервере упадёт на `${GRAFANA_ADMIN_PASSWORD:?...}`.
4. **Запуск.** `community.docker.docker_compose_v2`: `state: present`, `pull: missing`, `build: never`, `wait: true`, `wait_timeout: 180`. Образы приложения берутся из GHCR по SHA, образы Prometheus, Grafana и экспортёров из публичных реестров.
5. **Перезапуск по условию.** `docker compose up` не пересоздаёт контейнер, если изменился только файл, смонтированный bind mount-ом: Prometheus не перечитает `prometheus.yml`, Grafana не увидит новый дашборд. Поэтому есть отдельная задача `state: restarted` для `prometheus` и `grafana` с условием `when: prometheus_cfg.changed or grafana_cfg.changed`. Если конфиги не менялись, перезапуска нет (идемпотентность).
6. **Проверки в плейбуке.** `uri` на `http://127.0.0.1:8080/api/health` (API через Nginx) и на `http://127.0.0.1:3000/api/health` (Grafana), оба с `until` / `retries: 10` / `delay: 3`: контейнеру нужно время подняться.
7. **Проверка в workflow.** Негативный тест: `https://<домен>/api/metrics` на публичном домене должен вернуть **404**. Метрики API отдаются на порту 9100 внутри сети `metrics`, а Nginx проксирует только `/api/` на порт 3000. Тест проверяет, что внутренние метрики не торчат наружу.
8. **Доступ к Grafana на сервере.** Порт привязан к `127.0.0.1:3000`, Caddy его не проксирует, UFW не открывает. Смотреть через SSH-туннель:

   ```bash
   ssh -L 3000:127.0.0.1:3000 deploy@<IP-сервера>
   # затем открыть http://localhost:3000 (admin / GRAFANA_ADMIN_PASSWORD)
   ```

9. **Ресурсы.** Сумма `mem_limit` всего стека около 1,9 ГБ (redis 256, api 256, frontend 256, redis-exporter 64, node-exporter 64, prometheus 512, grafana 512 МБ). Для почасового VPS проверьте запас: `free -h` и `docker stats --no-stream`.

Идея на будущее: дополнительная негативная проверка, что порт 3000 не отвечает снаружи (`curl --max-time 5 http://<IP>:3000` должен не соединиться).

## 9. Что дальше

- **Алерты:** файл правил `prometheus/alerts.yml`, подключается через `rule_files:` в `prometheus.yml`. Примеры правил: `up == 0` дольше минуты, диск занят более 85%, Redis использует более 80% от `mem_limit`. Для уведомлений понадобится Alertmanager.
- **cAdvisor:** метрики по каждому контейнеру (CPU, память, сеть).
- **Метрики API:** частота запросов и задержки, 2-3 панели.
- **Loki + Promtail:** логи контейнеров в той же Grafana.

## 10. Каталог ошибок

| Симптом | Причина | Решение |
|---------|---------|---------|
| `Bind for 127.0.0.1:8080 failed: port is already allocated` | порт уже занят другим контейнером или процессом | `docker ps --filter "publish=8080"`, остановить старый стек; либо сделать порт настраиваемым: `"${BIND_ADDR:-127.0.0.1}:${FRONTEND_PORT:-8080}:8080"`. Для хоста: `sudo lsof -i :8080` (Linux), `netstat -ano \| findstr :8080` (Windows) |
| Grafana не открывается на `127.0.0.1:3000`, в `docker compose ps` порт показан как `3000/tcp` без `127.0.0.1:` | сервис только в `internal`-сети, порты оттуда не публикуются | добавить сервис в сеть без `internal` (например, `edge`) |
| `path / is mounted on / but it is not a shared or slave mount` | `rslave` в bind mount `/:/host:ro,rslave` не работает в WSL2 | убрать `rslave`: `/:/host:ro` |
| Дашборд есть, панели пустые, «datasource not found» | в JSON дашборда другой uid источника данных | `uid: prometheus` в `datasources.yml`, в JSON заменить uid на `prometheus` |
| Дашборда нет после старта | неверный `path` в `dashboards.yml`, невалидный JSON или файл не в `grafana/dashboards/` | `docker compose logs grafana \| grep -i provisioning` |
| В Explore «No data» | запрос не введён или не нажат Run query; Prometheus ещё не успел собрать (подождать минуту); неверный источник данных | проверить запрос `up`, **Connections → Data sources → Prometheus → Save & test** |
| Цель `down` в `up` | неверное имя или порт в `prometheus.yml`, сервис не в общей сети с Prometheus | проверить `scrapeUrl` и `lastError` в `/api/v1/targets` |
| Метрики API не находятся на порту 3000 | метрики отдаются на отдельном порту 9100 | `wget -qO- http://127.0.0.1:9100/metrics` внутри контейнера `api` |
| На графике всё сливается в ноль | в одном запросе смешаны метрики разного масштаба (байты и проценты) | по одному запросу на панель |
| Подпись серии `{__name__="...", instance=..., job=...}` | подпись Auto | **Standard options → Display name** или **Options → Legend → Custom**; для одной серии можно выключить легенду |
| `CPU`/диск показывают метрики не Windows, а WSL | node-exporter видит виртуальную машину WSL2 | для учебного стека нормально; на настоящем сервере показывает хост |
| `GRAFANA_ADMIN_PASSWORD is not set` | переменная не задана в `.env` | добавить в `.env` и в `.env.example` (без значения) |
| Готовый дашборд (например, ID 1860) не работает через provisioning | в JSON стоит `${DS_PROMETHEUS}` | заменить на `prometheus` (или uid источника данных) |
| Деплой падает на `assert` в начале плейбука | нет `grafana_admin_password` (секрет не создан в GitHub или не передан) | создать секрет `GRAFANA_ADMIN_PASSWORD` в environment `production` |
| На сервере Compose пишет `GRAFANA_ADMIN_PASSWORD is not set` | в шаблоне `env.j2` нет этой переменной | добавить строку в `env.j2` |
| Изменил дашборд или `prometheus.yml`, на сервере всё по-старому | контейнер не перезапущен: bind-mount файл не вызывает пересоздание | `docker compose restart prometheus grafana` (плейбук делает это сам при изменении файлов) |
| Шаг «Check that metrics are not exposed publicly» красный | `/api/metrics` на домене вернул не 404 (метрики попали в публичный маршрут) | проверить `nginx.conf` и что метрики API идут только на порт 9100 в сети `metrics` |