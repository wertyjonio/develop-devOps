FROM alpine:latest
WORKDIR /app
RUN apk add --no-cache bash
COPY backup.sh . 
RUN chmod +x backup.sh
CMD ["bash", "./backup.sh"]
