"""
Deck building engine.
Step 1 (rule-based): filter collection to legal, color-identity-matching candidates.
Step 2 (LLM): send candidates + user prompt to a local Ollama model to select the final 99 cards.

Requires Ollama running locally: https://ollama.com
Recommended models: mistral, llama3, gemma2
Default model is configurable via OLLAMA_MODEL env var (default: mistral).
"""
import json
import os
import random
import re
import threading
import time
from typing import Callable, Optional
import ollama
from services.synergy_engine import resolve_synergies


import logging
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "mtg-commander")
# Increase default timeout to 900s (15 minutes)
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "900"))  # seconds
OLLAMA_MAX_GENERATION_SEC = float(os.getenv("OLLAMA_MAX_GENERATION_SEC", "900"))
OLLAMA_NUM_PREDICT = int(os.getenv("OLLAMA_NUM_PREDICT", "768"))
ALLOW_LLM_TIMEOUT_FALLBACK = os.getenv("ALLOW_LLM_TIMEOUT_FALLBACK", "1").strip().lower() not in {"0", "false", "no"}
BASE_MODEL_CANDIDATES = int(os.getenv("MAX_MODEL_CANDIDATES", "500"))
KEYWORD_MODEL_CANDIDATE_CAP = 750
MODEL_PROGRESS_HEARTBEAT_SEC = float(os.getenv("MODEL_PROGRESS_HEARTBEAT_SEC", "8"))
COLOR_ORDER = ["W", "U", "B", "R", "G"]
BASIC_NAME_TO_COLOR = {
    "plains": "W",
    "island": "U",
    "swamp": "B",
    "mountain": "R",
    "forest": "G",
}

# Persistent logger for LLM errors
logger = logging.getLogger("deck_engine")
handler = logging.FileHandler("llm_deckbuilder.log")
formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
handler.setFormatter(formatter)
if not logger.hasHandlers():
    logger.addHandler(handler)
logger.setLevel(logging.INFO)


def is_commander_legal(card: dict) -> bool:
    legalities = card.get("legalities") or {}
    return legalities.get("commander") == "legal"


def matches_color_identity(card: dict, commander_identity: list[str]) -> bool:
    card_identity = card.get("color_identity") or []
    return all(c in commander_identity for c in card_identity)


def is_basic_land(card: dict) -> bool:
    type_line = (card.get("type_line") or "").lower()
    return "basic" in type_line and "land" in type_line


def is_land(card: dict) -> bool:
    return "land" in (card.get("type_line") or "").lower()


def is_nonbasic_land(card: dict) -> bool:
    return is_land(card) and not is_basic_land(card)


def is_dual_land(card: dict, commander_identity: Optional[list[str]] = None) -> bool:
    """A dual (multicolor) nonbasic land that fits the commander's color identity.

    Definition: nonbasic land whose color_identity has 2+ colors and whose
    every color is present in the commander's identity. (Mono-color utility
    lands like Path of Ancestry / Command Tower are NOT duals.)
    """
    if not is_nonbasic_land(card):
        return False
    card_colors = [c for c in (card.get("color_identity") or []) if c in COLOR_ORDER]
    if len(card_colors) < 2:
        return False
    if commander_identity is not None:
        identity_set = {c for c in commander_identity if c in COLOR_ORDER}
        if not identity_set or any(c not in identity_set for c in card_colors):
            return False
    return True


def _card_colors(card: dict) -> list[str]:
    colors = card.get("color_identity") or card.get("colors") or []
    return [c for c in colors if c in COLOR_ORDER]


def _basic_land_color(card: dict) -> Optional[str]:
    colors = _card_colors(card)
    if len(colors) == 1:
        return colors[0]

    lowered_name = (card.get("name") or "").lower()
    for land_name, color in BASIC_NAME_TO_COLOR.items():
        if land_name in lowered_name:
            return color
    return None


def _round_robin_by_color(cards: list[dict], color_order: list[str], limit: int) -> list[dict]:
    if limit <= 0:
        return []

    buckets: dict[str, list[dict]] = {color: [] for color in color_order}
    colorless: list[dict] = []
    for card in cards:
        colors = _card_colors(card)
        primary = next((c for c in color_order if c in colors), None)
        if primary:
            buckets[primary].append(card)
        else:
            colorless.append(card)

    selected: list[dict] = []
    seen_ids: set[str] = set()

    while len(selected) < limit:
        added_this_round = 0
        for color in color_order:
            bucket = buckets[color]
            while bucket:
                card = bucket.pop(0)
                card_id = card.get("id") or card.get("name")
                if not card_id or card_id in seen_ids:
                    continue
                seen_ids.add(card_id)
                selected.append(card)
                added_this_round += 1
                break
            if len(selected) >= limit:
                break
        if added_this_round == 0:
            break

    for card in colorless:
        if len(selected) >= limit:
            break
        card_id = card.get("id") or card.get("name")
        if not card_id or card_id in seen_ids:
            continue
        seen_ids.add(card_id)
        selected.append(card)

    if len(selected) < limit:
        for card in cards:
            if len(selected) >= limit:
                break
            card_id = card.get("id") or card.get("name")
            if not card_id or card_id in seen_ids:
                continue
            seen_ids.add(card_id)
            selected.append(card)

    return selected[:limit]


def _allocate_basic_land_counts(
    selected_nonlands: list[dict],
    basic_target: int,
    commander_identity: list[str],
) -> dict[str, int]:
    colors = [c for c in commander_identity if c in COLOR_ORDER]
    if not colors:
        return {}

    if basic_target <= 0:
        return {c: 0 for c in colors}

    weights: dict[str, int] = {c: 0 for c in colors}
    for card in selected_nonlands:
        card_colors = _card_colors(card)
        for color in colors:
            if color in card_colors:
                weights[color] += 1

    total_weight = sum(weights.values())
    if total_weight == 0:
        base = basic_target // len(colors)
        remainder = basic_target % len(colors)
        allocation = {c: base for c in colors}
        for color in colors[:remainder]:
            allocation[color] += 1
        return allocation

    exact = {c: (weights[c] / total_weight) * basic_target for c in colors}
    floored = {c: int(exact[c]) for c in colors}
    used = sum(floored.values())
    remainder = basic_target - used

    ranked = sorted(colors, key=lambda c: (exact[c] - floored[c], weights[c]), reverse=True)
    for color in ranked[:remainder]:
        floored[color] += 1
    return floored


def rule_based_filter(
    collection: list[dict],
    commander_identity: list[str],
    commander_id: str,
) -> list[dict]:
    """Return cards from collection that are legal and fit the commander's color identity."""
    candidates = []
    for card in collection:
        if card["id"] == commander_id:
            continue
        if not is_commander_legal(card) and not is_basic_land(card):
            continue
        if not matches_color_identity(card, commander_identity):
            continue
        candidates.append(card)
    return candidates


def card_summary(card: dict) -> str:
    """Compact card summary to minimize prompt tokens while preserving selection-relevant info."""
    keywords = card.get("keywords") or []
    keyword_str = ",".join(keywords[:4]) if keywords else ""
    parts = [card["name"], card.get("type_line") or "", f"CMC:{card.get('cmc', 0)}"]
    if keyword_str:
        parts.append(keyword_str)
    return " | ".join(parts)


