# DeepBrew v1.0.18

## Bracket Power-Level Targeting + Art Printing Modal

### Highlights

This release transforms the WotC bracket system from a soft LLM prompt hint into an active deck-building system. The app now injects and scores high-power cards from your collection based on your target bracket. The art printing picker was also completely redesigned.

---

### Bracket Power-Level System

**VIP card injection (Bracket 4+)**

When you select Bracket 4 or 5, the deck builder automatically injects qualifying high-power cards from your collection into the must-include pool before the LLM runs:

- **Bracket 4+**: game changers, combo enablers, and tutor-equivalents
- **Bracket 5**: also includes extra-turn spells

No cards you don't own are added — collection-first, always.

**Scoring bonuses during rebalancing**

Power cards score higher during the post-LLM quality rebalance:

| Category | Bracket requirement | Score bonus |
|---|---|---|
| Game Changers | B4+ | +70 |
| Combo Enablers | B3+ | +60 |
| Extra Turn Spells | B5+ | +55 |
| Tutor-equivalents | B3+ | +50 |
| CMC >5 non-power | B4+ | −15 |

**Oracle-text fallback classification**

Cards are now detected as tutor-equivalents or extra-turn spells even if they aren't on the named lists:
- Any non-land card whose oracle text contains "search your library" is treated as a tutor-equivalent
- Any card whose oracle text contains "take an extra turn" is treated as an extra-turn spell
- Lands (including fetchlands and panoramas) are excluded from tutor classification regardless of oracle text

**Expanded curated card sets**

- **Game Changers**: 56 cards across all colors
- **Combo Enablers**: 55 cards across 6 categories (infinite mana, infinite tokens/ETB, infinite damage/win-cons, library-win, graveyard/recursion loops, extra-turn loops)

**Bracket threshold deduplication**

Cards that appear in both the Game Changers list and the tutors list (Demonic Tutor, Vampiric Tutor, etc.) no longer inflate both counters when calculating bracket rating, preventing false bracket elevation.

---

### Art Printing Picker — Full-Screen Modal

The 🎨 Art button now opens a full-screen centered modal instead of an inline scrollable list.

- Responsive auto-fill grid of all printings (minimum 130 px per cell)
- Full card art at correct 63:88 aspect ratio
- Set code + collector number label below each card
- Active printing highlighted with a purple border
- Click the backdrop or ✕ to close without changing selection
- Rendered via React portal (`createPortal` to `document.body`) — never clipped by card containers

---

### Bug Fixes

- Fixed: tutors in the Game Changers list double-counting toward both game changer and tutor bracket thresholds
- Fixed: fetchlands and panoramas being misclassified as tutor-equivalents
- Fixed: printing picker being clipped by card tile `overflow: hidden`

---

### Notes

- The `.gguf` model file is **not bundled** — download separately from Hugging Face and place in `%APPDATA%\mtg-collection-frontend\models\`. See README for full instructions.
- If the app is running when repackaging, some DLLs in the release folder will be locked (Access Denied). Close the app first, then repackage.
