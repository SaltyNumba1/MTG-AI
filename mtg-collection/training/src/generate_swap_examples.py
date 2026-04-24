"""
Generate "swap / edit" training examples from existing decklists.

Each output example shows: a starting deck, a user request to swap N cards
for a reason (budget, more ramp, more removal, change archetype), and a
revised deck. This teaches the model multi-turn editing — a capability the
v1 SFT data does not cover.

Strategy:
  - Read existing high-quality decks from data/processed/commander_examples.jsonl.
  - Sample 1–3 cards from the deck to "remove".
  - Sample replacement cards from a curated archetype pool (ramp, draw,
    removal, lands, wincons) consistent with color identity.
  - Emit the request + the revised deck as a single training example.

Output schema:
    {
        "type": "swap_edit",
        "commander": "...",
        "color_identity": ["W","U","B"],
        "reason": "more ramp",
        "removed": ["Card A", "Card B"],
        "added":   ["Card C", "Card D"],
        "deck_before": [...],
        "deck_after":  [...]
    }
"""

import argparse
import json
import random
from pathlib import Path


# Curated archetype pools. Keep small and high-signal; the model just needs
# enough examples to learn the *shape* of an edit, not memorize cards.
ARCHETYPE_POOLS = {
    "ramp": {
        "C": ["Sol Ring", "Arcane Signet", "Mind Stone", "Thought Vessel", "Wayfarer's Bauble", "Commander's Sphere"],
        "G": ["Cultivate", "Kodama's Reach", "Rampant Growth", "Three Visits", "Nature's Lore", "Farseek", "Sakura-Tribe Elder"],
        "W": ["Land Tax", "Knight of the White Orchid", "Smothering Tithe"],
        "B": ["Dark Ritual", "Bubbling Muck"],
        "R": ["Jeska's Will", "Wheel of Fortune"],
        "U": ["High Tide"],
    },
    "draw": {
        "C": ["Skullclamp", "Mind's Eye", "Mask of Memory"],
        "U": ["Rhystic Study", "Mystic Remora", "Brainstorm", "Ponder", "Preordain", "Fact or Fiction"],
        "B": ["Phyrexian Arena", "Read the Bones", "Sign in Blood", "Bolas's Citadel"],
        "G": ["Beast Whisperer", "Guardian Project", "Sylvan Library"],
        "W": ["Esper Sentinel", "Welcoming Vampire"],
        "R": ["Wheel of Misfortune", "Faithless Looting"],
    },
    "removal": {
        "W": ["Swords to Plowshares", "Path to Exile", "Generous Gift", "Fateful Absence"],
        "B": ["Go for the Throat", "Doom Blade", "Hero's Downfall", "Toxic Deluge", "Damnation"],
        "R": ["Lightning Bolt", "Chaos Warp", "Vandalblast"],
        "U": ["Counterspell", "Swan Song", "Cyclonic Rift", "Pongify"],
        "G": ["Beast Within", "Krosan Grip"],
        "C": ["Meteor Golem", "Pithing Needle"],
    },
    "lands": {
        "C": ["Command Tower", "Path of Ancestry", "Reliquary Tower", "Bojuka Bog", "Strip Mine", "Wasteland", "Exotic Orchard"],
    },
    "budget": {
        "C": ["Mind Stone", "Thought Vessel", "Wayfarer's Bauble", "Commander's Sphere", "Arcane Signet", "Sol Ring", "Skullclamp"],
    },
    "wincon": {
        "C": ["Triumph of the Hordes", "Approach of the Second Sun", "Craterhoof Behemoth", "Aetherflux Reservoir"],
    },
}


REASONS = [
    ("more ramp", "ramp", "Swap in cheaper mana acceleration so the deck ramps faster."),
    ("more card draw", "draw", "Add more reliable card draw."),
    ("more removal", "removal", "Add more interaction to deal with opposing threats."),
    ("better mana base", "lands", "Improve the mana base with utility lands."),
    ("more budget-friendly", "budget", "Cheaper alternatives that still pull weight."),
    ("a wincon package", "wincon", "Add a clearer path to closing the game."),
]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate swap/edit training examples from existing decklists.")
    p.add_argument(
        "--input",
        default="data/processed/commander_examples.jsonl",
        help="Existing normalized deck examples to derive edits from.",
    )
    p.add_argument("--output", default="data/raw/swap_examples.jsonl", help="Output JSONL path.")
    p.add_argument(
        "--per-deck",
        type=int,
        default=2,
        help="Number of swap examples to derive from each source deck (default: 2).",
    )
    p.add_argument("--seed", type=int, default=42)
    p.add_argument(
        "--max-swaps",
        type=int,
        default=3,
        help="Maximum number of cards swapped in a single example (default: 3).",
    )
    return p.parse_args()


def load_decks(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def candidate_replacements(pool_key: str, colors: list[str], rng: random.Random, k: int) -> list[str]:
    pool = ARCHETYPE_POOLS.get(pool_key, {})
    candidates: list[str] = list(pool.get("C", []))
    for c in colors:
        candidates.extend(pool.get(c, []))
    rng.shuffle(candidates)
    seen, out = set(), []
    for name in candidates:
        if name not in seen:
            seen.add(name)
            out.append(name)
        if len(out) >= k:
            break
    return out


def make_swap(deck: dict, rng: random.Random, max_swaps: int) -> dict | None:
    cards = deck.get("deck") or []
    if len(cards) < 50:
        return None

    reason_label, pool_key, reason_blurb = rng.choice(REASONS)

    n_swaps = rng.randint(1, max_swaps)

    # Pick removable cards: prefer non-basics, prefer cards NOT already in the target pool
    pool_names = set()
    for archetype in ARCHETYPE_POOLS.values():
        for color_list in archetype.values():
            pool_names.update(color_list)

    BASICS = {"Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"}
    removable = [c for c in cards if c["name"] not in BASICS and c["name"] not in pool_names]
    if len(removable) < n_swaps:
        return None
    to_remove = rng.sample(removable, n_swaps)
    remove_names = {c["name"] for c in to_remove}

    # Pick replacements not already in the deck
    deck_names = {c["name"] for c in cards}
    candidates = candidate_replacements(pool_key, deck.get("color_identity") or [], rng, n_swaps * 4)
    additions = [name for name in candidates if name not in deck_names][:n_swaps]
    if len(additions) < n_swaps:
        return None

    # Build the after-deck
    deck_after = [c for c in cards if c["name"] not in remove_names]
    deck_after.extend({"name": name, "quantity": 1} for name in additions)
    deck_after.sort(key=lambda c: c["name"].lower())

    return {
        "type": "swap_edit",
        "commander": deck["commander"],
        "color_identity": deck.get("color_identity") or [],
        "reason": reason_label,
        "reason_blurb": reason_blurb,
        "removed": list(remove_names),
        "added": additions,
        "deck_before": cards,
        "deck_after": deck_after,
    }


def main() -> None:
    args = parse_args()
    rng = random.Random(args.seed)

    decks = load_decks(Path(args.input))
    print(f"Loaded {len(decks):,} source decks from {args.input}")

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    written = 0
    with out_path.open("w", encoding="utf-8") as out:
        for deck in decks:
            attempts = 0
            for _ in range(args.per_deck):
                example = None
                while example is None and attempts < args.per_deck * 4:
                    example = make_swap(deck, rng, args.max_swaps)
                    attempts += 1
                if example:
                    out.write(json.dumps(example, ensure_ascii=True) + "\n")
                    written += 1

    print(f"Wrote {written:,} swap/edit examples to {out_path}")


if __name__ == "__main__":
    main()
