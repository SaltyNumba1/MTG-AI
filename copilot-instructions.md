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
