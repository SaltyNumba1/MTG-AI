# Dataset v3 — runbook

Goal: produce a richer training set for **mistral-commander-nemo** (v2 model).
Three example types instead of one:

| Type            | Source                                         | Teaches                                |
|-----------------|------------------------------------------------|----------------------------------------|
| `commander_deck`| EDHREC + Archidekt + existing v2 raw           | One-shot deckbuilding (current v1 skill) |
| `card_qa`       | Scryfall oracle bulk → `fetch_scryfall_qa.py`  | Card knowledge, costs, types, rules text |
| `swap_edit`     | Existing decks → `generate_swap_examples.py`   | Multi-turn editing, swaps, archetype changes |

## 0. Setup

From `mtg-collection/training/`:

```powershell
pip install -r requirements.txt
```

Download Scryfall oracle bulk data (one-time, ~150 MB):

1. Visit <https://scryfall.com/docs/api/bulk-data>
2. Click **Oracle Cards** → **Download**
3. Save as `data/raw/scryfall-oracle-cards.json`

## 1. Expand deck coverage (EDHREC)

Use the expanded commander list (already 165 commanders). Crank delay to be
polite to EDHREC.

```powershell
python src/fetch_edhrec.py `
  --commanders-file data/imports/commander_list_expanded.txt `
  --output data/raw/edhrec_examples_v3.jsonl `
  --delay 1.5
```

Want more? Append more commanders to `commander_list_expanded.txt` and re-run
with `--append`.

## 2. Pull more real Archidekt decks

Each run samples random IDs in a range. Run multiple times with different
seeds + ID ranges to grow the corpus.

```powershell
python src/fetch_archidekt.py `
  --start-id 1000000 --end-id 6000000 `
  --sample-size 600 `
  --min-view-count 25 `
  --seed 1 `
  --output data/raw/archidekt_examples_v3.jsonl

# repeat with --seed 2,3,4... and --append
python src/fetch_archidekt.py `
  --start-id 1000000 --end-id 6000000 `
  --sample-size 600 --min-view-count 25 --seed 2 `
  --output data/raw/archidekt_examples_v3.jsonl --append
```

Hit rate is roughly 5–15% for valid Commander decks, so ~600 IDs ⇒ ~30–90
saved decks per pass. Aim for 5,000+ across all passes.

## 3. Card-knowledge Q&A from Scryfall

```powershell
python src/fetch_scryfall_qa.py `
  --bulk data/raw/scryfall-oracle-cards.json `
  --output data/raw/scryfall_qa.jsonl `
  --max-cards 8000 `
  --questions-per-card 3 `
  --commander-only
```

Produces ~24,000 Q&A pairs covering 8,000 unique cards. Dial `--max-cards`
and `--questions-per-card` to taste.

## 4. Multi-turn swap/edit examples

Needs the v3 normalized decks first, so do this **after** step 5 (build
once, derive swaps, build again). Or run against v2 normalized data the
first time and re-merge.

```powershell
python src/generate_swap_examples.py `
  --input data/processed/commander_examples.jsonl `
  --output data/raw/swap_examples.jsonl `
  --per-deck 2 --max-swaps 3
```

## 5. Merge everything for training

```powershell
python src/build_dataset_v3.py `
  --decks data/raw/all_examples_v2.jsonl `
          data/raw/edhrec_examples_v3.jsonl `
          data/raw/archidekt_examples_v3.jsonl `
  --qa    data/raw/scryfall_qa.jsonl `
  --swaps data/raw/swap_examples.jsonl `
  --output-dir data/processed_v3 `
  --eval-ratio 0.05 `
  --cap-qa 15000      # keep Q&A from drowning out deck examples
```

Output:
- `data/processed_v3/chat_train.jsonl` — feed this to `train_lora.py`
- `data/processed_v3/chat_eval.jsonl`  — held-out for eval
- `data/processed_v3/commander_examples.jsonl` — clean normalized decks
  (use as input for round 2 of swap generation)

## Target dataset shape (rough)

| Bucket  | Target rows |
|---------|------------:|
| Decks   | 5,000–10,000 |
| Q&A     | 10,000–20,000 (capped) |
| Swaps   | 2,000–5,000 |
| **Total** | **~20k–35k chat rows** |

That hits the sweet spot for LoRA on Nemo-12B without over-spending on
training compute.

## What's next

After dataset v3 is built, see `TRAIN_NEMO.md` (coming next) for the QLoRA
training notebook tuned for Mistral-Nemo-12B-Instruct-2407.
