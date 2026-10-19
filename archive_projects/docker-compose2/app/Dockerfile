FROM python:3.14-slim
WORKDIR /usr/src/app
LABEL maintainer="Ivan Utkin <wertyjonio@gmail.com>"
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["python", "app.py"]
