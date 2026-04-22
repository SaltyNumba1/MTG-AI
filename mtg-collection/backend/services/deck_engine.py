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
OLLAMA_MAX_GENERATION_SEC = float(os.getenv("OLLAMA_MAX_GENERATION_SEC", "420"))
OLLAMA_NUM_PREDICT = int(os.getenv("OLLAMA_NUM_PREDICT", "768"))
ALLOW_LLM_TIMEOUT_FALLBACK = os.getenv("ALLOW_LLM_TIMEOUT_FALLBACK", "1").strip().lower() not in {"0", "false", "no"}
MAX_MODEL_CANDIDATES = int(os.getenv("MAX_MODEL_CANDIDATES", "320"))
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
        if len(keyword_only) >= max(12, int(nonland_target * 0.65)):
            deduped_nonlands = keyword_only

    is_akawalli = "akawalli" in (commander_name or "").lower()

    def score(card: dict) -> float:
        card_id = card.get("id") or card.get("name")
        value = 0.0

        if card_id in selected_ids:
            value += 25.0

        if normalized_keywords and _card_matches_keywords(card, normalized_keywords):
            value += 90.0 if strict_mode else 65.0

        if is_akawalli:
            value += float(_akawalli_synergy_score(card) * (10 if strict_mode else 8))

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
) -> list[dict]:
    """Rebalance final deck to requested land counts while preserving model picks where possible."""
    basic_target = max(0, int(basic_land_count or 0))
    nonbasic_target = max(0, int(nonbasic_land_count or 0))
    land_target = min(99, basic_target + nonbasic_target)
    nonland_target = 99 - land_target

    selected_nonlands = [c for c in selected if not is_land(c)]
    selected_nonbasic_lands = [c for c in selected if is_nonbasic_land(c)]
    selected_basic_lands = [c for c in selected if is_basic_land(c)]

    all_nonlands = [c for c in all_candidates if not is_land(c)]
    all_nonbasic_lands = [c for c in all_candidates if is_nonbasic_land(c)]
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
    basic_land_count: int = 37,
    nonbasic_land_count: int = 5,
    strict_mode: bool = False,
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

    if scoring_keywords:
        keyword_matches = [c for c in all_candidates if _card_matches_keywords(c, scoring_keywords)]
        keyword_non_matches = [c for c in all_candidates if not _card_matches_keywords(c, scoring_keywords)]
        all_candidates = keyword_matches + keyword_non_matches
        if progress_callback:
            progress_callback(
                f"Prioritized {len(keyword_matches)} synergy-matching cards from {len(all_candidates)} candidates"
            )

    model_candidates = all_candidates
    if len(model_candidates) > MAX_MODEL_CANDIDATES:
        non_land_target = int(MAX_MODEL_CANDIDATES * 0.75)
        chosen_non_lands = _round_robin_by_color(non_lands, commander_identity, non_land_target)
        remaining = MAX_MODEL_CANDIDATES - len(chosen_non_lands)
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

    system_prompt = (
        "You are an expert Magic: The Gathering deck builder specializing in Commander format. "
        "Select exactly 99 cards from the numbered list to form a synergistic Commander deck. "
        "Respond ONLY with valid JSON — no explanation, no markdown, no code fences. "
        'Format: {"description": "short deck description", "card_indices": [1, 5, 12, ...]}'
        " card_indices must contain exactly 99 numbers from the list."
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
        f"\nTarget deck composition: {max(0, 99 - min(99, basic_land_count + nonbasic_land_count))} non-lands, "
        f"{max(0, nonbasic_land_count)} nonbasic lands, {max(0, basic_land_count)} basic lands."
    )
    current_deck_text = ""
    if current_deck:
        current_deck_text = "\nCurrent deck:\n" + "\n".join(f"- {c.get('name', '')}" for c in current_deck)
    user_message = (
        f"Commander: {commander['name']} "
        f"(Color identity: {', '.join(commander.get('color_identity', []))})\n"
        f"Request: {prompt}{synergy_text}{deck_shape_text}\n"
        f"{current_deck_text}\n"
        f"Available cards:\n{card_list_text}"
    )

    if progress_callback:
        progress_callback(f"Asking AI to select 99 cards from {len(model_candidates)} candidates")


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
        # Always stream so we can stop early once the JSON object is complete
        started_stream = time.monotonic()
        model_options = {"temperature": 0.7, "num_predict": OLLAMA_NUM_PREDICT}
        timed_out = False
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
            content = chunk.get("message", {}).get("content", "")
            if content:
                if stream_callback:
                    stream_callback(content)
                raw += content

            # Hard cap generation time to avoid long hangs waiting for model completion.
            if OLLAMA_MAX_GENERATION_SEC > 0 and (time.monotonic() - started_stream) >= OLLAMA_MAX_GENERATION_SEC:
                timed_out = True
                break

            # Early stop: once output is parseable into a valid selection payload.
            if '"card_indices"' in raw:
                try:
                    parsed = extract_json(raw)
                    if isinstance(parsed, dict) and isinstance(parsed.get("card_indices"), list):
                        break
                except Exception:
                    pass

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

    land_target = min(99, max(0, int(basic_land_count or 0)) + max(0, int(nonbasic_land_count or 0)))
    nonland_target = 99 - land_target
    rebalanced_nonlands = _rebalance_nonlands_for_quality(
        selected,
        all_candidates,
        nonland_target,
        commander.get("name", ""),
        scoring_keywords,
        strict_mode,
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
    )

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
    basic_land_count: int = 37,
    nonbasic_land_count: int = 5,
    strict_mode: bool = False,
    commander_override: Optional[dict] = None,
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
        basic_land_count=basic_land_count,
        nonbasic_land_count=nonbasic_land_count,
        strict_mode=strict_mode,
        progress_callback=progress_callback,
        current_deck=current_deck,
    )
