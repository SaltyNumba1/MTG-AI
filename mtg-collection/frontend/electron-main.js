const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, dialog } = require("electron");
const { spawn, spawnSync } = require("child_process");

const isDev = process.env.NODE_ENV === "development";
const frontendDir = path.join(__dirname);
const backendDir = path.join(__dirname, "..", "backend");
const packagedBackendDir = path.join(process.resourcesPath || __dirname, "backend");
let backendProcess = null;
let llamaProcess = null;
let llamaServerStarted = false;
let splashWin = null;
let isQuitting = false;
let mainWindow = null;

const LLAMA_PORT = 8081;
const LLAMA_CTX = 20480;
// Adaptive GPU layer steps: try most layers first, step down on VRAM OOM, reach 0 for CPU fallback.
const LLAMA_GPU_LAYER_STEPS = [99, 60, 40, 20, 0];
let llamaStartPromise = null; // resolves when adaptive startup finishes
const ICON_PATH = path.join(__dirname, "build", "icon.ico");
const LOGO_PATH = path.join(__dirname, "build", "icon.png");

function getLlamaServerDir() {
  // Packaged: resources/llama-server/  Dev: frontend/llama-server/
  const packaged = path.join(process.resourcesPath || __dirname, "llama-server");
  const dev = path.join(__dirname, "llama-server");
  if (fs.existsSync(packaged)) return packaged;
  return dev;
}

const MODEL_SELECT_TEMPLATE = [
  "# DeepBrew — Model Selection",
  "# Uncomment ONE line below to select which model to load.",
  "# Download models from:",
  "#   7B  (recommended): https://huggingface.co/SaltyNumba1/MTG-Commander-Mistral-7B-Trained",
  "#   12B:               https://huggingface.co/SaltyNumba1/Mistral-nemo-12B-MTG-Commander",
  "#",
  "# Place the downloaded .gguf file(s) in the same folder as this config file.",
  "#",
  "MODEL_FILE=mistral-commander-q4.gguf",
  "# MODEL_FILE=mtg-commander-nemo-q3_k_m.gguf",
  "# MODEL_FILE=mtg-commander-nemo-q4_k_m.gguf",
].join("\r\n") + "\r\n";

function getModelPath() {
  const userDataDir = app.getPath("userData");
  const modelsDir = path.join(userDataDir, "models");
  const configPath = path.join(modelsDir, "model-select.env");

  // Auto-create the config on first launch so the user has a ready-to-edit file.
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.writeFileSync(configPath, MODEL_SELECT_TEMPLATE, "utf8");
    logStartup(`Created model config: ${configPath}`);
  }

  // Parse: first non-comment MODEL_FILE= line wins; fall back to model.gguf.
  let modelFile = "model.gguf";
  try {
    const lines = fs.readFileSync(configPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || trimmed === "") continue;
      const match = trimmed.match(/^MODEL_FILE\s*=\s*(.+)$/);
      if (match) {
        modelFile = match[1].trim();
        break;
      }
    }
  } catch {
    // fall through to fallback
  }

  logStartup(`Model file selected: ${modelFile}`);
  return path.join(modelsDir, modelFile);
}

function ensureModelCopied() {
  const dest = getModelPath();
  if (fs.existsSync(dest)) return true;

  // Possible source locations for the GGUF (dev + packaged)
  const candidates = [
    path.join(__dirname, "..", "..", "training", "TRAIN_Mistral", "mistral-commander-q4.gguf"),
    path.join(__dirname, "..", "..", "training", "TRAIN_NEMO", "mtg-commander-nemo-q4_k_m.gguf"),
    path.join(__dirname, "..", "..", "training", "TRAIN_NEMO", "mtg-commander-nemo-q3_k_m.gguf"),
    path.join(process.resourcesPath || __dirname, "models", "model.gguf"),
  ];

  for (const src of candidates) {
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      logStartup(`Copied model from ${src} to ${dest}`);
      return true;
    }
  }
  logStartup("WARNING: GGUF model not found in any candidate location");
  return false;
}

// Returns true if the tail of the llama log contains VRAM OOM / abort markers.
function checkLogForOOM(logPath) {
  try {
    if (!fs.existsSync(logPath)) return false;
    const stat = fs.statSync(logPath);
    const readSize = Math.min(stat.size, 32768);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(logPath, "r");
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    const tail = buf.toString("utf8");
    return /ErrorOutOfDeviceMemory|failed to allocate.*buffer|unable to allocate.*buffer|n_gpu_layers already set by user.*abort/i.test(tail);
  } catch {
    return false;
  }
}

