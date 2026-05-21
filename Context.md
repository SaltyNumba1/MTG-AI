[Update: May 21, 2026]

## Current State — v1.4.2

### Version
- **v1.4.2** — AI quality & reliability improvements on top of v1.4.1.

### Changes in v1.4.2
- **Functional-role tagging (`_TAG_PATTERNS`)**: 13 regex patterns tag each card with up to 3 roles (draw, ramp, removal, wipe, bounce, token, counter, tutor, recursion, copy, proliferate, anthem, protection) extracted from oracle text. Tags are embedded in the AI prompt.
- **Two-tier card summaries**: `card_summary(card)` — compact `Name | Type | CMC:X | keywords | [tags]` for filler slots. `card_summary_full(card)` — appends the first oracle sentence (up to 120 chars) for synergy candidates. `_first_oracle_sentence()` strips reminder text and mana symbols before extracting.
- **`mana_cost` in text blob**: `_card_text_blob` and `_card_matches_keywords` now include `mana_cost` so `{x}` keyword/constraint searches correctly match X-cost spells.
- **`extract_json` robustness**: No longer raises on parse failure. Added a `{"description":"Card Name","quantity":N}` hallucination-format parser. Returns `{"_parse_failed": True}` sentinel as last resort. Deck generation always completes.
- **`_build_deck_selection` returns `(selected, ai_matched)` tuple**: `ai_matched` tracks how many of the AI's choices mapped to real candidates (via index and name-match paths).
- **Retry logic**: When `ai_matched < 10` after first LLM call, engine retries at temperature=0.1 with top-200 candidates and a simplified prompt. Adopts retry result only if it produces more matches.
- **Anti-hallucination system prompt**: AI instructed to output a plain-text numbered list only (`1 Card Name` per line). No JSON, no markdown. Card names must be copied verbatim from the Available Cards list.
- **Garbled deck description fix**: `_extract_numbered_card_indices` now discards any captured preamble that is longer than 120 chars or contains no 4-letter English words, preventing model garbage from being stored as the deck description.

---

[Update: May 18, 2026]

## Current State — v1.4.1

### Version
- **v1.4.1** — bug fixes and polish on top of v1.4.0 commercial launch.

### Changes in v1.4.1
- **Backup path in success message**: `POST /collection/backup` now returns `{ backups: [...], backup_path: "..." }`. Frontend displays the full path in the "Backup saved to: ..." success toast so users know exactly where their backup is.
- **Backup dropdown auto-select**: After creating a backup, the dropdown immediately selects the newly created backup (was previously stuck on whatever was previously selected).
- **🎨 Art button moved**: In `CardPreview.tsx`, the 🎨 Art button moved from the bottom `card-hint-row` (near the × Remove button) to a top-right hover overlay on the card image — matching the 🖼 background button at top-left. Both fade in on card hover.
- **PyInstaller crash fix**: App was crashing on launch with `ModuleNotFoundError: No module named 'openai'`. Fixed by always using `.venv\Scripts\python.exe` for PyInstaller builds, and using `collect_all('openai')`, `collect_all('httpx')`, `collect_all('httpcore')` in `mtg-collection.spec` to fully bundle the openai v2.x package tree.

---

[Update: May 17, 2026]

## Current State — v1.4.0

### Version
- **v1.4.0** — full commercial launch. License-key activation + auto model download for both Starter and Pro tiers.

### Changes in v1.4.0
- **FirstLaunchModal rewrite**: Replaced static HF download table with a 3-step Electron license flow (`enter-key` → `downloading` → `done`). Starter users enter their license key, which is validated via `window.deepbrew.activateLicense()`, then `mistral-commander-q4.gguf` downloads automatically with a live progress bar. Dev/browser fallback (static HF table) preserved for `!window.deepbrew` path.
- **My Decks inline card removal**: Each mainboard card tile in edit mode now has an inline `× Remove` button. Cards are removed immediately from the deck state and `deckModified` is flagged.
- **`desktop:package:all` script**: New convenience script in `package.json` that runs `desktop:package:starter` then `desktop:package:pro` in sequence.
- **electron-main.js ipcMain handlers**: All license/model handlers fully implemented — `get-machine-id`, `get-license-status`, `activate-license`, `download-model` (streaming with progress events + SHA-256 validation), `set-active-model`.
- **preload.js contextBridge**: Exposes `getMachineId`, `getLicenseStatus`, `activateLicense`, `downloadModel`, `onDownloadProgress`, `setActiveModel`, `tier`.
- **LicenseModal.tsx**: Pro tier license activation + model selection (Q3/Q4) + download flow. Fully complete.
- **MODEL_TIER_HASHES**: Real SHA-256 fingerprints baked into `electron-main.js` for all three model files.

---

[Update: May 17, 2026]

## Current State — v1.3.2

### Version
- **v1.3.2** — bug fixes + constraint improvements on top of v1.3.1.

### Changes in v1.3.2
- **Deck import fix**: `import_deck` in `routes/deckbuilder.py` now wraps each `upsert_card` call in `try/except` and calls `commit_with_retry` before returning. Importing a `.txt` decklist no longer fails when cards need to be fetched from Scryfall.
- **Create Backup fix**: `create_backup` in `routes/collection.py` now calls `shutil.copy2(db_path, backup_path)` — the call was previously missing.
- **Power/Toughness constraint**: `_card_matches_constraint` in `deck_engine.py` has a new `elif field in ("power", "toughness"):` branch that parses the card's actual stat as an integer and supports `4+`, `>=4`, `>3`, `<=2`, `<4`, and exact-int matching. Non-numeric stats (`*`, `X`) return False.
- **`_analyze_commander_profile` fix**: power ≥4 commander suggestion changed from `match_field="oracle_text"`, `match_value="power 4"` → `match_field="power"`, `match_value="4+"`.
- **Max constraint enforcement fix**: In `_enforce_constraints`, when `replacements_pool` is empty, evicted cards are set to `None` then filtered — they are now actually removed from the deck instead of left in silently.
- **Add to Deck (frontend)**: New button + modal in `Collection.tsx`. Fetches `GET /deck/saved`, lets user pick a deck and destination (mainboard/sideboard), then `GET /deck/saved/{file}` + merges cards + `PUT /deck/saved/{file}`.
- **Power/Toughness in constraint dropdown**: `DeckBuilder.tsx` custom constraint `<select>` now includes `power` and `toughness` options with a dynamic placeholder showing the correct syntax.

---

[Update: May 13, 2026]

## Commercial Roadmap — v1.4.0 (in progress)

### Summary
Full commercial launch roadmap defined. App transitions from open-source to a tiered one-time-purchase desktop product. HF repos will go private on launch. Implementation of Phases 1–4 has begun.

### Pricing (final, locked)
| Tier | Price | Upgrade Path | Model |
|---|---|---|---|
| Starter | $15 | — | Mistral 7B Q4 (B1–B3 only) |
| Pro | $49 | $40 upgrade from Starter | Nemo 12B Q3 + Q4 (B1–B5 + lean pool + thought stream) |
| Titan | future ~$79 | — | 35B+ fine-tune (not yet trained) |

**Upgrade framing:** Starter→Pro upgrade is $40 (not $49) because the user already has the 7B model. They end up with both models — total $55 for two, vs $49 Pro-only. Market this as "two tools for $55."

