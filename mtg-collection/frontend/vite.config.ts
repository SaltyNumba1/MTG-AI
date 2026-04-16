import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: "0.0.0.0",
    proxy: {
      "/collection": "http://localhost:8000",
      "/deck": "http://localhost:8000",
      "/health": "http://localhost:8000",
    },
  },
});
