# DeepBrew v1.3.2 — Bug Fixes & Constraint Improvements

## 🐛 Bug Fixes

### Deck Import (.txt) no longer fails silently
Importing a `.txt` decklist on the Collection page was throwing "Import failed" for any deck containing cards not already in your collection. The root cause was an unhandled exception during Scryfall lookups and a missing `db.commit()` that rolled back all newly fetched cards. Both are fixed — import now logs per-card failures and completes successfully even if individual cards can't be fetched.

### Create Backup now actually creates a backup
The **Create Backup** button on the Collection page was silently doing nothing. The file-copy call (`shutil.copy2`) was missing from the endpoint. Fixed — clicking Create Backup now correctly copies the database file to `backups/`.

### Power / Toughness constraints now match actual card stats
Custom deck constraints using `match_field = power` or `match_field = toughness` were falling through to a full-text search, matching cards whose oracle text *mentioned* the word "power 4" rather than creatures that *have* power ≥ 4. The constraint engine now parses the card's actual `power`/`toughness` field as an integer and supports all comparison operators: `4+`, `>=4`, `>3`, `<=2`, `<4`, and exact integers. Cards with non-numeric stats (`*`, `X`) are correctly excluded.

The auto-detected **"Power ≥4 creatures"** constraint (emitted for commanders that reward high-power creatures) has also been corrected from `oracle_text / "power 4"` to `power / "4+"`.

### Max constraint enforcement works when no replacements exist
When the replacement pool was exhausted (e.g. an artifact-tribal commander where every pool card is also an artifact), cards violating a `max_count` ceiling were being left in the deck silently. They are now removed; the downstream basic-land padding fills any resulting gap.

---

## ✨ New Features

### "Add to Deck" on the Collection page
A new **Add to Deck** button appears in the bulk-action toolbar whenever one or more cards are selected. Clicking it opens a modal where you choose an existing saved deck and a destination (**Mainboard** or **Sideboard**), then appends the selected cards directly without leaving the Collection page.

### Power / Toughness in the custom constraint dropdown
The **Field** dropdown in the DeckBuilder constraint panel now includes **Power** and **Toughness** options. When either is selected the value placeholder updates to show the supported syntax (`"4+" or ">3" or ">=5" or "2"`).

---

## 📦 Build

- Backend rebuilt with PyInstaller (`package_standalone.bat`)
- Frontend repackaged with `npm run desktop:package`
