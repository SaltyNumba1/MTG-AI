/**
 * preload.js — runs in a privileged context with contextIsolation=true.
 * Exposes a minimal, typed API surface to the renderer via contextBridge.
 * No raw Node/Electron APIs are exposed.
 */
const { contextBridge, ipcRenderer } = require("electron");

const _tierArg = process.argv.find(a => a.startsWith("--deepbrew-tier="));
const _tier = _tierArg ? _tierArg.split("=")[1] : "starter";

contextBridge.exposeInMainWorld("deepbrew", {
  /** Returns the stable machine ID (UUID stored in userData). */
  getMachineId: () => ipcRenderer.invoke("deepbrew:get-machine-id"),

  /** Returns stored license info or null. */
  getLicenseStatus: () => ipcRenderer.invoke("deepbrew:get-license-status"),

  /**
   * Activate a license key against the DeepBrew API.
   * Returns { ok, tier } on success or throws with an error message.
   */
  activateLicense: (licenseKey) =>
    ipcRenderer.invoke("deepbrew:activate-license", licenseKey),

  /**
   * Download a model file from the DeepBrew API into the models folder.
   * Progress events are delivered via the onDownloadProgress callback.
   * Returns { ok, path } on success or throws.
   */
  downloadModel: (model) =>
    ipcRenderer.invoke("deepbrew:download-model", model),

  /** Register a callback for download progress { received, total, percent }. */
  onDownloadProgress: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on("deepbrew:download-progress", handler);
    return () => ipcRenderer.removeListener("deepbrew:download-progress", handler);
  },

  /**
   * Write a new MODEL_FILE= line into model-select.env and restart llama-server.
   */
  setActiveModel: (filename) =>
    ipcRenderer.invoke("deepbrew:set-active-model", filename),

  /** The build tier baked into this package ('starter' | 'pro'). */
  tier: _tier,
});