**Do NOT split Q3 vs Q4 into separate tiers.** The quality delta (~2-3%) does not justify a price step. Both quantizations are included in Pro. The `model-select.env` system already handles selection. Q3 is for 8 GB VRAM GPUs; Q4 for 10–12 GB.

**Titan tier** is reserved for a genuine 35B+ model fine-tune. Do not launch it on a quantization difference.

### Tier enforcement (three-layer security)
1. **Build-time constant** (`DEEPBREW_TIER` injected via `vite.config.ts` `define` at `npm run desktop:package` time). Baked into the JS bundle — cannot be changed by editing files on disk. Two separate build scripts produce two different binaries.
2. **Backend feature gate** (`deck_engine.py` rejects `target_bracket >= 4` requests if `DEEPBREW_TIER != 'pro'`). Blocks Postman/API exploitation even if someone hacks the frontend.
3. **Model hash gate** (`electron-main.js` checks partial SHA-256 of loaded `.gguf` against a hardcoded tier map at startup). Blocks model file swapping — a Starter build refuses to start with a Pro model file.

### Commercial distribution (no persistent server needed)
- Products sold via Gumroad / LemonSqueezy — three SKUs: Starter, Pro, Starter→Pro Upgrade
- License key validation via **Cloudflare Worker** (serverless, ~$0/month)
- Model files delivered as **24-hour presigned R2/S3 URLs** — never a static link, cannot be shared
- `FirstLaunchModal.tsx` replaces static HF links with an in-app license-key input that triggers the download

### UI: Bracket tile upsell
- Bracket selector replaced with six clickable tile buttons (B0/Any through B5)
- B4 and B5 tiles are **greyed out** (opacity 0.4, cursor: not-allowed) in Starter builds
- Purple `PRO` badge on each locked tile
- Clicking a locked tile opens an upgrade modal: *"Upgrade to Pro for $40 → deepbrew.io/upgrade"*
- Hiding is NOT used (upsell opportunity). The guard is state-level + backend, not visual.

### Engine changes (v1.4.0)
- **Synergy-VIP handshake**: `resolve_synergies()` moved to top of `generate_deck()` (before VIP injection). VIPs that are also Game Changers AND match expanded keywords are flagged as "High-Priority Injection" (guaranteed must-include). Others are scored but not force-injected.
- **Thought Stream log**: `progress_callback` emits `[DEEPBREW_LOG]: Synergy Analysis | Identified {archetype} patterns. Prioritizing matching staples.`
- **`_build_lean_pool()`**: For B4/B5, pre-filters the candidate pool using `Score = (is_vip * 100) + (is_synergy * 50) - (CMC * 10)`. Hard-excludes non-land CMC>4 cards that match no keyword. Returns top 500. Applied in `generate_deck()` before `build_deck_with_llm`.

### Key new/changed files for v1.4.0
| File | Change |
|---|---|
| `frontend/vite.config.ts` | Added `define: { __DEEPBREW_TIER__ }` |
| `frontend/src/global.d.ts` | Added `declare const __DEEPBREW_TIER__` |
| `frontend/package.json` | Added `desktop:package:starter` and `desktop:package:pro` scripts; added `cross-env` devDependency |
| `frontend/electron-main.js` | Passes `DEEPBREW_TIER` env var to backend spawn; future: model hash gate |
| `backend/services/deck_engine.py` | Backend feature gate; synergy-VIP handshake; `_build_lean_pool()` |
| `frontend/src/pages/DeckBuilder.tsx` | Bracket tile row (replaces `<select>`); upgrade modal |
| `frontend/src/pages/DeckBuilder.css` | Bracket tile styles |
| `frontend/src/components/FirstLaunchModal.tsx` | License-key download flow (Phase 6, not yet started) |

### What is NOT in v1.4.0
- Model hash gate (Phase 3) — needs actual SHA-256 values from built `.gguf` files; add before first commercial release
- License-key / presigned URL download flow (Phase 6) — requires Cloudflare Worker + R2 setup
- Titan tier — no model trained yet; placeholder pricing only
- DPO pass on preference pairs — deferred post-launch

---

[Update: May 12, 2026]

## Current State — v1.3.1

### Version
- **v1.3.1** — committed and tagged on `main`. Frontend packaged at `C:\Temp\MTGPkg\DeepBrew-win32-x64` and `frontend/release/DeepBrew-win32-x64`.

### Architecture (current)
- **Backend**: FastAPI, SQLAlchemy async, SQLite (aiosqlite), uvicorn port 8000. Packaged to `backend/dist/mtg-collection.exe` via PyInstaller (`package_standalone.bat`).
- **LLM**: Bundled `llama-server` (llama.cpp Vulkan), port 8081, OpenAI-compatible `/v1` API, adaptive GPU-layer retry (99→60→40→20→0), `timeout=None`.
- **Frontend**: React 18 + TypeScript, Vite, Electron desktop wrapper, React Router v6, Axios via `api` instance. Packaged with `npm run desktop:package`.

### Key files
| File | Purpose |
|---|---|
| `frontend/src/hooks/useSettings.ts` | Central source of truth for all 10 `deepbrew_*` localStorage settings. Exports `useSettings()`, `readSettings()`, `SETTINGS_DEFAULTS`. |
| `frontend/src/pages/Settings.tsx` | Three-section settings page: GPU Performance, Deck Building Defaults, Display. Uses `useSettings`. |
| `frontend/src/pages/DeckBuilder.tsx` | Commander selection, deck generation, bracket targeting. All settings via `useSettings`. |
| `frontend/src/pages/MyDecks.tsx` | View/edit/analyze/rename saved decks. Stats panel (mana curve, color dist, lands). Swap-select UX fix applied. |
| `backend/routes/deckbuilder.py` | FastAPI routes for deck building, saving, analyzing. `PATCH /saved/{deck_file}` rename endpoint with path traversal protection. |
| `backend/services/deck_engine.py` | Core deck generation, LLM call, bracket engine, rebalancing. |

### v1.3.1 changes
- **My Decks stats panel**: Mana Curve, Color Distribution, Lands (basic/nonbasic) shown above sort selector when a deck is open.
- **Swap-select UX fix**: `setSwapSelectMode(false)` now fires at the start of `handleAnalyze` (before the 30 s API call) instead of only in the `finally` block.
- **Hint bar**: Shown when swap-select mode is active with no cards selected yet.

### v1.3.0 changes
- **`useSettings` hook**: All pages use one source of truth for 10 settings keys.
- **Expanded Settings page**: Deck Building Defaults + Display sections added.
- **Rename decks**: Pencil icon in My Decks, `PATCH /deck/saved/{deck_file}` backend endpoint.

### v1.2.0 changes
- **GPU Settings page**: New Settings page with oracle-text threshold (compact candidate mode) and max-tokens controls, persisted to `localStorage`.
- **Select to Swap**: In My Decks analyze view, toggle swap-select mode to pick specific cards for AI substitution suggestions.
- **Sideboard**: My Decks deck view/edit now includes a sideboard section.
- **Type filter chips**: Deck Builder card-type filters redesigned as toggle chips.
- **Compact candidate mode**: Cards beyond the oracle-text threshold sent to LLM as abbreviated `name + type` format to reduce prompt token usage.

