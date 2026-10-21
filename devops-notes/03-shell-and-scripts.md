# Оболочка и Bash-скрипты

[← К оглавлению](README.md)

# Часть 1. Переменные окружения и конфиги оболочки

- `env` — все переменные текущей сессии.
- `export VAR="value"` — сделать переменную глобальной. Вокруг `=` **нет пробелов**. `$` нужен только при чтении (`echo $VAR`). Имена чувствительны к регистру.
- `$PATH` — папки (через `:`), где ищутся исполняемые файлы.
  - Добавить путь, **сохранив старый**: `export PATH="$PATH:/home/user/my_folder"`.
  - Точка `.` в `$PATH` позволяет запускать скрипты из текущей папки по имени, но на реальных серверах это опасно: злоумышленник может подложить вредоносный файл в рабочую папку.
- `~/.bashrc` — выполняется при каждом открытии терминала (алиасы, постоянный `PATH`).
- `~/.bash_profile` / `~/.profile` — выполняются один раз при логине.

---

# Часть 2. Bash-скрипты

Скрипт — текстовый файл `.sh`. Запуск: `bash script.sh` или `chmod +x script.sh && ./script.sh`.

## Коды возврата

- `$?` — код последней команды: `0` успех, `1–255` ошибка. CI/CD по ненулевому коду останавливает деплой.
- `exit 1` — прервать скрипт с ошибкой.

## Операторы в `[ ]` (пробелы внутри скобок обязательны)

- Числа: `-eq` равно, `-ne` не равно, `-gt` больше, `-lt` меньше, `-ge` больше или равно, `-le` меньше или равно.
- Строки и файлы: `-z "$VAR"` пустая строка, `-n "$VAR"` непустая, `-f файл` файл существует, `-d папка` папка существует.
- Переменные в `[ ]` лучше брать в кавычки.

## Шаблон скрипта

```bash
#!/bin/bash
# Шебанг указывает интерпретатор

# 1. Проверка обязательной переменной окружения
if [ -z "$DB_PASSWORD" ]; then
    echo "[ERROR] DB_PASSWORD не задан!" >&2
    exit 1
fi

# 2. Цикл по строкам файла servers.txt (while read надёжнее, чем for ... $(cat ...))
while read -r ip; do
    echo "--- Проверяю $ip ---"
    # if проверяет код возврата команды напрямую, без отдельного $?
    if ping -c 1 -W 1 "$ip" > /dev/null 2>&1; then
        echo "[OK] Сервер доступен, отправляю конфиг..."
        scp nginx.conf "wert@$ip:/tmp/"
    else
        echo "[WARNING] $ip недоступен или закрыт файрволом!"
    fi
done < servers.txt
# Если внутри такого цикла используется ssh, добавляй ssh -n,
# иначе он съест остаток servers.txt со stdin.
```

## Пример: мониторинг ресурсов (monitor.sh)

Нужны `bc`; для отправки алертов почтой ещё и `mail`.

```bash
#!/bin/bash
LOG_FILE="/var/log/monitor.log"    # запись в /var/log требует root
THRESHOLD_CPU=80
THRESHOLD_MEMORY=80
THRESHOLD_DISK=90

log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
}

check_cpu() {
    local cpu
    cpu=$(top -bn1 | awk '/Cpu\(s\)/ {print $2 + $4}')    # user + system
    if (( $(echo "$cpu > $THRESHOLD_CPU" | bc -l) )); then
        log_message "WARNING: High CPU usage: ${cpu}%"
        # echo "High CPU: ${cpu}%" | mail -s "CPU Alert" admin@example.com
    fi
}

check_memory() {
    local mem
    mem=$(free | awk '/Mem/ {printf "%.1f", $3/$2*100}')
    if (( $(echo "$mem > $THRESHOLD_MEMORY" | bc -l) )); then
        log_message "WARNING: High memory usage: ${mem}%"
    fi
}

check_disk() {
    df -hP | grep -vE '^Filesystem|tmpfs|cdrom' | awk '{print $5, $1}' | while read -r usage partition; do
        usage=${usage%\%}
        if [ "$usage" -ge "$THRESHOLD_DISK" ]; then
            log_message "WARNING: High disk usage on $partition: ${usage}%"
        fi
    done
}

log_message "Starting system monitoring"
check_cpu
check_memory
check_disk
log_message "Monitoring completed"
```

Запуск по расписанию: см. cron и systemd timer в [04-users-processes-services.md](04-users-processes-services.md#планировщик).
