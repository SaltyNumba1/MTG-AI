<img width="1024" height="1024" alt="icon" src="https://github.com/user-attachments/assets/676307dc-9ec3-4626-9561-6cecaa6ed368" />
# 🃏 DeepBrew — MTG Collection & Deck Builder

**v1.4.2** | [Download at deepbrewmtg.com](https://deepbrewmtg.com)

Build Commander decks from your own collection using a **fully local AI model** — no cloud, no subscription, no Ollama. Your cards and your data stay on your machine.

---

## ✅ Requirements

- 🪟 Windows 10/11 x64
- 🖥️ A **Vulkan-capable GPU** (AMD, NVIDIA, or Intel) recommended for GPU-accelerated deck generation
  - CPU fallback is automatic — no GPU required, but generation takes ~5 minutes

> **No Ollama required.** The app bundles `llama-server` (llama.cpp Vulkan) and starts it automatically on launch.

---

## 🚀 Getting Started

1. **Download** the correct edition from [deepbrewmtg.com](https://deepbrewmtg.com):
   - **Starter** — Mistral-7B engine, Brackets 1–3, $15
   - **Pro** — Nemo-12B engine, Brackets 1–5 (cEDH), $49
2. **Extract** the zip and run `DeepBrew-Starter.exe` or `DeepBrew-Pro.exe`.
3. On **first launch**, enter your license key. The correct AI model (~4–7.5 GB) downloads automatically with a live progress bar — no manual file placement needed.
4. Once the main window opens, the nav bar shows 🟢 **AI Ready (GPU)** when the model is loaded.

> 💡 **GPU note:** The bundled `llama-server` uses Vulkan and works on AMD, NVIDIA, and Intel GPUs automatically. Without a GPU the app falls back to CPU inference.

---

## 🤖 Model Reference (for developers)

| Tier | Model | File | Size | Min VRAM |
|---|---|---|---|---|
| Starter | Mistral 7B Q4 | `mistral-commander-q4.gguf` | ~4.1 GB | 6 GB (or CPU) |
| Pro | Nemo 12B Q3 | `mtg-commander-nemo-q3_k_m.gguf` | ~6 GB | 8 GB |
| Pro | Nemo 12B Q4 | `mtg-commander-nemo-q4_k_m.gguf` | ~7.5 GB | 10 GB |

Models are downloaded automatically to `%APPDATA%\DeepBrew-[Starter|Pro]\models\` on first launch.

---

## 🏃 Run the App

1. Open `DeepBrew-Starter.exe` or `DeepBrew-Pro.exe`.
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

## v1.4.2 — AI Quality & Reliability

### 🧠 Engine Improvements

- **Functional-role tagging** — the deck engine now tags each card with up to 3 roles (`[draw]`, `[ramp]`, `[removal]`, `[wipe]`, `[bounce]`, `[token]`, `[counter]`, `[tutor]`, `[recursion]`, `[copy]`, `[proliferate]`, `[anthem]`, `[protection]`) derived from oracle text. These tags are included in the AI prompt so the model understands what each card *does*, not just what it's named.
- **Two-tier card summaries** — filler slots receive a compact `Name | Type | CMC | keywords | [tags]` summary; synergy candidates receive the full first oracle sentence for richer context.
- **`{x}` mana cost filtering** — `mana_cost` is now included in the text search blob, so typing `{x}` in any keyword or constraint field correctly filters for X-cost spells.
- **Anti-hallucination system prompt** — the AI is now instructed to output a plain-text numbered card list only (no JSON, no markdown). Card names must be copied verbatim from the Available Cards list.
- **Retry on low match count** — if the AI's first response matches fewer than 10 cards from the candidate list, the engine automatically retries at temperature=0.1 with the top-200 candidates. Only the better result is kept.
- **Robust JSON parser** — `extract_json` no longer raises on malformed output. It handles the `{"description":"Card Name","quantity":1}` hallucination format, and returns a `_parse_failed` sentinel as a last resort so deck generation always completes.
- **Garbled deck description fix** — model preamble (numbers, symbols, JSON fragments) that appeared before the card list was being stored as the deck description. The parser now discards any preamble that contains no real English words.

---

## v1.4.1 — Bug Fixes & Polish

### 🐛 Bug Fixes

- **Backup path in success message** — `POST /collection/backup` now returns the full path. Frontend shows "Backup saved to: C:\Users\...\AppData\Roaming\DeepBrew\backups\..." so users know exactly where the file is.
- **Backup dropdown auto-select** — after creating a backup the dropdown immediately selects the new entry instead of staying on the previously selected one.
- **PyInstaller crash on launch** — `ModuleNotFoundError: No module named 'openai'` on first run after install. Fixed by using `collect_all('openai')`, `collect_all('httpx')`, `collect_all('httpcore')` in the PyInstaller spec to fully bundle openai v2.x's dynamic import tree.

### ✨ Improvements

- **🎨 Art button moved** — in Collection, the art/printing switcher button moved from the bottom row (near × Remove) to a top-right hover overlay on the card image, matching the 🖼 background button at top-left.

---

## v1.4.0 — Commercial Launch: License Keys & Auto Model Download

### ⚡ What's New

- **License-key activation** — on first launch, users enter their LemonSqueezy license key. The app validates it with the DeepBrew API, stores the activation locally, and unlocks the correct tier.
- **Automatic model download** — after activation, the correct `.gguf` model downloads automatically with a live progress bar and SHA-256 integrity check. No manual file placement required.
- **Two tiers** — Starter (Mistral-7B, Brackets 1–3) and Pro (Nemo-12B, Brackets 1–5 including cEDH).
- **Pro upgrade path** — existing Starter users can purchase an upgrade license for $40; the Pro model downloads in-place.
- **Inline card removal in My Decks** — each card tile in edit mode now has an inline × Remove button. Cards are removed immediately without any extra confirmation step.

---

## v1.3.2 — Bug Fixes & Constraint Improvements

### 🐛 Bug Fixes

- **Deck import (.txt) fix** — importing a `.txt` decklist no longer throws "Import failed" when cards are missing from your collection. Scryfall fetch errors are now caught per-card and a database commit is issued at the end so all successfully fetched cards are persisted.
- **Create Backup fix** — the backup button was silently doing nothing (missing `shutil.copy2` call). Backups are now correctly written to the `backups/` folder next to the database.
- **Power/Toughness constraint fix** — `match_field: power` and `match_field: toughness` now compare actual integer card stats instead of searching oracle text. Supports `4+`, `>=4`, `>3`, `<=2`, `<4`, and exact integers. The auto-detected "Power ≥4 creatures" suggestion is also corrected.
- **Max constraint enforcement fix** — when no valid replacement cards exist in the pool, cards exceeding a `max_count` ceiling are now removed from the deck (previously left in silently).

### ✨ New Features

- **Add to Deck** — a new **Add to Deck** button in the Collection bulk toolbar opens a modal to append selected cards to any saved deck's Mainboard or Sideboard.
- **Power / Toughness constraint field** — the Field dropdown in the DeckBuilder constraint panel now includes Power and Toughness, with placeholder hints for the supported syntax (`4+`, `>3`, `>=5`, etc.).

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

## v1.2.0 — GPU Settings, Select to Swap, Sideboard & Type Chips

### ⚡ What's New

- **GPU Settings page** — a new Settings page exposes two performance controls: oracle-text threshold (how many candidates before compact mode engages) and max tokens per LLM call. Persisted to `localStorage`; applied to every deck build.
- **Select to Swap** — in My Decks analyze view, toggle **Select to Swap** mode to click individual cards you want replaced. The AI then returns targeted substitution suggestions for those specific cards.
- **Sideboard** — My Decks deck view and edit mode now includes a sideboard section.
- **Type filter chips** — deck builder card-type filters redesigned from a dropdown to toggle chips.
- **Compact candidate mode** — cards beyond the oracle-text threshold are sent to the LLM in an abbreviated `name + type` format, reducing prompt token usage on large collections.

---

## v1.1.1 — Analyze Timeout Removed

### ⚡ What's New

- **No more analyze timeouts** — the hard 900-second wall-clock timeout on LLM calls has been removed entirely. `OLLAMA_MAX_GENERATION_SEC`, `OLLAMA_TIMEOUT`, and `ALLOW_LLM_TIMEOUT_FALLBACK` constants are gone. The heartbeat reporter (every 8 s) is kept so elapsed time still displays. On failure the backend raises a clear exception instead of silently returning nothing.

---

## v1.1.0 — Renamed to DeepBrew

### ⚡ What's New

- **App renamed to DeepBrew** — executable and window title changed from "MTG Commander Generator" to **DeepBrew**.
- **Dynamic splash version** — splash screen reads the version from `package.json` so it always reflects the current release.

---

## v1.0.19 — UI Polish

### ⚡ What's New

- **Land counter inputs restyled** — basic/nonbasic/dual land inputs on the Deck Builder page updated visually.
- **Constraint inputs darkened** — deck constraint panel inputs use a darker background for better contrast.
- **Splash fullscreen fix** — splash window now fills the screen correctly on all display configurations.

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
