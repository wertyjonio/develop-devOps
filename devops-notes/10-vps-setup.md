# Первичная настройка VPS: вход, SSH, файрвол

Пошаговый порядок действий для нового сервера на Ubuntu 24.04 (минимизированный образ облачного провайдера). Это практическая инструкция «что и в каком порядке делать»; теория по hardening лежит в [06-security.md](06-security.md).

**Главное правило:** не закрывай рабочую сессию, пока не проверил вход новой. Иначе одна ошибка в `sshd` или файрволе, и ты заперт снаружи (спасёт только веб-консоль провайдера).

> В командах ниже `<IP>` это адрес сервера. Реальный IP в публичный репозиторий лучше не писать.

## Алгоритм одним взглядом

| # | Шаг | Где | Зачем |
|---|-----|-----|-------|
| 1 | Создать SSH-ключ | локально | вход без пароля |
| 2 | Войти на сервер | локально -> сервер | убедиться, что ключ работает |
| 3 | Обновить систему | сервер | закрыть известные уязвимости |
| 4 | Создать пользователя `deploy` | сервер | не работать под root |
| 5 | Проверить вход новым пользователем | второй терминал | защита от самоблокировки |
| 6 | Ужесточить `sshd` | сервер | запретить root и пароли |
| 7 | Включить UFW | сервер | закрыть всё, кроме 22/80/443 |
| 8 | Учесть обход UFW у Docker | `docker-compose.yml` | не открыть порты случайно |
| 9 | Удобный вход через `~/.ssh/config` | локально | `ssh vps` вместо длинной команды |
| 10 | Установить Docker | сервер | запускать контейнеры проекта |
| 11 | Keepalive и `tmux` | локально и сервер | переживать обрывы SSH |
| 12 | Ручной деплой проекта | сервер | запустить стек из образов GHCR |
| 13 | Обновление и откат по тегу | сервер | менять версию одной строкой в `.env` |

## 1. Ключ на локальной машине

```bash
ssh-keygen -t ed25519 -C "vps-learning"
```

Создаётся пара: приватный `~/.ssh/id_ed25519` (никому не отдавать) и публичный `~/.ssh/id_ed25519.pub` (его кладём на серверы). Лучше всего добавить публичный ключ в панели провайдера при создании VPS: тогда первый вход сразу идёт по ключу.

Если сервер уже создан и есть только пароль:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub <пользователь>@<IP>
```

## 2. Первый вход

```bash
ssh root@<IP>
```

При первом подключении SSH спросит про отпечаток хоста (`The authenticity of host ... can't be established`). Это нормально: отвечаем `yes`, сервер записывается в `~/.ssh/known_hosts`.

Какого пользователя пускает ключ, зависит от провайдера: где-то это `root`, где-то `ubuntu`. Если запросили пароль, значит, для этого пользователя ключа на сервере нет (подробнее в каталоге ошибок ниже).

## 3. Обновление системы

```bash
apt update && apt upgrade -y
```

Если обновилось ядро, перезагрузись (`reboot`) и зайди снова.

## 4. Пользователь `deploy`

```bash
adduser deploy
usermod -aG sudo deploy

mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

Каждая команда идёт с **новой строки** (или через `&&`). Если вставить всё одной строкой через пробелы, `mkdir` примет остальные команды за имена папок.

Что делает каждая команда:

| Команда | Что происходит |
|---------|----------------|
| `adduser deploy` | создаёт пользователя с домашней папкой и паролем (пароль нужен для `sudo`) |
| `usermod -aG sudo deploy` | добавляет в группу `sudo` (`-a` дописать, а не заменить группы) |
| `mkdir -p .../.ssh` | создаёт папку для ключей; `-p` не ругается, если она уже есть |
| `cp .../authorized_keys` | копирует список разрешённых ключей: тот же ключ, что пускает в root, теперь пустит и в `deploy` |
| `chown -R deploy:deploy` | отдаёт папку и файл пользователю `deploy` (создал их root) |
| `chmod 700` на папку | доступ только владельцу |
| `chmod 600` на файл | чтение и запись только владельцу |

Права важны: если `authorized_keys` доступен другим пользователям, `sshd` откажется его использовать.

Проверить:

```bash
ls -la /home/deploy/.ssh
# drwx------ ... .
# -rw------- ... authorized_keys
```

## 5. Проверка входа новым пользователем

Во **втором** терминале, не закрывая первый:

```bash
ssh deploy@<IP>
sudo whoami      # должно вывести: root
```

Пароль при входе спрашивать не должны (только при `sudo`). Пока это не работает, к следующему шагу не переходим.

## 6. Ужесточение `sshd`

Настройки кладём отдельным файлом в `sshd_config.d`, а не правим основной конфиг:

```bash
sudo tee /etc/ssh/sshd_config.d/01-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers deploy
EOF

