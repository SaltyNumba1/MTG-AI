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
