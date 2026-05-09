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

# WotC's official Game Changer list (as of 2025)
GAME_CHANGERS: set[str] = {
    "rhystic study",
    "smothering tithe",
    "jeweled lotus",
    "dockside extortionist",
    "mana crypt",
    "demonic tutor",
    "cyclonic rift",
    "necropotence",
    "trouble in pairs",
    "opposition agent",
    "drannith magistrate",
    "mana drain",
    "ancient tomb",
    "mana vault",
    "the one ring",
    "parallel lives",
    "deflecting swat",
    "fierce guardianship",
    "mystic remora",
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
    "thassa's oracle",
    "demonic consultation",
    "tainted pact",
    "doomsday",
    "hermit druid",
    "underworld breach",
    "timetwister",
    "laboratory maniac",
    "jace, wielder of mysteries",
    "isochron scepter",
    "dramatic reversal",
    "freed from the real",
    "pemmin's aura",
    "heliod, sun-crowned",
    "walking ballista",
    "kiki-jiki, mirror breaker",
    "splinter twin",
    "exquisite blood",
    "sanguine bond",
    "basalt monolith",
    "rings of brighthearth",
    "power artifact",
    "breya, etherium shaper",
    "auriok salvagers",
    "lion's eye diamond",
    "food chain",
    "squee, the immortal",
    "misthollow griffin",
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
    found_extra = sorted(
        n for n in EXTRA_TURN_SPELLS if n in normalized
    )
    found_land = sorted(
        n for n in MASS_LAND_DENIAL if n in normalized
    )
    found_combo = sorted(
        n for n in COMBO_ENABLERS if n in normalized
    )
    found_tutors = [
        n for n in STRONG_TUTORS if n in normalized
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