def card_summary_full(card: dict) -> str:
    """Extended summary including oracle text, used only when candidate pool is small."""
    base = card_summary(card)
    oracle = (card.get("oracle_text") or "")[:80].replace(chr(10), " ")
    return f"{base} | {oracle}" if oracle else base


MAX_COMPACT_CANDIDATES = 200


def _dedupe_indices(indices: list[int]) -> list[int]:
    seen = set()
    unique = []
    for index in indices:
        if index in seen:
            continue
        seen.add(index)
        unique.append(index)
    return unique


# ---------------------------------------------------------------------------
# Deck Constraint helpers
# ---------------------------------------------------------------------------

def _card_matches_constraint(card: dict, constraint: dict) -> bool:
    """Return True if card satisfies the constraint's match_field / match_value."""
    field = (constraint.get("match_field") or "any").lower()
    raw_value = (constraint.get("match_value") or "").strip()
    if not raw_value:
        return False
    terms = [t.strip().lower() for t in raw_value.split("|") if t.strip()]
    if not terms:
        return False

    if field == "type_line":
        haystack = (card.get("type_line") or "").lower()
    elif field == "oracle_text":
        haystack = (card.get("oracle_text") or "").lower()
    elif field == "keywords":
        haystack = " ".join(card.get("keywords") or []).lower()
    else:  # "any"
        haystack = _card_text_blob(card)

    return any(t in haystack for t in terms)