### v1.1.1 changes
- **Analyze timeout removed**: Hard 900 s wall-clock limit on LLM calls deleted entirely. `OLLAMA_MAX_GENERATION_SEC`, `OLLAMA_TIMEOUT`, `ALLOW_LLM_TIMEOUT_FALLBACK` constants and Electron env injections removed. Backend now raises clear exceptions on failure.

### v1.1.0 changes
- **App renamed to DeepBrew**: Executable and window title changed from "MTG Commander Generator" to DeepBrew.
- **Dynamic splash version**: Splash screen reads version from `package.json` at runtime.

### v1.0.19 changes
- Land counter inputs restyled in Deck Builder.
- Constraint panel inputs darkened for better contrast.
- Splash screen fullscreen fix.

### Build / release pipeline
1. `cd backend && .\package_standalone.bat` → `backend/dist/mtg-collection.exe`
2. `cd frontend && npm run desktop:package` → Electron package at `C:\Temp\MTGPkg\DeepBrew-win32-x64`, robocopy'd to `frontend/release/DeepBrew-win32-x64`
3. `git add -A && git commit -m "..." && git tag vX.Y.Z`

---

[Update: April 20, 2026]
Resolved Issues: * Successfully implemented streaming (stream: true) for Ollama API requests to act as a TCP heartbeat, preventing 5-minute idle timeouts.

Configured OLLAMA_KEEP_ALIVE=-1 to ensure the Mistral model stays loaded in VRAM between chunked processing tasks.

Migrated network/fetch logic to the Main Process to avoid Electron UI thread throttling.

Current Focus: * Moving from simple "chunk processing" to intelligent deck synthesis.

Implementing a synergy-mapping system where keywords (e.g., "Sacrifice," "Blink") are matched against a JSON synergy database.

Strategy directives are now being injected into prompts to force the model to prioritize synergy partners during the deck-building process.

Next Implementation Steps:

Finalize the synergy_map.json structure.

Create the "Strategy Directive" generator in the backend to ensure keywords from the CSV match the synergy requirements before prompt construction.
---

## Update — 2026-04-23 (v1.0.8)

### Architecture overview
- **Backend**: FastAPI (`mtg-collection/backend/`), packaged to a single Windows exe via PyInstaller (`package_standalone.bat`).
  - Routers: `routes/collection.py` (CSV/text/manual import, bulk ops, backups), `routes/deckbuilder.py` (deck generation, save/load, analyze), and supporting Scryfall service in `services/scryfall.py`.
  - Deck generation engine: `services/deck_engine.py`. Calls a local Ollama LLM (default model configured at runtime, e.g. `llama3`) to choose card indices from a pre-filtered candidate list, then post-processes for land targets, must-include cards, and quality rebalancing.
  - Persistence: SQLite via SQLAlchemy async (`database.py`). `mtg_collection.db` lives next to the exe (CWD anchored, so it survives upgrades). Saved decks live in `saved_decks/` next to the exe (frozen-aware path, fixed in v1.0.7).
- **Frontend**: React + Vite + TypeScript (`mtg-collection/frontend/`), packaged with electron-packager into `release/MTG Collection-win32-x64/`.
  - Pages: `Collection.tsx` (filters, imports, bulk ops), `DeckBuilder.tsx` (commander selection, prompt, land/dual counters, must-includes, generation), `MyDecks.tsx` (list, sort, view, analyze).
  - Per-page CSS files (`Collection.css`, `DeckBuilder.css`, `MyDecks.css`, `Help.css`, `CardPreview.css`) - inline `style` props are progressively being moved out.

### Build / release pipeline
1. `cd backend && .\package_standalone.bat` -> `backend/dist/mtg-collection.exe`
2. `cd frontend && npm run desktop:package` -> packages frontend and copies the backend exe into `release/MTG Collection-win32-x64/resources/backend/dist/`.
3. Electron main process (`frontend/electron/main.cjs`) spawns the backend exe on launch.
4. Zip the release folder and publish via `gh release create vX.Y.Z` against the GitHub repo.

### How the deck-generation pipeline pulls data
- `collection` rows are loaded from SQLite, filtered for cards legal in the commander's color identity.
- Candidates that match user keyword filters and must-include names are forced into the prompt list.
- The AI is asked for `99 - basic - nonbasic - dual - must_include` non-land card indices (target reduced as of v1.0.8).
- Engine then post-processes:
  - Inserts must-include cards (fetches from Scryfall if not in collection).
  - Fills basic / nonbasic / dual land targets from the collection, falling back to Scryfall basics if the collection lacks them.
  - Rebalances non-land picks for synergy / removes weak duplicates.
- Final 99-card deck + commander is returned and auto-saved as `saved_decks/<commander>_<timestamp>.json`.

### v1.0.8 changes summary
- Backend
  - `DeckRequest.dual_land_count` plumbed through `generate_deck` -> `build_deck_with_llm` -> `_apply_land_targets`.
  - New `is_dual_land(card, commander_identity)` helper (multi-color land in identity).
  - Prompt math + system prompt now ask for `99 - lands - must_includes` non-land picks.
  - New `POST /collection/import-text` endpoint (parses Moxfield-style lines, upserts into existing collection).
- Frontend
  - DeckBuilder: dual-land input, smaller commander preview, basic-land tile collapsing with `(N)` count badge, lands group rendered last in the deck list, must-includes sent in the build POST.
  - Collection: toolbar reorganized into purpose groups, filters moved above the card grid, `Import Cards from Text` button + modal (with .txt file load), circular SVG progress indicator (replaces linear bar).
  - MyDecks: sort dropdown (Name / Cost / Color / Type), Analyze modal redesigned with paired swap tiles (~288 px) and arrow.

### Known model / data sources
- Ollama runs locally; the chat completion endpoint is hit synchronously by the engine.
- Scryfall API (`services/scryfall.py`) for missing-card lookups and basic-land artwork.
- TCGplayer prices are stored per-card on import for cost summaries.

---

## 2026-04-24 05:30 UTC - v1.0.9 release + Nemo-12B retrain plan (in progress)

### v1.0.9 release (shipped)
- **Docs/distribution release** — no app code changes vs v1.0.8.
- Trained model now lives on Hugging Face: <https://huggingface.co/SaltyNumba1/mistral-commander-lora>
  - mistral-commander-q4.gguf (4.37 GB) - drop-in Q4_K_M for Ollama.
  - mistral-commander-lora.zip - raw LoRA adapter.
  - dapter_config.json - LoRA hyperparameters.
- README + mtg-collection/training/LOCAL_SETUP.md updated with HF download (Option A direct gguf, Option B merge-LoRA-in-Colab) and "Using a different base model" docs (swap via OLLAMA_MODEL env var; default is mtg-commander, set in services/deck_engine.py:21).
- HF model card drafted at mtg-collection/training/HF_MODEL_CARD.md (rename to README.md when uploading to the HF repo root).
- Released zip: MTG-Collection-v1.0.9-win32-x64.zip (146.5 MB), tag 1.0.9, GitHub release published.

### Nemo-12B retrain plan (active work, branch: main)
**Goal:** v2 model = mistral-commander-nemo, fine-tuned from mistralai/Mistral-Nemo-Instruct-2407 (12B params, **128K native context**, Tekken tokenizer ~30% better on JSON).

**Why Nemo over current Mistral-7B-v0.2:**
- 8K -> 128K context unlocks "show the model the whole collection" instead of sampling subsets.
- Tekken tokenizer is more efficient on card-list JSON.
- Smarter base = better deck quality at same dataset size.
- Trained context will be 8K (T4) / 12K (L4) / 16K (A100-40) / 16K rank-128 batch-2 (A100-80) - notebook auto-detects GPU.

