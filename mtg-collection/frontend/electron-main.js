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
let isQuitting = false;
let mainWindow = null;

const LLAMA_PORT = 8081;
const LLAMA_CTX = 20480;
const LLAMA_GPU_LAYERS = 99; // offload all layers to Vulkan GPU

function getLlamaServerDir() {
  // Packaged: resources/llama-server/  Dev: frontend/llama-server/
  const packaged = path.join(process.resourcesPath || __dirname, "llama-server");
  const dev = path.join(__dirname, "llama-server");
  if (fs.existsSync(packaged)) return packaged;
  return dev;
}

function getModelPath() {
  const userDataDir = app.getPath("userData");
  return path.join(userDataDir, "models", "model.gguf");
}

function ensureModelCopied() {
  const dest = getModelPath();
  if (fs.existsSync(dest)) return true;

  // Possible source locations for the GGUF (dev + packaged)
  const candidates = [
    path.join(__dirname, "..", "..", "training", "TRAIN_Mistral", "mistral-commander-q4.gguf"),
    path.join(__dirname, "..", "..", "training", "TRAIN_NEMO", "mtg-commander-nemo-q4_k_m.gguf"),
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

function startLlamaServer() {
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

  logStartup(`Starting llama-server (Vulkan) on port ${LLAMA_PORT} with model ${modelPath}`);

  // Build a clean child environment: delete Chromium's Vulkan overrides so
  // the AMD GPU driver is discovered normally by the Vulkan loader.
  // (schtasks ran as SYSTEM and had no GPU access; spawn with custom env works.)
  const env = { ...process.env };
  delete env.VK_ICD_FILENAMES;
  delete env.VK_LAYER_PATH;

  const userDataDir = app.getPath("userData");
  const llamaLogPath = path.join(userDataDir, "llama-server.log");
  const logFd = fs.openSync(llamaLogPath, "a");

  const child = spawn(exe, [
    "--model", modelPath,
    "--port", String(LLAMA_PORT),
    "--ctx-size", String(LLAMA_CTX),
    "--n-gpu-layers", String(LLAMA_GPU_LAYERS),
    "--batch-size", "2048",   // larger batch = faster prefill of long prompts
    "--ubatch-size", "512",
    "--host", "127.0.0.1",
  ], {
    cwd: serverDir,
    env,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);
  logStartup(`llama-server spawned (pid ${child.pid}), log: ${llamaLogPath}`);
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
      "MTG Collection",
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
    dialog.showErrorBox("MTG Collection", `Backend failed to start: ${error.message}`);
    app.quit();
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, "build", "icon.ico");
  const state = loadWindowState();
  const win = new BrowserWindow({
    width: state.width || 1200,
    height: state.height || 860,
    x: state.x,
    y: state.y,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
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

app.whenReady().then(async () => {
  const backendAlreadyRunning = await checkBackendHealth();
  logStartup(`Backend already running before launch: ${backendAlreadyRunning}`);
  if (!backendAlreadyRunning) {
    startBackend();
  } else {
    logStartup("Reusing existing backend on port 8000.");
  }

  startLlamaServer();

  logStartup("Waiting for backend to be ready...");
  const ready = await waitForBackend("http://127.0.0.1:8000/health");
  logStartup(`Backend ready: ${ready}`);
  if (!ready) {
    dialog.showErrorBox("MTG Collection", "Backend failed to start within 15 seconds.");
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
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
  if (backendProcess) {
    backendProcess.kill();
  }
  // Kill llama-server by port (it was launched detached via schtasks)
  try {
    spawnSync("powershell.exe", ["-NoProfile", "-Command",
      `Get-NetTCPConnection -LocalPort ${LLAMA_PORT} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`
    ]);
    spawnSync("schtasks", ["/delete", "/tn", "MTGLlamaServer", "/f"], { stdio: "ignore" });
  } catch {}
});