def _analyze_commander_profile(commander: dict) -> list[dict]:
    """
    Detect deck-building themes from a commander's oracle text and type line.
    Returns a list of ConstraintSuggestion dicts, each with:
        label, match_field, match_value, suggested_min,
        detected_from (human-readable explanation), confidence ("high"|"medium")
    """
    oracle = (commander.get("oracle_text") or "").lower()
    type_line = (commander.get("type_line") or "").lower()
    name = (commander.get("name") or "")
    suggestions: list[dict] = []
    seen_values: set[str] = set()

    def add(label: str, match_field: str, match_value: str, suggested_min: int,
            detected_from: str, confidence: str = "high"):
        key = f"{match_field}:{match_value.lower()}"
        if key in seen_values:
            return
        seen_values.add(key)
        suggestions.append({
            "label": label,
            "match_field": match_field,
            "match_value": match_value,
            "min_count": 0,
            "suggested_min": suggested_min,
            "detected_from": detected_from,
            "confidence": confidence,
        })

    # --- Tribal detection ---
    # Pattern: "Pirate you control", "Pirates you control", "target Pirate", "each Pirate", etc.
    tribal_patterns = [
        r"\b([A-Z][a-z]+)s?\s+you\s+control\b",
        r"target\s+([A-Z][a-z]+)\b",
        r"each\s+([A-Z][a-z]+)\b",
        r"another\s+([A-Z][a-z]+)\b",
        r"put\s+a\s+.*counter\s+on\s+target\s+([A-Z][a-z]+)\b",
        r"whenever\s+a\s+([A-Z][a-z]+)\s+you\s+control",
        r"whenever\s+another\s+([A-Z][a-z]+)\b",
    ]
    # Common non-creature words to exclude from tribal detection
    _tribal_exclusions = {
        "card", "cards", "permanent", "permanents", "player", "players",
        "creature", "creatures", "land", "lands", "artifact", "artifacts",
        "enchantment", "enchantments", "spell", "spells", "token", "tokens",
        "counter", "counters", "ability", "abilities", "trigger", "effect",
        "opponent", "opponents", "library", "graveyard", "battlefield",
        "hand", "combat", "turn", "step", "phase", "cost", "mana",
        "color", "colors", "power", "toughness", "loyalty", "source",
        "target", "control", "controller", "owner", "zone", "stack",
    }
    found_tribal: set[str] = set()
    for pat in tribal_patterns:
        for m in re.finditer(pat, commander.get("oracle_text") or "", re.IGNORECASE):
            word = m.group(1).lower()
            if word not in _tribal_exclusions and len(word) > 2:
                found_tribal.add(word)

    # Also check commander's own creature subtypes from type_line
    # e.g. "Legendary Creature — Human Pirate" → ["human", "pirate"]
    if "—" in type_line:
        subtypes_part = type_line.split("—", 1)[1]
        for subtype in subtypes_part.split():
            subtype = subtype.strip(".,;").lower()
            if subtype and subtype not in _tribal_exclusions and len(subtype) > 2:
                found_tribal.add(subtype)

    for tribe in sorted(found_tribal):
        # Use capitalized form for display and matching
        tribe_display = tribe.capitalize()
        confidence = "high" if any(
            re.search(pat, commander.get("oracle_text") or "", re.IGNORECASE)
            for pat in tribal_patterns
        ) else "medium"
        add(
            label=f"{tribe_display} creatures",
            match_field="type_line",
            match_value=tribe_display,
            suggested_min=10,
            detected_from=f"Commander references or is a {tribe_display}",
            confidence=confidence,
        )

    # --- Spellslinger ---
    if re.search(r"whenever you cast (an? )?(instant or sorcery|noncreature spell)", oracle):
        add("Instants & Sorceries", "type_line", "Instant|Sorcery", 15,
            "Commander triggers on casting instants or sorceries", "high")
    elif re.search(r"whenever you cast (an? )?noncreature spell", oracle):
        add("Noncreature spells (no creatures)", "oracle_text", "noncreature", 12,
            "Commander triggers on noncreature spells", "high")

    # --- Artifacts ---
    if re.search(r"whenever (an? )?artifact (enters|you control|is)", oracle):
        add("Artifacts", "type_line", "Artifact", 10,
            "Commander triggers on artifacts entering or being controlled", "high")
    elif re.search(r"artifact\s+you\s+control|equipped|equip", oracle):
        add("Artifacts", "type_line", "Artifact", 8,
            "Commander cares about artifacts or Equipment", "medium")

    # --- Equipment ---
    if re.search(r"equipped creature|whenever (a creature )?becomes equipped|equip", oracle):
        add("Equipment", "type_line", "Equipment", 6,
            "Commander cares about Equipment", "high")

    # --- Enchantments / Auras ---
    if re.search(r"whenever (an? )?enchantment (enters|you control)", oracle):
        add("Enchantments", "type_line", "Enchantment", 8,
            "Commander triggers on enchantments entering", "high")
    if re.search(r"enchant creature|whenever (this creature )?becomes enchanted|aura", oracle):
        add("Auras (Voltron)", "type_line", "Aura", 6,
            "Commander cares about Auras or enchanting creatures", "high")

    # --- Vehicles ---
    if re.search(r"crew|vehicle", oracle):
        add("Vehicles", "type_line", "Vehicle", 4,
            "Commander cares about Vehicles or Crew", "medium")

    # --- ETB payoffs ---
    if re.search(r"whenever (a |another )?(creature|permanent) (enters the battlefield|enters)", oracle):
        add("Creatures (ETB payoffs)", "oracle_text", "enters", 10,
            "Commander triggers on permanents entering the battlefield", "high")

    # --- Lifegain ---
    if re.search(r"whenever you gain life|gain.*life.*whenever|life.*you gain", oracle):
        add("Lifegain cards", "oracle_text", "gain", 8,
            "Commander rewards or triggers off gaining life", "high")
    elif re.search(r"gain.*life", oracle):
        add("Lifegain cards", "oracle_text", "gain", 6,
            "Commander gains or cares about life", "medium")

    # --- +1/+1 counters ---
    if re.search(r"\+1/\+1 counter", oracle):
        add("+1/+1 counter cards", "oracle_text", "+1/+1 counter", 10,
            "Commander places or cares about +1/+1 counters", "high")

    # --- -1/-1 counters ---
    if re.search(r"-1/-1 counter", oracle):
        add("-1/-1 counter cards", "oracle_text", "-1/-1 counter", 8,
            "Commander places or cares about -1/-1 counters", "high")

    # --- Experience counters ---
    if re.search(r"experience counter", oracle):
        add("Low-CMC creatures (experience)", "oracle_text", "experience", 6,
            "Commander uses experience counters", "high")

    # --- Graveyard / Reanimator ---
    if re.search(r"from your graveyard|in your graveyard|return.*graveyard.*battlefield", oracle):
        add("Graveyard recursion cards", "oracle_text", "graveyard", 6,
            "Commander interacts with the graveyard", "high")

    # --- Discard / Madness ---
    if re.search(r"whenever you discard|madness", oracle):
        add("Discard / Madness cards", "oracle_text", "discard|madness", 8,
            "Commander triggers on discard or Madness", "high")

    # --- Mill ---
    if re.search(r"\bmill\b", oracle):
        add("Mill cards", "oracle_text", "mill", 6,
            "Commander mills or cares about milling", "high")

    # --- Tokens ---
    if re.search(r"whenever (a |another )?.*token|create (a |an? ).*token", oracle):
        add("Token generators", "oracle_text", "token", 8,
            "Commander creates or cares about tokens", "high")

    # --- Sacrifice / Aristocrats ---
    if re.search(r"sacrifice (a |another )?creature|whenever (a |another )?creature (dies|you control dies)", oracle):
        add("Sacrifice / death-trigger cards", "oracle_text", "sacrifice|dies", 8,
            "Commander sacrifices or triggers on creature death", "high")

    # --- Landfall ---
    if re.search(r"whenever (a |another )?land enters", oracle):
        add("Ramp / Landfall cards", "oracle_text", "land enters", 8,
            "Commander triggers on lands entering the battlefield", "high")

    # --- Draw payoffs ---
    if re.search(r"whenever you draw (a card|cards)", oracle):
        add("Card draw spells", "oracle_text", "draw", 8,
            "Commander rewards drawing cards", "high")

    # --- Combat damage triggers ---
    if re.search(r"whenever .{0,30} deals combat damage to a player", oracle):
        add("Evasion creatures (combat damage)", "oracle_text", "combat damage", 8,
            "Commander or its creatures reward dealing combat damage to players", "high")

    # --- Attack triggers ---
    if re.search(r"whenever .{0,30} attacks", oracle):
        add("Attack-payoff cards", "oracle_text", "attacks", 8,
            "Commander triggers when creatures attack", "high")

    # --- Proliferate ---
    if re.search(r"proliferate", oracle):
        add("Proliferate cards", "oracle_text", "proliferate", 6,
            "Commander proliferates or rewards proliferating", "high")

    # --- Cycling ---
    if re.search(r"whenever you cycle|cycling", oracle):
        add("Cycling cards", "oracle_text", "cycling", 8,
            "Commander triggers on cycling or rewards cycling", "high")

    # --- Cast from exile ---
    if re.search(r"(cast|play).{0,20}from (exile|the top of)", oracle):
        add("Exile-cast enablers", "oracle_text", "from exile", 6,
            "Commander lets you cast spells from exile", "high")

    # --- Treasure ---
    if re.search(r"treasure token|create.*treasure|whenever.*treasure", oracle):
        add("Treasure generators", "oracle_text", "treasure", 6,
            "Commander creates or cares about Treasure tokens", "high")

    # --- Food ---
    if re.search(r"food token|create.*food|whenever.*food", oracle):
        add("Food generators", "oracle_text", "food", 6,
            "Commander creates or cares about Food tokens", "high")

    # --- Clues / Investigate ---
    if re.search(r"investigate|whenever.*clue", oracle):
        add("Clue / Investigate cards", "oracle_text", "investigate|clue", 6,
            "Commander investigates or cares about Clues", "high")

    # --- Copy / Storm ---
    if re.search(r"\bstorm\b|copy target (instant or sorcery|spell)|whenever you cast.*copy", oracle):
        add("Copy / Storm spells", "oracle_text", "copy", 8,
            "Commander copies spells or has Storm", "high")

    # --- Cascade ---
    if re.search(r"\bcascade\b", oracle):
        add("Cascade cards", "keywords", "cascade", 6,
            "Commander has or rewards Cascade", "high")

    # --- Morph / Manifest ---
    if re.search(r"\bmorph\b|\bmanifest\b", oracle):
        add("Morph / Manifest cards", "oracle_text", "morph|manifest", 6,
            "Commander cares about Morph or Manifest", "high")

    # --- Mutate ---
    if re.search(r"\bmutate\b", oracle):
        add("Mutate cards", "oracle_text", "mutate", 6,
            "Commander cares about Mutate", "high")

    # --- Historic / Sagas ---
    if re.search(r"\bhistoric\b|\bsaga\b", oracle):
        add("Historic / Saga permanents", "oracle_text", "historic|saga", 6,
            "Commander cares about historic spells or Sagas", "high")

    # --- Monarch / Initiative ---
    if re.search(r"\bmonarch\b|\binitiative\b", oracle):
        add("Monarch / Initiative cards", "oracle_text", "monarch|initiative", 4,
            "Commander uses the Monarch or Initiative mechanic", "high")

    # --- Dungeons ---
    if re.search(r"venture into the dungeon|dungeon", oracle):
        add("Dungeon / Venture cards", "oracle_text", "dungeon|venture", 6,
            "Commander ventures into the dungeon", "high")

    # --- Power ≥4 matters ---
    if re.search(r"power (4 or greater|of 4 or more|4 or more)|creatures with power 4", oracle):
        add("Power ≥4 creatures", "oracle_text", "power 4", 8,
            "Commander rewards creatures with power 4 or greater", "high")

    # --- Flying matters ---
    if re.search(r"whenever (a |another )?(creature with flying|flying creature)", oracle):
        add("Flying creatures", "oracle_text", "flying", 8,
            "Commander triggers on creatures with flying", "high")

    # --- Toughness matters ---
    if re.search(r"assigns combat damage equal to its toughness|toughness instead", oracle):
        add("High-toughness creatures", "oracle_text", "toughness", 8,
            "Commander assigns damage based on toughness", "high")

    # --- Stax / Tax ---
    if re.search(r"opponents can't|each opponent (must|can't|loses|sacrifices)", oracle):
        add("Stax / Tax permanents", "oracle_text", "opponents can't", 6,
            "Commander restricts opponents' actions", "high")

    return suggestions