// Adaptive startup: tries GPU layer counts in descending order.
// Falls back to CPU (0 layers) if every GPU attempt OOMs.
// Runs async so the backend can start in parallel; stores the result in
// llamaProcess / llamaServerStarted when a layer count succeeds.
async function startLlamaServer() {
  const serverDir = getLlamaServerDir();
  const exe = path.join(serverDir, "llama-server.exe");
  if (!fs.existsSync(exe)) {
    logStartup(`llama-server.exe not found at ${exe}, skipping GPU inference`);
    return;
  }

  const modelPath = getModelPath();
  if (!ensureModelCopied()) {
    logStartup("Model not available, skipping llama-server");
    return;
  }

  // Build a clean child environment: delete Chromium's Vulkan overrides so
  // the AMD GPU driver is discovered normally by the Vulkan loader.
  const env = { ...process.env };
  delete env.VK_ICD_FILENAMES;
  delete env.VK_LAYER_PATH;

  const userDataDir = app.getPath("userData");
  const llamaLogPath = path.join(userDataDir, "llama-server.log");

  for (const gpuLayers of LLAMA_GPU_LAYER_STEPS) {
    const label = gpuLayers === 0 ? "CPU only" : `${gpuLayers} GPU layers`;
    logStartup(`Attempting llama-server with ${label}...`);
    updateSplash(`Starting AI model (${label})\u2026`, 12);

    // Each attempt gets its own fresh log so OOM detection reads only this run.
    try { fs.writeFileSync(llamaLogPath, `--- attempt: ${label} ---\n`, "utf8"); } catch {}
    const logFd = fs.openSync(llamaLogPath, "a");

    const proc = spawn(exe, [
      "--model", modelPath,
      "--port", String(LLAMA_PORT),
      "--ctx-size", String(LLAMA_CTX),
      "--n-gpu-layers", String(gpuLayers),
      "--batch-size", "2048",
      "--ubatch-size", "512",
      "--host", "127.0.0.1",
    ], {
      cwd: serverDir,
      env,
      stdio: ["ignore", logFd, logFd],
    });
    fs.closeSync(logFd);
    logStartup(`llama-server spawned (pid ${proc.pid}) with ${label}, log: ${llamaLogPath}`);

    // Watch for a fast crash (OOM exits within ~12 s).
    // If still running after 12 s the model is loading — hand off to health polling.
    const exitedEarly = await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; resolve(false); }
      }, 12000);
      proc.once("exit", () => {
        clearTimeout(timer);
        if (!settled) { settled = true; resolve(true); }
      });
    });

    if (!exitedEarly) {
      // Process is still alive — it's loading normally.
      llamaProcess = proc;
      llamaServerStarted = true;
      logStartup(`llama-server still running after 12 s with ${label} — proceeding to health wait`);
      return;
    }

    // Process exited fast — check whether it was a VRAM OOM.
    const isOOM = checkLogForOOM(llamaLogPath);
    logStartup(`llama-server exited quickly with ${label}. OOM: ${isOOM}`);

    if (!isOOM) {
      logStartup("Non-OOM failure — stopping llama-server retries.");
      return;
    }

    if (gpuLayers === 0) {
      logStartup("CPU fallback also failed — giving up on llama-server.");
      return;
    }
    // OOM on GPU attempt — loop continues with fewer layers.
  }
}

async function checkBackendHealth(url = "http://127.0.0.1:8000/health", requestTimeoutMs = 1200) {
  const http = require("http");
  try {
    await new Promise((resolve, reject) => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve(true);
        } else {
          reject(new Error(`status ${res.statusCode}`));
        }
      });
      req.on("error", reject);
      req.setTimeout(requestTimeoutMs, () => {
        req.destroy(new Error("timeout"));
      });
    });
    return true;
  } catch {
    return false;
  }
}

function getWindowStatePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function loadWindowState() {
  try {
    const p = getWindowStatePath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function saveWindowState(win) {
  try {
    const bounds = win.getBounds();
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(bounds));
  } catch {
    // ignore persistence failures
  }
}

function resolvePythonExecutable() {
  const winPython = path.join(backendDir, ".venv", "Scripts", "python.exe");
  const posixPython = path.join(backendDir, ".venv", "bin", "python");
  if (fs.existsSync(winPython)) return winPython;
  if (fs.existsSync(posixPython)) return posixPython;
  return null;
}

function isPythonAvailable(executable) {
  if (!executable) return false;
  try {
    const result = spawnSync(executable, ["--version"], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

function logStartup(message) {
  try {
    if (!app || !app.getPath) return;
    const logDir = app.getPath("userData");
    const logFile = path.join(logDir, "desktop-startup.log");
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // ignore logging failures
  }
}

function getBundledBackendExecutable() {
  const candidates = [
    path.join(packagedBackendDir, "dist", "mtg-collection.exe"),
    path.join(process.resourcesPath || __dirname, "backend", "dist", "mtg-collection.exe"),
    path.join(process.resourcesPath || __dirname, "app", "backend", "dist", "mtg-collection.exe"),
    path.join(__dirname, "..", "backend", "dist", "mtg-collection.exe"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      logStartup(`Found backend executable at: ${candidate}`);
      return candidate;
    }
    logStartup(`Backend candidate not found: ${candidate}`);
  }

  return null;
}

function getBackendCommand() {
  const bundledExe = getBundledBackendExecutable();
  if (bundledExe) {
    return { command: bundledExe, args: [], cwd: path.dirname(bundledExe) };
  }

  const pythonExe = resolvePythonExecutable();
  if (pythonExe && isPythonAvailable(pythonExe)) {
    return {
      command: pythonExe,
      args: ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"],
      cwd: backendDir,
    };
  }

  return null;
}

function startBackend() {
  const backend = getBackendCommand();
  if (!backend) {
    dialog.showErrorBox(
      "DeepBrew",
      "Unable to start the backend. Please install Python or build the backend executable before running the desktop app."
    );
    app.quit();
    return;
  }

  logStartup(`Starting backend: ${backend.command} ${backend.args.join(" ")} in ${backend.cwd}`);

  // Derive stable, writable, per-user paths for the DB and saved decks.
  // app.getPath("userData") survives app reinstalls and is always writable.
  const userDataDir = app.getPath("userData");
  const backendEnv = Object.assign({}, process.env, {
    DATABASE_URL: `sqlite+aiosqlite:///${path.join(userDataDir, "mtg_collection.db").replace(/\\/g, "/")}`,
    SAVED_DECKS_DIR: path.join(userDataDir, "saved_decks"),
    OLLAMA_MAX_GENERATION_SEC: "900",   // 15 min wall-clock cap for LLM generation
    OLLAMA_TIMEOUT: "960",              // 16 min HTTP timeout (must be >= above)
    LLAMA_SERVER_URL: `http://127.0.0.1:${LLAMA_PORT}/v1`,
  });
  logStartup(`DATABASE_URL → ${backendEnv.DATABASE_URL}`);
  logStartup(`SAVED_DECKS_DIR → ${backendEnv.SAVED_DECKS_DIR}`);

  backendProcess = spawn(backend.command, backend.args, {
    cwd: backend.cwd,
    shell: false,
    env: backendEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  backendProcess.stdout.on("data", (data) => {
    logStartup(`[backend stdout] ${data.toString().trim()}`);
  });

  backendProcess.stderr.on("data", (data) => {
    logStartup(`[backend stderr] ${data.toString().trim()}`);
  });

  backendProcess.on("exit", (code) => {
    logStartup(`Backend exited with code ${code}`);
    backendProcess = null;
    if (!isQuitting) {
      checkBackendHealth().then((alive) => {
        if (alive) {
          logStartup("Backend process exited but health endpoint is still reachable; keeping app open.");
          return;
        }
        app.quit();
      });
    }
  });

  backendProcess.on("error", (error) => {
    logStartup(`Backend failed to start: ${error.message}`);
    dialog.showErrorBox("DeepBrew", `Backend failed to start: ${error.message}`);
    app.quit();
  });
}

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    width: state.width || 1200,
    height: state.height || 860,
    x: state.x,
    y: state.y,
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  mainWindow = win;

  let saveTimer = null;
  const queueSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(win), 150);
  };
  win.on("resize", queueSave);
  win.on("move", queueSave);
  win.on("close", () => saveWindowState(win));

  win.webContents.on("did-fail-load", (_e, code, desc) => {
    logStartup(`Window failed to load: ${code} ${desc}`);
  });

  win.webContents.on("render-process-gone", (_e, details) => {
    logStartup(`Renderer crashed: ${JSON.stringify(details)}`);
  });

  if (isDev) {
    win.loadURL(process.env.ELECTRON_START_URL || "http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexPath = path.join(frontendDir, "dist", "index.html");
    logStartup(`Loading frontend from: ${indexPath} (exists: ${fs.existsSync(indexPath)})`);
    win.loadFile(indexPath);
  }
}

async function waitForBackend(url, timeoutMs = 15000) {
  const http = require("http");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode); });
        req.on("error", reject);
        req.setTimeout(1000, () => { req.destroy(); reject(new Error("timeout")); });
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

// Waits for llama-server /health, updating the splash bar while polling.
// Skips immediately if llama-server was never started (missing model).
async function waitForLlamaWithProgress() {
  // Wait for the adaptive startup loop to finish before polling health.
  // This lets the backend start in parallel while retries are still running.
  if (llamaStartPromise) await llamaStartPromise;

  if (!llamaServerStarted) {
    logStartup("llama-server was not started; skipping health wait");
    return false;
  }
  const http = require("http");
  const timeoutMs = 120000; // 2 min — large models (12B) can take ~90s to load
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${LLAMA_PORT}/health`, (res) => {
          res.resume(); resolve(res.statusCode);
        });
        req.on("error", reject);
        req.setTimeout(1000, () => { req.destroy(); reject(new Error("timeout")); });
      });
      return true;
    } catch {
      const elapsed = Date.now() - start;
      const pct = Math.min(95, 50 + Math.floor((elapsed / timeoutMs) * 45));
      const secsElapsed = Math.floor(elapsed / 1000);
      updateSplash(`Loading AI model\u2026 (${secsElapsed}s)`, pct);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  logStartup("llama-server did not respond within 120 s timeout");
  return false;
}

// Detects whether llama-server loaded the model on GPU or CPU by scanning its log.
function detectGpuMode() {
  try {
    const userDataDir = app.getPath("userData");
    const llamaLogPath = path.join(userDataDir, "llama-server.log");
    if (!fs.existsSync(llamaLogPath)) return "unknown";
    // Read only the tail (64 KB) to handle large log files.
    const stat = fs.statSync(llamaLogPath);
    const readSize = Math.min(stat.size, 65536);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(llamaLogPath, "r");
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    const tail = buf.toString("utf8");
    // Zero-offload = CPU; any positive offload = GPU.
    if (/offloaded\s+0\//i.test(tail)) return "cpu";
    if (/offloaded\s+[1-9]\d*\//i.test(tail)) return "gpu";
    if (/ggml_vulkan[^:]*Found\s+[1-9]/i.test(tail)) return "gpu";
    if (/no Vulkan devices found/i.test(tail)) return "cpu";
    return "unknown";
  } catch {
    return "unknown";
  }
}

// Creates a small frameless splash window using an inline data: URL — no external file needed.
async function createSplash() {
  splashWin = new BrowserWindow({
    width: 440,
    height: 240,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreen: false,
    fullscreenable: false,
    center: true,
    alwaysOnTop: true,
    show: false,
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  const logoDataUri = fs.existsSync(LOGO_PATH)
    ? `data:image/png;base64,${fs.readFileSync(LOGO_PATH).toString("base64")}`
    : "";
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#1a1a2e;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;user-select:none}
    .logo{width:72px;height:72px;object-fit:contain;margin-bottom:10px}
    h1{font-size:1.05rem;color:#c0a0ff;font-weight:600;margin-bottom:22px;letter-spacing:.04em}
    #status{font-size:.8rem;color:#aaa;margin-bottom:12px;min-height:1.1em;text-align:center;padding:0 16px}
    .bar-bg{width:320px;height:4px;background:#2a2a4a;border-radius:4px;overflow:hidden}
    .bar-fill{height:100%;background:linear-gradient(90deg,#7c3aed,#a78bfa);border-radius:4px;transition:width .4s ease;width:5%}
    .version{position:absolute;bottom:12px;font-size:.68rem;color:#444}
  </style></head><body>
    ${logoDataUri ? `<img class="logo" src="${logoDataUri}" alt="">` : ""}
    <h1>DeepBrew</h1>
    <div id="status">Starting&hellip;</div>
    <div class="bar-bg"><div class="bar-fill" id="bar"></div></div>
    <div class="version">v${app.getVersion()}</div>
  </body></html>`;
  await splashWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  splashWin.show();
}

function updateSplash(text, pct) {
  if (!splashWin || splashWin.isDestroyed()) return;
  const safeText = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  splashWin.webContents.executeJavaScript(
    `document.getElementById('status').textContent='${safeText}';` +
    `document.getElementById('bar').style.width='${Math.min(100, pct)}%';`
  ).catch(() => {});
}

function closeSplash() {
  if (splashWin && !splashWin.isDestroyed()) {
    splashWin.close();
    splashWin = null;
  }
}

app.whenReady().then(async () => {
  // Check for first launch before anything creates the userData dir.
  const userDataDir = app.getPath("userData");
  const lockFile = path.join(userDataDir, "launched.lock");
  const isFirstLaunch = !fs.existsSync(lockFile);

  // Show splash immediately so the user sees activity instead of a blank taskbar.
  await createSplash();

  // Step 1: Fire llama-server adaptive startup — runs async so backend starts in parallel.
  updateSplash("Starting AI model\u2026", 10);
  llamaStartPromise = startLlamaServer();

  // Step 2: Start backend in parallel (it's fast; the model load dominates).
  updateSplash("Starting backend\u2026", 20);
  const backendAlreadyRunning = await checkBackendHealth();
  if (!backendAlreadyRunning) {
    startBackend();
  } else {
    logStartup("Reusing existing backend on port 8000.");
  }

  // Step 3: Wait for backend (15 s cap).
  updateSplash("Waiting for backend\u2026", 35);
  logStartup("Waiting for backend to be ready...");
  const backendReady = await waitForBackend("http://127.0.0.1:8000/health");
  logStartup(`Backend ready: ${backendReady}`);
  if (!backendReady) {
    closeSplash();
    dialog.showErrorBox("DeepBrew", "Backend failed to start within 15 seconds.");
  }

  // Step 4: Wait for llama-server health (120 s cap, progress updates splash).
  updateSplash("Loading AI model\u2026", 50);
  logStartup("Waiting for llama-server to be ready...");
  const llamaReady = await waitForLlamaWithProgress();
  logStartup(`llama-server ready: ${llamaReady}`);

  // Step 5: Detect GPU vs CPU mode from the server log.
  const gpuMode = detectGpuMode();
  logStartup(`GPU mode detected: ${gpuMode}`);

  updateSplash("Opening app\u2026", 100);

  // Write first-launch lock so the setup modal won't appear again.
  if (isFirstLaunch) {
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.writeFileSync(lockFile, new Date().toISOString(), "utf8");
    } catch {}
  }

  // Brief pause so the completed bar is visible before the window opens.
  await new Promise((r) => setTimeout(r, 300));
  closeSplash();
  createWindow();

  // Inject runtime status into the renderer once the page has loaded.
  mainWindow.webContents.once("did-finish-load", () => {
    const script = [
      `localStorage.setItem('mtg.llamaMode','${gpuMode}');`,
      `localStorage.setItem('mtg.llamaReady','${llamaReady ? "1" : "0"}');`,
      isFirstLaunch ? `localStorage.setItem('mtg.firstLaunch','1');` : "",
      // Fire a custom event so ModelStatus can react without a page reload.
      `window.dispatchEvent(new CustomEvent('mtg-llama-status',{detail:{ready:${llamaReady},mode:'${gpuMode}'}}));`,
    ].join("");
    mainWindow.webContents.executeJavaScript(script).catch(() => {});
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  if (mainWindow) saveWindowState(mainWindow);

  // Kill the backend process tree (taskkill /F /T handles PyInstaller child processes).
  if (backendProcess) {
    try {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(backendProcess.pid)], { stdio: "ignore" });
    } catch {}
    backendProcess = null;
  }

  // Kill llama-server directly — we kept the handle (non-detached).
  if (llamaProcess) {
    try { llamaProcess.kill(); } catch {}
    llamaProcess = null;
  }

  // Fallback: kill any remaining process still holding LLAMA_PORT.
  try {
    spawnSync("powershell.exe", ["-NoProfile", "-Command",
      `Get-NetTCPConnection -LocalPort ${LLAMA_PORT} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`
    ], { stdio: "ignore" });
  } catch {}
});
