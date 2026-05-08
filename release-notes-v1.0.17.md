# MTG Collection v1.0.17

## 🚀 Startup UX, AI Status Badge & First-Launch Setup

### What's New

#### Splash Screen & Ordered Startup
- A branded splash window appears immediately when you launch the app — logo, animated progress bar, and live status text. No more blank taskbar while the AI model loads.
- **Startup order is now correct**: llama-server starts first (the model can take 10–90 s to load depending on VRAM), the backend starts in parallel, and the main window only opens once both are ready.
- The app waits up to **2 minutes** for the AI model to finish loading, with a live elapsed-time counter. This accommodates the larger Nemo 12B models which previously caused false "AI Offline" states.

#### AI Model Status Badge
A persistent badge in the top-right of the nav bar shows the real-time state of the AI model:

| Badge | Meaning |
|---|---|
| 🟢 **AI Ready (GPU)** | Model loaded on Vulkan GPU — full speed |
| 🟡 **AI Ready (CPU)** | No Vulkan GPU found — CPU fallback active (~5 min generation time) |
| 🔴 **AI Offline** | Model not found or failed to start — hover for install path |

The badge updates every 5 seconds after load and reacts instantly to the startup event.

#### First-Launch Setup Modal
On your very first launch a setup modal walks you through downloading and installing your AI model:
- Three-model comparison table with VRAM requirements
- Direct download links to the Hugging Face repos
- One-click **Copy Path** button for the install folder
- Step-by-step instructions

The modal only appears once and is dismissed with "Got it".

#### Clean Process Exit
- The backend process tree is now fully terminated on exit using `taskkill /F /T` (kills PyInstaller child processes too).
- `llama-server` is killed directly via its retained process handle.
- No more orphaned `mtg-collection.exe` or `llama-server.exe` processes after closing the app.

#### New Backend Endpoint
- `GET /health/llama` — proxies the llama-server health check through the backend API. The frontend polls this single origin instead of hitting the llama port directly, avoiding any CORS or port-conflict issues.

---

### Models

| Model | File | VRAM | HF Repo |
|---|---|---|---|
| Mistral 7B Q4_K_M *(recommended)* | `mistral-commander-q4.gguf` | ~5 GB | [SaltyNumba1/MTG-Commander-Mistral-7B-Trained](https://huggingface.co/SaltyNumba1/MTG-Commander-Mistral-7B-Trained) |
| Nemo 12B Q3_K_M | `mtg-commander-nemo-q3_k_m.gguf` | ~6 GB | [SaltyNumba1/Mistral-nemo-12B-MTG-Commander](https://huggingface.co/SaltyNumba1/Mistral-nemo-12B-MTG-Commander) |
| Nemo 12B Q4_K_M | `mtg-commander-nemo-q4_k_m.gguf` | ~7.5 GB | [SaltyNumba1/Mistral-nemo-12B-MTG-Commander](https://huggingface.co/SaltyNumba1/Mistral-nemo-12B-MTG-Commander) |

---

### Install / Upgrade

1. Download `MTG-Collection-v1.0.17-win32-x64.zip`
2. Extract and run `MTG Commander Generator.exe`
3. On first launch the **setup modal** will appear — follow the steps to download and install your `.gguf` model file
4. If upgrading from v1.0.16+: your `model-select.env` and `.gguf` files in `%APPDATA%\mtg-collection-frontend\models\` are preserved automatically

> **Model file not included** — download separately from Hugging Face and place in:
> `%APPDATA%\mtg-collection-frontend\models\`
> Then edit `model-select.env` in the same folder to uncomment the line matching your file.

---

### Bug Fixes

- Fixed "AI Offline" badge showing even when the GPU was actively running the model — caused by the backend exe being built before the `/health/llama` endpoint was added. Rebuilt and repackaged.
- Fixed orphaned `mtg-collection.exe` and `llama-server.exe` processes remaining after the app window was closed.
- Fixed llama-server process handle being lost (was spawned `detached + unref`), which made direct kill impossible on exit.