def _enforce_constraints(
    deck: list[dict],
    pool: list[dict],
    constraints: list[dict],
    must_include_names: Optional[set] = None,
) -> list[dict]:
    """
    Post-rebalance enforcement:
    - min_count: ensure at least N matching non-land cards.
    - max_count (>0): ensure at most N matching non-land cards.
    Never evicts must-include cards.
    """
    if not constraints:
        return deck

    has_active = any((c.get("min_count") or 0) > 0 or (c.get("max_count") or 0) > 0 for c in constraints)
    if not has_active:
        return deck

    protected = must_include_names or set()

    # ── Enforce minimums ────────────────────────────────────────────────────
    for constraint in constraints:
        floor = constraint.get("min_count") or 0
        if floor <= 0:
            continue
        matching_deck = [c for c in deck if not is_land(c) and _card_matches_constraint(c, constraint)]
        if len(matching_deck) >= floor:
            continue

        needed = floor - len(matching_deck)
        deck_ids = {c.get("id") or c.get("name") for c in deck}

        pool_matches = [
            c for c in pool
            if not is_land(c)
            and _card_matches_constraint(c, constraint)
            and (c.get("id") or c.get("name")) not in deck_ids
        ]
        if not pool_matches:
            continue

        swap_targets = [
            (i, c) for i, c in enumerate(deck)
            if not is_land(c)
            and (c.get("name", "").lower() not in protected)
            and not _card_matches_constraint(c, constraint)
        ]
        swap_targets.sort(key=lambda x: _card_cmc(x[1]), reverse=True)

        for pool_card in pool_matches[:needed]:
            if not swap_targets:
                break
            swap_idx, _ = swap_targets.pop(0)
            deck[swap_idx] = pool_card
            deck_ids.add(pool_card.get("id") or pool_card.get("name"))

    # ── Enforce maximums ────────────────────────────────────────────────────
    for constraint in constraints:
        ceiling = constraint.get("max_count") or 0
        if ceiling <= 0:
            continue
        matching_idxs = [
            i for i, c in enumerate(deck)
            if not is_land(c)
            and _card_matches_constraint(c, constraint)
            and c.get("name", "").lower() not in protected
        ]
        excess = len(matching_idxs) - ceiling
        if excess <= 0:
            continue

        # Sort by CMC descending — evict highest-CMC matchers first
        matching_idxs.sort(key=lambda i: _card_cmc(deck[i]), reverse=True)
        evict_idxs = set(matching_idxs[:excess])
        deck_ids = {c.get("id") or c.get("name") for c in deck}

        replacements_pool = [
            c for c in pool
            if not is_land(c)
            and not _card_matches_constraint(c, constraint)
            and (c.get("id") or c.get("name")) not in deck_ids
        ]
        replacements_pool.sort(key=lambda c: _card_cmc(c))

        for evict_i in sorted(evict_idxs):
            if replacements_pool:
                deck[evict_i] = replacements_pool.pop(0)
            # else: remove card — deck will be shorter (safety net later pads basics)

    return deck


def _enforce_tapped_land_cap(
    deck: list[dict],
    pool: list[dict],
    tapped_land_max: int,
) -> list[dict]:
    """Swap out excess tapped lands (oracle text contains 'enters the battlefield tapped')
    for non-tapped lands from the pool. Does nothing when tapped_land_max <= 0."""
    if tapped_land_max <= 0:
        return deck

    def is_tapped_land(card: dict) -> bool:
        if not is_land(card):
            return False
        ot = (card.get("oracle_text") or "").lower()
        return "enters the battlefield tapped" in ot or "enters tapped" in ot

    tapped_idxs = [i for i, c in enumerate(deck) if is_tapped_land(c)]
    excess = len(tapped_idxs) - tapped_land_max
    if excess <= 0:
        return deck

    deck_ids = {c.get("id") or c.get("name") for c in deck}
    non_tapped_pool = [
        c for c in pool
        if is_land(c)
        and not is_tapped_land(c)
        and (c.get("id") or c.get("name")) not in deck_ids
    ]

    for evict_i in tapped_idxs[:excess]:
        if non_tapped_pool:
            deck[evict_i] = non_tapped_pool.pop(0)
        # If no untapped replacements available, leave as-is

    return deck


def _extract_numbered_card_indices(text: str) -> tuple[list[int], str]:
    """Parse fallback model output like '801. Card Name | ... 802. Card Name | ...'."""
    matches = list(re.finditer(r"(?:^|[\s,;])(\d{1,4})\.\s+", text))
    if not matches:
        return [], ""

    indices = _dedupe_indices([int(match.group(1)) for match in matches])
    description = text[: matches[0].start(1)].strip(" ,;:\n\t")
    return indices, description


def _normalize_card_name(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip()).lower()


def _extract_numbered_card_names(text: str) -> list[str]:
    """Extract candidate card names from numbered list fallback output."""
    names = []
    for match in re.finditer(r"(?:^|[\s,;])\d{1,4}\.\s+([^|\n\r]+)", text):
        raw = match.group(1).strip(" ,;:\n\t")
        if not raw:
            continue
        names.append(raw)
    return names


def _clean_keyword_filters(keyword_filters: Optional[list[str]]) -> list[str]:
    if not keyword_filters:
        return []
    return [k.strip().lower() for k in keyword_filters if isinstance(k, str) and k.strip()]


def _card_matches_keywords(card: dict, keyword_filters: list[str]) -> bool:
    if not keyword_filters:
        return False
    fields = [
        card.get("name") or "",
        card.get("type_line") or "",
        card.get("oracle_text") or "",
        " ".join(card.get("keywords") or []),
    ]
    haystack = " ".join(fields).lower()
    return any(keyword in haystack for keyword in keyword_filters)


def _card_cmc(card: dict) -> float:
    try:
        return float(card.get("cmc", 0) or 0)
    except (TypeError, ValueError):
        return 0.0


def _cmc_bucket(card: dict) -> str:
    cmc = _card_cmc(card)
    if cmc <= 2:
        return "low"
    if cmc <= 4:
        return "mid"
    return "high"


def _card_text_blob(card: dict) -> str:
    return " ".join(
        [
            (card.get("name") or ""),
            (card.get("type_line") or ""),
            (card.get("oracle_text") or ""),
            " ".join(card.get("keywords") or []),
        ]
    ).lower()


def _akawalli_synergy_score(card: dict) -> int:
    text = _card_text_blob(card)
    score = 0

    strong = [
        "mill",
        "self-mill",
        "surveil",
        "sacrifice",
        "dies",
        "from your graveyard",
        "return target creature card",
        "descend",
    ]
    support = [
        "token",
        "treasure",
        "blood token",
        "map token",
        "mana value",
        "creature card in your graveyard",
    ]

    for term in strong:
        if term in text:
            score += 3
    for term in support:
        if term in text:
            score += 1

    return score


