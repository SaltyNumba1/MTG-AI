# MTG Collection v1.0.8

## ✨ New
- **Add cards to existing collection from text** – new "Import Cards from Text" button on the Collection page. Paste a Moxfield/Archidekt-style list or load a `.txt` file; quantities are upserted into your existing collection (existing cards increment, no replacement).
- **Dual lands counter** on the Build Deck page – set how many multi-color lands matching your commander's color identity should be included. Counts toward the total land budget.
- **Smarter AI target** – the engine now asks the model for `99 − basics − nonbasics − duals − must-includes` non-land cards instead of asking for all 99. Faster, fewer wasted picks.
- **Lands at the bottom** of the generated deck list, with **basic-land tiles collapsed** to one tile per color (with `(N)` count badge). No more pages of identical Plains art.
- **Smaller commander preview** after deck generation (~half size).
- **My Decks sort dropdown** – Name / Card count / Commander / Type.
- **Analyze & Suggest popup** redesigned with side-by-side swap recommendations: current card → suggested card, at ~3"×3" tile size with arrows so you can actually read them.
- **Circular progress indicator** on collection imports (with percent in the center) replaces the linear bar.

## 🐛 Fixes
- Command Tower / Path of Ancestry are correctly treated as **nonbasic lands**, not basics.

## 📦 Build / Install
1. Download `MTG-Collection-v1.0.8-win32-x64.zip` (~146 MB)
2. Extract anywhere (e.g. `C:\Apps\MTG Collection`)
3. Run `MTG Collection.exe`

> Your `mtg_collection.db` and `saved_decks/` folder are kept next to the exe and persist across upgrades. Copy them over from your old install if you want to keep your collection and decks.