sudo sshd -t                 # проверка синтаксиса (тишина = всё хорошо)
sudo systemctl reload ssh    # применить без разрыва текущих сессий
sudo sshd -T | grep -E 'permitrootlogin|passwordauthentication|allowusers'
```

Почему имя файла начинается с `01-`: `sshd` читает файлы из `sshd_config.d/` по алфавиту, и **побеждает первое найденное значение**. Cloud-init часто кладёт `50-cloud-init.conf` с `PasswordAuthentication yes`; наш файл должен идти раньше. Итоговые значения всегда проверяй через `sshd -T`.

| Параметр | Что даёт |
|----------|----------|
| `PermitRootLogin no` | вход под root по SSH запрещён |
| `PasswordAuthentication no` | вход по паролю запрещён, только ключи |
| `KbdInteractiveAuthentication no` | закрывает обходной путь ввода пароля |
| `PubkeyAuthentication yes` | вход по ключу разрешён |
| `AllowUsers deploy` | пускать только этого пользователя |

После `reload` снова проверь вход **новой** сессией. Смена порта SSH не обязательна: она убирает шум из логов, но защиты не добавляет. В Ubuntu 24.04 это к тому же неудобно из-за `ssh.socket`.

## 7. Файрвол (UFW)

На минимизированном образе `ufw` может быть не установлен:

```bash
sudo apt install -y ufw
```

Политики по умолчанию и разрешения:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH        # ВАЖНО: до enable
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

- `default deny incoming`: весь входящий трафик блокируется, если нет отдельного разрешения. Принцип «запрещено всё, что не разрешено явно».
- `default allow outgoing`: сервер свободно ходит наружу (`apt`, `docker pull`, DNS, внешние API). Ответы на соединения, которые открыл сам сервер, файрвол пропускает автоматически.
- `allow OpenSSH` **обязательно до `enable`**, иначе файрвол закроет текущую SSH-сессию. Если профиль `OpenSSH` не найден, используй `allow 22/tcp`.

В `status verbose` должны быть строка `Default: deny (incoming), allow (outgoing)` и правила для 22, 80 и 443.

## 8. Docker обходит UFW

Порты, опубликованные через `ports:` в Compose, Docker открывает через собственные правила iptables, **в обход UFW**. `ufw status` при этом может показывать, что порт закрыт, хотя он доступен снаружи. Поэтому:

- публикуй наружу только то, что должно быть публичным (reverse proxy на `80` и `443`);
- у баз данных, Redis и бэкенда не указывай `ports:` вообще: контейнеры общаются по внутренней сети Compose;
- если порт нужен только хосту, привязывай его к localhost: `127.0.0.1:5432:5432`.

В `guestbook-new` это уже учтено: порт фронтенда по умолчанию привязан к `127.0.0.1` (`BIND_ADDR`), а наружу сервис будет смотреть через reverse proxy.

Проверка снаружи (с локальной машины), что лишние порты действительно закрыты:

```bash
nc -zv <IP> 3000     # ожидаем отказ или таймаут
```

А на самом сервере посмотреть, что слушает:

```bash
sudo ss -tlnp
```

## 9. Удобный вход: `~/.ssh/config`

Локально:

```
Host vps
    HostName <IP>
    User deploy
    IdentityFile ~/.ssh/id_ed25519
```

После этого `ssh vps`, а также `scp file vps:~/` и `rsync` работают с коротким именем.

Если VPS арендуется почасово и пересоздаётся, у нового сервера будет другой отпечаток хоста (а иногда и IP). Тогда SSH ругнётся на `REMOTE HOST IDENTIFICATION HAS CHANGED`. Убедись, что сервер действительно новый, и удали старую запись:

```bash
ssh-keygen -R <IP>
```

## 10. Установка Docker

Ставим из официального apt-репозитория Docker, а не `docker.io` из репозиториев Ubuntu (тот может быть устаревшим). Команды выполняются на сервере под `deploy`.

```bash
# 1. подключить репозиторий Docker
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update

# 2. поставить Docker Engine и плагины
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Проверка:

```bash
sudo systemctl is-enabled docker      # enabled: стартует при загрузке сервера
sudo docker run --rm hello-world
docker compose version
```

