# Dockerfiles

## 1
HEALHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8080/heath')"]
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