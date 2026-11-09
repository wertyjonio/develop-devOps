FROM python:3.15-alpine3.24
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=appuser:appgroup . .
USER appuser
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8080/heath')"]
CMD ["python", "app.py"]