Права без `sudo`:

```bash
sudo usermod -aG docker $USER
```

Группа применяется только к **новым** сессиям: выйди и зайди по SSH снова, потом проверь `docker ps`.

Доступ к Docker равен root-доступу (контейнер можно запустить с примонтированным `/`), поэтому в группу `docker` добавляем только пользователя для деплоя.

Актуальные команды всегда сверяй с официальной инструкцией (раздел Ubuntu, способ «Install using the apt repository» на docs.docker.com): репозиторий и формат записи со временем меняются.

## 11. Обрывы SSH: keepalive и `tmux`

Если сессию иногда выбрасывает (`Connection reset by peer`, `Broken pipe`), чаще всего виновата сеть, а не настройки сервера: роутер, Wi-Fi, VPN или NAT в WSL2 забывают «молчащее» соединение через несколько минут. Hardening (`sshd`, UFW) действует на вход и новые соединения и уже открытую сессию не рвёт.

**Сначала посмотреть на сервере, не он ли виноват:**

```bash
uptime                                      # не было ли перезагрузки
last -x | head                              # reboot / shutdown / входы
sudo journalctl -u ssh --since "-1 hour"    # что писал sshd в момент обрыва
sudo dmesg -T | grep -i -E 'oom|killed'     # не убивало ли процессы из-за памяти
free -h
```

**Keepalive на клиенте** (локально, `~/.ssh/config`): клиент раз в 30 секунд проверяет связь, NAT не забывает соединение, а реальный обрыв обнаруживается быстро.

```
Host *
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

**Keepalive на сервере** отдельным файлом, не трогая `01-hardening.conf`:

```bash
sudo tee /etc/ssh/sshd_config.d/02-keepalive.conf <<'EOF'
ClientAliveInterval 60
ClientAliveCountMax 3
EOF
sudo sshd -t && sudo systemctl reload ssh
```

**`tmux`**: сессия терминала живёт на сервере и переживает обрыв SSH. Нужен для долгих команд (`apt upgrade`, `docker pull`, сборка).

```bash
sudo apt install -y tmux
tmux                  # запустить сессию
# ...работаем, связь оборвалась, заходим снова...
tmux attach           # вернуться в ту же сессию
```

Базовые клавиши: `Ctrl+b`, затем `d` отсоединиться (сессия продолжает работать); `tmux ls` список сессий. Команды вида `docker compose up -d` обрыв и так не затрагивает, они работают в фоне.

## 12. Ручной деплой проекта

Цель: запустить стек из готовых образов GHCR, ничего не собирая на сервере. Все команды на сервере под `deploy`, кроме `scp` (он запускается **локально**, в WSL, потому что копирует файл с той машины, где запущен).

**1. Папка проекта (сервер)**

```bash
sudo mkdir -p /opt/guestbook
sudo chown deploy:deploy /opt/guestbook
```

**2. Compose-файл (локально, из корня репозитория)**

```bash
scp guestbook-new/docker-compose.yml vps:/opt/guestbook/
```

Алиас `vps` должен быть в `~/.ssh/config` **локальной** машины, а не сервера.

**3. `.env` на сервере**

Пароль генерируется сразу в файл и нигде не светится:

```bash
cd /opt/guestbook
cat > .env <<EOF
PORT=3000
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=$(openssl rand -hex 24)
TAG=latest
BIND_ADDR=127.0.0.1
EOF
chmod 600 .env
```

Для первого запуска `TAG=latest`, к конкретному sha переходим в разделе 13. `BIND_ADDR=127.0.0.1` оставляет порт фронтенда закрытым для интернета.

**4. Вход в GHCR (если пакеты приватные)**

Пакеты, опубликованные из Actions, по умолчанию приватные. На GitHub: Settings -> Developer settings -> Personal access tokens -> **Tokens (classic)**, единственное право `read:packages`, срок 30 дней. Токен показывается один раз. Fine-grained токены для GHCR не подходят.

```bash
read -rs GHCR_TOKEN        # вставить токен, Enter (символы не видны)
echo -n "$GHCR_TOKEN" | docker login ghcr.io -u wertyjonio --password-stdin
unset GHCR_TOKEN
```

Ожидаемый результат: `Login Succeeded`. Токен никому не отправляем; если он попал в чат или скриншот, его сразу удаляем на GitHub и выпускаем новый.

**5. Запуск**

```bash
docker compose pull
docker compose up -d --wait --no-build
docker compose ps          # все сервисы healthy / running
```

**6. Проверки**

```bash
# на сервере: API отвечает через nginx
curl -s http://127.0.0.1:8080/api/health

