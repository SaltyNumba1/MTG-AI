# MTG Collection & Deck Builder

Store your Magic: The Gathering card collection and generate Commander decks from it using AI.

## Setup

### Prerequisites — Ollama (local AI)

Deck generation runs entirely on your machine via [Ollama](https://ollama.com).

```bash
# 1. Install Ollama: https://ollama.com/download
# 2. Pull a model (mistral is the default, ~4GB)
ollama pull mistral

# Optional: use a larger model for better picks
ollama pull llama3
```

Set `OLLAMA_MODEL=llama3` in `backend/.env` to switch models.

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

uvicorn main:app --reload
```

API runs at http://localhost:8000  
Swagger docs at http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App runs at http://localhost:5173

---

## Importing Your Collection

The CSV importer accepts exports from:

| Source | How to export |
|---|---|
| **Moxfield** | Collection → Export → CSV |
| **Archidekt** | Collection → Export → CSV |
| **Generic** | Any CSV with a `name` column (and optional `quantity` column) |

---

## Building a Deck

1. Import your collection first
2. Go to **Build Deck**
3. Select a commander (only legendary creatures from your collection appear)
4. Describe the deck you want, e.g.:
   - *"Aggressive token swarm with anthem effects"*
   - *"Control deck focused on counterspells and card draw"*
   - *"Combo deck that wins through infinite mana loops"*
5. Click **Generate Deck** — the engine filters your collection by color identity and legality, then GPT-4o picks the best 99 cards
6. Export the decklist as a `.txt` file (compatible with Moxfield/Archidekt import)

---

## Environment Variables

| Variable | Description |
|---|---|
| `OLLAMA_MODEL` | Model to use for deck generation (default: `mistral`) |
