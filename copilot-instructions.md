# DeepBrew Project Instructions

## Project Overview
DeepBrew is a local, privacy-first MTG deck-building suite. It uses local LLMs (Mistral/Gemma) to build decks from a user's collection CSV.

## Commercial Tiers
- **Starter ($15):** Uses Mistral-7B. Limited to Brackets 1-3.
- **Pro ($49):** Uses Mistral-Nemo-12B. Unlocks Brackets 4-5, "Lean Pool" filtering, and "Thought Stream" logs.

## Domain Rules
- **Format:** Commander/EDH (Singleton, 100 cards total).
- **Legality:** Strictly follow the Commander ban list (e.g., Biorhythm is BANNED).
- **Power Levels:** Use the 5-Bracket system defined in `bracket_engine.py`.

## Coding Standards
- **Inference:** Uses a local OpenAI-compatible API on port 8081.
- **Performance:** For B4/B5, always prioritize low CMC (Converted Mana Cost).
- **Logic:** Functional slots (Lands/Ramp/Interaction) take priority over "flavor" cards in Pro mode.

# DeepBrew Project Update (v1.3.1)

## Commercial Tier Enforcement
- **Starter ($15):** DEEPBREW_TIER='starter'. Max Bracket: 3. No Lean Pool.
- **Pro ($49):** DEEPBREW_TIER='pro'. Unlocks Brackets 4-5 and Lean Pool Filter.

## Lean Pool Formula (Pro Only)
For target_bracket >= 4, use the 500-card filter:
Weight = (is_vip * 100) + (is_synergy * 50) - (CMC * 10)

## Thought Stream Formatting
Always emit progress via:
[DEEPBREW_LOG]: <Phase> | <Message>
