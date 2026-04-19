"""
Batch importer for Moxfield / Archidekt Commander deck text exports.

Reads a CSV manifest alongside the .txt decklist files so each deck
can have its own commander, strategy, color identity, tags, and source.

Usage:
    python src/batch_import_decklists.py \
        --imports-dir data/imports \
        --output data/raw/imported_examples.jsonl

Each .txt file in --imports-dir must have a matching row in manifest.csv.
The manifest lives at <imports-dir>/manifest.csv and is auto-created as a
template when it doesn't exist yet.

Moxfield export steps:
  1. Open any Commander deck on moxfield.com
  2. Click the Export button → select "Text" or "Plain Text"
  3. Copy the text into a .txt file in data/imports/
  4. Fill in the matching row in manifest.csv

Archidekt export steps:
  1. Open any Commander deck on archidekt.com
  2. Click the kebab/more menu → Export → Plain Text
  3. Save the file in data/imports/
  4. Fill in the matching row in manifest.csv

Expected text format (Moxfield / Archidekt plain text):
    Commander
    1 Meren of Clan Nel Toth

    Deck
    1 Sol Ring
    1 Arcane Signet
    ...

Lines starting with a number and card name are parsed; everything else is ignored.
The commander is identified by the --commander override in the manifest; if blank,
the first counted card is used.
"""

import argparse
import csv
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
    "companion",
    "companion:",
    "tokens",
    "tokens:",
}

LINE_PATTERN = re.compile(r"^(?P<quantity>\d+)x?\s+(?P<name>.+?)\s*(?:#.*)?$")

MANIFEST_FIELDS = [
    "filename",
    "commander",
    "color_identity",
    "strategy",
    "tags",
    "source",
    "quality_score",
    "notes",
]

MANIFEST_EXAMPLE_ROW = {
    "filename": "my_deck.txt",
    "commander": "Meren of Clan Nel Toth",
    "color_identity": "B,G",
    "strategy": "Graveyard recursion value engine with sacrifice outlets.",
    "tags": "graveyard,aristocrats,midrange",
    "source": "moxfield",
    "quality_score": "0.85",
    "notes": "Exported from my personal Moxfield list.",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Batch-import Moxfield/Archidekt Commander deck text exports using a CSV manifest."
    )
    parser.add_argument(
        "--imports-dir",
        default="data/imports",
        help="Directory containing .txt decklist files and manifest.csv",
    )
    parser.add_argument(
        "--output",
        default="data/raw/imported_examples.jsonl",
        help="Output JSONL file (appends if it already exists)",
    )
    parser.add_argument(
        "--append",
        action="store_true",
        help="Append to --output instead of overwriting it",
    )
    return parser.parse_args()


def ensure_manifest(manifest_path: Path) -> None:
    if not manifest_path.exists():
        with manifest_path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=MANIFEST_FIELDS)
            writer.writeheader()
            writer.writerow(MANIFEST_EXAMPLE_ROW)
        print(f"Created manifest template at {manifest_path}")
        print("Fill in one row per .txt file in the imports directory, then re-run.")


def load_manifest(manifest_path: Path) -> dict[str, dict]:
    rows: dict[str, dict] = {}
    with manifest_path.open("r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            filename = row.get("filename", "").strip()
            if filename and filename != MANIFEST_EXAMPLE_ROW["filename"]:
                rows[filename] = {k: v.strip() for k, v in row.items()}
    return rows


def parse_color_identity(raw: str) -> list[str]:
    return [t.strip().upper() for t in raw.split(",") if t.strip()]


def parse_tags(raw: str) -> list[str]:
    return [t.strip() for t in raw.split(",") if t.strip()]


def parse_quality_score(raw: str) -> float | None:
    try:
        return float(raw)
    except (ValueError, TypeError):
        return None


def parse_text_decklist(path: Path) -> list[dict]:
    cards: list[dict] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.lower() in SECTION_HEADERS:
            continue
        match = LINE_PATTERN.match(line)
        if not match:
            continue
        name = match.group("name").strip()
        # Strip trailing set/collector annotations like (OTC) 123
        name = re.sub(r"\s*\([A-Z0-9]+\)\s*\d*$", "", name).strip()
        cards.append({"name": name, "quantity": int(match.group("quantity"))})
    if not cards:
        raise ValueError(f"No card rows found in {path.name}.")
    return cards


def split_commander(cards: list[dict], commander_override: str) -> tuple[str, list[dict]]:
    if commander_override:
        commander = commander_override.strip()
        remaining = []
        removed = False
        for card in cards:
            if not removed and card["name"].lower() == commander.lower():
                removed = True
                if card["quantity"] > 1:
                    remaining.append({"name": card["name"], "quantity": card["quantity"] - 1})
                continue
            remaining.append(card)
        if not removed:
            # Commander not found in list — treat it as not in the 99
            pass
        return commander, remaining

    first = cards[0]
    commander = first["name"]
    remaining = list(cards[1:])
    if first["quantity"] > 1:
        remaining.insert(0, {"name": first["name"], "quantity": first["quantity"] - 1})
    return commander, remaining


def build_example(txt_path: Path, meta: dict) -> dict:
    cards = parse_text_decklist(txt_path)
    commander, deck = split_commander(cards, meta.get("commander", ""))
    total = sum(c["quantity"] for c in deck)
    if total != 99:
        raise ValueError(
            f"{txt_path.name}: deck has {total} non-commander cards after parsing; expected 99.\n"
            f"  Check that the export is a complete 100-card Commander deck."
        )
    return {
        "commander": commander,
        "color_identity": parse_color_identity(meta.get("color_identity", "")),
        "strategy": meta.get("strategy", "").strip(),
        "deck": deck,
        "tags": parse_tags(meta.get("tags", "")),
        "source": meta.get("source", "imported").strip() or "imported",
        "quality_score": parse_quality_score(meta.get("quality_score", "")),
        "notes": meta.get("notes", "").strip(),
    }


def main() -> None:
    args = parse_args()
    imports_dir = Path(args.imports_dir)
    output_path = Path(args.output)
    manifest_path = imports_dir / "manifest.csv"

    imports_dir.mkdir(parents=True, exist_ok=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    ensure_manifest(manifest_path)

    manifest = load_manifest(manifest_path)
    if not manifest:
        print("Manifest has no rows yet. Add your deck files and fill in manifest.csv, then re-run.")
        return

    txt_files = sorted(imports_dir.glob("*.txt"))
    if not txt_files:
        print(f"No .txt files found in {imports_dir}. Export decks from Moxfield/Archidekt and place them here.")
        return

    results = []
    errors = []
    for txt_path in txt_files:
        meta = manifest.get(txt_path.name)
        if meta is None:
            print(f"  SKIP  {txt_path.name} — not listed in manifest.csv")
            continue
        try:
            example = build_example(txt_path, meta)
            results.append(example)
            print(f"  OK    {txt_path.name} ({example['commander']})")
        except ValueError as exc:
            errors.append((txt_path.name, str(exc)))
            print(f"  ERROR {txt_path.name}: {exc}")

    if results:
        mode = "a" if args.append else "w"
        with output_path.open(mode, encoding="utf-8") as f:
            for row in results:
                f.write(json.dumps(row, ensure_ascii=True) + "\n")
        action = "Appended" if args.append else "Wrote"
        print(f"\n{action} {len(results)} example(s) to {output_path}")
    else:
        print("\nNo examples were successfully imported.")

    if errors:
        print(f"\n{len(errors)} file(s) had errors — fix and re-run:")
        for fname, msg in errors:
            print(f"  {fname}: {msg}")


if __name__ == "__main__":
    main()
