# Training Scaffold

This folder contains the first-pass training pipeline for improving Commander deck generation without changing the app runtime path.

The current app still uses Ollama at inference time. The purpose of this scaffold is to help you collect and normalize high-value Commander examples before attempting Mistral fine-tuning.

## Goals

- Keep training dependencies isolated from the desktop app backend.
- Validate Commander deck examples before they enter a fine-tuning set.
- Normalize raw decklist data into JSONL that can be reused for retrieval, evaluation, or supervised tuning.

## Recommended Dataset Shape

Use examples that match the actual task:

- commander
- color identity
- deck intent or strategy text
- final 99-card decklist
- optional tags, notes, source, and quality score

Raw card text corpora are not the target here. The useful signal is deck construction quality.

## Raw Input Format

The dataset builder accepts either a JSON array or JSONL. Each example should look like this:

```json
{
  "commander": "Meren of Clan Nel Toth",
  "color_identity": ["B", "G"],
  "strategy": "Graveyard recursion and value creatures with sacrifice outlets.",
  "deck": [
    {"name": "Sol Ring", "quantity": 1},
    {"name": "Sakura-Tribe Elder", "quantity": 1},
    {"name": "Forest", "quantity": 10},
    {"name": "Swamp", "quantity": 10}
  ],
  "tags": ["graveyard", "midrange", "aristocrats"],
  "source": "curated",
  "quality_score": 0.92,
  "notes": "Budget-friendly value list"
}
```

Rules enforced by the validator:

- `commander` is required.
- `strategy` is required.
- `deck` is required and must total exactly 99 cards.
- Quantities must be positive integers.
- Duplicate non-basic cards are rejected.

## Output Files

The builder creates these files under `training/data/processed/`:

- `commander_examples.jsonl`: normalized examples for reuse.
- `chat_train.jsonl`: training split in chat format.
- `chat_eval.jsonl`: evaluation split in chat format.

Each chat record is shaped for supervised instruction tuning:

```json
{
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ]
}
```

## Usage

From the `training` folder:

```bash
pip install -r requirements.txt
python src/build_dataset.py --input data/raw/commander_examples.jsonl
```

There is also an illustrative starter file at `data/raw/sample_commander_examples.jsonl`.

Optional flags:

```bash
python src/build_dataset.py \
  --input data/raw/commander_examples.jsonl \
  --output-dir data/processed \
  --eval-ratio 0.15 \
  --seed 42
```

## Import Existing Decklists

If you already have Commander deck exports in plain text form, convert them into the raw schema first:

```bash
python src/import_decklists.py \
  --input data/imports/my_deck.txt \
  --output data/raw/imported_examples.jsonl \
  --strategy "Mono-white Angels with lifegain payoffs" \
  --color-identity W
```

Assumptions for text imports:

- Lines should look like `1 Card Name`.
- Section headers like `Commander` and `Deck` are ignored.
- The first counted card is treated as the commander by default.

You can override that behavior with `--commander "Card Name"`.

## Train a LoRA Adapter

Once you have processed chat-format JSONL, you can start a basic LoRA fine-tune:

```bash
python src/train_lora.py \
  --model mistralai/Mistral-7B-Instruct-v0.2 \
  --train-file data/processed/chat_train.jsonl \
  --eval-file data/processed/chat_eval.jsonl \
  --output-dir outputs/mistral-commander-lora
```

This script is intentionally minimal. It avoids quantization-specific setup so it stays portable. If you later want QLoRA, add the appropriate GPU and dependency path after the dataset proves useful.

## Next Steps

1. Populate `training/data/raw/` with curated Commander lists.
2. Add an offline benchmark of commander prompts and expected deck traits.
3. Decide whether to use the processed dataset for retrieval first or fine-tuning first.

## Files

- `src/build_dataset.py`: validates raw Commander examples and writes normalized plus chat-format JSONL.
- `src/import_decklists.py`: converts decklist text exports into the raw example schema.
- `src/train_lora.py`: minimal supervised LoRA fine-tuning entry point.
- `data/raw/sample_commander_examples.jsonl`: illustrative seed data for pipeline validation.

