"""
Fetches EDHREC "average deck" data for a list of commanders and converts
them into the raw training example schema (commander_examples.jsonl).

EDHREC's public JSON API is used at:
  https://json.edhrec.com/pages/commanders/{slug}.json

No authentication is required. The script respects rate limiting with a
configurable delay between requests.

Usage:
    python src/fetch_edhrec.py \
        --output data/raw/edhrec_examples.jsonl

    python src/fetch_edhrec.py \
        --commanders "Meren of Clan Nel Toth" "Atraxa, Praetors' Voice" \
        --output data/raw/edhrec_examples.jsonl \
        --delay 1.5

The commander list can also be read from a plain text file (one name per line):
    python src/fetch_edhrec.py \
        --commanders-file data/imports/commander_list.txt \
        --output data/raw/edhrec_examples.jsonl
"""

import argparse
import json
import re
import time
import unicodedata
import urllib.request
import urllib.error
from pathlib import Path


# Popular commanders to fetch when no explicit list is given
DEFAULT_COMMANDERS = [
    "Meren of Clan Nel Toth",
    "Atraxa, Praetors' Voice",
    "Edgar Markov",
    "Yuriko, the Tiger's Shadow",
    "Prossh, Skyraider of Kher",
    "Omnath, Locus of Creation",
    "Breya, Etherium Shaper",
    "Sisay, Weatherlight Captain",
    "Kaalia of the Vast",
    "Narset, Enlightened Master",
    "Muldrotha, the Gravetide",
    "The Ur-Dragon",
    "Krenko, Mob Boss",
    "Ezuri, Claw of Progress",
    "The Gitrog Monster",
    "Zur the Enchanter",
    "Oloro, Ageless Ascetic",
    "Teysa Karlov",
    "Kinnan, Bonder Prodigy",
    "Sidisi, Brood Tyrant",
    "Grenzo, Dungeon Warden",
    "Kess, Dissident Mage",
    "Tasigur, the Golden Fang",
    "Najeela, the Blade-Blossom",
    "Kenrith, the Returned King",
    "Chulane, Teller of Tales",
    "Korvold, Fae-Cursed King",
    "Riku of Two Reflections",
    "Nicol Bolas, the Ravager",
    "Sharuum the Hegemon",
]

COLOR_MAP = {
    "White": "W",
    "Blue": "U",
    "Black": "B",
    "Red": "R",
    "Green": "G",
}

BASIC_LANDS = {
    "Plains", "Island", "Swamp", "Mountain", "Forest",
    "Wastes",
    "Snow-Covered Plains", "Snow-Covered Island", "Snow-Covered Swamp",
    "Snow-Covered Mountain", "Snow-Covered Forest",
}

EDHREC_BASE = "https://json.edhrec.com/pages/commanders/{slug}.json"
USER_AGENT = "MTG-Training-Pipeline/1.0 (educational; github.com)"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch EDHREC average-deck data and convert to training JSONL."
    )
    parser.add_argument(
        "--commanders",
        nargs="+",
        metavar="NAME",
        help="One or more commander names to fetch. Uses built-in popular list if omitted.",
    )
    parser.add_argument(
        "--commanders-file",
        help="Path to a plain text file with one commander name per line.",
    )
    parser.add_argument(
        "--output",
        default="data/raw/edhrec_examples.jsonl",
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
        default=1.0,
        help="Seconds to wait between API requests (default: 1.0).",
    )
    parser.add_argument(
        "--min-cards",
        type=int,
        default=60,
        help="Skip commanders where EDHREC returns fewer than this many recommended cards.",
    )
    return parser.parse_args()


def name_to_slug(name: str) -> str:
    """Convert a commander name to the EDHREC URL slug format."""
    # Normalize unicode apostrophes / accents
    normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    # Remove apostrophes entirely (Tiger's → Tigers) before hyphenating
    normalized = normalized.replace("'", "")
    # Lowercase, replace spaces and remaining punctuation with hyphens
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return slug


