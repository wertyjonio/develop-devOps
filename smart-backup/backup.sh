#!/bin/bash
SOURCE_DIR="/data/src"
BACKUP_DIR="/data/backups"
TIMESTAMP=$(date + "%Y-%m-%d-%H-%M-%S")
ARCHIVE_NAME="backup_$TIMESTAMP.tar.gz"
if [ ! -d $SOURCE_DIR ]; then
	echo "ERROR, папки с данными нет"
	exit 1
fi

mkdir -p $BACKUP_DIR

tar -czf "$BACKUP_DIR/$ARCHIVE_NAME" -C  "$SOURCE_DIR" .

if [ $? -eq 0 ]; then
	echo "SUCCES, бэкап успешно создан: $ARCHIVE_NAME"
	exit 0
else
	echo "ERROR, произошла ошибка"
	exit 1

fi
