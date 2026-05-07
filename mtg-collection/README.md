# MTG Collection & Deck Builder

Store your Magic: The Gathering card collection and build Commander decks from it using a local AI model.

---

## Requirements

- Windows 10/11 x64
- A **Vulkan-capable GPU** (AMD, NVIDIA, or Intel) for GPU-accelerated deck generation
  - CPU fallback is available but significantly slower
- The model file `mistral-commander-q4.gguf` placed at:
  `%APPDATA%\mtg-collection-frontend\models\model.gguf`
  ([Download from Hugging Face](https://huggingface.co/SaltyNumba1/mistral-commander-lora))

**No Ollama required.** The app bundles `llama-server` (llama.cpp Vulkan) and starts it automatically.

---

## 1. Install the Model

1. Download `mistral-commander-q4.gguf` (~4.1 GB) from [Hugging Face](https://huggingface.co/SaltyNumba1/mistral-commander-lora)
2. Place it at:
```
C:\Users\<you>\AppData\Roaming\mtg-collection-frontend\models\model.gguf
```

---

## 2. Run the App

1. Open `MTG Commander Generator.exe`.
2. Wait ~15 seconds for the backend and `llama-server` (GPU inference engine) to start.
3. Import your collection and build decks inside the app.

That is all most users need.

---

## Importing Your Collection

The app accepts CSV exports from:

| Source | How to export |
|---|---|
| **Moxfield** | Collection → Export → CSV |
| **Archidekt** | Collection → Export → CSV |
| **ManaBox** | Collection → top-right menu → Export CSV |
| **Generic** | Any CSV with a `name` column (optional `quantity` column) |

---

## Building a Deck

1. Import your collection on the **Collection** page.
2. Go to the **Build Deck** page.
3. Select a commander - only legendary creatures from your collection are shown.
4. Describe the deck you want, for example:
   - *"Aggressive token swarm with anthem effects"*
   - *"Control deck focused on counterspells and card draw"*
   - *"Combo deck that wins through infinite mana loops"*
5. Click **Generate Deck**. The engine filters your collection by color identity and Commander legality, then the AI selects the best 99 cards.
6. Export the finished decklist as a `.txt` file (compatible with Moxfield and Archidekt import).

Defaults:
- Basic lands: **25**
- Nonbasic lands: **12**

The builder now also shows an **estimated deck cost** using available TCG pricing data.

---

## Collection Features

- **Import Deck** modal can now save directly to **My Decks** and supports an optional deck name.
- **Color filter** includes a **Colorless** option for non-colored cards.
- Use card checkboxes plus **Save Selected as Deck** to create a manual deck from your collection.
- Backup/restore uses a safer SQLite backup flow for more complete backups.

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

## Optional: Development Setup

Only use these steps if you are running the project from source or working on the codebase.

- Python 3.10+
- Node.js 18+

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS / Linux
pip install -r requirements.txt
uvicorn main:app --reload
```

The API will be available at **http://localhost:8000**.

---

### Frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The app will be available at **http://localhost:5173**.

---

## Configuration

Create a `backend/.env` file to override defaults:

```env
OLLAMA_MODEL=mistral   # Change to llama3, gemma2, etc.
```

---

## Experimental: Training Data Scaffold

This repo now includes a separate `training/` folder for building and validating Commander deck datasets before model fine-tuning.

Use it if you want to curate decklists, evaluate Hugging Face sources, or prepare JSONL for supervised tuning. It does not change the app runtime path, which still uses Ollama through the backend.

See `training/README.md` for the dataset format and preprocessing script.
