# MTG Collection v1.0.10

## ✨ New
- **Import deck from text (.txt)** – new "Import Deck" flow on the Collection page. Paste a Moxfield/Archidekt/plain-text decklist (or load a `.txt`) and any cards not already in your collection are auto-fetched from Scryfall and added. The imported deck lands directly in My Decks.
  - ⚠️ **Format requirement:** the **commander must be at the top of the decklist** (above the 99 mainboard cards) **and must also be named in the deck title block**. The parser also recognises an explicit `Commander` / `Command Zone` section header and the `*CMDR*` inline marker, but commander-on-line-1-AND-titled is the most reliable combo.
  - Lines like `1 Sol Ring`, `1x Sol Ring`, or just `Sol Ring` all work. `//` and `#` lines are treated as comments. Anything under `Sideboard` / `Maybeboard` is ignored.
- **Build Status Floater** – a global, collapsible floating panel that polls the backend every 2.5 s and shows the active AI build phase, current step, and the most recent model "thoughts." You can navigate away from the Build Deck page (e.g. browse your collection or My Decks) without losing visibility into a running build.
- **Configurable LLM via `.env`** – `mtg-collection/backend/.env` now controls which Ollama model the deck engine talks to (`OLLAMA_MODEL`, default `mtg-commander`) and the request timeout (`OLLAMA_TIMEOUT`, default 900 s). Switch between Mistral 7B and Mistral-Nemo 12B without rebuilding the app — just edit the file next to the exe and restart.
- **New deck-build telemetry endpoints** – `GET /deck/build-status`, `GET /deck/build-stream` (SSE), and `POST /deck/reset` expose live progress and a kill switch for stuck builds.

## 🐛 Fixes / hardening
- Scryfall lookups now fall back gracefully on double-faced (`A // B`) card names during deck and collection imports.
- Import flows upsert missing cards through Scryfall instead of failing outright.
- Database / scryfall service error handling tightened.

## 📦 Build / Install
1. Download `MTG-Collection-v1.0.10-win32-x64.zip` (~188 MB)
2. Extract anywhere (e.g. `C:\Apps\MTG Collection`)
3. Run `MTG Collection.exe`

> Your `mtg_collection.db` and `saved_decks/` folder are kept next to the exe and persist across upgrades. Copy them over from your v1.0.9 install if you want to keep your collection and decks.
> The new `.env` lives next to the exe — edit it to change which Ollama model the deck engine uses.
