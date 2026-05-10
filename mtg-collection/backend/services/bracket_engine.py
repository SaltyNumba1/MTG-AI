"""
Commander Bracket Engine — rates a decklist against WotC's official Bracket system
and generates power-level directives for the LLM when a target bracket is specified.

Brackets (2025):
  1 – Exhibition   : ultra-casual, theme decks, no powerful staples
  2 – Core         : precon power level, typical 8+ turn games
  3 – Upgraded     : above average, 1-3 Game Changers, combos OK, 6+ turns
  4 – Optimized    : high power, any card except banned list
  5 – Competitive  : cEDH, fastest possible win
"""
from __future__ import annotations

# ---------------------------------------------------------------------------
# Card sets — all lowercase for case-insensitive matching
# ---------------------------------------------------------------------------

# WotC's official Game Changer list (as of 2025) — extended with widely recognised
# high-power staples. Cards that also appear in STRONG_TUTORS or COMBO_ENABLERS are
# listed here too for scoring weight; calculate_bracket deduplicates so they only
# count toward one threshold.
GAME_CHANGERS: set[str] = {
    # White
    "drannith magistrate",
    "smothering tithe",
    "teferi's protection",
    "enlightened tutor",
    "humility",
    "farewell",
    "serra's sanctum",
    "parallel lives",

    # Blue
    "rhystic study",
    "mystic remora",
    "cyclonic rift",
    "fierce guardianship",
    "mana drain",
    "force of will",
    "intuition",
    "consecrated sphinx",
    "trouble in pairs",

    # Black
    "demonic tutor",
    "vampiric tutor",
    "imperial seal",
    "necropotence",
    "opposition agent",
    "orcish bowmasters",
    "bolas's citadel",

    # Red
    "dockside extortionist",
    "deflecting swat",
    "jeska's will",

    # Green
    "gaea's cradle",
    "survival of the fittest",
    "sylvan library",
    "worldly tutor",
    "seedborn muse",
    "natural order",

    # Colorless / Artifacts / Lands
    "mana crypt",
    "mana vault",
    "jeweled lotus",
    "the one ring",
    "ancient tomb",
    "mox diamond",
    "chrome mox",
    "grim monolith",
    "mox opal",
    "lion's eye diamond",
    "field of the dead",
    "the tabernacle at pendrell vale",
    "mishra's workshop",
}

EXTRA_TURN_SPELLS: set[str] = {
    "time warp",
    "temporal manipulation",
    "capture of jingzhou",
    "temporal mastery",
    "part the waterveil",
    "walk the aeons",
    "nexus of fate",
    "expropriate",
    "time stretch",
    "beacon of tomorrows",
    "alrund's epiphany",
    "time vault",
    "magistrate's scepter",
    "lighthouse chronologist",
    "sage of hours",
}

MASS_LAND_DENIAL: set[str] = {
    "armageddon",
    "ravages of war",
    "jokulhaups",
    "obliterate",
    "decree of annihilation",
    "catastrophe",
    "sunder",
    "apocalypse",
    "worldfire",
    "global ruin",
    "wildfire",
    "burning of xinye",
    "fall of the thran",
    "ruination",
    "keldon firebombers",
    "cataclysm",
}

STRONG_TUTORS: set[str] = {
    "vampiric tutor",
    "imperial seal",
    "grim tutor",
    "enlightened tutor",
    "mystical tutor",
    "worldly tutor",
    "gamble",
    "transmute artifact",
    "survival of the fittest",
    "chord of calling",
    "green sun's zenith",
    "natural order",
    "diabolic intent",
    "personal tutor",
    "scheming symmetry",
    "tooth and nail",
    "razaketh, the foulblooded",
    "recruiter of the guard",
    "imperial recruiter",
    "beseech the mirror",
    "stoneforge mystic",
    "wishclaw talisman",
    "lim-dul's vault",
    "crop rotation",
    "expedition map",
    "fabricate",
    "tinker",
    "dark petition",
    "diabolic tutor",
}

