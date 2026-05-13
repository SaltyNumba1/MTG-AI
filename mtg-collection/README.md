# 🃏 MTG Collection & Deck Builder

Store your Magic: The Gathering card collection and build Commander decks from it using a **fully local AI model** — no cloud, no subscription, no Ollama.

---

## ✅ Requirements

- 🪟 Windows 10/11 x64
- 🖥️ A **Vulkan-capable GPU** (AMD, NVIDIA, or Intel) recommended for GPU-accelerated deck generation
  - CPU fallback is automatic — no GPU required, but generation takes ~5 minutes with the 7B model
- 📦 A model `.gguf` file placed in `%APPDATA%\mtg-collection-frontend\models\` (see below)

> **No Ollama required.** The app bundles `llama-server` (llama.cpp Vulkan) and starts it automatically on launch.

---

## 🤖 1. Choose & Install a Model

Three model files are available. Pick one based on your hardware:

| Model | File | Download Size | Min GPU VRAM | Best For |
|---|---|---|---|---|
| **Mistral 7B** *(default)* | `mistral-commander-q4.gguf` | ~4.1 GB | 6 GB (or CPU-only) | Most users, laptops, 8 GB VRAM cards |
| **Nemo 12B Q3** | `mtg-commander-nemo-q3_k_m.gguf` | ~6 GB | 8 GB VRAM | Mid-range GPUs (RX 5700, RTX 3070+) |
| **Nemo 12B Q4** | `mtg-commander-nemo-q4_k_m.gguf` | ~7.5 GB | 10 GB VRAM | High-end GPUs (RX 6800+, RTX 3080+) |

**Download links:**
- Mistral 7B: [huggingface.co/SaltyNumba1/MTG-Commander-Mistral-7B-Trained](https://huggingface.co/SaltyNumba1/MTG-Commander-Mistral-7B-Trained)
- Nemo 12B (Q3 & Q4): [huggingface.co/SaltyNumba1/Mistral-nemo-12B-MTG-Commander](https://huggingface.co/SaltyNumba1/Mistral-nemo-12B-MTG-Commander)

### 📥 Install Steps

1. **Download** your chosen `.gguf` file from the links above.
2. **Place it** (without renaming) in:
   ```
   C:\Users\<you>\AppData\Roaming\mtg-collection-frontend\models\
   ```
3. **Select it** — open `model-select.env` in the same folder (auto-created on first launch) with any text editor and uncomment the matching line:
   ```
   # Uncomment ONE line:
   MODEL_FILE=mistral-commander-q4.gguf
   # MODEL_FILE=mtg-commander-nemo-q3_k_m.gguf
   # MODEL_FILE=mtg-commander-nemo-q4_k_m.gguf
   ```
   Save the file and (re)launch the app.

> 💡 **GPU note:** The bundled `llama-server` uses Vulkan and works on AMD, NVIDIA, and Intel GPUs automatically. NVIDIA users: Vulkan is functional but a CUDA-optimized release is planned for better NVIDIA performance. Without a GPU the app falls back to CPU inference (~5 min for 7B model on most laptops).

---

## 🚀 2. Run the App

1. Open `MTG Commander Generator.exe`.
2. A **splash screen** appears while the AI model and backend start up — this takes 15–90 s depending on your model size and GPU.
3. Once the main window opens, the nav bar shows 🟢 **AI Ready (GPU)** when the model is loaded.
4. Import your collection and build decks.

That is all most users need.

---

## 📂 Importing Your Collection

The app accepts CSV exports from:

| Source | How to export |
|---|---|
| **Moxfield** | Collection → Export → CSV |
| **Archidekt** | Collection → Export → CSV |
| **ManaBox** | Collection → top-right menu → Export CSV |
| **Generic** | Any CSV with a `name` column (optional `quantity` column) |

---

## 🧠 Building a Deck

1. Import your collection on the **Collection** page.
2. Go to the **Build Deck** page.
3. Select a commander — only legendary creatures from your collection are shown.
4. Describe the deck you want, for example:
   - *"Aggressive token swarm with anthem effects"*
   - *"Control deck focused on counterspells and card draw"*
   - *"Combo deck that wins through infinite mana loops"*
5. Click **Generate Deck**. The engine filters your collection by color identity and Commander legality, then the AI selects the best 99 cards.
6. Export the finished decklist as a `.txt` file (compatible with Moxfield and Archidekt import).

Defaults:
- 🌿 Basic lands: **25**
- 🗺️ Nonbasic lands: **12**

💰 The builder shows an **estimated deck cost** using available TCG pricing data.

---

## 🗃️ Collection Features

- 📥 **Import Deck** modal can save directly to **My Decks** and supports an optional deck name.
- 🎨 **Color filter** includes a **Colorless** option for non-colored cards.
- ✅ Use card checkboxes plus **Save Selected as Deck** to create a manual deck from your collection.
- 💾 Backup/restore uses a safer SQLite backup flow for more complete backups.

---

## v1.3.1 — My Decks Stats Panel & Swap-Select UX

### ⚡ What's New

- **Mana Curve, Color Distribution & Lands panel** — appears above the sort selector whenever a deck is open in My Decks. The mana curve shows non-land cards bucketed 0–7+; the color bar chart shows color distribution by color identity; the lands card shows basic vs nonbasic counts. Same visual style as the Deck Builder result.
- **Swap-select mode fixes** — the "🔄 Selecting…" button now reverts instantly when you click **Find Substitutes** rather than staying active for the full 30-second AI call.
- **Hint bar** — when swap-select mode is active with no cards selected, a dashed hint prompts you to click cards before clicking Find Substitutes.

---

## v1.3.0 — Global Settings Hook & Rename Decks

### ⚡ What's New

- **Global `useSettings` hook** — all pages share a single source of truth for user preferences stored in `localStorage`. Previously each page read settings independently.
- **Expanded Settings page** — new sections for Deck Building Defaults (land counts, bracket, strict mode, tapped land cap) and Display (price visibility, default sort order). The GPU Performance section remains. All changes take effect immediately.
- **Rename saved decks** — click the pencil icon on any deck card in My Decks to rename it. The JSON file on disk is updated via `PATCH /deck/saved/{deck_file}` with path traversal protection.

---

## v1.0.17.4 — Commander Bracket Ratings, Collection Color Counter & UX Polish

### ⚡ What's New

- **Commander Bracket Rating** — every generated and saved deck is automatically scored on WotC's 2025 Bracket system (1 Exhibition → 5 Competitive/cEDH). Badge shown on the deck builder result and every saved deck in My Decks.
- **Target Bracket** — optional power-level dropdown in the deck builder (No preference / 1 Exhibition / 2 Core / 3 Upgraded / 4 Optimized / 5 Competitive). Injects a directive into the AI prompt. Always a soft hint — the app only ever picks from cards you own.
- **Collection color counter** — stat bar below the keyword filters shows how many unique non-land cards in your collection fit the selected commander's color identity. Updates instantly when commander changes.
- **Splash screen logo** — app logo now renders correctly on all systems (fixes broken image caused by spaces in Windows paths).
- **Nav bar cleanup** — removed emoji from the nav bar title.

---

## v1.0.17.3 — Adaptive GPU Retry & CPU Fallback

### ⚡ What's New

- **Adaptive GPU layer retry** — on startup, llama-server is launched with progressively fewer GPU layers until it succeeds:
  1. `--n-gpu-layers 99`
  2. `--n-gpu-layers 60`
  3. `--n-gpu-layers 40`
  4. `--n-gpu-layers 20`
  5. `--n-gpu-layers 0` (CPU fallback)
- **OOM detection** — the app reads the tail of `llama-server.log` to detect out-of-memory failures and decides when to step down to the next tier.
- **Parallel startup preserved** — backend startup continues in parallel while adaptive retries complete; no regression in startup speed on healthy hardware.
- **Correct health polling order** — startup wait logic now awaits adaptive llama initialization before beginning health polls.

### Why This Matters
Laptop GPUs and systems with limited free VRAM could previously fail silently when `--n-gpu-layers` was too high, leaving the app unable to start. The app now steps down automatically until the model loads — even falling back to CPU if needed.

### Validation
Confirmed expected step-down behavior on constrained VRAM hardware:
- 99 layers → OOM
- 60 layers → OOM
- 40 layers → OOM
- 20 layers → OOM
- 0 layers (CPU) → model loads, `/health` reports ready

---

## v1.0.17.2 — UX Polish, Commander Bracket Rating & Collection Color Counter

### ⚡ What's New

- **Commander Bracket Rating** — every generated and saved deck is automatically scored on WotC's 2025 Bracket system (1 Exhibition → 5 Competitive/cEDH). The badge appears on the deck builder result and on every saved deck in My Decks. Scoring is based on Game Changers, strong tutors, combo enablers, extra turn spells, and mass land denial.
- **Target Bracket** — optional power-level selector in the deck builder (No preference / 1 Exhibition / 2 Core / 3 Upgraded / 4 Optimized / 5 Competitive). Injects a detailed directive into the AI prompt. This is a soft hint — the deck is always built from cards you own, so results reflect your actual collection.
- **Collection color counter** — stat bar between the keyword filters and the Deck Constraints panel shows how many unique non-land cards in your collection fit the selected commander's color identity. Updates instantly when you change commander.
- **Splash screen logo** — app logo now displays correctly on the loading splash screen.
- **Nav bar cleanup** — removed emoji from nav bar title.

---

## v1.0.17 — Startup UX, AI Status Badge & First-Launch Setup

### ⚡ What's New

- **Splash screen** — branded loading window with progress bar appears instantly on launch. No more blank window while the AI model loads.
- **Ordered startup** — llama-server starts first (model load takes 10–90 s for 12B), backend starts in parallel, main window opens only when both are ready.
- **120-second model wait** — polls `llama-server` health up to 2 minutes with a live elapsed timer; accommodates the slower Nemo 12B load time.
- **AI status badge** — nav bar shows live model state: 🟢 GPU, 🟡 CPU (with generation time warning), 🔴 Offline (with install path). Updates every 5 s.
- **First-launch setup modal** — walks new users through GGUF download with model comparison table, HF links, and one-click copy of the install path. Shown once, never again.
- **Clean exit** — `taskkill /F /T` terminates the entire PyInstaller backend process tree; llama-server handle retained for direct kill. No orphaned processes.
- **`GET /health/llama`** — new backend endpoint proxies the llama-server health check, keeping all status polling on a single API origin.

---

## v1.0.14 — AMD GPU Acceleration (llama.cpp Vulkan)

### ⚡ What's New

- **Bundled `llama-server`** — `llama-server.exe` and all required Vulkan DLLs ship inside the app. No Ollama installation required.
- **GPU inference** — tested on AMD RX 5700: 7.5/8.0 GB VRAM used. Deck generation runs entirely on the GPU.
- **Faster prefill** — `--batch-size 2048` processes large card-list prompts faster.
- **20 480 token context** — handles large collections without truncation.
- **Diagnostic log** — `llama-server` output written to `%APPDATA%\mtg-collection-frontend\llama-server.log`.

### 📁 Data Location (v1.0.11+)

Your collection database, saved decks, and model are stored in:

```
C:\Users\<you>\AppData\Roaming\mtg-collection-frontend\
  mtg_collection.db
  saved_decks\
  models\model.gguf
  llama-server.log
```

This folder persists across upgrades. If upgrading from v1.0.10 or earlier, copy your existing `saved_decks\` JSON/TXT pairs into this folder to restore your decks.

---

## My Decks Features

- **Analyze & Suggest Improvements** now calls the backend and returns AI suggestions.
- Exported decklists include explicit commander marking for better Moxfield compatibility.

---

## Help Page

A built-in **Help** page is available in the top navigation with quick how-to guidance for import, deck building, manual deck saving, and backup/restore.

---