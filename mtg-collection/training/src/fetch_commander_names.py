"""
Build a big commander_list.txt by querying Scryfall for every card that's
legal as a Commander.

Scryfall search query: `is:commander legal:commander`
- includes legendary creatures, planeswalkers with "can be your commander",
  and Background/partner pairs.
- excludes banned cards.

Pagination is handled (Scryfall caps each page at 175 cards).
Output is one name per line, deduped, sorted.

Usage:
    python src/fetch_commander_names.py \
        --output data/imports/commander_list_all.txt
"""

import argparse
import json
import time
import urllib.request
from pathlib import Path

SEARCH_URL = "https://api.scryfall.com/cards/search?q=is%3Acommander+legal%3Acommander&unique=cards&order=edhrec"
USER_AGENT = "MTG-Training-Pipeline/1.0 (educational)"


def fetch(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="data/imports/commander_list_all.txt")
    parser.add_argument("--max-pages", type=int, default=50, help="Safety cap (each page ~175 cards).")
    parser.add_argument("--delay", type=float, default=0.1, help="Seconds between Scryfall pages.")
    args = parser.parse_args()

    names: list[str] = []
    seen: set[str] = set()
    url = SEARCH_URL
    pages = 0

    while url and pages < args.max_pages:
        pages += 1
        print(f"  page {pages}: {url[:80]}...")
        data = fetch(url)
        for card in data.get("data", []):
            name = card.get("name", "").strip()
            # Split MDFC / DFC commander names into the front face only
            if " // " in name:
                name = name.split(" // ")[0].strip()
            if name and name not in seen:
                seen.add(name)
                names.append(name)
        if data.get("has_more"):
            url = data.get("next_page")
            time.sleep(args.delay)
        else:
            url = None

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(sorted(names)) + "\n", encoding="utf-8")
    print(f"\nWrote {len(names):,} commander names to {out}")


if __name__ == "__main__":
    main()