# Known combo enablers — cards that form or enable two-card infinite combos
COMBO_ENABLERS: set[str] = {
    # Infinite Mana
    "basalt monolith",
    "rings of brighthearth",
    "power artifact",
    "isochron scepter",
    "dramatic reversal",
    "ashnod's altar",
    "phyrexian altar",
    "forsaken monument",
    "auriok salvagers",
    "lion's eye diamond",

    # Infinite Tokens / ETB
    "kiki-jiki, mirror breaker",
    "splinter twin",
    "pestermite",
    "deceiver exarch",
    "village bell-ringer",
    "felidar guardian",
    "restoration angel",
    "emiel the blessed",
    "peregrine drake",
    "deadeye navigator",

    # Infinite Damage / Win-Cons
    "walking ballista",
    "heliod, sun-crowned",
    "exquisite blood",
    "sanguine bond",
    "sanguine blood",

    # Library-Win / Consultation Package
    "thassa's oracle",
    "demonic consultation",
    "tainted pact",
    "doomsday",
    "laboratory maniac",
    "jace, wielder of mysteries",

    # Graveyard / Recursion Loops
    "hermit druid",
    "underworld breach",
    "timetwister",
    "food chain",
    "squee, the immortal",
    "misthollow griffin",
    "breya, etherium shaper",

    # Untap Enablers
    "freed from the real",
    "pemmin's aura",

    # Extra Turn Loops (included here as they enable loops in certain builds)
    "time warp",
    "temporal manipulation",
    "nexus of fate",
    "beacon of tomorrows",
}

BRACKET_LABELS: dict[int, str] = {
    1: "Exhibition",
    2: "Core",
    3: "Upgraded",
    4: "Optimized",
    5: "Competitive (cEDH)",
}

BRACKET_DESCRIPTIONS: dict[int, str] = {
    1: (
        "Ultra-casual, theme-focused deck. No Game Changers, no powerful tutors, "
        "no combos, no extra turns. Games are typically long and story-driven."
    ),
    2: (
        "Average power level, similar to Commander preconstructed sets. "
        "No Game Changers or infinite combos. Games last at least 8 turns."
    ),
    3: (
        "Above-average deck with a clear strategy. May include up to 3 Game Changers, "
        "a single infinite combo, and extra turn spells. Games typically last 6+ turns."
    ),
    4: (
        "High-power deck with efficient, explosive strategies. May include 4+ Game Changers, "
        "mass land denial, and multiple combos. No restrictions beyond the ban list."
    ),
    5: (
        "Competitive EDH (cEDH) — metagame-driven deck built to win as quickly as possible. "
        "Heavy use of fast mana, tutors, interaction, and combo finishers."
    ),
}


# ---------------------------------------------------------------------------
# Oracle text patterns for functional equivalents
# (used by deck_engine.py to score/inject cards that aren't in the named sets
#  but perform the same role — keeps bracket logic consistent with the keyword
#  filter pipeline which already searches oracle text via _card_matches_keywords)
# ---------------------------------------------------------------------------

import re as _re

TUTOR_ORACLE_PATTERNS: list[str] = ["search your library"]
EXTRA_TURN_ORACLE_PATTERNS: list[str] = ["take an extra turn", "takes an extra turn"]

# Matches oracle text that searches for a basic land (Plains/Island/Swamp/Mountain/Forest).
# Covers both "basic land card" and "basic Forest card" / "basic Plains or Island card" etc.
# These are ramp spells, not tutors, and should not count as tutor equivalents.
_BASIC_LAND_SEARCH_RE = _re.compile(
    r"basic\s+(land|plains|island|swamp|mountain|forest)\b", _re.IGNORECASE
)


def _card_oracle_lower(card: dict) -> str:
    return (card.get("oracle_text") or "").lower()


def is_game_changer(card: dict) -> bool:
    """Exact name match only — Game Changers are too diverse for reliable oracle patterns."""
    return (card.get("name") or "").lower() in GAME_CHANGERS


def is_combo_enabler(card: dict) -> bool:
    """Exact name match only — combo pieces are too specific for reliable oracle patterns."""
    return (card.get("name") or "").lower() in COMBO_ENABLERS


def is_tutor_equivalent(card: dict) -> bool:
    """True for named strong tutors OR any non-land card that searches the library
    for non-basic cards.

    Lands are excluded entirely — fetchlands and other land-based searchers are
    mana-fixing, not tutors.
    Ramp spells that only fetch basic lands (Rampant Growth, Cultivate, panoramas, etc.)
    are excluded via the basic-land-type pattern.
    """
    if (card.get("name") or "").lower() in STRONG_TUTORS:
        return True
    # Lands are never tutors
    if "land" in (card.get("type_line") or "").lower():
        return False
    oracle = _card_oracle_lower(card)
    if "search your library" not in oracle:
        return False
    return not _BASIC_LAND_SEARCH_RE.search(oracle)


def is_extra_turn_equivalent(card: dict) -> bool:
    """True for named extra-turn spells OR any card with take-an-extra-turn oracle text."""
    if (card.get("name") or "").lower() in EXTRA_TURN_SPELLS:
        return True
    oracle = _card_oracle_lower(card)
    return any(p in oracle for p in EXTRA_TURN_ORACLE_PATTERNS)


