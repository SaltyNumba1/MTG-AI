# DeepBrew v1.4.2 — AI Quality & Reliability

## 🧠 Engine Improvements

### Functional-role tagging
The deck engine now analyses each card's oracle text with 13 regex patterns and assigns up to 3 functional role tags: `[draw]`, `[ramp]`, `[removal]`, `[wipe]`, `[bounce]`, `[token]`, `[counter]`, `[tutor]`, `[recursion]`, `[copy]`, `[proliferate]`, `[anthem]`, `[protection]`. These tags are embedded directly in the AI prompt so the model understands what each card *does*, which leads to more cohesive deck selections.

### Two-tier card summaries in the AI prompt
Cards sent to the AI are now formatted at two fidelity levels:

- **Filler candidates** → compact: `Name | Type | CMC:X | keywords | [draw][ramp]`
- **Synergy candidates** → full: `Name | Type | CMC:X | keywords | First oracle sentence…`

The first oracle sentence is extracted by stripping reminder text and mana symbols, then taking the leading clause up to 120 characters.

### `{x}` mana cost filtering
`mana_cost` is now included in the card text search blob. Typing `{x}` in a keyword filter or any-field constraint now correctly matches X-cost spells (e.g. Finale of Devastation, Torment of Hailfire).

### Anti-hallucination system prompt
The AI is now instructed to output a plain-text numbered card list *only* — no JSON, no markdown, no explanations. Card names must be copied verbatim from the Available Cards list provided in the prompt. This eliminates the most common failure mode where the model invented plausible-sounding card names.

### Retry on low match count
After the first LLM response, the engine counts how many card names actually matched entries in the candidate pool. If fewer than 10 names matched, the engine automatically retries with:
- Temperature reduced to 0.1
- Candidate pool limited to the top-200 scored cards
- A simplified, more direct prompt

The retry result is only adopted if it produces *more* matches than the first attempt.

## 🐛 Bug Fixes

### Garbled deck description
When the model output began with JSON fragments or number sequences before the card list (e.g. `1.0}, {"1.0, 1.0}...`), that garbage was being stored verbatim as the deck's description. The description parser now discards any captured preamble that either exceeds 120 characters or contains no word with 4+ letters, clearing the description to empty in those cases.

### Robust JSON / output parser
`extract_json` no longer raises an exception on malformed LLM output. A new branch handles the `{"description":"Card Name","quantity":1}` hallucination format by extracting the description values as card names. If all parsing attempts fail, the function returns a `_parse_failed` sentinel so deck generation always completes gracefully rather than surfacing a 500 error.

## 📦 Build

- Backend rebuilt with PyInstaller (`package_standalone.bat`)
- Frontend repackaged: `npm run desktop:package:starter` and `npm run desktop:package:pro`
