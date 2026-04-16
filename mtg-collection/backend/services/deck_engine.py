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
from typing import Optional
import ollama

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "mistral")


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
    return (
        f"{card['name']} | {card.get('type_line', '')} | "
        f"CMC:{card.get('cmc', 0)} | "
        f"{(card.get('oracle_text') or '')[:100].replace(chr(10), ' ')}"
    )


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
    max_candidates: int = 300,
) -> dict:
    """
    Ask the local Ollama model to pick 99 cards from candidates.
    Returns {"commander": ..., "deck": [...], "description": "..."}
    """
    # Prioritize non-lands to stay within context window
    non_lands = [c for c in candidates if "land" not in (c.get("type_line") or "").lower()]
    lands = [c for c in candidates if "land" in (c.get("type_line") or "").lower()]
    trimmed = (non_lands + lands)[:max_candidates]

    card_list_text = "\n".join(
        f"{i + 1}. {card_summary(c)}" for i, c in enumerate(trimmed)
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

    response = ollama.chat(
        model=OLLAMA_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        options={"temperature": 0.7},
    )

    raw = response["message"]["content"]
    result = extract_json(raw)

    indices = result.get("card_indices", [])[:99]
    selected = [trimmed[i - 1] for i in indices if 0 < i <= len(trimmed)]

    # Pad with basic lands if the model returned fewer than 99
    if len(selected) < 99:
        basics_needed = 99 - len(selected)
        basic_lands = [c for c in lands if is_basic_land(c)]
        selected += (basic_lands * 10)[:basics_needed]

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
) -> dict:
    """Main entry point for deck generation."""
    commander = commander_override
    if not commander:
        for card in collection:
            if card["name"].lower() == commander_name.lower():
                commander = card
                break

    if not commander:
        raise ValueError(f"Commander '{commander_name}' not found in your collection.")

    identity = commander.get("color_identity", [])
    candidates = rule_based_filter(collection, identity, commander["id"])

    if len(candidates) < 20:
        raise ValueError(
            f"Not enough legal cards in your collection for a {commander['name']} deck. "
            f"Found only {len(candidates)} candidates."
        )

    return build_deck_with_llm(prompt, commander, candidates)
