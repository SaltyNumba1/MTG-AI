import { useEffect, useState } from "react";
import api from "../api";
import "./ModelStatus.css";

type LlamaStatus = "online" | "offline" | "loading";
type GpuMode = "gpu" | "cpu" | "unknown";

export default function ModelStatus() {
  const [status, setStatus] = useState<LlamaStatus>("loading");
  const [gpuMode, setGpuMode] = useState<GpuMode>("unknown");

  // Read the mode injected by electron-main on startup and poll the health endpoint.
  useEffect(() => {
    const stored = localStorage.getItem("mtg.llamaMode") as GpuMode | null;
    if (stored) setGpuMode(stored);

    const storedReady = localStorage.getItem("mtg.llamaReady");
    if (storedReady === "0") setStatus("offline");
    else if (storedReady === "1") setStatus("online");

    const poll = async () => {
      try {
        const { data } = await api.get<{ status: string }>("/health/llama");
        setStatus(data.status === "online" ? "online" : "offline");
      } catch {
        setStatus("offline");
      }
    };

    poll();
    const t = window.setInterval(poll, 5000);
    return () => window.clearInterval(t);
  }, []);

  // Listen for the event fired by electron-main.js immediately after page load.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ ready: boolean; mode: string }>).detail;
      setStatus(detail.ready ? "online" : "offline");
      if (detail.mode) setGpuMode(detail.mode as GpuMode);
    };
    window.addEventListener("mtg-llama-status", handler);
    return () => window.removeEventListener("mtg-llama-status", handler);
  }, []);

  let dotClass = "model-status-dot";
  let label = "DeepBrew";
  let tooltip = "";

  if (status === "loading") {
    dotClass += " model-status-dot--loading";
    label = "DeepBrew …";
    tooltip = "Checking model status\u2026";
  } else if (status === "offline") {
    dotClass += " model-status-dot--offline";
    label = "DeepBrew Offline";
    tooltip =
      "Model not loaded. Check that your .gguf file is in " +
      "%APPDATA%\\mtg-collection-frontend\\models\\ and restart the app.";
  } else if (gpuMode === "cpu") {
    dotClass += " model-status-dot--cpu";
    label = "DeepBrew (CPU)";
    tooltip =
      "Running on CPU \u2014 expect ~5 min generation time. " +
      "A Vulkan-capable GPU will speed this up significantly.";
  } else {
    dotClass += " model-status-dot--online";
    label = gpuMode === "gpu" ? "DeepBrew (GPU)" : "DeepBrew Ready";
    tooltip =
      gpuMode === "gpu"
        ? "Model loaded and running on GPU."
        : "Model loaded and ready.";
  }

  return (
    <span className="model-status" title={tooltip}>
      <span className={dotClass} />
      <span className="model-status-label">{label}</span>
    </span>
  );
}
