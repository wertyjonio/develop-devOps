FROM node:18-alpine AS frontend-builder
WORKDIR /build
COPY flask-app/package.json flask-app/package-lock.json* ./
RUN npm install
COPY flask-app/ .
RUN npm run build

FROM python:3.10-slim
LABEL maintainer="Ivan Utkin <wertyjonio@gmail.com>"
WORKDIR /usr/src/app
COPY flask-app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=frontend-builder /build/static ./static
COPY --from=frontend-builder /build/templates ./templates
COPY flask-app/app.py .
COPY utils/trucks.geojson .
EXPOSE 5000
CMD ["python", "app.py"]