def is_bracket_vip(card: dict, target_bracket: int) -> bool:
    """True if the card qualifies as a VIP auto-include for the given bracket.

    Uses oracle-text fallbacks so functional equivalents of named power cards are
    caught even when the exact card name is not in a named set.
      B4+: Game Changers (name), Combo Enablers (name), Tutor-equivalents (oracle)
      B5:  additionally Extra Turn equivalents (oracle)
    """
    if target_bracket >= 4:
        if is_game_changer(card) or is_combo_enabler(card) or is_tutor_equivalent(card):
            return True
    if target_bracket >= 5 and is_extra_turn_equivalent(card):
        return True
    return False


# ---------------------------------------------------------------------------
# Core functions
# ---------------------------------------------------------------------------

def calculate_bracket(card_names: list[str], commander_name: str = "") -> dict:
    """
    Calculate the Commander Bracket rating for a decklist.

    Args:
        card_names: All card names in the deck (including commander).
        commander_name: Optional commander name (already included in card_names).

    Returns:
        {
            "bracket": int (1-5),
            "label": str,
            "description": str,
            "game_changers": list[str],   # actual GC cards found
            "extra_turns": list[str],
            "mass_land_denial": list[str],
            "combo_enablers": list[str],
            "tutor_count": int,
        }
    """
    normalized = {n.strip().lower() for n in card_names if n and n.strip()}

    found_gc = sorted(
        n for n in GAME_CHANGERS if n in normalized
    )
    found_gc_set = set(found_gc)
    found_extra = sorted(
        n for n in EXTRA_TURN_SPELLS if n in normalized
    )
    found_land = sorted(
        n for n in MASS_LAND_DENIAL if n in normalized
    )
    found_combo = sorted(
        n for n in COMBO_ENABLERS if n in normalized
    )
    # Exclude tutors already counted as Game Changers to avoid double-counting
    # toward bracket thresholds (they still carry full GC weight for scoring).
    found_tutors = [
        n for n in STRONG_TUTORS if n in normalized and n not in found_gc_set
    ]

    gc_count = len(found_gc)
    has_extra = len(found_extra) > 0
    has_land_denial = len(found_land) > 0
    has_combo = len(found_combo) > 0
    tutor_count = len(found_tutors)

    # Determine bracket
    if gc_count == 0 and not has_extra and not has_land_denial and not has_combo and tutor_count <= 2:
        bracket = 1
    elif gc_count == 0 and not has_extra and not has_land_denial and not has_combo:
        bracket = 2
    elif gc_count >= 5 and (has_extra or has_combo) and tutor_count >= 3:
        bracket = 5
    elif gc_count >= 4 or has_land_denial:
        bracket = 4
    else:
        # 1-3 GCs, or has extra turns, or has combo enablers
        bracket = 3

    # Title-case the card names for display
    def _title(names: list[str]) -> list[str]:
        return [n.title() for n in names]

    return {
        "bracket": bracket,
        "label": BRACKET_LABELS[bracket],
        "description": BRACKET_DESCRIPTIONS[bracket],
        "game_changers": _title(found_gc),
        "extra_turns": _title(found_extra),
        "mass_land_denial": _title(found_land),
        "combo_enablers": _title(found_combo),
        "tutor_count": tutor_count,
    }


# ---------------------------------------------------------------------------
# Prompt directives — power-level guidance injected into the LLM prompt
# (Target bracket is a soft hint only — no cards are auto-fetched or injected.
#  The app is collection-first: only cards the user owns are candidates.)
# ---------------------------------------------------------------------------


