# 🃏 MTG-AI

A desktop app for managing your Magic: The Gathering collection and building Commander decks with the help of a **fully local AI model** — no cloud, no subscription, no Ollama. FastAPI backend + React/Vite frontend, packaged as an Electron app for Windows.

## ✨ Features

- 🗃️ **Collection management** – Import CSV exports from Moxfield, Archidekt, and ManaBox. Bulk select, edit quantities, delete, and back up the database.
- ➕ **Add single cards** – Add individual cards by name (with quantity) directly from the Collection page; metadata is fetched from Scryfall automatically.
- 🤖 **AI deck builder** – Pick a commander, write a strategy prompt, and generate a 100-card Commander deck driven by a local LLM. Keyword filters help guide AI synergy.
- 📌 **Must-Include Cards** – Force the AI to include specific cards (even ones you don't own) by listing them in the "Must Include Cards" textbox on the Build Deck page. Cards are fetched from Scryfall and counted against the appropriate land/non-land budget.
- 💾 **Saved decks** – Save generated decks to "My Decks", view stats (mana curve, color distribution, suggested basics), export decklists as TXT (Moxfield-friendly with commander marker), and run AI suggestions on existing decks.
- 🔨 **Manual decks** – Build decks by selecting cards from your collection and saving them directly to My Decks.
- 📄 **Import deck from text (.txt)** – Paste or load a Moxfield/Archidekt/manual decklist on the Collection page to save it as a deck. Any cards not already in your collection are automatically fetched from Scryfall and added.
- 📡 **Live build status floater** – A persistent floating panel (any page) shows AI deck-build phase, current message, and the last few model "thoughts" while a build is in flight.
- 🔒 **Local LLM (no cloud)** – Deck generation runs fully offline via a bundled `llama-server` (llama.cpp Vulkan). No data leaves your machine.

## What's New (v1.0.17)

- 🚀 **Splash screen** — a branded loading window appears immediately on launch, showing real-time status text and an animated progress bar while the AI model and backend spin up. Users see activity right away instead of a blank taskbar.
- 🔄 **Ordered startup sequence** — `llama-server` (model load) starts first, backend starts in parallel, then the UI window opens only after both are ready. Eliminates race conditions and "AI Offline" flicker.
- ⏳ **120-second model health wait** — the app polls `http://127.0.0.1:8081/health` up to 2 minutes for large models (12B Nemo can take ~90 s to load), with a live elapsed-time counter in the splash.
- 🖥 **GPU/CPU detection** — parses `llama-server.log` for Vulkan offload lines on startup; result is passed directly to the UI so the badge is accurate from first render.
- 🟢 **AI model status badge** — nav bar shows real-time model state: green "AI Ready (GPU)", yellow "AI Ready (CPU)" (with tooltip warning ~5 min generation time), or red "AI Offline" (with path instructions). Polls every 5 s after load.
- 🎉 **First-launch setup modal** — on first ever launch a full-screen modal walks new users through downloading their GGUF, shows the three-model comparison table with HF links, and provides a one-click "Copy Path" button for the install folder. Dismissed with "Got it", never shown again.
- 🔧 **Robust process cleanup** — on exit, the backend's full PyInstaller process tree is killed with `taskkill /F /T /PID`; `llama-server` is killed directly via its retained process handle. Port-kill PowerShell fallback covers edge cases. No orphaned processes after closing the app.
- 🌐 **New `GET /health/llama` endpoint** — backend proxies a health check to `llama-server` so the frontend can poll through a single API origin without CORS/port concerns.

## What's New (v1.0.16)

- 🗂 **Model selection config** — `model-select.env` (auto-created in `%APPDATA%\mtg-collection-frontend\models\` on first launch) lets you switch between the 7B and 12B Nemo models without renaming files. Uncomment the line matching your downloaded `.gguf` and restart.
- 🤗 **Updated model links** — corrected Hugging Face repos: Mistral 7B → [SaltyNumba1/MTG-Commander-Mistral-7B-Trained](https://huggingface.co/SaltyNumba1/MTG-Commander-Mistral-7B-Trained), Nemo 12B → [SaltyNumba1/Mistral-nemo-12B-MTG-Commander](https://huggingface.co/SaltyNumba1/Mistral-nemo-12B-MTG-Commander).
- 🐛 **Root cause of v1.0.14 deck generation failure** — the `.gguf` model file does not ship inside the release zip due to size. It must be downloaded separately from Hugging Face and placed in `%APPDATA%\mtg-collection-frontend\models\`. See AI Model section below for full instructions.

## What's New (v1.0.14)

- ⚡ **AMD GPU acceleration** — replaced Ollama with a bundled [llama.cpp](https://github.com/ggml-org/llama.cpp) Vulkan backend (`llama-server`). The model now runs entirely on the GPU (tested: AMD RX 5700, 7.5/8.0 GB VRAM used). No Ollama installation required. Download the model from [Hugging Face](https://huggingface.co/SaltyNumba1/MTG-Commander-Mistral-7B-Trained) and place it in `%APPDATA%\mtg-collection-frontend\models\`.
- 🚀 **~3× faster deck generation** — GPU inference via Vulkan + `--batch-size 2048` for faster prefill on large candidate pools. Benchmark: 554 candidates in ~416 s on RX 5700 (was CPU-only before).
- 📦 **Self-contained** — `llama-server.exe` and all 22 required DLLs (`ggml-vulkan.dll`, `mtmd.dll`, etc.) ship inside the app. No external dependencies.
- 🔧 **Context window 20 480 tokens** — handles large collections without truncation (up from 8 192).
- 🛠 **Removed Ollama dependency** — backend now uses the `openai` Python client pointed at the local `llama-server` (OpenAI-compatible API). The `.env` `OLLAMA_MODEL` / `OLLAMA_TIMEOUT` vars are still respected for timeout tuning.
- 🐛 **Fixed VS Code file-watcher lock** on `npm run desktop:package` — build now targets `C:\Temp\MTGPkg` then robocopy into the release folder.
- ⚠️ **Model file not bundled** — the `.gguf` must be downloaded separately from Hugging Face. Without it the app starts but AI deck generation is unavailable.

## What's New (v1.0.13)

- ⚡ **AMD GPU acceleration via llama.cpp Vulkan** — `llama-server` (bundled) replaces Ollama entirely. No Ollama installation required.
- 🖥 **GPU inference** — tested on AMD RX 5700: 7.5/8.0 GB VRAM used. Works on any Vulkan-capable GPU (AMD, NVIDIA, Intel); CPU fallback automatic when no GPU found.
- 🚀 **Faster prefill** — `--batch-size 2048` processes large card-list prompts faster. Benchmarks: ~282 s (~400 candidates) / ~416 s (~554 candidates) on RX 5700.
- 🔧 **Context window 20 480 tokens** — up from 8 192; handles large collections without truncation.
- 📋 **Diagnostic log** — `llama-server` output written to `%APPDATA%\mtg-collection-frontend\llama-server.log`.
- 🐛 **Fixed `desktop:package` DLL lock** — build now targets `C:\Temp\MTGPkg` then robocopy into the workspace, avoiding VS Code file-watcher `EBUSY`/`EPERM` errors.

## What's New (v1.0.12)

- 🎯 **Deck Constraints Panel** — after selecting a commander the app auto-detects deck-building themes (tribal, spellslinger, artifacts, lifegain, tokens, sacrifice, and 30+ more archetypes) from oracle text. High-confidence constraints are auto-enabled; each shows a configurable min and optional max count. Add fully custom constraints via field / value / count inputs.
- 🔢 **Type Counters** — Artifact, Sorcery, Instant, and Enchantment each get dedicated Min / Max inputs on the build form. Shows how many you own.
- 🛑 **Max Tapped Lands** — cap the number of tapped lands placed by the engine.
- 🎲 **Re-Roll + Card Exclusion** — check any deck card to exclude it from the next build, then hit Re-Roll. Excluded cards are shown as dismissible pills and persisted for the session.
- 🖊 **My Decks Edit Mode** — toggle edit mode to check-and-remove cards, add cards from your collection, and save changes back to the deck file.
- 🖼 **Background Art** — click the 🖼 button on any card image to set it as the full-screen app background (persisted via localStorage).
- 💰 **Deck Price** — My Decks now shows the total TCGplayer price of every card in the deck.
- 🌌 **UI Theming** — radial purple gradient background, mana symbol scatter overlay, global 25% zoom.
- 🐛 **Collection type filter fix** — DFC cards and Legendary supertype now filter correctly (~224 legendary creatures vs 3).
- ⚙️ **Deck variety** — candidate pool shuffled per build; LLM temperature randomised (0.70–0.88).
- 🔧 **New backend endpoints** — `GET /deck/commander-profile`, `GET /deck/card-lookup`, `PUT /deck/saved/:file`.

## What's New (v1.0.10)

- 🪄 **Import deck from text** – new "Import Deck" flow on the Collection page. Accepts Moxfield/Archidekt/plain-text decklists; missing cards are auto-fetched from Scryfall and added to your collection. Imported decks land directly in My Decks.
  - ⚠️ **Decklist format requirement:** the **commander must appear at the very top of the decklist** (above the 99 mainboard cards) **and must also be named in the deck title block**. The importer detects the commander from the first card line, the `Commander` / `Command Zone` section header, or a `*CMDR*` marker — the safest combo is "commander first + named in title".
- 🛰️ **Build Status Floater** – a global, collapsible floating panel polls `/deck/build-status` every 2.5 s and surfaces the active build phase, current step, and the most recent AI thoughts so you can navigate away from the Build Deck page without losing visibility.
- 🧠 **New deck-build telemetry endpoints** – `GET /deck/build-status`, `GET /deck/build-stream` (SSE), and `POST /deck/reset` expose live progress and a kill switch for stuck builds.
- ⚙️ **Backend `.env` for model selection** – `mtg-collection/backend/.env` now controls `OLLAMA_MODEL` (default `mtg-commander`) and `OLLAMA_TIMEOUT` (default 15 min). Switch between Mistral 7B and Mistral-Nemo 12B by uncommenting the relevant line.
- 🔁 **Scryfall auto-add on import** – text-based deck and collection imports upsert missing cards through Scryfall instead of failing.
- 🗃️ **Database / Scryfall service hardening** – improved error handling and lookup fallbacks for double-faced (`A // B`) card names.

## What's New (v1.0.8)

- 🔁 **Add cards to existing collection from text** – new "Import Cards from Text" button on the Collection page (paste a list or load a `.txt`).
- 🧱 **Dual lands counter** – set how many multi-color lands matching your commander identity should be included; counts toward the total land budget.
- 🎯 **Smarter AI target** – the engine now asks the model for `99 − basics − nonbasics − duals − must-includes`, so it stops wasting effort generating cards we'll throw away.
- 🌿 **Lands grouped at the bottom** of the generated deck list, with basic-land tiles collapsed to one tile per color (with `(N)` count).
- 📷 **Smaller commander preview** after generation.
- 🧮 **My Decks sort dropdown** – Name / Card count / Commander / Type.
- 🤝 **Analyze & Suggest** popup now shows side-by-side swap recommendations (current → suggested) at ~3"×3" tile size with arrows.
- ⏳ **Circular progress indicator** on collection imports (with percent in the center).
- 🐛 Command Tower / Path of Ancestry are correctly treated as nonbasic lands, not basics.

## What's New (v1.0.7)

- 💾 Saved decks now persist between launches in the packaged Windows app (path is anchored next to the exe instead of the temporary PyInstaller extraction directory).

## What's New (v1.0.6)

- ➕ Add single cards to your collection from the Collection page.
- 🎯 New "Must Include Cards" textbox on the Build Deck page – wrap card names in double quotes, one or many per line. Lands among them count toward the nonbasic land target.
- 🐛 Fixed deck generation failure when must-include cards weren't owned (`fetch_card_by_name` import was missing).
- 🎨 Refactored inline styles out of `CardPreview`, `DeckBuilder`, `MyDecks`, and `Help` into dedicated CSS files.

## 🤖 AI Model (llama-server / llama.cpp)

The app ships a bundled `llama-server.exe` (llama.cpp Vulkan build) that starts automatically — **no Ollama required**.

Two custom-trained models are available on Hugging Face:

| Model | File | Size | Min VRAM | Best For |
|---|---|---|---|---|
| **Mistral 7B** *(default)* | `mistral-commander-q4.gguf` | ~4.1 GB | 6 GB (or CPU) | Most users, laptops, 8 GB cards |
| **Nemo 12B Q3** | `mtg-commander-nemo-q3_k_m.gguf` | ~6 GB | 8 GB | Mid-range GPUs (RX 5700, RTX 3070+) |
| **Nemo 12B Q4** | `mtg-commander-nemo-q4_k_m.gguf` | ~7.5 GB | 10 GB | High-end GPUs (RX 6800+, RTX 3080+) |

**🤗 Download links:**
- Mistral 7B: https://huggingface.co/SaltyNumba1/MTG-Commander-Mistral-7B-Trained
- Nemo 12B: https://huggingface.co/SaltyNumba1/Mistral-nemo-12B-MTG-Commander

### 📥 Model Setup

1. Download the `.gguf` file of your choice.
2. Place it (without renaming) in:
   ```
   C:\Users\<you>\AppData\Roaming\mtg-collection-frontend\models\
   ```
3. On first launch the app auto-creates `model-select.env` in that folder. Open it with any text editor and uncomment the line matching your file:
   ```
   MODEL_FILE=mistral-commander-q4.gguf
   # MODEL_FILE=mtg-commander-nemo-q3_k_m.gguf
   # MODEL_FILE=mtg-commander-nemo-q4_k_m.gguf
   ```
4. Save the file and (re)launch the app.

> 🖥️ **GPU:** Vulkan backend works on AMD, NVIDIA, and Intel GPUs automatically. CPU fallback is available (~5 min for 7B on most laptops). A CUDA-optimized NVIDIA release is planned.

## 💡 Tips

- **Must Include Cards format**: `"Sol Ring" "Arcane Signet" "Command Tower"` – each name in double quotes, separated by spaces or newlines.
- **Importing a decklist (.txt)**: place the **commander on the first line** of the decklist *and* set it in the title/header block before importing. The parser also recognises a `Commander` (or `Command Zone`) section header and the `*CMDR*` inline marker, but commander-at-top-plus-titled is the most reliable combo. Lines like `1 Sol Ring`, `1x Sol Ring`, or just `Sol Ring` all work; `//` and `#` lines are treated as comments; anything under `Sideboard` / `Maybeboard` is ignored.
- **Stuck deck build**: if the model hangs, a "Force Reset Model" button appears after 45 seconds. You can also navigate away and watch progress in the Build Status Floater, then hit `POST /deck/reset` (or the Reset button) to clear a wedged build.
- **Switching LLM**: edit `mtg-collection/backend/.env` (next to the exe in packaged builds) and set `OLLAMA_MODEL=...`. Restart the backend / app.
- **Logs**: `mtg-collection/backend/dist/llm_deckbuilder.log` (runs from the packaged exe's CWD).
