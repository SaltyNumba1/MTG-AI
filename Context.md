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
