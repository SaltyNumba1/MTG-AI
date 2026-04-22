"""
Synergy Engine — maps keyword_filters to Commander archetypes, expands them into
richer oracle-text search patterns, and generates a Strategy Directive for the LLM.

Usage:
    from services.synergy_engine import resolve_synergies

    expanded_keywords, strategy_directive = resolve_synergies(
        keyword_filters=["sacrifice", "token"],
        commander_name="Meren of Clan Nel Toth",
        color_identity=["B", "G"],
    )
"""
import json
import re
from pathlib import Path
from typing import Optional

def _get_synergy_map_path() -> Path:
    """Resolve synergy_map.json whether running live or as a PyInstaller bundle."""
    import sys
    if getattr(sys, "frozen", False):
        # PyInstaller extracts data files relative to sys._MEIPASS
        return Path(sys._MEIPASS) / "services" / "synergy_map.json"
    return Path(__file__).parent / "synergy_map.json"

_SYNERGY_MAP_PATH = _get_synergy_map_path()
_synergy_map: Optional[dict] = None


def _load_map() -> dict:
    global _synergy_map
    if _synergy_map is None:
        _synergy_map = json.loads(_SYNERGY_MAP_PATH.read_text(encoding="utf-8"))
    return _synergy_map


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _match_archetypes(keyword_filters: list[str], archetypes: dict) -> list[str]:
    """Return archetype keys whose aliases match any of the keyword_filters."""
    normalized_inputs = {_normalize(k) for k in keyword_filters if k and k.strip()}
    matched: list[str] = []
    for archetype_key, archetype in archetypes.items():
        aliases = [_normalize(a) for a in archetype.get("aliases", [])]
        if any(
            (alias in inp or inp in alias)
            for inp in normalized_inputs
            for alias in aliases
        ):
            if archetype_key not in matched:
                matched.append(archetype_key)
    return matched


def _build_expanded_keywords(
    matched_archetypes: list[str],
    original_keywords: list[str],
    archetypes: dict,
) -> list[str]:
    """
    Combine original keywords with oracle-text patterns from matched archetypes
    and their synergy_partners. Returns a deduplicated list.
    """
    seen: set[str] = set()
    expanded: list[str] = []

    def add(term: str):
        norm = _normalize(term)
        if norm and norm not in seen:
            seen.add(norm)
            expanded.append(term.strip().lower())

    for kw in original_keywords:
        add(kw)

    for key in matched_archetypes:
        archetype = archetypes.get(key, {})
        for pattern in archetype.get("key_patterns", []):
            add(pattern)
        for partner in archetype.get("synergy_partners", []):
            # Partners are short labels — look them up as additional keywords
            add(partner)
            # Also look up the partner's own key_patterns if it is itself an archetype
            partner_archetype = archetypes.get(partner.lower().replace(" ", "_"), {})
            for p in partner_archetype.get("key_patterns", []):
                add(p)

    return expanded


def _build_strategy_directive(
    matched_archetypes: list[str],
    commander_name: str,
    color_identity: list[str],
    archetypes: dict,
) -> str:
    """Compose a multi-archetype strategy directive string for the LLM prompt."""
    if not matched_archetypes:
        return ""

    lines: list[str] = [
        f"=== STRATEGY DIRECTIVE FOR {commander_name.upper()} ===",
        f"Color identity: {', '.join(color_identity) if color_identity else 'Colorless'}",
        f"Detected archetypes: {', '.join(matched_archetypes)}",
        "",
        "You MUST follow these archetype-specific construction rules when selecting cards:",
        "",
    ]

    for key in matched_archetypes:
        archetype = archetypes.get(key, {})
        directive = archetype.get("strategy_directive", "")
        if directive:
            lines.append(directive)
            lines.append("")

    if len(matched_archetypes) > 1:
        lines.append(
            "MULTI-ARCHETYPE NOTE: These archetypes overlap — prioritize cards that "
            "serve multiple roles simultaneously (e.g., a creature that generates tokens "
            "AND has a death trigger serves both 'sacrifice' and 'token' archetypes). "
            "Prefer crossover cards over single-purpose ones."
        )
        lines.append("")

    lines.append(
        "REQUIRED ROLES (ensure these categories are filled before picking generic cards): "
        + "; ".join(
            role
            for key in matched_archetypes
            for role in archetypes.get(key, {}).get("requires", [])
        )
    )

    return "\n".join(lines)


def resolve_synergies(
    keyword_filters: list[str],
    commander_name: str = "",
    color_identity: Optional[list[str]] = None,
) -> tuple[list[str], str]:
    """
    Main entry point.

    Args:
        keyword_filters: Raw keyword strings from the user (e.g. ["sacrifice", "blink"]).
        commander_name:  Commander card name (for directive personalisation).
        color_identity:  Commander color identity list (e.g. ["B", "G"]).

    Returns:
        (expanded_keywords, strategy_directive)
        - expanded_keywords: Original keywords + oracle-text patterns from matched archetypes.
        - strategy_directive: Multi-paragraph instruction string ready to inject into LLM prompt.
          Empty string if no archetypes matched.
    """
    data = _load_map()
    archetypes = data.get("archetypes", {})

    clean_filters = [k for k in (keyword_filters or []) if k and k.strip()]

    if not clean_filters:
        return [], ""

    matched = _match_archetypes(clean_filters, archetypes)
    expanded = _build_expanded_keywords(matched, clean_filters, archetypes)
    directive = _build_strategy_directive(
        matched,
        commander_name or "Commander",
        color_identity or [],
        archetypes,
    )

    return expanded, directive
