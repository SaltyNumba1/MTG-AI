import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: "0.0.0.0",
    proxy: {
      "/collection": "http://127.0.0.1:8000",
      "/deck": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
    },
  },
});
