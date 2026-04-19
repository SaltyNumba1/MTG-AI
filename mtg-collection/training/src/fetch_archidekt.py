"""
Fetches public Commander decks from Archidekt by sampling deck IDs and
converts them into the raw training example schema (commander_examples.jsonl).

Archidekt's public deck API is used at:
  https://archidekt.com/api/decks/{id}/

No authentication is required for public decks. Private/unlisted decks are
automatically skipped.

Usage:
    python src/fetch_archidekt.py \
        --output data/raw/archidekt_examples.jsonl

    python src/fetch_archidekt.py \
        --start-id 1000000 \
        --end-id 5000000 \
        --sample-size 200 \
        --output data/raw/archidekt_examples.jsonl \
        --delay 1.0

The script samples IDs randomly within --start-id..--end-id. You can also
pass an explicit list of known deck IDs with --deck-ids.
"""

import argparse
import json
import random
import time
import urllib.request
import urllib.error
from pathlib import Path


ARCHIDEKT_DECK_URL = "https://archidekt.com/api/decks/{id}/"
USER_AGENT = "MTG-Training-Pipeline/1.0 (educational; github.com)"

COMMANDER_FORMAT = 3  # Archidekt's internal format code for Commander/EDH

COLOR_MAP = {
    "White": "W",
    "Blue": "U",
    "Black": "B",
    "Red": "R",
    "Green": "G",
    "Colorless": "C",
}

BASIC_LAND_NAMES = {
    "plains", "island", "swamp", "mountain", "forest", "wastes",
    "snow-covered plains", "snow-covered island", "snow-covered swamp",
    "snow-covered mountain", "snow-covered forest",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch public Commander decks from Archidekt and convert to training JSONL."
    )
    parser.add_argument(
        "--deck-ids",
        nargs="+",
        type=int,
        metavar="ID",
        help="Explicit list of Archidekt deck IDs to fetch.",
    )
    parser.add_argument(
        "--start-id",
        type=int,
        default=1_000_000,
        help="Start of the ID range to sample from (default: 1,000,000).",
    )
    parser.add_argument(
        "--end-id",
        type=int,
        default=5_200_000,
        help="End of the ID range to sample from (default: 5,200,000).",
    )
    parser.add_argument(
        "--sample-size",
        type=int,
        default=100,
        help="Number of random IDs to try when no explicit IDs are given (default: 100).",
    )
    parser.add_argument(
        "--output",
        default="data/raw/archidekt_examples.jsonl",
        help="Output JSONL file.",
    )
    parser.add_argument(
        "--append",
        action="store_true",
        help="Append to output instead of overwriting.",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.2,
        help="Seconds to wait between API requests (default: 1.2).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Random seed for reproducible ID sampling.",
    )
    parser.add_argument(
        "--min-view-count",
        type=int,
        default=50,
        help="Skip decks with fewer views than this (proxy for quality, default: 50).",
    )
    return parser.parse_args()


def fetch_deck(deck_id: int) -> dict | None:
    """Fetch a single Archidekt deck JSON. Returns None on any error."""
    url = ARCHIDEKT_DECK_URL.format(id=deck_id)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code not in (401, 403, 404):
            print(f"    HTTP {exc.code}")
        return None
    except Exception as exc:
        print(f"    Error: {exc}")
        return None


def get_oracle_name(card_entry: dict) -> str:
    """Safely extract the oracle/canonical card name from an Archidekt card entry."""
    try:
        return card_entry["card"]["oracleCard"]["name"].strip()
    except (KeyError, TypeError, AttributeError):
        # Fall back to displayName
        try:
            return card_entry["card"]["displayName"].strip() or ""
        except Exception:
            return ""


def get_color_identity(card_entry: dict) -> list[str]:
    """Extract color identity as WUBRG letters from a commander card entry."""
    try:
        raw = card_entry["card"]["oracleCard"]["colorIdentity"]
        return [COLOR_MAP[c] for c in raw if c in COLOR_MAP]
    except (KeyError, TypeError):
        return []


def is_commander_category(categories: list) -> bool:
    """Return True if the card's categories include the Commander slot."""
    if not categories:
        return False
    return any(str(c).lower() == "commander" for c in categories)


