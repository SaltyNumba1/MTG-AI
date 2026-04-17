# MTG Collection & Deck Builder

Store your Magic: The Gathering card collection and build Commander decks from it using a local AI model.

---

## Requirements

- [Ollama](https://ollama.com) (local AI runtime)

If you are using the packaged desktop app, you do not need to start the backend or frontend separately. The desktop app launches the bundled backend automatically.

---

## 1. Install Ollama

1. Download and install Ollama from **https://ollama.com/download**
2. After installation, open a terminal and pull a model:

```bash
ollama pull mistral
```

> `mistral` (~4 GB) is the default. For better deck suggestions, you can use a larger model:
> ```bash
> ollama pull llama3
> ```
> Then set `OLLAMA_MODEL=llama3` in `backend/.env`.

3. Make sure Ollama is running before starting the app. It starts automatically on most systems after install, but you can also run it manually:

```bash
ollama serve
```

---

## 2. Run the App

1. Open the packaged MTG Collection desktop app.
2. Wait a few seconds for the bundled backend to start.
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
