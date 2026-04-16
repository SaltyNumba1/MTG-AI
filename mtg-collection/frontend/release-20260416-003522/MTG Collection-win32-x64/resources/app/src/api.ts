import axios from "axios";

const baseURL = window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "/";

const api = axios.create({
  baseURL,
});

export default api;