def parse_deck(data: dict, min_view_count: int) -> dict | None:
    """
    Parse an Archidekt deck JSON into a training example.
    Returns None if the deck should be skipped.
    """
    # Must be Commander format
    if data.get("deckFormat") != COMMANDER_FORMAT:
        return None

    # Skip private or unlisted decks
    if data.get("private") or data.get("unlisted"):
        return None

    # Minimum view threshold as a quality proxy
    if data.get("viewCount", 0) < min_view_count:
        return None

    cards_raw = data.get("cards") or []

    # Find commander card(s)
    commander_entries = [c for c in cards_raw if is_commander_category(c.get("categories") or [])]
    if not commander_entries:
        return None

    # Use the first commander (partner commanders are edge cases we skip for now)
    commander_entry = commander_entries[0]
    commander_name = get_oracle_name(commander_entry)
    if not commander_name:
        return None

    color_identity = get_color_identity(commander_entry)

    # Build the 99-card deck (exclude commander)
    deck_cards: dict[str, int] = {}
    commander_key = commander_name.lower()

    for card_entry in cards_raw:
        # Skip deleted cards
        if card_entry.get("deletedAt"):
            continue
        # Skip non-deck categories (sideboard, maybeboard)
        categories = card_entry.get("categories") or []
        if is_commander_category(categories):
            continue

        name = get_oracle_name(card_entry)
        if not name or name.lower() == commander_key:
            continue

        quantity = card_entry.get("quantity") or 1
        deck_cards[name] = deck_cards.get(name, 0) + quantity

    deck = [{"name": name, "quantity": qty} for name, qty in deck_cards.items()]
    total = sum(c["quantity"] for c in deck)

    if total != 99:
        return None  # Only accept clean 99-card decks

    # Derive strategy from deck name and tags
    deck_name = data.get("name", "").strip()
    deck_tags = [t.get("name", "").strip() for t in (data.get("deckTags") or []) if t.get("name")]
    strategy = deck_name if deck_name else f"Commander deck with {commander_name}."

    return {
        "commander": commander_name,
        "color_identity": color_identity,
        "strategy": strategy,
        "deck": deck,
        "tags": deck_tags,
        "source": f"archidekt:{data['id']}",
        "quality_score": None,
        "notes": f"View count: {data.get('viewCount', 0)}. Fetched from archidekt.com/decks/{data['id']}",
    }


def generate_ids(args: argparse.Namespace) -> list[int]:
    if args.deck_ids:
        return list(args.deck_ids)
    rng = random.Random(args.seed)
    return rng.sample(range(args.start_id, args.end_id + 1), args.sample_size)


def main() -> None:
    args = parse_args()
    ids = generate_ids(args)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Sampling {len(ids)} Archidekt deck IDs "
          f"(range {args.start_id:,}–{args.end_id:,}, min views: {args.min_view_count})...")

    results = []
    skipped_format = 0
    skipped_private = 0
    skipped_incomplete = 0
    errors = 0

    for i, deck_id in enumerate(ids):
        print(f"[{i+1}/{len(ids)}] Deck #{deck_id}", end=" ... ")

        data = fetch_deck(deck_id)
        if data is None:
            print("not found / error")
            errors += 1
            if i < len(ids) - 1:
                time.sleep(args.delay * 0.5)
            continue

        fmt = data.get("deckFormat")
        if fmt != COMMANDER_FORMAT:
            print(f"skip (format {fmt})")
            skipped_format += 1
            if i < len(ids) - 1:
                time.sleep(args.delay * 0.3)
            continue

        if data.get("private") or data.get("unlisted"):
            print("skip (private)")
            skipped_private += 1
            if i < len(ids) - 1:
                time.sleep(args.delay * 0.3)
            continue

        example = parse_deck(data, args.min_view_count)
        if example is None:
            print("skip (incomplete deck / low views)")
            skipped_incomplete += 1
        else:
            results.append(example)
            total = sum(c["quantity"] for c in example["deck"])
            print(f"OK  [{example['commander']}]  {total} cards  views={data.get('viewCount',0)}")

        if i < len(ids) - 1:
            time.sleep(args.delay)

    # Write output
    if results:
        mode = "a" if args.append else "w"
        with output_path.open(mode, encoding="utf-8") as f:
            for row in results:
                f.write(json.dumps(row, ensure_ascii=True) + "\n")
        action = "Appended" if args.append else "Wrote"
        print(f"\n{action} {len(results)} example(s) to {output_path}")
    else:
        print("\nNo valid Commander decks found in this sample.")

    print(
        f"\nSummary: {len(results)} saved | "
        f"{skipped_format} wrong format | "
        f"{skipped_private} private | "
        f"{skipped_incomplete} incomplete | "
        f"{errors} errors"
    )

    if len(results) < 10 and not args.deck_ids:
        print(
            "\nTip: Try a wider ID range or lower --min-view-count. "
            "Commander decks make up ~30% of all Archidekt decks."
        )


if __name__ == "__main__":
    main()
