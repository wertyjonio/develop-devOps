FROM goland:1.27.4-alpine3.24 AS build
WORKDIR /app
COPY go.mod .
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o server main.go

FROM scratch
COPY --from=build /app/server /server
USER 10001
EXPOSE 8080
CMD ["/server"]