def _rebalance_nonlands_for_quality(
    selected: list[dict],
    all_candidates: list[dict],
    nonland_target: int,
    commander_name: str,
    keyword_filters: list[str],
    strict_mode: bool,
    constraints: Optional[list[dict]] = None,
    excluded_card_names: Optional[list[str]] = None,
) -> list[dict]:
    if nonland_target <= 0:
        return []

    selected_nonlands = [c for c in selected if not is_land(c)]
    selected_ids = {c.get("id") or c.get("name") for c in selected_nonlands}

    all_nonlands = [c for c in all_candidates if not is_land(c)]
    deduped_nonlands: list[dict] = []
    seen_ids: set[str] = set()
    for card in all_nonlands:
        card_id = card.get("id") or card.get("name")
        if not card_id or card_id in seen_ids:
            continue
        seen_ids.add(card_id)
        deduped_nonlands.append(card)

    normalized_keywords = _clean_keyword_filters(keyword_filters)
    if strict_mode and normalized_keywords:
        keyword_only = [c for c in deduped_nonlands if _card_matches_keywords(c, normalized_keywords)]
        if len(keyword_only) >= max(12, int(nonland_target * 0.45)):
            deduped_nonlands = keyword_only

    is_akawalli = "akawalli" in (commander_name or "").lower()
    active_constraints = [c for c in (constraints or []) if (c.get("min_count") or 0) > 0]
    excluded_set = {n.lower() for n in (excluded_card_names or []) if n}

    def score(card: dict) -> float:
        card_id = card.get("id") or card.get("name")
        value = 0.0

        # Excluded cards get a heavy penalty — only selected as absolute last resort
        if card.get("name", "").lower() in excluded_set:
            value -= 200.0

        if card_id in selected_ids:
            value += 25.0

        if normalized_keywords and _card_matches_keywords(card, normalized_keywords):
            value += 90.0 if strict_mode else 65.0

        if is_akawalli:
            value += float(_akawalli_synergy_score(card) * (10 if strict_mode else 8))

        # Constraint scoring: +80 per active constraint matched
        for constraint in active_constraints:
            if _card_matches_constraint(card, constraint):
                value += 80.0

        cmc = _card_cmc(card)
        if cmc <= 2:
            value += 8.0
        elif cmc <= 4:
            value += 4.0
        elif cmc >= 6:
            value -= 5.0

        return value

    buckets: dict[str, list[dict]] = {"low": [], "mid": [], "high": []}
    for card in deduped_nonlands:
        buckets[_cmc_bucket(card)].append(card)
    for bucket in buckets.values():
        bucket.sort(key=lambda c: (score(c), -_card_cmc(c)), reverse=True)

    picked: list[dict] = []
    picked_ids: set[str] = set()

    if nonland_target <= 8:
        remaining = sorted(deduped_nonlands, key=lambda c: (score(c), -_card_cmc(c)), reverse=True)
        for card in remaining:
            if len(picked) >= nonland_target:
                break
            card_id = card.get("id") or card.get("name")
            if not card_id or card_id in picked_ids:
                continue
            picked_ids.add(card_id)
            picked.append(card)
    else:
        if strict_mode:
            low_target = int(nonland_target * 0.36)
            mid_target = int(nonland_target * 0.44)
        else:
            low_target = int(nonland_target * 0.30)
            mid_target = int(nonland_target * 0.43)
        high_target = max(0, nonland_target - low_target - mid_target)
        targets = {"low": low_target, "mid": mid_target, "high": high_target}

        for bucket_name in ["low", "mid", "high"]:
            for card in buckets[bucket_name]:
                if len(picked) >= nonland_target:
                    break
                if targets[bucket_name] <= 0:
                    break
                card_id = card.get("id") or card.get("name")
                if not card_id or card_id in picked_ids:
                    continue
                picked_ids.add(card_id)
                picked.append(card)
                targets[bucket_name] -= 1

    if len(picked) < nonland_target:
        remaining = sorted(deduped_nonlands, key=lambda c: (score(c), -_card_cmc(c)), reverse=True)
        for card in remaining:
            if len(picked) >= nonland_target:
                break
            card_id = card.get("id") or card.get("name")
            if not card_id or card_id in picked_ids:
                continue
            picked_ids.add(card_id)
            picked.append(card)

    return picked[:nonland_target]


def extract_json(text: str) -> dict:
    """Extract JSON from model output that may contain extra prose."""
    text = (text or "").strip()
    if not text:
        raise ValueError("Model response was empty.")

    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Find first {...} block
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    indices, description = _extract_numbered_card_indices(text)
    if indices:
        card_names = _extract_numbered_card_names(text)
        return {
            "description": description,
            "card_indices": indices,
            "card_names": card_names,
        }

    raise ValueError(f"Could not extract deck selection from model response:\n{text[:500]}")


def _build_deck_selection(
    model_candidates: list[dict],
    all_candidates: list[dict],
    result: dict,
) -> list[dict]:
    """Build a robust 99-card list from model output, recovering from malformed responses."""
    selected: list[dict] = []
    selected_ids: set[str] = set()

    def add_card(card: dict):
        card_id = card.get("id") or card.get("name")
        if not card_id or card_id in selected_ids:
            return
        selected_ids.add(card_id)
        selected.append(card)

    # Primary path: model-provided indices into the numbered candidate list.
    indices = _dedupe_indices(result.get("card_indices", [])[:99])
    for index in indices:
        if 0 < index <= len(model_candidates):
            add_card(model_candidates[index - 1])

    # Recovery path: map parsed card names back to owned candidates.
    if len(selected) < 99:
        by_name = {_normalize_card_name(c.get("name", "")): c for c in all_candidates}
        for name in result.get("card_names", []):
            card = by_name.get(_normalize_card_name(name))
            if card:
                add_card(card)
            if len(selected) >= 99:
                break

    # Safety net: prefer non-lands to avoid land-only decks if model output is poor.
    if len(selected) < 99:
        for card in all_candidates:
            type_line = (card.get("type_line") or "").lower()
            if "land" not in type_line:
                add_card(card)
            if len(selected) >= 99:
                break

    # Then fill with remaining lands from owned candidates.
    if len(selected) < 99:
        for card in all_candidates:
            add_card(card)
            if len(selected) >= 99:
                break

    # Final fallback for very small collections: repeat legal basics if needed.
    if len(selected) < 99:
        basic_lands = [c for c in all_candidates if is_basic_land(c)]
        idx = 0
        while basic_lands and len(selected) < 99:
            selected.append(basic_lands[idx % len(basic_lands)])
            idx += 1

    return selected[:99]