**Compute budget:** Colab Pro (T4/L4 baseline, occasional A100-40 or A100-80). On A100-80 a full SFT run is ~10-15 hr single session (no QLoRA needed, bf16 LoRA rank 64-128). On T4-only it would be 40-60 hr split across sessions with Drive checkpointing.

**Tokenizer note:** Mistral-Nemo's chat template differs from v0.2's [INST]...[/INST]. Training data is emitted as OpenAI-style messages and the tokenizer applies its own template at train time, so the same dataset works for both bases.

**v1 LoRA is NOT transferable to Nemo** (different architecture). v1 stays on HF as the stable fallback.

### Dataset v3 pipeline (committed in 178089, READY TO RUN)
Three example types instead of v2's one:

| Type | Source script | Teaches |
|---|---|---|
| commander_deck | existing EDHREC + Archidekt scrapers | one-shot deckbuilding (current v1 skill) |
| card_qa | src/fetch_scryfall_qa.py (NEW) | card knowledge from oracle text |
| swap_edit | src/generate_swap_examples.py (NEW) | multi-turn editing, archetype swaps |

Merger: src/build_dataset_v3.py (NEW) - deck validation, eval split, per-bucket caps. Outputs to data/processed_v3/.

Runbook: mtg-collection/training/DATASET_V3.md - step-by-step.

**Current dataset size (v2):** 286 deck examples / 165 commanders / ~258 chat rows.
**Target v3 dataset size:** ~20-35k chat rows (5-10k decks + 10-20k QA capped + 2-5k swaps).

**User action items before training can start:**
1. Download Scryfall oracle bulk JSON (~150 MB) to mtg-collection/training/data/raw/scryfall-oracle-cards.json from <https://scryfall.com/docs/api/bulk-data>.
2. Run EDHREC expansion (commanders list at data/imports/commander_list_expanded.txt, 165 commanders) and Archidekt sampling passes per DATASET_V3.md sections 1-2.
3. Run etch_scryfall_qa.py and generate_swap_examples.py.
4. Run uild_dataset_v3.py to merge everything.

### Next deliverable (NOT yet started)
- TRAIN_NEMO.md runbook + Colab .ipynb for Mistral-Nemo-12B QLoRA/bf16 training with:
  - GPU auto-detect (T4/L4/A100-40/A100-80) -> picks QLoRA-4bit vs bf16 LoRA, context length, batch size, LoRA rank.
  - Drive checkpointing every ~250 steps for Colab disconnect resilience.
  - Merge LoRA -> full weights -> llama.cpp Q4_K_M GGUF (~7.5 GB final).
  - Smoke-test prompts against the user's real collection.
- After SFT v2 ships: optional DPO pass on ~3k preference pairs (v1 vs v2 outputs scored by deterministic legality + heuristic rules).
- App-side after v2 ships: bump default OLLAMA_MODEL to mtg-commander-nemo, ship as MTG Collection v1.1.0, keep v1 model on HF as legacy/small/fast option.

### Decision log
- User has Colab Pro for one month (with occasional A100-80 access).
- Training method choice: bf16 LoRA on A100, QLoRA-4bit fallback on T4/L4. Auto-detected by notebook.
- LoRA rank: 64 (T4/L4/A100-40), 128 (A100-80).
- Base model: mistralai/Mistral-Nemo-Instruct-2407 (NOT Mistral-Nemo-Base-2407 - we want the instruct variant for chat).
- Quantization: Q4_K_M (same as v1).
- Old v1 model stays published on HF as the stable/small fallback.


---

## 2026-05-01 — v1.0.10 UI/pipeline updates (committed, not yet released)

Commit: `74ac049` on `main`. Bundles all UI improvements + backend DB/pipeline changes since v1.0.9. Training assets (Mistral / Nemo / Gemma LoRAs, datasets, llamacpp binaries) are intentionally excluded from this commit and will live on Hugging Face instead.

### New backend endpoints
- `POST /deck/import-deck` — parse a Moxfield/Archidekt/plain-text decklist, upsert any missing cards via Scryfall, and save the result straight to My Decks. Commander detection order: explicit `Commander` / `Command Zone` section, inline `*CMDR*` marker, fallback to the first card line. **User-facing rule: commander must be at the top of the decklist AND named in the title block** for reliable imports.
- `POST /collection/import-text` — paste/upload a card list to upsert into the existing collection (additive, not replacement).
- `GET  /deck/build-status` — JSON snapshot of the current AI build (active flag, phase, message, started_at, finished_at, last_activity_at, last 50 thoughts).
- `GET  /deck/build-stream` — SSE stream of the same snapshot for live UI subscribers.
- `POST /deck/reset` — kill switch that clears `BUILD_STATUS` and unblocks a wedged generation.
- `GET  /collection/precons`, `POST /collection/import-precon`, `GET  /collection/archidekt-precons` exist in code but the precon-decklist UI was removed because there's no per-precon decklist API; treat these as dormant for now.

### New frontend pieces
- `components/BuildStatusFloater.tsx` + `BuildStatusFloater.css` — global floating panel mounted at the app root. Polls `/deck/build-status` every 2.5 s, hides itself on `/deck` (the page owns its own chat), shows phase + message + last 3 thoughts, collapsible.
- `global.d.ts` — workspace-wide TS module declarations (lets Electron preload typings live alongside Vite types without bleeding into per-file imports).
- `App.tsx` mounts the floater so build progress is visible from Collection / My Decks / Help, not just the Build Deck page.
- Collection / DeckBuilder / MyDecks / CardPreview pages received polish + the new "Import Deck" entry point.

### Backend `.env`
- `mtg-collection/backend/.env` (committed, no secrets) selects the active Ollama model and timeout. Default `OLLAMA_MODEL=mtg-commander` (Mistral 7B v1 LoRA), with commented `mtg-commander-nemo` / `mtg-commander-nemo-q3` lines for the upcoming v2. `OLLAMA_TIMEOUT=900` (15 min) covers slow CPU-only builds.

### Deck pipeline tweaks
- `services/deck_engine.py` updates feed the build-status writer (`_set_build_status`, `_append_build_thought`) so each LLM round-trip pushes a phase + message into the status snapshot.
- `services/scryfall.py` gained more lenient name lookups (split-card `A // B` fallback, retry/error reporting) which both `import-deck` and `import-text` rely on.

### Build / release pipeline (unchanged structurally)
1. `cd backend && .\package_standalone.bat` -> `backend/dist/mtg-collection.exe` (PyInstaller).
2. `cd frontend && npm run desktop:package` -> `release/MTG Collection-win32-x64/` (electron-packager copies the backend exe in).
3. The `.env` file ships next to the exe so end users can swap models without rebuilding.
4. Zip the release folder and `gh release create vX.Y.Z` against the GitHub repo.

### Decklist import format (for docs / support replies)
Accepted patterns per line: `1 Sol Ring`, `1x Sol Ring`, plain `Sol Ring`. Comments: `//`, `#`. Section headers: `Commander` / `Command Zone`, `Deck` / `Mainboard` / `Main`, `Sideboard` / `Side` / `Maybeboard` (sideboard rows are ignored). Commander detection: explicit section -> `*CMDR*` marker -> first non-section card line. **Always tell users to put the commander on line 1 and also list it in the deck title block** to guarantee correct routing.

