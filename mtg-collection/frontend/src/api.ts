import axios from "axios";

// Always use backend at port 8001 for local development
const baseURL = "http://localhost:8001";

const api = axios.create({
  baseURL,
});

export default api;