def _apply_land_targets(
    selected: list[dict],
    all_candidates: list[dict],
    basic_land_count: int,
    nonbasic_land_count: int,
    commander_identity: list[str],
    dual_land_count: int = 0,
) -> list[dict]:
    """Rebalance final deck to requested land counts while preserving model picks where possible."""
    basic_target = max(0, int(basic_land_count or 0))
    nonbasic_target = max(0, int(nonbasic_land_count or 0))
    dual_target = max(0, int(dual_land_count or 0))
    land_target = min(99, basic_target + nonbasic_target + dual_target)
    nonland_target = 99 - land_target

    selected_nonlands = [c for c in selected if not is_land(c)]
    selected_dual_lands = [c for c in selected if is_dual_land(c, commander_identity)]
    selected_dual_ids = {c.get("id") or c.get("name") for c in selected_dual_lands}
    selected_nonbasic_lands = [
        c for c in selected
        if is_nonbasic_land(c) and (c.get("id") or c.get("name")) not in selected_dual_ids
    ]
    selected_basic_lands = [c for c in selected if is_basic_land(c)]

    all_nonlands = [c for c in all_candidates if not is_land(c)]
    all_dual_lands = [c for c in all_candidates if is_dual_land(c, commander_identity)]
    all_dual_ids = {c.get("id") or c.get("name") for c in all_dual_lands}
    all_nonbasic_lands = [
        c for c in all_candidates
        if is_nonbasic_land(c) and (c.get("id") or c.get("name")) not in all_dual_ids
    ]
    all_basic_lands = [c for c in all_candidates if is_basic_land(c)]
    basic_lands_by_color: dict[str, list[dict]] = {c: [] for c in COLOR_ORDER}
    for card in all_basic_lands:
        color = _basic_land_color(card)
        if color:
            basic_lands_by_color[color].append(card)

    deck: list[dict] = []
    seen_ids: set[str] = set()

    def add_unique_from_pool(pool: list[dict], limit: int) -> int:
        added = 0
        for card in pool:
            card_id = card.get("id") or card.get("name")
            if not card_id or card_id in seen_ids:
                continue
            seen_ids.add(card_id)
            deck.append(card)
            added += 1
            if added >= limit:
                break
        return added

    def add_repeats_from_pool(pool: list[dict], limit: int) -> int:
        if not pool or limit <= 0:
            return 0
        idx = 0
        while idx < limit:
            deck.append(pool[idx % len(pool)])
            idx += 1
        return limit

    nonlands_added = add_unique_from_pool(selected_nonlands, nonland_target)
    if nonlands_added < nonland_target:
        nonlands_added += add_unique_from_pool(all_nonlands, nonland_target - nonlands_added)

    dual_added = add_unique_from_pool(selected_dual_lands, dual_target)
    if dual_added < dual_target:
        dual_added += add_unique_from_pool(all_dual_lands, dual_target - dual_added)
    # If not enough dual lands available, allow nonbasic lands to fill the gap.
    if dual_added < dual_target:
        nonbasic_target += (dual_target - dual_added)

    nonbasic_added = add_unique_from_pool(selected_nonbasic_lands, nonbasic_target)
    if nonbasic_added < nonbasic_target:
        nonbasic_added += add_unique_from_pool(all_nonbasic_lands, nonbasic_target - nonbasic_added)

    basic_allocation = _allocate_basic_land_counts(selected_nonlands, basic_target, commander_identity)
    basic_added = 0
    for color in [c for c in commander_identity if c in COLOR_ORDER]:
        target_for_color = basic_allocation.get(color, 0)
        if target_for_color <= 0:
            continue
        pool = basic_lands_by_color.get(color, [])
        added_for_color = add_unique_from_pool(pool, target_for_color)
        if added_for_color < target_for_color:
            added_for_color += add_repeats_from_pool(pool, target_for_color - added_for_color)
        basic_added += added_for_color

    if basic_added < basic_target:
        basic_added += add_unique_from_pool(all_basic_lands, basic_target - basic_added)
    if basic_added < basic_target:
        basic_added += add_repeats_from_pool(all_basic_lands, basic_target - basic_added)

    if len(deck) < 99:
        add_unique_from_pool(all_candidates, 99 - len(deck))

    if len(deck) < 99:
        land_pool = all_basic_lands or all_nonbasic_lands or [c for c in all_candidates if is_land(c)]
        if land_pool:
            add_repeats_from_pool(land_pool, 99 - len(deck))

    return deck[:99]