### What is intentionally NOT in this commit
- All `mtg-collection/training/**` (Mistral, Nemo, and the new Gemma experiments, dataset v3 raw + processed JSONL, `llamacpp/` 46 MB of `.dll` / `.exe`, Scryfall oracle bulk JSON). These are reserved for the Hugging Face repo and will not be committed back to GitHub.

---

## 2026-05-06 — v1.0.13: AMD GPU acceleration via llama.cpp Vulkan

### Summary
Replaced the Ollama runtime with a bundled llama.cpp Vulkan backend (`llama-server`). The model now runs on the AMD RX 5700 GPU instead of CPU. No Ollama installation required by end users.

### Root cause of GPU non-detection (resolved)
Electron's Chromium renderer sets `VK_ICD_FILENAMES` to its own SwiftShader (CPU Vulkan) ICD path in the process environment. All child processes inherit this, causing `llama-server` to use software rendering. Fix: spawn `llama-server` with `{ ...process.env }` then `delete env.VK_ICD_FILENAMES` before passing it as the `env` option to `spawn()`. The GPU is then discovered normally by the Vulkan loader.

An earlier attempt used `schtasks` to fully detach from the Electron process tree, but Task Scheduler runs tasks as SYSTEM which has no user-session GPU access. Reverted to direct `spawn()` with cleaned env.

### Architecture changes
- `electron-main.js`: `startLlamaServer()` now calls Node `spawn()` directly with cleaned env (no `VK_ICD_FILENAMES`, no `VK_LAYER_PATH`). Args: `--batch-size 2048 --ctx-size 20480 --n-gpu-layers 99`. `llama-server` stdout/stderr redirected to `%APPDATA%\mtg-collection-frontend\llama-server.log` for diagnostics.
- `backend/services/deck_engine.py`: replaced `ollama` Python library with `openai` (pointing at `http://127.0.0.1:8081/v1`, no API key). Streaming preserved. All env var names kept (`OLLAMA_TIMEOUT`, `OLLAMA_NUM_PREDICT`) for backward compatibility.
- `backend/requirements.txt`: `ollama==0.2.1` → `openai>=1.30.0`.
- `frontend/package.json` `desktop:package` script: now builds to `C:\Temp\MTGPkg` then robocopy into the workspace release folder, avoiding VS Code file-watcher DLL locks.
- `frontend/llama-server/`: 23 files — `llama-server.exe` + 22 DLLs including `ggml-vulkan.dll`, `mtmd.dll`, `ggml.dll`, `llama.dll`, 14 CPU variant DLLs.

### llama-server details
- Binary: llama.cpp b9037, Vulkan Windows x64
- Model: `mistral-commander-q4.gguf` (4.1 GB, Mistral 7B Q4_K_M LoRA), loaded from `%APPDATA%\mtg-collection-frontend\models\model.gguf`
- Port: 8081, host 127.0.0.1
- ctx-size: 20480 (handles ~15K token prompts from large collections)
- GPU result: 7.5/8.0 GB dedicated VRAM on RX 5700

### Performance benchmark
- 554 candidates, full build: ~416 seconds on AMD RX 5700 (GPU)
- 282 seconds observed on a smaller candidate pool (~400)
- Previous CPU baseline (Ollama, v1.0.11): 144 seconds on laptop (different hardware, not directly comparable)