# с локальной машины: порт снаружи НЕ должен отвечать
curl --max-time 5 http://<IP>:8080

# посмотреть сайт в браузере через SSH-туннель
ssh -L 8080:127.0.0.1:8080 vps      # затем http://localhost:8080
```

Данные переживают перезапуск: `docker compose down` и снова `up -d --wait --no-build`, сообщение в гостевой книге остаётся. Команда `down -v` удаляет том с данными, её не используем.

## 13. Обновление и откат по тегу

CI публикует образы в GHCR с двумя тегами: `latest` (плавающий, всегда самая свежая сборка) и полный `sha` коммита (фиксированный, навсегда указывает на одну версию). Версия на сервере берётся из `TAG` в `.env`:

- **обновление** = записать в `TAG` sha новой версии;
- **откат** = вернуть в `TAG` прежний sha. Пересборка не нужна, образ уже лежит в GHCR.

Для отката `latest` не годится: вернуться назад по плавающему тегу нельзя, поэтому на сервере живём на конкретных sha. Где взять sha: GitHub -> профиль -> Packages -> `guestbook-api` -> теги. Образы `api` и `frontend` публикуются с одним sha. Для проверки нужны две разные версии (A и B); если версия одна, вноси мелкое изменение в `guestbook-new/`, мержи в `main` и дожидайся зелёного `guestbook-ci`.

```bash
cd /opt/guestbook

# зафиксировать версию (подставить полный sha) и применить
sed -i 's/^TAG=.*/TAG=ПОЛНЫЙ_SHA/' .env
docker compose pull
docker compose up -d --wait --no-build
docker compose restart frontend

docker compose images                       # в колонке TAG должен быть нужный sha
curl -s http://127.0.0.1:8080/api/health
```

Эти же команды используются и для обновления, и для отката, меняется только sha.

`restart frontend` нужен потому, что nginx запоминает адрес `api` при старте. Если контейнер `api` пересоздан, а nginx нет, он может ходить по старому адресу и отдавать 502.

**Проверка перезагрузкой:**

```bash
sudo reboot
# через минуту: ssh vps
cd /opt/guestbook
docker compose ps          # стек поднялся сам
docker compose images      # версия та, что записана в .env
```

Стек поднимается сам благодаря `restart: unless-stopped` и включённому при загрузке Docker (`systemctl is-enabled docker` выводит `enabled`).

## 14. Дополнительно

| Что | Команда | Зачем |
|-----|---------|-------|
| Автообновления безопасности | `sudo apt install unattended-upgrades` | патчи ставятся сами |
| fail2ban | `sudo apt install fail2ban`, статус: `sudo fail2ban-client status sshd` | банит перебор паролей и ключей |
| Облачный файрвол провайдера | в панели VPS: разрешить 22, 80, 443 | второй слой снаружи VM, не зависит от Docker |
| Отдельный ключ для CI | `ssh-keygen -t ed25519 -f ~/.ssh/gha-deploy` | для деплоя из GitHub Actions (приватная часть в Secrets, публичная в `authorized_keys`) |

## 15. Почасовой VPS: что повторять после пересоздания

Если сервер арендуется почасово и удаляется, после создания нового нужно заново пройти весь путь. Ничего не сохраняется, **включая данные Redis**: том `redis-data` живёт только на том сервере, который существует.

| Что повторить | Раздел | Что нужно под рукой |
|---------------|--------|---------------------|
| добавить SSH-ключ при создании сервера, зайти первый раз | 1, 2 | публичный ключ, IP нового сервера |
| убрать старую запись в `known_hosts`, обновить IP в `~/.ssh/config` | 9 | `ssh-keygen -R <IP>` |
| обновление, пользователь `deploy`, sshd, UFW | 3-7 | ключ для `deploy` |
| установка Docker, группа `docker` | 10 | повторный вход по SSH |
| keepalive, `tmux` | 11 | |
| папка, compose-файл, `.env` с новым паролем Redis | 12 | |
| вход в GHCR | 12 | токен `read:packages` (новый или сохранённый в менеджере паролей) |
| запуск на нужном sha | 13 | полный sha из GHCR |

Ручное повторение этого списка занимает много времени и легко ошибиться. Поэтому следующий шаг: описать его в плейбуке Ansible, который повторяет разделы 3-13 на чистом сервере одной командой. Секреты (токен GHCR, пароль Redis) при этом не кладутся в репозиторий открытым текстом: для них используется `ansible-vault` или переменные окружения.

## Итоговая проверка

- [ ] вход по ключу под `deploy` работает без пароля
- [ ] `sudo whoami` выводит `root`
- [ ] `ssh root@<IP>` отклоняется
- [ ] вход с паролем отклоняется: `ssh -o PubkeyAuthentication=no deploy@<IP>`
- [ ] `sudo sshd -T` показывает `permitrootlogin no` и `passwordauthentication no`
- [ ] `sudo ufw status verbose` показывает политику `deny (incoming)` и правила 22, 80, 443
- [ ] `sudo ss -tlnp`: на `0.0.0.0` слушают только ожидаемые сервисы
- [ ] `docker compose version` работает, `docker ps` работает без `sudo` (после повторного входа)
- [ ] `systemctl is-enabled docker` выводит `enabled`
- [ ] `docker compose ps`: все сервисы `healthy` / `running`, `curl http://127.0.0.1:8080/api/health` отвечает
- [ ] порт `8080` снаружи не отвечает (`curl --max-time 5 http://<IP>:8080`)
- [ ] обновление и откат по sha работают, после `reboot` стек поднимается с версией из `.env`

