import axios from "axios";

// In dev mode Vite's proxy (vite.config.ts) forwards /collection, /deck, /health
// to localhost:8000, so we use a relative base URL and let the proxy handle it.
// In production (packaged Electron app) there is no Vite proxy, so we hit the
// backend directly on port 8000.
const baseURL = import.meta.env.DEV ? "" : "http://127.0.0.1:8000";

const api = axios.create({
  baseURL,
});

export default api;
