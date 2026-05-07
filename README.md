# MTG-AI

A desktop app for managing your Magic: The Gathering collection and building Commander decks with the help of a local LLM. FastAPI backend + React/Vite frontend, packaged as an Electron app for Windows.

## Features

- **Collection management** – Import CSV exports from Moxfield, Archidekt, and ManaBox. Bulk select, edit quantities, delete, and back up the database.
- **Add single cards** – Add individual cards by name (with quantity) directly from the Collection page; metadata is fetched from Scryfall automatically.
- **AI deck builder** – Pick a commander, write a strategy prompt, and generate a 100-card Commander deck driven by a local LLM. Keyword filters help guide AI synergy.
- **Must-Include Cards** – Force the AI to include specific cards (even ones you don't own) by listing them in the new "Must Include Cards" textbox on the Build Deck page. Cards are fetched from Scryfall and counted against the appropriate land/non-land budget.
- **Saved decks** – Save generated decks to "My Decks", view stats (mana curve, color distribution, suggested basics), export decklists as TXT (Moxfield-friendly with commander marker), and run AI suggestions on existing decks.
- **Manual decks** – Build decks by selecting cards from your collection and saving them directly to My Decks.
- **Import deck from text (.txt)** – Paste or load a Moxfield/Archidekt/manual decklist on the Collection page to save it as a deck. Any cards not already in your collection are automatically fetched from Scryfall and added.
- **Live build status floater** – A persistent floating panel (any page) shows AI deck-build phase, current message, and the last few model "thoughts" while a build is in flight.
- **Local LLM (no cloud)** – Deck generation runs fully offline via a bundled `llama-server` (llama.cpp Vulkan). Timeout tunable via `OLLAMA_TIMEOUT` in `mtg-collection/backend/.env`.

## What's New (v1.0.14)

- ⚡ **AMD GPU acceleration** — replaced Ollama with a bundled [llama.cpp](https://github.com/ggml-org/llama.cpp) Vulkan backend (`llama-server`). The model now runs entirely on the GPU (tested: AMD RX 5700, 7.5/8.0 GB VRAM used). No Ollama installation required.
- 🚀 **~3× faster deck generation** — GPU inference via Vulkan + `--batch-size 2048` for faster prefill on large candidate pools. Benchmark: 554 candidates in ~416 s on RX 5700 (was CPU-only before).
- 📦 **Self-contained** — `llama-server.exe` and all 22 required DLLs (`ggml-vulkan.dll`, `mtmd.dll`, etc.) ship inside the app. No external dependencies.
- 🔧 **Context window 20 480 tokens** — handles large collections without truncation (up from 8 192).
- 🛠 **Removed Ollama dependency** — backend now uses the `openai` Python client pointed at the local `llama-server` (OpenAI-compatible API). The `.env` `OLLAMA_MODEL` / `OLLAMA_TIMEOUT` vars are still respected for timeout tuning.
- 🐛 **Fixed VS Code file-watcher lock** on `npm run desktop:package` — build now targets `C:\Temp\MTGPkg` then robocopy into the release folder.

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

## Project Structure

```
mtg-collection/
  backend/      FastAPI service (routes, services, scryfall client, deck engine)
  frontend/     React + Vite app + Electron wrapper
```

## Running in development

```powershell
# Backend
cd mtg-collection\backend
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload

# Frontend
cd mtg-collection\frontend
npm install
npm run dev
```

## Building the desktop app

```powershell
# 1. Build the standalone backend exe (PyInstaller)
cd mtg-collection\backend
.\package_standalone.bat

# 2. Package the Electron app (electron-packager)
cd ..\frontend
npm run desktop:package
```

Output: `mtg-collection/frontend/release/MTG Commander Generator-win32-x64/MTG Commander Generator.exe`

> Note: `npm run desktop:build` (electron-builder) requires Developer Mode / admin to extract `winCodeSign` symlinks. Use `desktop:package` unless you specifically need an installer.

## AI model (Ollama)

The deck engine talks to a locally-running [Ollama](https://ollama.com) instance.
You can use any chat-capable model, but the project ships with a custom-trained
LoRA over Mistral 7B specialized for Commander deck building.

**🤗 Hugging Face repo:** https://huggingface.co/SaltyNumba1/mistral-commander-lora

That repo contains:
- `mistral-commander-q4.gguf` — prebuilt Q4_K_M quantized model (~4 GB). Drop it into `mtg-collection/training/` and run `ollama create mtg-commander -f Modelfile`.
- `mistral-commander-lora.zip` — raw LoRA adapter, for users who want to merge it themselves or apply it to a different fine-tune.

See [`mtg-collection/training/LOCAL_SETUP.md`](mtg-collection/training/LOCAL_SETUP.md) for step-by-step setup.

### Using a different base model (Llama 3, Gemma, Qwen, etc.)

The app doesn't care which model Ollama serves — it just sends a chat request. The model name is read from the `OLLAMA_MODEL` env var (default: `mtg-commander`).

**Option A — use any stock model as-is (no MTG fine-tune):**
```powershell
ollama pull gemma:7b
$env:OLLAMA_MODEL = "gemma:7b"   # set before launching MTG Collection.exe
```
Or create a `.env` file next to the exe with `OLLAMA_MODEL=gemma:7b`. Quality won't be MTG-specialized but it works out of the box.

**Option B — fine-tune a different base on the MTG dataset:**
The published LoRA adapter is **Mistral-7B-specific** — it can't be applied to Gemma, Llama 3, etc. (different architectures). To get an MTG-specialized Gemma model you have to retrain:
1. Open `mtg-collection/training/MTG_Mistral_LoRA_Training.ipynb` in Colab.
2. Change the base-model line from `mistralai/Mistral-7B-Instruct-v0.2` to e.g. `google/gemma-7b-it`.
3. The training data generator (Scryfall + EDHREC pulls in the notebook) is reusable as-is.
4. Re-run training → merge → quantize → download the new `.gguf`.
5. Register in Ollama and set `OLLAMA_MODEL` to your new model name.


## Tips

- **Must Include Cards format**: `"Sol Ring" "Arcane Signet" "Command Tower"` – each name in double quotes, separated by spaces or newlines.
- **Importing a decklist (.txt)**: place the **commander on the first line** of the decklist *and* set it in the title/header block before importing. The parser also recognises a `Commander` (or `Command Zone`) section header and the `*CMDR*` inline marker, but commander-at-top-plus-titled is the most reliable combo. Lines like `1 Sol Ring`, `1x Sol Ring`, or just `Sol Ring` all work; `//` and `#` lines are treated as comments; anything under `Sideboard` / `Maybeboard` is ignored.
- **Stuck deck build**: if the model hangs, a "Force Reset Model" button appears after 45 seconds. You can also navigate away and watch progress in the Build Status Floater, then hit `POST /deck/reset` (or the Reset button) to clear a wedged build.
- **Switching LLM**: edit `mtg-collection/backend/.env` (next to the exe in packaged builds) and set `OLLAMA_MODEL=...`. Restart the backend / app.
- **Logs**: `mtg-collection/backend/dist/llm_deckbuilder.log` (runs from the packaged exe's CWD).
