const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, dialog } = require("electron");
const { spawn, spawnSync } = require("child_process");

const isDev = process.env.NODE_ENV === "development";
const frontendDir = path.join(__dirname);
const backendDir = path.join(__dirname, "..", "backend");
const packagedBackendDir = path.join(process.resourcesPath || __dirname, "backend");
let backendProcess = null;
let isQuitting = false;
let mainWindow = null;

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

  backendProcess = spawn(backend.command, backend.args, {
    cwd: backend.cwd,
    shell: false,
    env: process.env,
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
});