def build_deck_with_llm(
    prompt: str,
    commander: dict,
    candidates: list[dict],
    keyword_filters: Optional[list[str]] = None,
    must_include_cards: Optional[list[dict]] = None,
    basic_land_count: int = 37,
    nonbasic_land_count: int = 5,
    dual_land_count: int = 0,
    strict_mode: bool = False,
    constraints: Optional[list[dict]] = None,
    excluded_card_names: Optional[list[str]] = None,
    tapped_land_max: int = 0,
    progress_callback: Optional[Callable[[str], None]] = None,
    stream_callback: Optional[Callable[[str], None]] = None,
    current_deck: Optional[list[dict]] = None,
) -> dict:
    """
    Ask the local Ollama model to pick 99 cards from candidates.
    Returns {"commander": ..., "deck": [...], "description": "..."}
    """
    if progress_callback:
        progress_callback("Preparing candidate pool for AI model")

    commander_identity = [c for c in (commander.get("color_identity") or []) if c in COLOR_ORDER]

    # Non-lands first, then lands — no truncation; use the full filtered collection
    non_lands = [c for c in candidates if "land" not in (c.get("type_line") or "").lower()]
    lands = [c for c in candidates if "land" in (c.get("type_line") or "").lower()]
    all_candidates = non_lands + lands

    normalized_keywords = _clean_keyword_filters(keyword_filters)

    # Resolve synergy archetypes — expands keywords and produces a strategy directive
    expanded_keywords, strategy_directive = resolve_synergies(
        keyword_filters=normalized_keywords,
        commander_name=commander.get("name", ""),
        color_identity=commander.get("color_identity", []),
    )
    # Use expanded keywords for card scoring/prioritisation
    scoring_keywords = expanded_keywords if expanded_keywords else normalized_keywords

    if progress_callback:
        if normalized_keywords:
            progress_callback(f"Applying keyword filters: {', '.join(normalized_keywords)}")
        else:
            progress_callback("No keyword filters selected — using full candidate pool")

    keyword_match_count = 0
    if scoring_keywords:
        keyword_matches = [c for c in all_candidates if _card_matches_keywords(c, scoring_keywords)]
        keyword_non_matches = [c for c in all_candidates if not _card_matches_keywords(c, scoring_keywords)]
        keyword_match_count = len(keyword_matches)
        # Shuffle within each group for deck variety (preserves synergy-first priority order)
        random.shuffle(keyword_matches)
        random.shuffle(keyword_non_matches)
        all_candidates = keyword_matches + keyword_non_matches
        if progress_callback:
            progress_callback(
                f"Prioritized {len(keyword_matches)} synergy-matching cards from {len(all_candidates)} candidates"
            )
    else:
        # No keyword filters — shuffle the full pool so different runs pick different cards
        random.shuffle(all_candidates)

    model_candidates = all_candidates
    model_candidate_cap = min(KEYWORD_MODEL_CANDIDATE_CAP, max(1, BASE_MODEL_CANDIDATES))
    if keyword_match_count > 0:
        model_candidate_cap = min(KEYWORD_MODEL_CANDIDATE_CAP, max(model_candidate_cap, keyword_match_count))

    if len(model_candidates) > model_candidate_cap:
        non_land_target = int(model_candidate_cap * 0.75)
        chosen_non_lands = _round_robin_by_color(non_lands, commander_identity, non_land_target)
        remaining = model_candidate_cap - len(chosen_non_lands)
        chosen_lands = _round_robin_by_color(lands, commander_identity, max(0, remaining))
        model_candidates = chosen_non_lands + chosen_lands
        if progress_callback:
            progress_callback(
                f"Candidate pool reduced from {len(all_candidates)} to {len(model_candidates)} for model performance"
            )

    # Use compact summaries for large pools to stay within context limits
    summarize = card_summary_full if len(model_candidates) <= MAX_COMPACT_CANDIDATES else card_summary

    card_list_text = "\n".join(
        f"{i + 1}. {summarize(c)}" for i, c in enumerate(model_candidates)
    )

    # Compute the number of cards we actually need the AI to choose.
    # We pre-allocate land slots and must-include slots ourselves.
    must_include_nonland_count = sum(1 for c in (must_include_cards or []) if not is_land(c))
    must_include_land_count = len(must_include_cards or []) - must_include_nonland_count
    total_land_budget = max(0, int(basic_land_count or 0)) + max(0, int(nonbasic_land_count or 0)) + max(0, int(dual_land_count or 0))
    ai_pick_target = max(1, min(99, 99 - total_land_budget - len(must_include_cards or [])))

    system_prompt = (
        "You are an expert Magic: The Gathering deck builder specializing in Commander format. "
        f"Select exactly {ai_pick_target} non-land cards from the numbered list to form a synergistic Commander deck. "
        "Lands and must-include cards will be added automatically by the engine — do NOT pick lands. "
        "Respond ONLY with valid JSON — no explanation, no markdown, no code fences. "
        'Format: {"description": "short deck description", "card_indices": [1, 5, 12, ...]}'
        f" card_indices must contain exactly {ai_pick_target} numbers from the list."
    )

    # Build synergy context for the prompt
    if strategy_directive:
        # Full archetype directive takes precedence; also list expanded keywords as a hint
        synergy_text = f"\n\n{strategy_directive}"
        if progress_callback:
            progress_callback(f"Strategy directive generated for archetypes: {', '.join([k for k in strategy_directive.split('archetypes:')[1].split(chr(10))[0].strip().split(', ') if k] if 'archetypes:' in strategy_directive else [])}")
    elif normalized_keywords:
        synergy_text = f"\nSynergy keywords to prioritize: {', '.join(normalized_keywords)}"
    else:
        synergy_text = ""

    deck_shape_text = (
        f"\nTarget deck composition: {max(0, 99 - min(99, total_land_budget))} non-lands "
        f"(of which {len(must_include_cards or []) - must_include_land_count} are pre-selected must-includes), "
        f"{max(0, nonbasic_land_count)} nonbasic lands, {max(0, dual_land_count)} dual lands, "
        f"{max(0, basic_land_count)} basic lands."
        f"\nYou only need to pick {ai_pick_target} non-land card_indices — lands and must-includes are added automatically."
    )
    must_include_names = [c["name"] for c in (must_include_cards or [])]
    must_include_text = ""
    if must_include_names:
        must_include_text = (
            "\nThese cards MUST be included in your selection (they will be force-added if you skip them): "
            + ", ".join(must_include_names)
        )
    # Build DECK REQUIREMENTS block from active constraints
    active_constraints = [c for c in (constraints or []) if (c.get("min_count") or 0) > 0]
    requirements_text = ""
    if active_constraints:
        req_lines = []
        for c in active_constraints:
            field_desc = {"type_line": "type line", "oracle_text": "oracle text",
                          "keywords": "keywords", "any": "card text"}.get(c.get("match_field", "any"), "card text")
            req_lines.append(
                f"  - At least {c['min_count']} cards with \"{c['match_value']}\" in their {field_desc}"
            )
        requirements_text = (
            "\nDECK REQUIREMENTS (hard minimums — you MUST meet these):\n" + "\n".join(req_lines)
        )
    current_deck_text = ""
    if current_deck:
        current_deck_text = "\nCurrent deck:\n" + "\n".join(f"- {c.get('name', '')}" for c in current_deck)
    user_message = (
        f"Commander: {commander['name']} "
        f"(Color identity: {', '.join(commander.get('color_identity', []))})\n"
        f"Request: {prompt}{synergy_text}{deck_shape_text}{must_include_text}{requirements_text}\n"
        f"{current_deck_text}\n"
        f"Available cards:\n{card_list_text}"
    )

    if progress_callback:
        progress_callback(f"Asking AI to select {ai_pick_target} non-land cards from {len(model_candidates)} candidates")


    client = ollama.Client(timeout=OLLAMA_TIMEOUT)
    raw = ""
    heartbeat_stop = threading.Event()

    def heartbeat():
        started = time.monotonic()
        while not heartbeat_stop.wait(MODEL_PROGRESS_HEARTBEAT_SEC):
            if progress_callback:
                elapsed = int(time.monotonic() - started)
                progress_callback(f"AI is still generating a response... {elapsed}s elapsed")

    heartbeat_thread = None
    if progress_callback and MODEL_PROGRESS_HEARTBEAT_SEC > 0:
        heartbeat_thread = threading.Thread(target=heartbeat, daemon=True)
        heartbeat_thread.start()

    llm_timed_out = False

    try:
        import queue as _queue
        model_options = {"temperature": round(random.uniform(0.70, 0.88), 2), "num_predict": OLLAMA_NUM_PREDICT}
        timed_out = False
        _chunk_queue: _queue.Queue = _queue.Queue()
        _abort = threading.Event()

        def _llm_worker():
            try:
                response = client.chat(
                    model=OLLAMA_MODEL,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_message},
                    ],
                    options=model_options,
                    stream=True,
                )
                for chunk in response:
                    if _abort.is_set():
                        break
                    content = chunk.get("message", {}).get("content", "")
                    if content:
                        _chunk_queue.put(("chunk", content))
                _chunk_queue.put(("done", None))
            except Exception as exc:
                _chunk_queue.put(("error", exc))

        _worker = threading.Thread(target=_llm_worker, daemon=True)
        _worker.start()

        # Drain the queue on the main thread with a hard wall-clock deadline.
        # This fires even if the first token hasn't arrived yet.
        _deadline = time.monotonic() + (OLLAMA_MAX_GENERATION_SEC if OLLAMA_MAX_GENERATION_SEC > 0 else float("inf"))
        while True:
            remaining = _deadline - time.monotonic()
            if remaining <= 0:
                _abort.set()
                timed_out = True
                break
            try:
                kind, value = _chunk_queue.get(timeout=min(1.0, remaining))
            except _queue.Empty:
                continue
            if kind == "chunk":
                if stream_callback:
                    stream_callback(value)
                raw += value
                # Early stop: once output is parseable into a valid selection payload.
                if '"card_indices"' in raw:
                    try:
                        parsed = extract_json(raw)
                        if isinstance(parsed, dict) and isinstance(parsed.get("card_indices"), list):
                            _abort.set()
                            break
                    except Exception:
                        pass
            elif kind == "done":
                break
            elif kind == "error":
                raise value

        if timed_out:
            raise TimeoutError(
                f"Model generation exceeded {OLLAMA_MAX_GENERATION_SEC:.0f}s before producing a complete response"
            )

        if not raw.strip():
            raise TimeoutError("Model returned no content")

        # If the model ended without a parseable result, fail fast with a clear error.
        extract_json(raw)
    except ValueError as e:
        logger.error(f"Ollama LLM call produced unparsable output: {e}")
        if progress_callback:
            progress_callback(f"LLM output was not parseable: {e}")
        if ALLOW_LLM_TIMEOUT_FALLBACK:
            llm_timed_out = True
        else:
            raise
    except TimeoutError as e:
        logger.error(f"Ollama LLM call timed out: {e}")
        if progress_callback:
            progress_callback(f"LLM timeout: {e}")
        if ALLOW_LLM_TIMEOUT_FALLBACK:
            llm_timed_out = True
        else:
            raise
    except Exception as e:
        logger.error(f"Ollama LLM call failed: {e}")
        if progress_callback:
            progress_callback(f"LLM error: {e}")
        raise
    finally:
        heartbeat_stop.set()
        if heartbeat_thread and heartbeat_thread.is_alive():
            heartbeat_thread.join(timeout=0.5)

    if progress_callback:
        progress_callback("Parsing AI response and validating card picks")

    if llm_timed_out:
        if progress_callback:
            progress_callback("Model timed out; using local fallback deck assembly")
        result = {
            "description": "LLM timed out; deck assembled from prioritized local candidates.",
            "card_indices": [],
            "card_names": [],
        }
    else:
        try:
            result = extract_json(raw)
        except Exception as e:
            logger.error(f"Failed to parse LLM output: {e}\nRaw output: {raw[:500]}")
            if progress_callback:
                progress_callback(f"Failed to parse LLM output: {e}")
            raise

    selected = _build_deck_selection(model_candidates, all_candidates, result)

    land_target = min(99, max(0, int(basic_land_count or 0)) + max(0, int(nonbasic_land_count or 0)) + max(0, int(dual_land_count or 0)))
    nonland_target = 99 - land_target
    rebalanced_nonlands = _rebalance_nonlands_for_quality(
        selected,
        all_candidates,
        nonland_target,
        commander.get("name", ""),
        scoring_keywords,
        strict_mode,
        constraints=constraints,
        excluded_card_names=excluded_card_names,
    )
    selected_lands = [c for c in selected if is_land(c)]
    selected = rebalanced_nonlands + selected_lands

    if progress_callback:
        mode_label = "strict" if strict_mode else "balanced"
        progress_callback(f"Applied {mode_label} quality tuning to nonland picks")

    selected = _apply_land_targets(
        selected,
        all_candidates,
        basic_land_count,
        nonbasic_land_count,
        commander_identity,
        dual_land_count=dual_land_count,
    )

    # Enforce user-defined deck constraints (hard minimums/maximums by card type/text)
    if constraints:
        must_names_lower = {m["name"].lower() for m in (must_include_cards or [])}
        selected = _enforce_constraints(selected, all_candidates, constraints, must_names_lower)
        if progress_callback:
            active_c = [c for c in constraints if (c.get("min_count") or 0) > 0 or (c.get("max_count") or 0) > 0]
            if active_c:
                progress_callback(f"Enforced {len(active_c)} deck constraint(s)")

    # Enforce tapped-land cap
    if tapped_land_max > 0:
        selected = _enforce_tapped_land_cap(selected, all_candidates, tapped_land_max)
        if progress_callback:
            progress_callback(f"Enforced tapped land cap: max {tapped_land_max}")

    # Enforce must-include cards: swap into the final 99 if missing.
    if must_include_cards:
        must_lower = {m["name"].lower() for m in must_include_cards}
        present = {c["name"].lower() for c in selected}
        missing = [m for m in must_include_cards if m["name"].lower() not in present]
        for m in missing:
            m_is_land = is_land(m)
            replaced = False
            for i in range(len(selected) - 1, -1, -1):
                sc = selected[i]
                if sc["name"].lower() in must_lower:
                    continue
                if is_land(sc) == m_is_land:
                    if progress_callback:
                        progress_callback(f"Forced must-include: swapped '{sc['name']}' for '{m['name']}'")
                    selected[i] = m
                    replaced = True
                    break
            if not replaced:
                if progress_callback:
                    progress_callback(f"Forced must-include appended: '{m['name']}'")
                selected.append(m)
        if len(selected) > 99:
            # Trim non-must extras from the end first
            trimmed = []
            for c in selected:
                trimmed.append(c)
            i = len(trimmed) - 1
            while len(trimmed) > 99 and i >= 0:
                if trimmed[i]["name"].lower() not in must_lower:
                    trimmed.pop(i)
                i -= 1
            selected = trimmed[:99]

    if progress_callback and len(selected) < 99:
        progress_callback("Deck had insufficient candidates after recovery; padded with available basics")

    if progress_callback:
        progress_callback("Deck assembly complete")

    return {
        "commander": commander,
        "deck": selected[:99],
        "description": result.get("description", ""),
    }


