# MTG Collection v1.0.13

## ⚡ AMD GPU Acceleration (llama.cpp Vulkan)

Deck generation now runs on your AMD GPU via a bundled [llama.cpp](https://github.com/ggml-org/llama.cpp) Vulkan backend — no Ollama required.

### What changed

- **Bundled `llama-server`** — `llama-server.exe` and all required DLLs ship inside the app. Nothing to install.
- **GPU inference** — tested on AMD RX 5700 (RDNA1): 7.5 GB of 8 GB VRAM used during generation.
- **Faster prefill** — `--batch-size 2048` processes the large card-list prompt in bigger chunks.
- **Larger context window** — 20 480 tokens (up from 8 192), handles large collections without truncation.
- **No Ollama dependency** — the Python backend now uses the `openai` client pointing at the local `llama-server` (OpenAI-compatible API on `127.0.0.1:8081`).
- **Diagnostic log** — `llama-server` output is written to `%APPDATA%\mtg-collection-frontend\llama-server.log`.

### Performance

| Scenario | Time | Hardware |
|---|---|---|
| ~400 candidates | ~282 s | AMD RX 5700 (GPU) |
| ~554 candidates | ~416 s | AMD RX 5700 (GPU) |

### Install / upgrade

1. Download `MTG-Collection-v1.0.13-win32-x64.zip`
2. Extract and run `MTG Commander Generator.exe`
3. On first launch the app copies the model to `%APPDATA%\mtg-collection-frontend\models\model.gguf` automatically — **this requires the model file to ship with the release or be placed there manually.**

> **Model file not included in the zip** (4.1 GB). Download `mistral-commander-q4.gguf` from [Hugging Face](https://huggingface.co/SaltyNumba1/mistral-commander-lora) and place it at:
> `%APPDATA%\mtg-collection-frontend\models\model.gguf`

### Bug fixes

- Fixed `desktop:package` failing with `EBUSY` / `EPERM` on DLL files locked by VS Code file-watcher — build now targets `C:\Temp\MTGPkg` then robocopy into the workspace.