def fetch_json(url: str) -> dict | None:
    """Fetch a URL and parse JSON. Returns None on error."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        print(f"    HTTP {exc.code} for {url}")
        return None
    except Exception as exc:
        print(f"    Error fetching {url}: {exc}")
        return None


def extract_cardviews(data: dict) -> list[dict]:
    """
    Walk the EDHREC JSON and collect all cardview entries across all sections.
    The JSON has a top-level list of section objects, each with a 'cardviews' key.
    """
    cards: list[dict] = []
    seen: set[str] = set()

    def walk(obj):
        if isinstance(obj, dict):
            if "name" in obj and "num_decks" in obj and "potential_decks" in obj:
                name = obj["name"].strip()
                if name and name not in seen:
                    seen.add(name)
                    cards.append(obj)
            else:
                for v in obj.values():
                    walk(v)
        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    walk(data)
    return cards


def extract_color_identity(data: dict) -> list[str]:
    """Try to find color identity from the EDHREC page data."""
    # Look for colorIdentity or color_identity anywhere in the top level
    for key in ("colorIdentity", "color_identity", "colors"):
        val = data.get(key)
        if isinstance(val, list):
            return [COLOR_MAP.get(c, c) for c in val if COLOR_MAP.get(c, c)]
    return []


def extract_commander_name(data: dict, slug: str) -> str:
    """Extract the canonical commander name from EDHREC page data."""
    # Try header or title fields
    for key in ("header", "title", "name", "commander"):
        val = data.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    # Fall back: convert slug back to title case
    return slug.replace("-", " ").title()


def build_deck_from_cardviews(
    cardviews: list[dict],
    color_identity: list[str],
    commander: str,
) -> list[dict] | None:
    """
    Build a 99-card deck from EDHREC card recommendation data.

    Strategy:
    - Sort all non-basic cards by inclusion rate (num_decks / potential_decks)
    - Take enough top cards to fill non-land slots
    - Fill remaining slots with basic lands spread across color identity
    """
    non_basics = [
        c for c in cardviews
        if c["name"] not in BASIC_LANDS and c["name"].lower() != commander.lower()
    ]
    non_basics.sort(key=lambda c: c["num_decks"] / max(c["potential_decks"], 1), reverse=True)

    # Target roughly 35 lands in a 99-card deck
    LAND_COUNT = 36
    non_land_target = 99 - LAND_COUNT

    top_non_basics = non_basics[:non_land_target]

    if len(top_non_basics) < 30:
        return None  # Not enough data

    # Build deck entries
    deck: list[dict] = [{"name": c["name"], "quantity": 1} for c in top_non_basics]

    # Fill remaining with basic lands
    remaining = 99 - len(deck)
    lands_to_add = _distribute_basics(remaining, color_identity)
    deck.extend(lands_to_add)

    # Trim or pad to exactly 99
    total = sum(c["quantity"] for c in deck)
    if total > 99:
        deck = deck[:99]
    elif total < 99:
        deck[-1]["quantity"] += 99 - total

    return deck


def _distribute_basics(count: int, colors: list[str]) -> list[dict]:
    """Distribute `count` basic lands evenly across the given color identities."""
    color_to_land = {"W": "Plains", "U": "Island", "B": "Swamp", "R": "Mountain", "G": "Forest"}
    valid = [color_to_land[c] for c in colors if c in color_to_land]
    if not valid:
        valid = ["Wastes"]

    base, extra = divmod(count, len(valid))
    return [
        {"name": land, "quantity": base + (1 if i < extra else 0)}
        for i, land in enumerate(valid)
        if base + (1 if i < extra else 0) > 0
    ]


def fetch_commander(commander_name: str, min_cards: int) -> dict | None:
    """Fetch EDHREC data for a single commander and return a training example."""
    slug = name_to_slug(commander_name)
    url = EDHREC_BASE.format(slug=slug)
    print(f"  Fetching: {url}")

    data = fetch_json(url)
    if data is None:
        return None

    cardviews = extract_cardviews(data)
    if len(cardviews) < min_cards:
        print(f"    Only {len(cardviews)} cards returned — skipping.")
        return None

    color_identity = extract_color_identity(data)
    canonical_name = extract_commander_name(data, slug)

    deck = build_deck_from_cardviews(cardviews, color_identity, canonical_name)
    if deck is None:
        print(f"    Could not build a full deck — skipping.")
        return None

    total = sum(c["quantity"] for c in deck)
    if total != 99:
        print(f"    Deck total {total} != 99 — skipping.")
        return None

    strategy = f"EDHREC average deck for {canonical_name}. Top cards by inclusion rate across {data.get('num_decks_avg', 'unknown')} registered decks."

    return {
        "commander": canonical_name,
        "color_identity": color_identity,
        "strategy": strategy,
        "deck": deck,
        "tags": ["edhrec-average"],
        "source": "edhrec",
        "quality_score": None,
        "notes": f"Built from EDHREC inclusion data. {len(cardviews)} cards in recommendation pool.",
    }


def load_commander_list(args: argparse.Namespace) -> list[str]:
    if args.commanders_file:
        path = Path(args.commanders_file)
        names = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        return names
    if args.commanders:
        return list(args.commanders)
    return DEFAULT_COMMANDERS


def main() -> None:
    args = parse_args()
    commanders = load_commander_list(args)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Fetching {len(commanders)} commander(s) from EDHREC...")

    results = []
    errors = []

    for i, name in enumerate(commanders):
        print(f"[{i+1}/{len(commanders)}] {name}")
        try:
            example = fetch_commander(name, args.min_cards)
            if example:
                results.append(example)
                print(f"    OK — {len(example['deck'])} slots ({sum(c['quantity'] for c in example['deck'])} cards)")
            else:
                errors.append(name)
        except Exception as exc:
            print(f"    Unexpected error: {exc}")
            errors.append(name)

        if i < len(commanders) - 1:
            time.sleep(args.delay)

    if results:
        mode = "a" if args.append else "w"
        with output_path.open(mode, encoding="utf-8") as f:
            for row in results:
                f.write(json.dumps(row, ensure_ascii=True) + "\n")
        action = "Appended" if args.append else "Wrote"
        print(f"\n{action} {len(results)} example(s) to {output_path}")
    else:
        print("\nNo examples were successfully fetched.")

    if errors:
        print(f"\n{len(errors)} commander(s) failed: {', '.join(errors)}")


if __name__ == "__main__":
    main()
