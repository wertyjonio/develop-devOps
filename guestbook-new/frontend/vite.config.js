import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    // В режиме разработки Vite сам проксирует /api на Nginx из docker compose
    // (там уже настроен переход на сервис api).
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