## Каталог ошибок

| Симптом | Причина | Что делать |
|---------|---------|------------|
| `ssh ubuntu@IP` просит пароль, а `ssh root@IP` пускает без него | ключ добавлен только пользователю `root`; запрашивается пароль пользователя `ubuntu`, а не root | войти как тот пользователь, для которого есть ключ, или скопировать ключ командой `ssh-copy-id` |
| `sudo: ufw: command not found` | минимизированный образ без `ufw` | `sudo apt install -y ufw` |
| `install: missing destination file operand` | вместо `apt install` набрано `install` (это команда копирования файлов) | `apt install <пакет>` |
| после `mkdir` появились папки `cp`, `chown`, `chmod` | команды вставлены одной строкой без переводов строк | каждая команда с новой строки, лишние папки удалить |
| после `enable` SSH оборвался | не было правила `allow OpenSSH` до включения | веб-консоль провайдера, `ufw allow OpenSSH` |
| по ключу не пускает (`Permission denied (publickey)`) | неверные права или владелец у `~/.ssh` и `authorized_keys` | `chmod 700 ~/.ssh`, `chmod 600 authorized_keys`, `chown -R user:user ~/.ssh` |
| пароль всё ещё принимается после настройки | другой файл в `sshd_config.d/` побеждает наш | назвать свой файл `01-...`, проверить `sshd -T` |
| порт контейнера доступен снаружи при закрытом UFW | Docker обходит UFW | убрать `ports:` или привязать к `127.0.0.1` |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | сервер пересоздан, отпечаток сменился | убедиться, что это ожидаемо, `ssh-keygen -R <IP>` |
| `permission denied while trying to connect to the Docker daemon socket` | пользователь не в группе `docker` или сессия открыта до добавления в группу | `sudo usermod -aG docker $USER`, выйти и зайти по SSH заново |
| `Connection reset by peer`, `Broken pipe` | NAT или сеть забыли простаивающее соединение | keepalive на клиенте и сервере, долгие команды в `tmux` |
| `Permission denied (publickey)` при входе как `docker` | `docker` это группа, а не пользователь; `AllowUsers` пускает только `deploy` | `ssh deploy@<IP>` или `ssh vps` |
| `scp: stat local ...: No such file or directory` | `scp` запущен на сервере, а файл лежит на локальной машине | запускать `scp` в локальном терминале (приглашение `wert@DESKTOP`) |
| `Could not resolve hostname vps` | алиас `Host vps` прописан в `~/.ssh/config` сервера, а не локальной машины | добавить блок `Host vps` в локальный `~/.ssh/config`, `chmod 600` |
| `denied` при `docker login ghcr.io` | токен не classic, нет права `read:packages`, истёк или вставлен неполностью | выпустить classic-токен с `read:packages`, вводить через `read -rs` и `--password-stdin` |
| после смены `TAG` сайт отдаёт 502 | nginx держит старый адрес контейнера `api` | `docker compose restart frontend` |

## Что дальше

- пройти обновление и откат по sha и проверку перезагрузкой (раздел 13);
- reverse proxy с HTTPS и доменом (Caddy);
- деплой из GitHub Actions по отдельному SSH-ключу, откат по тегу коммита;
- плейбук Ansible: разделы 3-13 на чистом сервере одной командой (раздел 15 это список того, что он должен повторять).