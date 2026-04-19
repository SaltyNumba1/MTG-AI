import argparse
import json
import random
from pathlib import Path


BASIC_LAND_NAMES = {
    "plains",
    "island",
    "swamp",
    "mountain",
    "forest",
    "wastes",
    "snow-covered plains",
    "snow-covered island",
    "snow-covered swamp",
    "snow-covered mountain",
    "snow-covered forest",
}

# Cards that are Commander-legal in multiples (special rules / Gatherer errata)
MULTI_COPY_LEGAL = {
    "relentless rats",
    "shadowborn apostle",
    "dragon's approach",
    "rat colony",
    "persistent petitioners",
    "seven dwarves",
    "slime against humanity",
    "nazgul",
}

SYSTEM_PROMPT = (
    "You are an expert Magic: The Gathering Commander deck builder. "
    "Given a commander and deck goal, produce a coherent 99-card decklist that matches the strategy."
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate and normalize Commander deck examples into fine-tuning JSONL."
    )
    parser.add_argument("--input", required=True, help="Path to raw JSON or JSONL examples")
    parser.add_argument(
        "--output-dir",
        default="data/processed",
        help="Directory for normalized and chat-formatted output files",
    )
    parser.add_argument(
        "--eval-ratio",
        type=float,
        default=0.1,
        help="Fraction of examples to reserve for evaluation",
    )
    parser.add_argument("--seed", type=int, default=42, help="Random seed for data split")
    return parser.parse_args()


def load_examples(path: Path) -> list[dict]:
    raw_text = path.read_text(encoding="utf-8").strip()
    if not raw_text:
        return []

    if path.suffix.lower() == ".json":
        data = json.loads(raw_text)
        if not isinstance(data, list):
            raise ValueError("JSON input must contain a top-level array of examples.")
        return data

    return [json.loads(line) for line in raw_text.splitlines() if line.strip()]


def normalize_card(entry: dict, example_index: int) -> dict:
    if not isinstance(entry, dict):
        raise ValueError(f"Example {example_index}: deck entries must be objects.")

    name = str(entry.get("name", "")).strip()
    quantity = entry.get("quantity")

    if not name:
        raise ValueError(f"Example {example_index}: deck entries must include a card name.")
    if not isinstance(quantity, int) or quantity < 1:
        raise ValueError(f"Example {example_index}: quantity for '{name}' must be a positive integer.")

    return {"name": name, "quantity": quantity}


def validate_deck(deck: list[dict], example_index: int) -> list[dict]:
    normalized = [normalize_card(entry, example_index) for entry in deck]
    total_cards = sum(card["quantity"] for card in normalized)
    if total_cards != 99:
        raise ValueError(f"Example {example_index}: deck must contain exactly 99 cards, found {total_cards}.")

    seen_non_basics = set()
    for card in normalized:
        import unicodedata
        name_key = unicodedata.normalize("NFKD", card["name"].strip().lower()).encode("ascii", "ignore").decode()
        is_allowed_multi = name_key in BASIC_LAND_NAMES or name_key in MULTI_COPY_LEGAL
        if card["quantity"] > 1 and not is_allowed_multi:
            raise ValueError(
                f"Example {example_index}: duplicate non-basic card '{card['name']}' is not Commander legal."
            )
        if name_key in seen_non_basics and not is_allowed_multi:
            raise ValueError(
                f"Example {example_index}: repeated non-basic card '{card['name']}' should be merged into one entry."
            )
        if not is_allowed_multi:
            seen_non_basics.add(name_key)

    return sorted(normalized, key=lambda card: (card["name"].lower(), card["quantity"]))


def normalize_example(example: dict, index: int) -> dict:
    commander = str(example.get("commander", "")).strip()
    strategy = str(example.get("strategy", "")).strip()
    color_identity = example.get("color_identity") or []
    deck = example.get("deck") or []

    if not commander:
        raise ValueError(f"Example {index}: commander is required.")
    if not strategy:
        raise ValueError(f"Example {index}: strategy is required.")
    if not isinstance(color_identity, list) or not all(isinstance(color, str) for color in color_identity):
        raise ValueError(f"Example {index}: color_identity must be a list of strings.")
    if not isinstance(deck, list) or not deck:
        raise ValueError(f"Example {index}: deck must be a non-empty list.")

    normalized = {
        "commander": commander,
        "color_identity": [color.strip().upper() for color in color_identity if color.strip()],
        "strategy": strategy,
        "deck": validate_deck(deck, index),
        "tags": [str(tag).strip() for tag in example.get("tags", []) if str(tag).strip()],
        "source": str(example.get("source", "unknown")).strip() or "unknown",
        "quality_score": example.get("quality_score"),
        "notes": str(example.get("notes", "")).strip(),
    }
    return normalized


def format_user_prompt(example: dict) -> str:
    lines = [
        f"Commander: {example['commander']}",
        f"Color identity: {', '.join(example['color_identity']) or 'Colorless'}",
        f"Strategy: {example['strategy']}",
    ]
    if example["tags"]:
        lines.append(f"Tags: {', '.join(example['tags'])}")
    if example["notes"]:
        lines.append(f"Notes: {example['notes']}")
    lines.append("Respond with a JSON object containing a short description and the 99-card decklist.")
    return "\n".join(lines)


def format_assistant_response(example: dict) -> str:
    payload = {
        "description": example["strategy"],
        "deck": example["deck"],
    }
    return json.dumps(payload, ensure_ascii=True)


def to_chat_record(example: dict) -> dict:
    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": format_user_prompt(example)},
            {"role": "assistant", "content": format_assistant_response(example)},
        ]
    }


def write_jsonl(path: Path, rows: list[dict]) -> None:
    content = "\n".join(json.dumps(row, ensure_ascii=True) for row in rows)
    path.write_text(content + ("\n" if content else ""), encoding="utf-8")


def split_examples(examples: list[dict], eval_ratio: float, seed: int) -> tuple[list[dict], list[dict]]:
    if not 0 < eval_ratio < 1:
        raise ValueError("--eval-ratio must be between 0 and 1.")

    shuffled = list(examples)
    random.Random(seed).shuffle(shuffled)
    eval_count = max(1, int(len(shuffled) * eval_ratio)) if len(shuffled) > 1 else 0
    eval_examples = shuffled[:eval_count]
    train_examples = shuffled[eval_count:]
    return train_examples, eval_examples


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    raw_examples = load_examples(input_path)
    normalized_examples = [normalize_example(example, index + 1) for index, example in enumerate(raw_examples)]

    train_examples, eval_examples = split_examples(normalized_examples, args.eval_ratio, args.seed)

    write_jsonl(output_dir / "commander_examples.jsonl", normalized_examples)
    write_jsonl(output_dir / "chat_train.jsonl", [to_chat_record(example) for example in train_examples])
    write_jsonl(output_dir / "chat_eval.jsonl", [to_chat_record(example) for example in eval_examples])

    print(f"Loaded {len(raw_examples)} raw examples")
    print(f"Wrote {len(normalized_examples)} normalized examples to {output_dir / 'commander_examples.jsonl'}")
    print(f"Wrote {len(train_examples)} training rows to {output_dir / 'chat_train.jsonl'}")
    print(f"Wrote {len(eval_examples)} evaluation rows to {output_dir / 'chat_eval.jsonl'}")


if __name__ == "__main__":
    main()
