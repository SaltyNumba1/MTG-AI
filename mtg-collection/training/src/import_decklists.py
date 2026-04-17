import argparse
import json
import re
from pathlib import Path


SECTION_HEADERS = {
    "commander",
    "commander:",
    "deck",
    "deck:",
    "sideboard",
    "sideboard:",
    "maybeboard",
    "maybeboard:",
}

LINE_PATTERN = re.compile(r"^(?P<quantity>\d+)\s+(?P<name>.+?)\s*$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert Commander decklist text exports into the raw training example schema."
    )
    parser.add_argument("--input", required=True, help="Path to a .txt file or a directory of .txt files")
    parser.add_argument("--output", required=True, help="Path to output JSONL file")
    parser.add_argument("--strategy", required=True, help="Strategy text to attach to imported examples")
    parser.add_argument(
        "--color-identity",
        default="",
        help="Comma-separated color identity, for example W,U or B,G",
    )
    parser.add_argument(
        "--commander",
        default="",
        help="Optional explicit commander override. If omitted, the first counted card is used.",
    )
    parser.add_argument(
        "--source",
        default="imported",
        help="Source label to store in each example",
    )
    parser.add_argument(
        "--notes",
        default="",
        help="Optional notes to attach to imported examples",
    )
    parser.add_argument(
        "--tags",
        default="",
        help="Comma-separated tags to attach to imported examples",
    )
    return parser.parse_args()


def parse_color_identity(raw_value: str) -> list[str]:
    if not raw_value.strip():
        return []
    return [token.strip().upper() for token in raw_value.split(",") if token.strip()]


def parse_tags(raw_value: str) -> list[str]:
    if not raw_value.strip():
        return []
    return [token.strip() for token in raw_value.split(",") if token.strip()]


def is_section_header(line: str) -> bool:
    return line.strip().lower() in SECTION_HEADERS


def parse_text_decklist(path: Path) -> list[dict]:
    cards: list[dict] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or is_section_header(line):
            continue
        match = LINE_PATTERN.match(line)
        if not match:
            continue
        cards.append(
            {
                "name": match.group("name").strip(),
                "quantity": int(match.group("quantity")),
            }
        )
    if not cards:
        raise ValueError(f"No card rows were found in {path.name}.")
    return cards


def split_commander(cards: list[dict], commander_override: str) -> tuple[str, list[dict]]:
    if commander_override:
        commander = commander_override.strip()
        remaining = []
        commander_removed = False
        for card in cards:
            if not commander_removed and card["name"].lower() == commander.lower():
                commander_removed = True
                if card["quantity"] > 1:
                    remaining.append({"name": card["name"], "quantity": card["quantity"] - 1})
                continue
            remaining.append(card)
        return commander, remaining

    first_card = cards[0]
    commander = first_card["name"]
    remaining = list(cards[1:])
    if first_card["quantity"] > 1:
        remaining.insert(0, {"name": first_card["name"], "quantity": first_card["quantity"] - 1})
    return commander, remaining


def validate_deck_total(deck: list[dict], path: Path) -> None:
    total = sum(card["quantity"] for card in deck)
    if total != 99:
        raise ValueError(f"Deck '{path.name}' has {total} non-commander cards after conversion; expected 99.")


def build_example(path: Path, args: argparse.Namespace) -> dict:
    cards = parse_text_decklist(path)
    commander, deck = split_commander(cards, args.commander)
    validate_deck_total(deck, path)
    return {
        "commander": commander,
        "color_identity": parse_color_identity(args.color_identity),
        "strategy": args.strategy.strip(),
        "deck": deck,
        "tags": parse_tags(args.tags),
        "source": args.source.strip() or "imported",
        "quality_score": None,
        "notes": args.notes.strip(),
    }


def collect_input_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    return sorted(candidate for candidate in path.glob("*.txt") if candidate.is_file())


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    files = collect_input_files(input_path)
    if not files:
        raise ValueError("No input decklist files were found.")

    rows = [build_example(path, args) for path in files]
    output_path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=True) for row in rows) + "\n",
        encoding="utf-8",
    )

    print(f"Converted {len(rows)} decklist file(s) into {output_path}")


if __name__ == "__main__":
    main()
