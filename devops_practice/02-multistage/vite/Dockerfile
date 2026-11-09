FROM node:24 AS build
WORKDIR /app
COPY package*.json ./
RUN npm cli
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:alpine
USER root
# hadolint ignore=DL3018
RUN apk upgrade --no-cache
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080