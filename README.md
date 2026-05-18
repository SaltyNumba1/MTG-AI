<img width="1024" height="1024" alt="icon" src="https://github.com/user-attachments/assets/8c7a3f97-26a5-4ec1-a106-a4131c211f3f" />


 MTG-AI

A desktop app for managing your Magic: The Gathering collection and building Commander decks with the help of a **fully local AI model** — no cloud, no subscription, no Ollama. FastAPI backend + React/Vite frontend, packaged as an Electron app for Windows.

## ✨ Features

- 🗃️ **Collection management** – Import CSV exports from Moxfield, Archidekt, and ManaBox. Bulk select, edit quantities, delete, and back up the database.
- ➕ **Add single cards** – Add individual cards by name (with quantity) directly from the Collection page; metadata is fetched from Scryfall automatically.
- 🤖 **AI deck builder** – Pick a commander, write a strategy prompt, and generate a 100-card Commander deck driven by a local LLM. Keyword filters help guide AI synergy.
- 📌 **Must-Include Cards** – Force the AI to include specific cards (even ones you don't own) by listing them in the "Must Include Cards" textbox on the Build Deck page. Cards are fetched from Scryfall and counted against the appropriate land/non-land budget.
- 💾 **Saved decks** — Save generated decks to "My Decks", view stats (mana curve, color distribution, lands breakdown), export decklists as TXT (Moxfield-friendly with commander marker), run AI suggestions, rename decks in-place, and swap out individual cards with AI-suggested substitutes.
- 🔨 **Manual decks** – Build decks by selecting cards from your collection and saving them directly to My Decks.
- 📄 **Import deck from text (.txt)** – Paste or load a Moxfield/Archidekt/manual decklist on the Collection page to save it as a deck. Any cards not already in your collection are automatically fetched from Scryfall and added.
- 📡 **Live build status floater** – A persistent floating panel (any page) shows AI deck-build phase, current message, and the last few model "thoughts" while a build is in flight.
- 🔒 **Local LLM (no cloud)** – Deck generation runs fully offline via a bundled `llama-server` (llama.cpp Vulkan). No data leaves your machine.

## What's New (v1.3.2)

- 🐛 **Deck import fix** — importing a `.txt` decklist no longer fails when cards are missing from your collection. Scryfall fetch errors are now handled per-card and the database commit is correctly issued at the end of the import.
- 🐛 **Create Backup fix** — the backup button was silently doing nothing; the missing file-copy call has been added and backups now work correctly.
- 🐛 **Power/Toughness constraint fix** — `match_field: power` / `toughness` now compares actual card stats (integer) instead of searching oracle text. Supports `4+`, `>=4`, `>3`, `<=2`, `<4`, and exact values. The auto-detected "Power ≥4 creatures" suggestion is also corrected.
- 🐛 **Max constraint enforcement fix** — when no replacement cards exist in the pool, cards that exceed a `max_count` ceiling are now actually removed from the deck instead of silently left in.
- ✨ **Add to Deck** — new button in the Collection bulk toolbar lets you append selected cards to any saved deck's mainboard or sideboard without leaving the page.
- ✨ **Power / Toughness in constraint builder** — the Field dropdown in the DeckBuilder constraint panel now includes Power and Toughness with syntax hints (`4+`, `>3`, `>=5`, etc.).

## What's New (v1.3.1)

- 📊 **My Decks stats panel** — a Mana Curve bar chart, Color Distribution bar chart, and Lands breakdown (basic vs nonbasic count) now appear above the sort selector whenever you open a saved deck in My Decks. Same visual style as the Deck Builder result view.
- 🔄 **Swap-select UX fix** — the "🔄 Selecting…" toolbar button now immediately reverts to normal the moment you click **Find Substitutes**, rather than staying in selecting-mode for the full 30-second AI analysis call.
- 💡 **Swap-select hint bar** — when swap-select mode is active but no cards have been checked yet, a dashed hint bar guides you to click cards first before clicking Find Substitutes.

## What's New (v1.3.0)

- ⚙️ **Global settings hook (`useSettings`)** — all pages now read from a single source of truth for GPU/deck/display preferences instead of scattered `localStorage.getItem` calls. Settings changes propagate instantly across the entire app.
- 🎛️ **Expanded Settings page** — three sections: GPU Performance (oracle text threshold, max tokens), Deck Building Defaults (basic/nonbasic/dual land counts, target bracket, strict mode, max tapped lands), and Display (show prices, default sort). Previously only GPU settings were configurable.
- ✏️ **Rename saved decks** — pencil icon on each deck card in My Decks lets you rename a deck in place. The file is renamed on disk via `PATCH /deck/saved/{deck_file}`.

## What's New (v1.2.0)

- ⚙️ **GPU Settings page** — new Settings page with two controls: oracle-text threshold (how many candidates before compact mode kicks in) and max tokens for LLM generation. Both values are persisted to `localStorage` and applied to every deck build.
- 🔄 **Select to Swap** — in the My Decks analyze view, a new **Select to Swap** mode lets you pick specific cards you want replaced. The AI returns substitution suggestions for exactly those cards.
- 📋 **Sideboard** — deck view in My Decks now displays and edits a sideboard section.
- 🏷️ **Type filter chips** — card type filters in the deck builder redesigned as toggle chips for faster selection.
- 🗜️ **Compact candidate mode** — cards beyond the oracle-text threshold are sent to the LLM using an abbreviated format (name + type only), cutting prompt token usage on large collections.

## What's New (v1.1.1)

- 🐛 **Analyze suggestions no longer time out** — removed the hard 900-second wall-clock timeout from the LLM pipeline. The `OLLAMA_MAX_GENERATION_SEC` / `OLLAMA_TIMEOUT` / `ALLOW_LLM_TIMEOUT_FALLBACK` constants and their corresponding Electron env injections are gone. The heartbeat progress reporter (every 8 s) is kept so elapsed time still shows in the UI. On failure the backend now raises a clear exception rather than returning an empty result silently.

## What's New (v1.1.0)

- 🍺 **App renamed to DeepBrew** — the executable and window title changed from "MTG Commander Generator" to **DeepBrew**.
- 🔢 **Dynamic splash version** — the splash screen now reads the version number directly from `package.json` so it always matches the release.

## What's New (v1.0.19)

- 🎨 **Land counter inputs restyled** — basic/nonbasic/dual land inputs on the Deck Builder page have an updated visual style.
- 🌑 **Constraint inputs darkened** — deck constraint panel inputs use a darker background for better contrast.
- 🖥️ **Splash screen fullscreen fix** — splash window now renders full-screen correctly on all display configurations.

## What's New (v1.0.18)

- 🏆 **WotC Bracket power-level targeting** — the deck builder now actively prioritizes high-power cards from your collection based on the target bracket you select:
  - **Bracket 4/5**: auto-injects game changers (Rhystic Study, Mana Drain, Dockside Extortionist, Necropotence + 52 more), combo enablers (Isochron Scepter, Thassa's Oracle, Mikaeus + 52 more), and tutor-equivalents from your collection.
  - **Bracket 5**: also injects extra-turn spells (Time Warp, Nexus of Fate, Temporal Manipulation + more).
  - Scoring bonuses applied during rebalancing: +70 game changers, +60 combo enablers, +55 extra turns, +50 tutors.
  - CMC >5 penalty (−15) for non-power cards at Bracket 4+ keeps curves tight.
- 🔎 **Oracle-text fallback classification** — cards that "search your library" (tutor-equivalents) or "take an extra turn" (extra-turn-equivalents) are detected automatically from oracle text even if not in the curated named sets. Lands (including fetchlands) are excluded from tutor classification.
- 🃏 **Expanded curated card sets** — GAME_CHANGERS expanded to 56 cards across all colors; COMBO_ENABLERS expanded to 55 cards across 6 combo categories (infinite mana, infinite tokens/ETB, infinite damage/win-cons, library-win, graveyard loops, untap enablers, extra-turn loops).
- ⚖️ **Bracket threshold deduplication** — cards counted as game changers no longer also inflate the tutor count when evaluating bracket thresholds, preventing false bracket inflation.
- 🎨 **Printing picker redesigned as full-screen modal** — the 🎨 Art button now opens a centered overlay with all printings in a responsive auto-fill grid. Each cell shows full card art at the correct 63:88 aspect ratio with set/number label. Active printing has a purple border highlight; clicking the backdrop or ✕ closes without changing selection. Rendered via React portal to `document.body` — never clipped by card containers.

## What's New (v1.0.17.2)

- 🔁 **Adaptive GPU fallback** — startup now retries `llama-server` with progressively fewer `--n-gpu-layers` values (`99 -> 60 -> 40 -> 20 -> 0`) when Vulkan VRAM is insufficient.
- 💻 **Reliable CPU fallback** — if all GPU attempts fail, the app automatically starts in CPU mode (`--n-gpu-layers 0`) instead of remaining offline.
- 🧾 **Retry diagnostics in startup log** — `desktop-startup.log` now records each layer attempt and whether it failed due to OOM.
- ✅ **Fix for laptop GPUs with limited VRAM** — prevents the previous hard-failure case where forcing high GPU layers aborted model load and never reached CPU mode.

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
- <img width="2545" height="1385" alt="1pquGYIwry" src="https://github.com/user-attachments/assets/0f693ae3-672d-4e00-a904-69f438e9a16e" />

<img width="2545" height="1385" alt="yiJ1LWyLgx" src="https://github.com/user-attachments/assets/c3d1dd22-7bfc-483b-9af2-03f593fdb77e" />

<img width="2545" height="1385" alt="wu0IWYy590" src="https://github.com/user-attachments/assets/a4a77be3-b6c3-447e-9bda-12523e85879c" />

<img width="2545" height="1385" alt="vujA6KECqe" src="https://github.com/user-attachments/assets/b6f0f412-cb17-4ede-99a4-9686539af045" />

<img width="2545" height="1385" alt="UCKr7Ng8dl" src="https://github.com/user-attachments/assets/c5d1e8cb-e9cf-488d-80a3-31712dd57df4" />

<img width="2545" height="1385" alt="swGQ5PnQxr" src="https://github.com/user-attachments/assets/f376320a-147a-45b2-98ec-da6b73fbe324" />


<img width="2545" height="1385" alt="rT8MbxPOLw" src="https://github.com/user-attachments/assets/be29b01a-c528-41d5-89ec-3d58219f7f55" />

<img width="2545" height="1385" alt="MTG_Commander_Generator_3GOAaLVCBs" src="https://github.com/user-attachments/assets/3ad6ceb5-b984-410b-84c1-875ffff6056a" />

<img width="2545" height="1385" alt="LHDFXsdx5F" src="https://github.com/user-attachments/assets/3c81b99e-2c76-4400-bedd-e1b5f8b060e7" />

<img width="2545" height="1385" alt="fLSlYwD1Vx" src="https://github.com/user-attachments/assets/34efbaee-7df4-410f-9a5a-1229e2c04978" />

<img width="2545" height="1385" alt="fEMjemb0Kt" src="https://github.com/user-attachments/assets/68d23b3a-5ad7-4ce4-a57e-bb37c59849f4" />

<img width="2545" height="1385" alt="f6OOtqmGzY" src="https://github.com/user-attachments/assets/64813f7d-47b0-468b-8b65-abb4d82d2776" />

<img width="2545" height="1385" alt="dGQdMF4eGQ" src="https://github.com/user-attachments/assets/d3735835-35a3-4f82-a217-a79ee4aed4bb" />

<img width="2545" height="1385" alt="DFDf4J1PDS" src="https://github.com/user-attachments/assets/9a773bb1-d78a-46ec-8f43-c19fca4692cf" />

<img width="2544" height="1328" alt="D6JYHXcjKd" src="https://github.com/user-attachments/assets/1c468c10-ebcc-44a6-8cb4-15b79e3a718e" />

<img width="2545" height="1385" alt="8XzGXkNvcp" src="https://github.com/user-attachments/assets/09507221-7660-4a3b-a484-006f3f9d8972" />

<img width="2545" height="1385" alt="7WcdWvG4tj" src="https://github.com/user-attachments/assets/c44d4ea1-c3ae-492b-9d64-bdc5d789c7b2" />

<img width="2545" height="1385" alt="6BmYEYMmLy" src="https://github.com/user-attachments/assets/6a385818-7f93-4cc9-a07e-1d952178057e" />

<img width="2545" height="1385" alt="5gkrUq8pQK" src="https://github.com/user-attachments/assets/572f4fe6-e3f8-41bb-9406-3aceb6d84360" />

<img width="2545" height="1385" alt="4c3BAHt3Bd" src="https://github.com/user-attachments/assets/4a80e649-cd07-419c-aae2-d9c6f35f416c" />

<img width="2545" height="1385" alt="MTG_Commander_Generator_RB8Hm3j18s" src="https://github.com/user-attachments/assets/445f5f41-c490-4453-ab56-bcf9136e6e22" />

<img width="2545" height="1385" alt="MTG_Commander_Generator_qRhoyrtQJq" src="https://github.com/user-attachments/assets/c96168ff-5e46-4e8c-b29d-f570c7072ed0" />

<img width="2545" height="1385" alt="MTG_Commander_Generator_uX3EHwF4XI" src="https://github.com/user-attachments/assets/b4e95e49-5379-44c5-85dd-a560e6e4ca35" />


