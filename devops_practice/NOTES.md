# Dockerfiles

## 1
HEALHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8080/heath')"]
(нужен для того, чтобы при docker ps видеть статус контейнера)

Документация: hub.docker.com - ищем образы, примеры их сборок и тд

## 2 (multi-stage)
COPY --from=build /app/dist /usr/share/nginx/html - используем файлы, которые создались после работы билдера