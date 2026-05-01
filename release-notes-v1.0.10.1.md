# MTG Collection v1.0.10.1 — Hotfix

Point release on top of [v1.0.10](https://github.com/SaltyNumba1/MTG-AI/releases/tag/v1.0.10) addressing a deck-build timeout regression in the packaged Windows release.

## 🐛 Fixes
- **Deck builds no longer time out at the 7-minute mark.** The packaged backend was using the in-code default `OLLAMA_MAX_GENERATION_SEC=420` because `.env` was never bundled into the PyInstaller exe. Bigger commanders / larger collections that needed more than ~7 minutes of Mistral 7B CPU inference would hard-fail with `Model generation exceeded 420s`.
- **`.env` is now embedded in the backend exe.** PyInstaller spec adds `.env` to `datas`, and `main.py` searches the exe directory, the PyInstaller `_MEIPASS` extract, the CWD, and the source `backend/` directory for a `.env` file. The first one found wins; later files don't override already-set variables.
- **Sidecar `.env` still works.** A copy is also dropped next to the exe in `resources/backend/dist/.env` so power users can edit timeouts / model selection without rebuilding. The sidecar takes precedence over the embedded copy.

## 🔧 New defaults (in the bundled `.env`)
| Var | Old default (in code) | New default (in `.env`) |
|---|---|---|
| `OLLAMA_TIMEOUT` | 900 s | **1800 s** (30 min) |
| `OLLAMA_MAX_GENERATION_SEC` | 420 s | **1800 s** (30 min) |
| `OLLAMA_NUM_PREDICT` | unset (model default) | **768** (documented) |

If you want faster failure for hung builds, lower these and restart the app.

## 📥 Install
1. Quit any existing MTG Collection instance.
2. Download `MTG-Collection-v1.0.10.1-win32-x64.zip` and extract anywhere.
3. Run `MTG Collection.exe`.

No data migration needed — the SQLite database lives in your AppData and is unaffected.

## 🔍 If you were debugging this on v1.0.10
The dev `uvicorn` left running from a development session would steal port 8000 and Electron would log `Reusing existing backend on port 8000`, meaning the bundled exe never actually started. If you still see this, kill any stray `python3.11.exe` on 8000 before launching.