def get_bracket_prompt_directive(target_bracket: int) -> str:
    """
    Return a power-level directive paragraph to inject into the LLM prompt.
    Returns an empty string when target_bracket is 0 (no preference).
    """
    if target_bracket == 1:
        return (
            "=== POWER LEVEL DIRECTIVE: BRACKET 1 (EXHIBITION) ===\n"
            "Build an ultra-casual, theme-driven deck. STRICTLY AVOID all of the following:\n"
            "- Game Changers: Rhystic Study, Smothering Tithe, Mana Crypt, Dockside Extortionist, "
            "Jeweled Lotus, Demonic Tutor, Cyclonic Rift, Necropotence, Mana Drain, Mana Vault, "
            "The One Ring, Fierce Guardianship, Deflecting Swat, Opposition Agent, Mystic Remora, "
            "Drannith Magistrate, Ancient Tomb, Parallel Lives, Trouble in Pairs.\n"
            "- Infinite combos (no Thassa's Oracle, Demonic Consultation, Tainted Pact, Doomsday, etc.)\n"
            "- Extra turn spells (no Time Warp, Temporal Manipulation, Expropriate, etc.)\n"
            "- Mass land denial (no Armageddon, Jokulhaups, Obliterate, etc.)\n"
            "- Efficient tutors (max 2 tutors total, and prefer Diabolic Tutor over Vampiric Tutor)\n"
            "Focus on fun, themed, flavourful cards that support the deck concept without oppressive power."
        )
    if target_bracket == 2:
        return (
            "=== POWER LEVEL DIRECTIVE: BRACKET 2 (CORE) ===\n"
            "Build a deck at preconstructed Commander set power level. AVOID:\n"
            "- All Game Changers: Rhystic Study, Smothering Tithe, Mana Crypt, Jeweled Lotus, "
            "Dockside Extortionist, Demonic Tutor, Cyclonic Rift, Necropotence, Mana Drain, "
            "Mana Vault, The One Ring, Fierce Guardianship, Deflecting Swat, and similar.\n"
            "- Infinite combos (no Thassa's Oracle + Consultation, Food Chain, etc.)\n"
            "- Extra turn spells (no Time Warp, Temporal Manipulation, etc.)\n"
            "- Mass land denial (no Armageddon, Jokulhaups, etc.)\n"
            "Up to 3 tutors are acceptable (Diabolic Tutor, Fabricate, Chord of Calling).\n"
            "Prioritise solid generalist cards, synergistic creatures, and clear on-theme selections. "
            "Games should last at least 8 turns."
        )
    if target_bracket == 3:
        return (
            "=== POWER LEVEL DIRECTIVE: BRACKET 3 (UPGRADED) ===\n"
            "Build an above-average, focused deck with a clear win strategy. Guidelines:\n"
            "- You MAY include up to 3 Game Changers (e.g. Rhystic Study, Smothering Tithe, "
            "Cyclonic Rift, Dockside Extortionist, Mana Crypt — choose wisely).\n"
            "- One infinite combo package is acceptable.\n"
            "- Extra turn spells are acceptable in small numbers.\n"
            "- AVOID mass land denial (no Armageddon, Jokulhaups, Obliterate, Decree of Annihilation).\n"
            "Include efficient tutors, fast mana rocks, and strong synergy engines. "
            "Aim for consistent gameplay where games last at least 6 turns."
        )
    if target_bracket == 4:
        return (
            "=== POWER LEVEL DIRECTIVE: BRACKET 4 (OPTIMIZED) ===\n"
            "Build a high-power, efficient deck. Include the best staples available:\n"
            "- Freely include Game Changers: Rhystic Study, Smothering Tithe, Mana Crypt, "
            "Jeweled Lotus, Dockside Extortionist, Demonic Tutor, Mana Drain, Mana Vault, "
            "The One Ring, Fierce Guardianship, Deflecting Swat, Cyclonic Rift, Necropotence.\n"
            "- Include efficient tutors: Vampiric Tutor, Enlightened Tutor, Mystical Tutor, "
            "Worldly Tutor, Imperial Seal, Gamble.\n"
            "- Combos and extra turns are fully acceptable.\n"
            "- No restrictions beyond the Commander ban list.\n"
            "Optimize for consistency and explosive turns. Prioritize 2-mana rocks, "
            "efficient interaction (counterspells, removal), and fast combo or beatdown wins."
        )
    if target_bracket == 5:
        return (
            "=== POWER LEVEL DIRECTIVE: BRACKET 5 (COMPETITIVE / cEDH) ===\n"
            "Build a Competitive EDH deck optimised purely to win as fast as possible. Include:\n"
            "- Maximum fast mana: Mana Crypt, Mana Vault, Ancient Tomb, Jeweled Lotus, "
            "Chrome Mox, Mox Diamond, Mox Opal, Elvish Spirit Guide, Simian Spirit Guide.\n"
            "- All applicable Game Changers (Rhystic Study, Smothering Tithe, Necropotence, "
            "Dockside Extortionist, The One Ring, Opposition Agent, Drannith Magistrate, "
            "Fierce Guardianship, Deflecting Swat, Mystic Remora, Mana Drain).\n"
            "- Fast tutors: Demonic Tutor, Vampiric Tutor, Imperial Seal, Mystical Tutor, "
            "Enlightened Tutor, Diabolic Intent, Lim-Dul's Vault, Razaketh.\n"
            "- A primary fast combo win: e.g. Thassa's Oracle + Demonic Consultation/Tainted Pact, "
            "Underworld Breach + Wheel, Food Chain, Isochron Scepter + Dramatic Reversal.\n"
            "- A counterspell suite (Force of Will, Force of Negation, Pact of Negation, "
            "Mental Misstep, Swan Song, Fierce Guardianship, Deflecting Swat).\n"
            "Ignore flavour and theme — every card must justify its inclusion by winning faster or "
            "stopping opponents. Aim to win by turn 3-4."
        )
    return ""
