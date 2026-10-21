# Безопасность сервера (hardening)

[← К оглавлению](README.md)

Чек-лист для нового сервера.

## 1. Обычный пользователь вместо root

```
sudo adduser devops_jun
sudo usermod -aG sudo devops_jun
```

## 2. Вход по SSH-ключам

```
ssh-keygen -t ed25519 -C "key_label"                      # на своём ПК
ssh-copy-id -i ~/.ssh/id_ed25519.pub devops_jun@<IP>      # положить публичный ключ на сервер
```

Ключ попадает в `~/.ssh/authorized_keys` пользователя на сервере.

## 3. Закрыть SSH-демон (`sudo vim /etc/ssh/sshd_config`)

- `PasswordAuthentication no` — вход только по ключам (защита от брутфорса).
- `PermitRootLogin no` — запрет прямого входа под root.

Применить: `sudo systemctl restart ssh` (на Ubuntu/Debian служба называется `ssh`, на RHEL-семействе `sshd`).

> **Перед перезапуском и закрытием сессии** открой вторую сессию и убедись, что вход по ключу работает. Иначе можно запереть себя на сервере.

> **Ловушка на VPS (облачные образы Ubuntu):** в `/etc/ssh/sshd_config.d/` могут лежать дополнительные файлы (например, `50-cloud-init.conf` с `PasswordAuthentication yes`), которые перекрывают правку в основном `sshd_config`. Итоговые значения проверяй командой: `sudo sshd -T | grep -iE 'passwordauthentication|permitrootlogin'`.

## 4. Файрвол UFW

```
sudo apt update && sudo apt install -y ufw
sudo ufw allow 22/tcp          # ОБЯЗАТЕЛЬНО до включения, иначе потеряешь доступ
sudo ufw enable                # остальные входящие порты закрыты
sudo ufw status verbose        # аудит правил
```

> **Docker обходит UFW:** порты, опубликованные через `-p` / `ports:`, Docker открывает правилами iptables напрямую. На сервере публикуй порты на loopback (`"127.0.0.1:8081:8080"`) и выставляй наружу через reverse proxy.

## 5. Дополнительно

Обновления безопасности (`unattended-upgrades`), `fail2ban`, логи в `/var/log/auth.log`, отсутствие `.` в `$PATH`, аудит прав (`find ... -perm 777`).

См. также: [hardening контейнеров](07-docker.md#8-hardening-контейнеров-в-compose), [безопасность в CI](08-cicd.md#6-безопасность-в-ci).