### Build / release pipeline (updated)
1. `cd backend && .venv\Scripts\pyinstaller.exe --clean mtg-collection.spec`
2. `cd frontend && npm run desktop:package` — builds to `C:\Temp\MTGPkg`, xcopy llama-server binaries, robocopy to `release\MTG Commander Generator-win32-x64\`
3. Zip and `gh release create v1.0.13`

### What is intentionally NOT committed
- `frontend/llama-server/*.dll` / `llama-server.exe` are in `.gitignore` (large binaries — ship in the release zip only)
- Training assets remain on Hugging Face

- **Deck build time (laptop, v1.0.11, Mistral 7B LoRA via Ollama):** 144 seconds (~2.4 min) end-to-end.
  - Model: `mtg-commander` (Mistral-7B Q4_K_M LoRA, running locally via Ollama).
  - Hardware: user's laptop (CPU-only or integrated GPU inference assumed).
  - This is the baseline reference for comparing future model swaps (e.g. Nemo-12B) or hardware upgrades.

---

## 2026-05-03 — v1.0.12 (in progress → released)

### Summary
Large feature release building on v1.0.11. All changes are on `main`. Desktop package rebuilt via `npm run desktop:package`. Tagged and released as `v1.0.12` with zip asset.

### New backend
- `GET /deck/commander-profile` — scans commander oracle text + type line and returns typed constraint suggestions (30+ archetype patterns: tribal, spellslinger, artifacts, equipment, enchantments, ETB, lifegain, +1/+1 counters, -1/-1 counters, experience, graveyard, discard, mill, tokens, sacrifice, landfall, draw payoffs, combat damage, attack triggers, proliferate, cycling, cast-from-exile, treasure, food, clues, storm/copy, cascade, morph, mutate, historic/sagas, monarch/initiative, dungeons, power≥4, flying, toughness, stax).
- `GET /deck/card-lookup?name=` — DB-first then Scryfall fallback for Add-from-Collection flows.
- `PUT /deck/saved/:deck_file` — replaces deck card list in an existing JSON save + regenerates `.txt` sidecar.
- `services/deck_engine.py` additions:
  - `_card_matches_constraint()` — field/value matcher with `|` OR support.
  - `_analyze_commander_profile()` — the 30+ regex pattern archetype detector.
  - `_enforce_constraints()` — post-rebalance min/max enforcement (evicts highest-CMC excess, fills from pool for deficits).
  - `_enforce_tapped_land_cap()` — swaps tapped land excess for untapped pool lands.
  - Constraint scoring in `_rebalance_nonlands_for_quality` — +80 per active constraint matched.
  - Candidate pool shuffled before each build; LLM temperature randomised between 0.70 and 0.88 for deck variety.
  - `strict_mode` keyword-only threshold lowered from 65% to 45%.
  - Excluded card names receive −200 score in rebalance (last resort only).
  - `OLLAMA_MAX_GENERATION_SEC` default raised from 420 s to 900 s in code.
- `electron-main.js` env: `OLLAMA_MAX_GENERATION_SEC` 720→900, `OLLAMA_TIMEOUT` 900→960.
- `DeckRequest` model extended: `constraints: list[DeckConstraint]`, `excluded_card_names: list[str]`, `tapped_land_max: int`.
- Deck save payload extended: `constraints: list[dict]`.

### New frontend
- **DeckBuilder**:
  - Deck Constraints Panel (collapsible) — auto-populated from `/deck/commander-profile` when commander changes. Checkbox enable/disable, min/max inputs, confidence badges (⚡ auto / ~ suggested), custom constraint row, field/value/count add.
  - Type Counters section — Artifact / Sorcery / Instant / Enchantment min + max, shows "N owned" from collection.
  - Max Tapped Lands input (paired with Dual Lands on the same row).
  - Card selection checkboxes on deck result tiles (non-land only).
  - Selection action bar — Exclude from Regen / Remove Selected / Re-Roll Without Selected / Clear Selection.
  - Re-roll button + excluded pills (dismissible, with × Clear All).
  - Deck result tiles replaced CardPreview with compact `deckbuilder-result-tile` (image + name + CMC/price).
  - Card preview modal on tile click.
  - Add from Collection modal (searchable top-50).
  - Save Changes bar (appears when deck is modified post-build).
  - `saveDeckWithName` extended to persist `constraints`.
  - `handleBuild` accepts `isReroll` + `overrideExcluded` params.
  - Constraint merge logic: `Map` keyed by `match_field::match_value`; higher min wins, lower non-zero max wins.
- **My Decks**:
  - Edit Mode toggle — shows checkboxes on card tiles; suppresses hover zoom + hides set-bg button.
  - Remove Selected bar.
  - Add from Collection modal.
  - Save Changes button → `PUT /deck/saved/:file`.
  - Deck Price in meta row (sum of `tcgplayer_price` for all cards + commander, shown in green).
- **App.tsx**:
  - `MANA_SCATTER` array — 12 fixed-position low-opacity emoji mana symbols rendered in `bg-mana-overlay`.
  - `bgArt` state — listens to `mtg-set-bg` custom event, stores/clears `localStorage.mtg.bgArt`, applies `backgroundImage` with dark overlay + `backgroundPosition: center 28%`.
- **CardPreview.tsx**: Set-bg button (🖼) with `card-set-bg-btn` / `card-set-bg-btn--active` classes. Fires `mtg-set-bg` CustomEvent. Toggles off if same card is already the background.
- **index.css**: `body` gets `radial-gradient(ellipse 120% 60% at 50% -10%, #3b1f6e 0%, #1a1a2e 55%)`, `background-attachment: fixed`, `zoom: 1.25`. New `.bg-mana-overlay` (fixed, z-index -1) and `.bg-mana-symbol` classes.
- **Collection.tsx**: `SUPERTYPES` Set for Legendary/Snow/Basic/World/Ongoing. `typeOptions` useMemo now splits primary face of DFC cards, separates supertypes from card types, builds compound options like `Creature // Legendary`. Filter also checks `supertypes[]` vs `subs[]` depending on whether the wanted subfilter is a supertype.
- **MyDecks.css**: Added `.my-decks-deck-price`, `.my-decks-edit-tile-wrap` (position: relative), edit tile hover suppression + `z-index: auto`, `.card-set-bg-btn { display: none }` in edit wrap, `.my-decks-tile-checkbox`, `.my-decks-remove-bar`, `.my-decks-add-collection-item`.
- **CardPreview.css**: `.card-set-bg-btn` and `.card-set-bg-btn--active` styles (top-left absolute, opacity 0→1 on hover, purple active state).
- **DeckBuilder.css**: 500+ lines added — constraints panel, type counters, result tile, card modal, selection/action bar, re-roll row, excluded pills, save-changes bar, add-from-collection modal.

### Build
- `package.json` (`frontend`): `signAndEditExecutable: false` added to electron-builder win config.
- All changes verified TypeScript-clean (`npx tsc --noEmit` exit 0).
- Desktop package rebuilt and confirmed working.

### Architecture notes
- Background state flows via DOM CustomEvent `mtg-set-bg` (detail: string|null) — decouples CardPreview from App state without prop drilling.
- Constraint enforcement runs after AI rebalance and before must-include insertion, so must-include cards are never evicted.
- The `_analyze_commander_profile` function is stateless and pure — no DB calls, just oracle text + type line regex. Called on every commander selection from the frontend.

---

## 2026-05-07 — v1.0.16: Model selection config + release failure post-mortem

### Root cause of v1.0.14 deck generation failure
- The `.gguf` model file (~4 GB+) does not ship inside the release zip due to file size constraints. Without it, `llama-server` skips startup silently — no AI backend, no deck generation, no error shown to the user.
- CPU fallback did **not** trigger on the test laptop because `llama-server` was never started (missing model), not because GPU detection failed. llama.cpp CPU fallback only activates when `llama-server` IS running but finds no Vulkan GPU at model load time.
- Previous README and release notes linked to an outdated HF repo (`mistral-commander-lora`). Corrected to the active repos.

### Changes (v1.0.16)
- `electron-main.js` — `getModelPath()` now reads `%APPDATA%\mtg-collection-frontend\models\model-select.env` (auto-created on first launch with all three options, 7B uncommented by default). First non-commented `MODEL_FILE=` line wins. Falls back to `model.gguf` for existing installs that already renamed the file.
- `mtg-collection/README.md` — replaced single-model install section with a three-model comparison table (7B / Nemo 12B Q3 / Nemo 12B Q4) with VRAM requirements, hardware guidance, both HF download links, and `model-select.env` step-by-step instructions.
- `README.md` (root) — added v1.0.16 and v1.0.13 What's New sections; added `⚠️ Model file not bundled` bullet to v1.0.14; replaced outdated Ollama AI model section with the current llama-server setup docs; corrected HF links throughout.

### Model inventory (current HF repos)
| Model | Repo | File | Size |
|---|---|---|---|
| Mistral 7B Q4_K_M | `SaltyNumba1/MTG-Commander-Mistral-7B-Trained` | `mistral-commander-q4.gguf` | ~4.1 GB |
| Nemo 12B Q3_K_M | `SaltyNumba1/Mistral-nemo-12B-MTG-Commander` | `mtg-commander-nemo-q3_k_m.gguf` | ~6 GB |
| Nemo 12B Q4_K_M | `SaltyNumba1/Mistral-nemo-12B-MTG-Commander` | `mtg-commander-nemo-q4_k_m.gguf` | ~7.5 GB |

### `model-select.env` format
```
MODEL_FILE=mistral-commander-q4.gguf
# MODEL_FILE=mtg-commander-nemo-q3_k_m.gguf
# MODEL_FILE=mtg-commander-nemo-q4_k_m.gguf
```
Auto-created at `%APPDATA%\mtg-collection-frontend\models\model-select.env` on first launch. First non-commented `MODEL_FILE=` line wins. Edit with any text editor; restart the app after saving.

### Next planned release (v1.0.17 — startup UX)
- Robust startup sequence: llama-server starts first, then backend, then UI window opens
- `waitForLlama()` health check against `http://127.0.0.1:8081/health` (120 s timeout for 12B model load)
- GPU/CPU mode detection by parsing `llama-server.log` for Vulkan offload lines
- Model status badge in nav bar: green = GPU ready, yellow = CPU fallback, red = offline
- First-launch modal directing users to HF to download their GGUF, with copyable install path
- Fix backend process cleanup on exit (`taskkill /F /T` for recursive PyInstaller child kill)
- New backend endpoint `GET /health/llama` proxying the llama-server health check


## 2026-05-07 — v1.0.17: Startup UX overhaul, AI status badge, first-launch modal

### Summary
All v1.0.17 implementation complete. Root cause of the "AI Offline" false positive in the initial v1.0.17 test: the backend exe was rebuilt from a May 5 build and did not contain the new `/health/llama` endpoint added to `main.py` on May 7. Fixed by rebuilding via `package_standalone.bat` and re-running `npm run desktop:package`.

### Changes

#### `electron-main.js`
- **New globals**: `let llamaServerStarted = false; let splashWin = null;`
- **`MODEL_SELECT_TEMPLATE`**: Template for auto-created `model-select.env`; 7B line uncommented by default, both Nemo lines commented out.
- **`getModelPath()`**: Reads `%APPDATA%\mtg-collection-frontend\models\model-select.env`; auto-creates it on first launch; first non-commented `MODEL_FILE=` line wins; falls back to `model.gguf`.
- **`startLlamaServer()`**: Removed `detached: true` and `child.unref()`. Process handle assigned to `llamaProcess` global so it can be killed directly on exit. Sets `llamaServerStarted = true`.
- **`waitForLlamaWithProgress()`**: Polls `http://127.0.0.1:8081/health` every 2 s up to 120 s. Updates splash bar pct 50→95% with elapsed time. Skips entirely (instant return `false`) if `llamaServerStarted === false` (no model file found).
- **`detectGpuMode()`**: Reads tail 64 KB of `llama-server.log`. Returns `"gpu"` if any layers offloaded, `"cpu"` if zero layers offloaded, `"unknown"` otherwise.
- **`createSplash()`**: Creates 440×240 frameless `BrowserWindow` with inline `data:text/html` URL containing logo, title, animated status text, and progress bar.
- **`updateSplash(text, pct)` / `closeSplash()`**: Helper functions to update splash content and destroy the window.
- **`app.whenReady()` sequence** (12 steps):
  1. Check `launched.lock` for first launch
  2. `await createSplash()`
  3. `startLlamaServer()` (non-blocking)
  4. `startBackend()` in parallel (reuses existing backend if already running)
  5. `waitForBackend()` — 15 s cap
  6. `waitForLlamaWithProgress()` — 120 s cap with splash progress
  7. `detectGpuMode()`
  8. Write `launched.lock` if first launch
  9. 300 ms pause (let progress bar reach 100%)
  10. `closeSplash()`
  11. `createWindow()`
  12. On `did-finish-load`: inject `mtg.llamaMode`, `mtg.llamaReady`, `mtg.firstLaunch` into localStorage; fire `mtg-llama-status` CustomEvent
- **`before-quit`**: `taskkill /F /T /PID` for backend process tree; direct `llamaProcess.kill()` for llama-server; PowerShell port-kill fallback.

#### `backend/main.py`
- Added `GET /health/llama` endpoint using stdlib `urllib.request` to proxy a health check to `http://127.0.0.1:8081/health`. Returns `{"status": "online"}` or `{"status": "offline"}`. No new dependencies.

#### `frontend/src/components/ModelStatus.tsx` (new)
- Nav bar badge polling `/health/llama` every 5 s.
- Reads `mtg.llamaMode` and `mtg.llamaReady` from localStorage on mount (injected by electron-main).
- Listens for `mtg-llama-status` CustomEvent for instant update at load.
- Four states: loading (pulsing gray), online+GPU (green "AI Ready (GPU)"), online+CPU (yellow "AI Ready (CPU)" + tooltip), offline (red "AI Offline" + install path tooltip).

#### `frontend/src/components/ModelStatus.css` (new)
- Styles for ModelStatus badge. Animated glow dots: green (GPU), yellow (CPU), red (offline), pulsing gray (loading).

#### `frontend/src/components/FirstLaunchModal.tsx` (new)
- Full-screen dark overlay shown only on first launch (`mtg.firstLaunch === '1'` in localStorage).
- Three-model comparison table (7B / Nemo 12B Q3 / Nemo 12B Q4) with VRAM requirements and HF download links.
- One-click "Copy Path" button for `%APPDATA%\mtg-collection-frontend\models\`.
- Step-by-step GGUF install instructions.
- "Got it" dismisses permanently (removes `mtg.firstLaunch` from localStorage).

#### `frontend/src/components/FirstLaunchModal.css` (new)
- Dark-themed modal styles matching app aesthetic (purple gradient dismiss button, dark card bg).

#### `frontend/src/App.tsx`
- Added `import ModelStatus from "./components/ModelStatus"` and `import FirstLaunchModal from "./components/FirstLaunchModal"`.
- `<ModelStatus />` added as last child of `<nav>` (right side, after Help link).
- `<FirstLaunchModal />` added after `<BuildStatusFloater />`.

### Verified
- TypeScript: no errors in ModelStatus.tsx, FirstLaunchModal.tsx, App.tsx (one pre-existing CSS inline-style lint warning on line 75 of App.tsx — pre-dates this session).
- Build: `npm run desktop:package` succeeded (99 modules, 23 llama DLLs copied).
- Runtime test: AMD RX 5700 — badge shows "AI Ready (GPU)" with green dot. GPU utilization and VRAM confirmed in Task Manager.

---

## 2026-05-08 — v1.0.17.2: UX polish, bracket rating display, collection color counter

### Summary
Several quality-of-life improvements shipped in one packaged build. Backend exe was rebuilt three times this session. No breaking API changes.

### Changes

#### `frontend/electron-main.js`
- **`ICON_PATH` / `LOGO_PATH`** — extracted to module-level constants (previously duplicated inside `createWindow()` and `createSplash()`).
- **Splash logo** — PNG embedded as `data:image/png;base64,...` URI via `fs.readFileSync`. Fixes broken image on Chromium `data:` pages where `file://` URLs are blocked and spaces in the path caused 404.
- **Nav bar** — removed `🃏` emoji from the `MTG Deck Builder` nav title in `App.tsx`.

#### `frontend/src/pages/DeckBuilder.tsx`
- **`collectionColorCount` useMemo** — counts unique non-land card names in the collection whose color identity is a subset of the selected commander's. Returns `null` when no commander is selected.
- **Color identity stat bar** — rendered between the keyword/must-include filters row and the Deck Constraints panel. Shows commander color pip emojis and `N cards in your collection match this color identity`. Hidden when no commander selected.

#### `frontend/src/pages/DeckBuilder.css`
- **`.deckbuilder-color-stat`** — subtle pill row: `rgba(255,255,255,0.04)` background, 1px border, 8px radius.
- **`.deckbuilder-color-stat-pips`** — flex row for color pip emojis.

#### `backend/routes/deckbuilder.py`
- **Retroactive bracket fix** — changed `if "bracket" not in data:` → `if not data.get("bracket"):` in the deck detail load path. Old decks saved with `"bracket": {}` (empty dict) now correctly trigger retroactive bracket calculation.

#### `backend/services/bracket_engine.py`
- Bracket target = **soft prompt hint only**. `target_bracket` injects a power-level directive paragraph into the LLM prompt. No cards are auto-fetched or force-injected — the candidate pool is always the user's collection. A bracket 5 request against a casual collection will produce a lower bracket result; this is expected.
- **Staple injection prototyped then fully reverted.** A `get_bracket_staples()` function and route-level injection block were implemented and then removed. Decision: the app is collection-first; adding cards the user doesn't own violates the core design. The existing must-include defaults (`Sol Ring`, `Arcane Signet`, `Command Tower`, `Path of Ancestry`, `Commander's Sphere`, `Roaming Throne`) handle universal precon staples.

### Build / rebuild log
1. Bracket retroactive fix + splash logo + nav emoji removal → `package_standalone.bat` → `npm run desktop:package`.
2. Bracket staple injection added → `package_standalone.bat` → `npm run desktop:package`.
3. Bracket staple injection reverted → `package_standalone.bat` → `npm run desktop:package`.

### Design decisions
- **Bracket target is always a soft hint.** Results reflect what the user actually owns.
- **Color count = unique card names, not total copies.** Commander is singleton — distinct names are what matter.
- **Lands excluded from color count.** Land counts are already surfaced in the nonbasic/dual land hint rows.

---

## 2026-05-10 — v1.0.18: Bracket power-level targeting, VIP injection, printing modal

### Summary
Expanded the bracket engine from a soft LLM hint to an active card-selection system. The deck builder now injects and prioritizes high-power cards from the user's collection based on the target bracket. The art printing picker was redesigned from a cramped inline list to a full-screen portal modal grid.

### `backend/services/bracket_engine.py`

#### Expanded curated card sets
- **`GAME_CHANGERS`**: expanded to 56 cards, categorized by color. Key additions: White (Enlightened Tutor, Farewell, Serra's Sanctum, Parallel Lives), Blue (Intuition, Trouble in Pairs), Black (Imperial Seal, Opposition Agent), Red (Jeska's Will), Green (Seedborn Muse, Natural Order), Colorless (Mox Diamond, Chrome Mox, Grim Monolith, Mox Opal, Lion's Eye Diamond, Field of the Dead, The Tabernacle at Pendrell Vale, Mishra's Workshop).
- **`COMBO_ENABLERS`**: expanded to 55 cards across 6 categories: Infinite Mana (Isochron Scepter, Basalt Monolith, Ashnod's Altar, Phyrexian Altar, Forsaken Monument), Infinite Tokens/ETB (Splinter Twin, Kiki-Jiki, Pestermite, Deceiver Exarch, Village Bell-Ringer, Felidar Guardian, Restoration Angel, Emiel the Blessed, Peregrine Drake), Infinite Damage/Win-Cons (Thassa's Oracle, Labman, Jace WMS, Sanguine Bond), Library-Win (Demonic Consultation, Tainted Pact, Auriok Salvagers), Graveyard Loops (Mikaeus, Ballista, Persist + sac, Deadeye Navigator), Untap Enablers, Extra Turn Loops (Time Warp, Temporal Manipulation, Nexus of Fate, Beacon of Tomorrows).

#### Oracle-text helper functions (new)
- **`_card_oracle_lower(card)`**: safely returns lowercase oracle text, empty string fallback.
- **`is_game_changer(card)`**: name-only check against `GAME_CHANGERS` set.
- **`is_combo_enabler(card)`**: name-only check against `COMBO_ENABLERS` set.
- **`is_tutor_equivalent(card)`**: name match OR oracle "search your library" — excludes cards whose `type_line` contains "land" (fetchlands, panoramas) and excludes basic-land ramp via `_BASIC_LAND_SEARCH_RE` regex.
- **`is_extra_turn_equivalent(card)`**: name match OR oracle "take an extra turn".
- **`is_bracket_vip(card, target_bracket)`**: returns `True` when the card qualifies for VIP injection at the given bracket (B4+: GC|combo|tutor; B5+: also extra turns).

#### `calculate_bracket()` — tutor deduplication
- `found_gc_set` built from the names of found game changers.
- `found_tutors` now filters out names already in `found_gc_set`: `found_tutors = [n for n in STRONG_TUTORS if n in normalized and n not in found_gc_set]`. Prevents cards like Vampiric Tutor / Demonic Tutor (in both sets) from inflating both the GC count and tutor count.

### `backend/services/deck_engine.py`

#### VIP injection in `generate_deck()`
After `must_dicts` are resolved, when `target_bracket >= 4`:
```python
from services.bracket_engine import is_bracket_vip
already_must = {c["name"].lower() for c in must_dicts}
vip_cards = [c for c in candidates if is_bracket_vip(c, target_bracket) and c["name"].lower() not in already_must]
must_dicts.extend(vip_cards)
```
Progress callback reports: `"Auto-injected N VIP power card(s)..."`. No cap — all qualifying cards in the collection are injected.

#### Scoring bonuses in `_rebalance_nonlands_for_quality(target_bracket)`
Inside `score()` inner function, after constraint scoring:
```python
if target_bracket >= 4 and _is_game_changer(card): value += 70.0
if target_bracket >= 3 and _is_combo_enabler(card): value += 60.0
if target_bracket >= 5 and _is_extra_turn_equiv(card): value += 55.0
if target_bracket >= 3 and _is_tutor_equiv(card): value += 50.0
if target_bracket >= 4 and cmc > 5 and not _is_combo_enabler(card) and not _is_game_changer(card): value -= 15.0
```
Oracle helpers are lazy-imported only when `target_bracket >= 3` to avoid overhead on casual builds.

### `frontend/src/components/CardPreview.tsx` + `CardPreview.css`

#### Printing picker redesigned as portal modal
- **Before**: inline `<div className="card-printing-picker">` scrollable list (max-height 200px, cramped inside card tiles).
- **After**: `createPortal(<div className="printing-modal-backdrop">...</div>, document.body)` — renders outside all card containers, no overflow clipping.
- **Modal structure**: fixed-position backdrop (rgba 0.72) → `.printing-modal` (max-height 85vh, max-width 720px) → `.printing-modal-header` (title + ✕ button) → `.printing-modal-grid` (grid-template-columns: repeat(auto-fill, minmax(130px, 1fr))).
- **Cell**: `.printing-modal-cell` — full card art at aspect-ratio 63/88, hover lifts (translateY −4px + shadow), `.printing-modal-cell--active` has purple border (2px solid #9b59b6).
- **State**: `pickerOpen` boolean; `printings` cached on first open (Scryfall fetch). Backdrop click closes without changing selection.
- **Removed CSS**: `.card-printing-picker`, `.card-printing-option`, `.card-printing-option--active`, `.card-printing-set`, `.card-printing-num`, `.card-printing-thumb`, `.card-printing-error`.

### Problem resolutions this session
| Problem | Root Cause | Fix |
|---|---|---|
| `COMBO_ENABLERS` syntax error | User pasted new block above old block — Python treated adjacent string literals as implicit concatenation | Merged into single clean categorized set |
| Double-counting tutors | Demonic Tutor / Vampiric Tutor in both GAME_CHANGERS and STRONG_TUTORS inflated both counters | Built `found_gc_set`; filter tutors: `n not in found_gc_set` |
| Fetchland misclassified as tutor | `"basic land" not in oracle` didn't catch panoramas ("search for a basic Forest **card**") | Added `if "land" in type_line: return False` before oracle check |
| VIP cap was 12 | Original implementation capped at 12 VIP cards | Removed cap entirely |
| Printing picker clipped | Inline picker inside card tile — parent `overflow: hidden` clipped the list | Replaced with `createPortal` to `document.body` |

### Build / package log
- Backend: `package_standalone.bat` → `backend/dist/mtg-collection.exe`
- Frontend: `npm run desktop:package` → `C:\Temp\MTGPkg\MTG Commander Generator-win32-x64` (robocopy to release/ got "Access is denied" on some DLLs because the app was running — code output is correct)

### Design decisions
- **VIP injection is collection-first**: only cards the user actually owns are injected. No Scryfall fetching for VIPs.
- **Oracle fallback is additive**: named sets remain the primary source; oracle text catches functional equivalents not in the lists.
- **Bracket scoring is cumulative**: a card can score GC bonus + tutor bonus if it qualifies for both.
- **Lands always excluded from tutor classification**: type_line check happens before oracle check, cleanly handling fetchlands, panoramas, and any future land-search effects.
