# MTG Collection v1.0.12

Feature release on top of [v1.0.11](https://github.com/SaltyNumba1/MTG-AI/releases/tag/v1.0.11).

---

## ✨ New Features

### Deck Constraints Panel
- **Commander auto-analysis** — when you select a commander, the backend scans its oracle text and type line and suggests relevant deck-building constraints (tribal synergies, spellslinger, artifacts, lifegain, tokens, sacrifice, landfall, +1/+1 counters, and 30+ other archetypes).
- **High-confidence constraints are auto-enabled**; medium-confidence ones are surfaced but off by default.
- Per-constraint **min and max count** inputs — the engine enforces the floor/ceiling in the post-AI rebalance step.
- **Custom constraints** — add your own via field (Type Line / Oracle Text / Keywords / Any), value (supports `|` for OR, e.g. `Instant|Sorcery`), and minimum count.
- Constraints panel is collapsible; active constraint count shown in the toggle label.

### Type Counters
- **Artifact, Sorcery, Instant, Enchantment** each have their own **Min / Max** inputs directly below the land row.
- Shows "N owned" from your collection for each type.
- Merges cleanly with commander constraints — higher min wins, lower non-zero max wins.

### Max Tapped Lands
- New input to cap how many tapped lands the engine places. `0 = no limit`.
- Engine swaps excess tapped lands for untapped ones from your collection.

### Re-Roll & Card Exclusion
- **Checkbox on every deck result card** — check cards you don't want regenerated.
- **"Exclude from Regen" button** — moves checked cards to an exclusion list shown as dismissible pills.
- **"Re-Roll Without Selected" button** — instantly regenerates the deck excluding those cards.
- **Re-roll button** with exclusion count shows when cards are excluded.
- Exclusion list is cleared on a fresh build; cards can be individually un-excluded or all cleared.

### My Decks Edit Mode
- **"✎ Edit Deck" toggle** — puts the deck view into edit mode where cards show checkboxes.
- **Remove Selected bar** — select cards and bulk-remove them.
- **"+ Add Cards" button** — opens an Add from Collection modal (searchable, top 50 matches shown).
- **"💾 Save Changes" button** — persists edits via a new `PUT /deck/saved/:file` backend endpoint.

### Card Preview Modal (DeckBuilder)
- Click any result tile in the deck grid to open a full-art preview modal.
- Shows card name, CMC, and TCGplayer price.

### Add from Collection Modal
- Available in both **DeckBuilder** and **My Decks**.
- Searches your local collection by name; adds via the new `/deck/card-lookup` endpoint (DB first, Scryfall fallback).

### Deck Price in My Decks
- Sums TCGplayer price for all cards + commander; displayed in green in the deck meta row.
- Hidden if no price data is available.

### Background Art
- **🖼 button** on every card image — click to set that card's art as the full-screen app background.
- Background persists across pages and app restarts via `localStorage` (`mtg.bgArt`).
- Art is vertically positioned at 28% (top of the card art frame) with a dark overlay.
- Click again (or on a different card) to swap or clear.

### UI & Theming
- **Radial purple gradient** background — `#3b1f6e → #1a1a2e` with fixed attachment.
- **Mana symbol scatter overlay** — 12 low-opacity fixed emoji symbols (☀️💧💀🔥🌲) behind all pages.
- **Global zoom 1.25** — entire app rendered 25% larger.

---

## 🐛 Fixes

- **Collection type filter — DFC cards and Legendary** — type_line for double-faced cards (e.g. `Creature // Land`) was previously bleeding the second face's types into the subtype parser. Supertypes (Legendary, Snow, Basic, etc.) were also being treated as subtypes. Fixed: parse primary face only; classify supertypes separately. Legendary creatures now return ~224 results instead of 3.
- **Constraint conflict** — when a commander auto-constraint and a type-counter constraint targeted the same card type (e.g. both set a min for Artifacts), the two were previously concatenated and could conflict. Now merged: higher min wins, lower non-zero max wins.
- **Edit mode checkbox coverage** — the `.card-set-bg-btn` (top-left) and the card hover `z-index: 30` were covering or displacing the edit-mode checkbox. Both are now suppressed inside edit tile wrappers.

---

## ⚙️ Backend Changes

- **`GET /deck/commander-profile`** — returns constraint suggestions for a given commander name from the user's collection.
- **`GET /deck/card-lookup`** — looks up a card by name (DB first, Scryfall fallback); used by Add from Collection.
- **`PUT /deck/saved/:deck_file`** — replaces the deck card list in a saved deck JSON and regenerates the `.txt` sidecar.
- **`_analyze_commander_profile()`** — 30+ archetype pattern matchers (tribal, spellslinger, artifacts, equipment, enchantments, ETB, lifegain, counters, graveyard, tokens, sacrifice, landfall, draw payoffs, combat damage, proliferate, cycling, cast-from-exile, treasure, food, clues, storm, cascade, morph, mutate, historic, monarch, dungeons, power≥4, flying, toughness, stax, and more).
- **`_enforce_constraints()`** — post-rebalance hard enforcement for min/max counts.
- **`_enforce_tapped_land_cap()`** — swaps tapped lands for untapped pool entries.
- **Deck variety** — candidate pool is shuffled per build; temperature randomised between 0.70 and 0.88.
- **Constraint scoring** in rebalance — +80 score per active constraint matched (cards that fit constraints are prioritised by the AI scorer).
- **Timeout bumps** — `OLLAMA_MAX_GENERATION_SEC` raised to 900 s (was 720 s), `OLLAMA_TIMEOUT` to 960 s.

---

## 📦 Build / Install

1. Download `MTG-Collection-v1.0.12-win32-x64.zip` (~188 MB)
2. Extract anywhere (e.g. `C:\Apps\MTG Collection`)
3. Run `MTG Collection.exe`

> Your `%APPDATA%\MTG Collection\` folder (database + saved decks) is untouched by the upgrade. No migration needed.

## ⬆️ Upgrading from v1.0.11

Drop in the new folder — your data in `%APPDATA%\MTG Collection\` carries over automatically.
