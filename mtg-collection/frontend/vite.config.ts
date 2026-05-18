import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  define: {
    // Injected at build time by desktop:package:starter / desktop:package:pro.
    // Baked into the JS bundle — cannot be changed by editing files on disk.
    __DEEPBREW_TIER__: JSON.stringify(process.env.DEEPBREW_TIER ?? "starter"),
  },
  server: {
    host: "0.0.0.0",
    proxy: {
      "/collection": "http://127.0.0.1:8000",
      "/deck": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
    },
  },
});
