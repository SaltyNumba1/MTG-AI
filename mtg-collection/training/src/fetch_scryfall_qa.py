"""
Generate Q&A training examples from Scryfall's oracle bulk data.

Teaches the model what individual cards do — independent of deckbuilding.
This is cheap (no network besides the one bulk download) and dramatically
improves the model's card knowledge floor.

Output schema (JSONL, one example per line):
    {"type": "card_qa", "card": "Sol Ring", "q": "...", "a": "..."}

Usage:
    python src/fetch_scryfall_qa.py \
        --bulk data/raw/scryfall-oracle-cards.json \
        --output data/raw/scryfall_qa.jsonl \
        --max-cards 8000 \
        --questions-per-card 3

Bulk file:
    Download from https://scryfall.com/docs/api/bulk-data
    Pick the "Oracle Cards" file (~150MB, ~30k cards).
"""

import argparse
import json
import random
import re
from pathlib import Path


# Question templates. Each template uses {name} and is paired with a function
# that produces the answer from a Scryfall card object.
def _ans_text(card: dict) -> str:
    text = (card.get("oracle_text") or "").strip()
    return text or "This card has no rules text."


def _ans_cost(card: dict) -> str:
    cost = card.get("mana_cost") or ""
    cmc = card.get("cmc")
    if not cost:
        return f"{card['name']} has no mana cost."
    return f"{card['name']} costs {cost} (mana value {int(cmc) if cmc is not None else '?'})."


def _ans_type(card: dict) -> str:
    return f"{card['name']} is a {card.get('type_line', 'card')}."


def _ans_color_identity(card: dict) -> str:
    ci = card.get("color_identity") or []
    label = "".join(ci) if ci else "Colorless (C)"
    return f"{card['name']} has color identity {label}."


def _ans_pt(card: dict) -> str:
    p, t = card.get("power"), card.get("toughness")
    if p is None or t is None:
        return f"{card['name']} is not a creature with power/toughness."
    return f"{card['name']} is {p}/{t}."


def _ans_legalities(card: dict) -> str:
    legs = card.get("legalities", {})
    fmts = ["commander", "modern", "legacy", "vintage", "pioneer", "standard", "pauper"]
    parts = [f"{f}: {legs.get(f, 'unknown')}" for f in fmts]
    return f"Legality of {card['name']}: " + ", ".join(parts) + "."


def _ans_full(card: dict) -> str:
    parts = [
        f"Name: {card['name']}",
        f"Mana cost: {card.get('mana_cost') or 'none'} (CMC {card.get('cmc', 0)})",
        f"Type: {card.get('type_line', '?')}",
    ]
    p, t = card.get("power"), card.get("toughness")
    if p is not None and t is not None:
        parts.append(f"Power/Toughness: {p}/{t}")
    loy = card.get("loyalty")
    if loy is not None:
        parts.append(f"Loyalty: {loy}")
    if card.get("oracle_text"):
        parts.append(f"Oracle text: {card['oracle_text'].strip()}")
    ci = "".join(card.get("color_identity") or []) or "Colorless"
    parts.append(f"Color identity: {ci}")
    return "\n".join(parts)


QUESTION_BANK: list[tuple[str, callable]] = [
    ("What does {name} do?", _ans_text),
    ("Explain the rules text of {name}.", _ans_text),
    ("What is the mana cost of {name}?", _ans_cost),
    ("How much does {name} cost to cast?", _ans_cost),
    ("What card type is {name}?", _ans_type),
    ("Is {name} a creature, instant, or something else?", _ans_type),
    ("What is {name}'s color identity?", _ans_color_identity),
    ("Can I play {name} in a Commander deck led by a mono-green commander?", _ans_color_identity),
    ("What are {name}'s power and toughness?", _ans_pt),
    ("Give me a full summary of the card {name}.", _ans_full),
    ("In which formats is {name} legal?", _ans_legalities),
]


SKIP_LAYOUTS = {"token", "double_faced_token", "emblem", "art_series", "vanguard", "scheme", "planar"}
SKIP_SET_TYPES = {"funny", "memorabilia", "token"}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate Q&A training examples from Scryfall oracle cards.")
    p.add_argument("--bulk", required=True, help="Path to scryfall oracle-cards bulk JSON file.")
    p.add_argument("--output", default="data/raw/scryfall_qa.jsonl", help="Output JSONL path.")
    p.add_argument("--max-cards", type=int, default=8000, help="Maximum number of cards to sample (default: 8000).")
    p.add_argument("--questions-per-card", type=int, default=3, help="How many Q&A pairs per card (default: 3).")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument(
        "--commander-only",
        action="store_true",
        help="Restrict to cards legal in Commander.",
    )
    return p.parse_args()


def is_usable_card(card: dict, commander_only: bool) -> bool:
    if card.get("layout") in SKIP_LAYOUTS:
        return False
    if card.get("set_type") in SKIP_SET_TYPES:
        return False
    if not card.get("name"):
        return False
    if card.get("type_line", "").lower().startswith("token"):
        return False
    if commander_only and card.get("legalities", {}).get("commander") not in ("legal", "restricted"):
        return False
    return True


def main() -> None:
    args = parse_args()
    bulk_path = Path(args.bulk)
    if not bulk_path.exists():
        raise SystemExit(
            f"Scryfall bulk file not found: {bulk_path}\n"
            "Download the 'Oracle Cards' bulk JSON from https://scryfall.com/docs/api/bulk-data"
        )

    print(f"Loading {bulk_path} ...")
    with bulk_path.open("r", encoding="utf-8") as f:
        all_cards = json.load(f)
    print(f"  {len(all_cards):,} raw card entries.")

    usable = [c for c in all_cards if is_usable_card(c, args.commander_only)]
    print(f"  {len(usable):,} usable after filtering.")

    rng = random.Random(args.seed)
    rng.shuffle(usable)
    sample = usable[: args.max_cards]
    print(f"  Sampling {len(sample):,} cards.")

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    written = 0
    with out_path.open("w", encoding="utf-8") as out:
        for card in sample:
            templates = rng.sample(QUESTION_BANK, k=min(args.questions_per_card, len(QUESTION_BANK)))
            for q_template, ans_fn in templates:
                question = q_template.format(name=card["name"])
                answer = ans_fn(card)
                row = {
                    "type": "card_qa",
                    "card": card["name"],
                    "q": question,
                    "a": answer,
                }
                out.write(json.dumps(row, ensure_ascii=True) + "\n")
                written += 1

    print(f"\nWrote {written:,} Q&A examples to {out_path}")


if __name__ == "__main__":
    main()