def generate_deck(
    prompt: str,
    commander_name: str,
    collection: list[dict],
    keyword_filters: Optional[list[str]] = None,
    must_include_cards: Optional[list[str]] = None,
    basic_land_count: int = 37,
    nonbasic_land_count: int = 5,
    dual_land_count: int = 0,
    strict_mode: bool = False,
    commander_override: Optional[dict] = None,
    constraints: Optional[list[dict]] = None,
    excluded_card_names: Optional[list[str]] = None,
    tapped_land_max: int = 0,
    progress_callback: Optional[Callable[[str], None]] = None,
    current_deck: Optional[list[dict]] = None,
) -> dict:
    """Main entry point for deck generation."""
    if progress_callback:
        progress_callback("Validating selected commander")

    commander = commander_override
    if not commander:
        for card in collection:
            if card["name"].lower() == commander_name.lower():
                commander = card
                break

    if not commander:
        raise ValueError(f"Commander '{commander_name}' not found in your collection.")

    identity = commander.get("color_identity", [])
    if progress_callback:
        progress_callback("Filtering collection by commander color identity and legality")

    candidates = rule_based_filter(collection, identity, commander["id"])

    # Resolve must-include card dicts and force them into the candidate pool
    # even if they were filtered out by color identity / legality.
    must_dicts: list[dict] = []
    if must_include_cards:
        wanted = {n.lower() for n in must_include_cards if isinstance(n, str) and n.strip()}
        if wanted:
            candidate_names = {c["name"].lower() for c in candidates}
            for card in collection:
                key = card["name"].lower()
                if key in wanted and key != commander["name"].lower():
                    must_dicts.append(card)
                    if key not in candidate_names:
                        candidates.append(card)
                        candidate_names.add(key)
            if progress_callback and must_dicts:
                progress_callback(
                    f"Forcing {len(must_dicts)} must-include card(s) into deck: "
                    + ", ".join(c["name"] for c in must_dicts)
                )

    if len(candidates) < 20:
        raise ValueError(
            f"Not enough legal cards in your collection for a {commander['name']} deck. "
            f"Found only {len(candidates)} candidates."
        )

    return build_deck_with_llm(
        prompt,
        commander,
        candidates,
        keyword_filters=keyword_filters,
        must_include_cards=must_dicts,
        basic_land_count=basic_land_count,
        nonbasic_land_count=nonbasic_land_count,
        dual_land_count=dual_land_count,
        strict_mode=strict_mode,
        constraints=constraints,
        excluded_card_names=excluded_card_names,
        tapped_land_max=tapped_land_max,
        progress_callback=progress_callback,
        current_deck=current_deck,
    )
