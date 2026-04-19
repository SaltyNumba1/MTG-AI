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
from typing import Callable, Optional
import ollama

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "mtg-commander")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "300"))  # seconds


def is_commander_legal(card: dict) -> bool:
    legalities = card.get("legalities") or {}
    return legalities.get("commander") == "legal"


def matches_color_identity(card: dict, commander_identity: list[str]) -> bool:
    card_identity = card.get("color_identity") or []
    return all(c in commander_identity for c in card_identity)


def is_basic_land(card: dict) -> bool:
    type_line = (card.get("type_line") or "").lower()
    return "basic" in type_line and "land" in type_line


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


def extract_json(text: str) -> dict:
    """Extract JSON from model output that may contain extra prose."""
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
    raise ValueError(f"Could not extract JSON from model response:\n{text[:500]}")


def build_deck_with_llm(
    prompt: str,
    commander: dict,
    candidates: list[dict],
    progress_callback: Optional[Callable[[str], None]] = None,
) -> dict:
    """
    Ask the local Ollama model to pick 99 cards from candidates.
    Returns {"commander": ..., "deck": [...], "description": "..."}
    """
    if progress_callback:
        progress_callback("Preparing candidate pool for AI model")

    # Non-lands first, then lands — no truncation; use the full filtered collection
    non_lands = [c for c in candidates if "land" not in (c.get("type_line") or "").lower()]
    lands = [c for c in candidates if "land" in (c.get("type_line") or "").lower()]
    trimmed = non_lands + lands

    # Use compact summaries for large pools to stay within context limits
    summarize = card_summary_full if len(trimmed) <= MAX_COMPACT_CANDIDATES else card_summary

    card_list_text = "\n".join(
        f"{i + 1}. {summarize(c)}" for i, c in enumerate(trimmed)
    )

    system_prompt = (
        "You are an expert Magic: The Gathering deck builder specializing in Commander format. "
        "Select exactly 99 cards from the numbered list to form a synergistic Commander deck. "
        "Respond ONLY with valid JSON — no explanation, no markdown, no code fences. "
        'Format: {"description": "short deck description", "card_indices": [1, 5, 12, ...]}'
        " card_indices must contain exactly 99 numbers from the list."
    )

    user_message = (
        f"Commander: {commander['name']} "
        f"(Color identity: {', '.join(commander.get('color_identity', []))})\n"
        f"Request: {prompt}\n\n"
        f"Available cards:\n{card_list_text}"
    )

    if progress_callback:
        progress_callback(f"Asking AI to select 99 cards from {len(trimmed)} candidates")

    client = ollama.Client(timeout=OLLAMA_TIMEOUT)
    response = client.chat(
        model=OLLAMA_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        options={"temperature": 0.7},
    )

    raw = response["message"]["content"]
    if progress_callback:
        progress_callback("Parsing AI response and validating card picks")

    result = extract_json(raw)

    indices = result.get("card_indices", [])[:99]
    selected = [trimmed[i - 1] for i in indices if 0 < i <= len(trimmed)]

    # Pad with basic lands if the model returned fewer than 99
    if len(selected) < 99:
        if progress_callback:
            progress_callback("AI returned fewer than 99 cards, padding with legal basic lands")
        basics_needed = 99 - len(selected)
        basic_lands = [c for c in lands if is_basic_land(c)]
        selected += (basic_lands * 10)[:basics_needed]

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
    commander_override: Optional[dict] = None,
    progress_callback: Optional[Callable[[str], None]] = None,
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
        progress_callback=progress_callback,
    )
