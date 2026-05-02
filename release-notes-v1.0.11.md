# MTG Collection v1.0.11

Point release on top of [v1.0.10.1](https://github.com/SaltyNumba1/MTG-AI/releases/tag/v1.0.10.1) addressing critical data-persistence bugs in the packaged Windows release.

## 🐛 Critical Fixes

- **Collection and decks now persist across app restarts.**
  The SQLite database was being written to `%TEMP%` (PyInstaller's extraction directory) in the packaged app because `database.py` used `Path(__file__).parents[1]` to locate the DB — in a frozen exe this resolves to the temp `_MEIPASS` folder, which is cleared on every launch. Both the database and saved decks are now routed to `%APPDATA%\MTG Collection\` via injected env vars (`DATABASE_URL`, `SAVED_DECKS_DIR`) from Electron's main process.

- **`saved_decks` folder is auto-created on first launch.**
  Previously the folder was only created when saving a deck for the first time. If the folder didn't exist the app would error silently. The backend now runs `mkdir(parents=True, exist_ok=True)` during the FastAPI startup event.

- **Deck saves no longer split between two locations.**
  `_saved_decks_dir()` had a priority-2 branch that checked for a "repo release" path, causing decks to be written to the source `backend/saved_decks/` in some environments and `%APPDATA%` in others. That branch has been removed; the priority order is now: (1) `$SAVED_DECKS_DIR` env var, (2) next to exe when frozen, (3) `backend/saved_decks/` in dev.

- **All API calls now work correctly in the packaged app.**
  `api.ts` was hardcoded to `http://localhost:8001`. Vite's dev proxy masked this during development, but in the packaged app (no proxy) every API call silently failed — imports appeared to stall and the progress circle never appeared. Fixed to use an empty base URL in dev (allowing Vite proxy) and `http://localhost:8000` in production.

- **AI deck builder no longer hangs indefinitely past the timeout.**
  `OLLAMA_MAX_GENERATION_SEC` was only checked between received tokens inside the streaming loop. A cold model load can take several minutes before producing the first token, so the deadline check never ran and the request hung until the 15-minute HTTP timeout. The Ollama call is now run in a background thread and drained via a queue with a 1-second poll, enforcing a hard wall-clock deadline regardless of when the first token arrives. The generation cap is also increased from 7 min to 12 min to give slow hardware more headroom.

## 📁 Data Location (v1.0.11+)

Your collection database and saved decks are stored in:

```
C:\Users\<you>\AppData\Roaming\MTG Collection\
  mtg_collection.db
  saved_decks\
```

This folder persists across upgrades and reinstalls.

> **Upgrading from v1.0.10.x?** Your previous data may be in `backend\saved_decks\` next to the old exe. Copy the `.json` and `.txt` pairs into `%APPDATA%\MTG Collection\saved_decks\` to restore your decks. The database will be rebuilt fresh from your next import.

## 📥 Install

1. Quit any existing MTG Collection instance.
2. Download `MTG-Collection-v1.0.11-win32-x64.zip` and extract anywhere.
3. Run `MTG Collection.exe`.
4. Import your collection — it will persist from now on.
