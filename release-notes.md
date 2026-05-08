# MTG Collection v1.0.12.2

See full release notes in [release-notes-v1.0.12.2.md](release-notes-v1.0.12.2.md).

## ⚡ Highlights

- **AMD GPU acceleration** — bundled llama.cpp Vulkan backend replaces Ollama. No install required.
- **7.5/8.0 GB VRAM used** on AMD RX 5700 during generation.
- **20 480 token context** — handles large collections without truncation.
- **`--batch-size 2048`** — faster prefill on large candidate pools.
- **Self-contained** — `llama-server.exe` + 22 DLLs ship inside the app.

## 📦 Build / Install

1. Download `MTG-Collection-v1.0.13-win32-x64.zip`
2. Extract anywhere
3. Place `mistral-commander-q4.gguf` at `%APPDATA%\mtg-collection-frontend\models\model.gguf`
4. Run `MTG Commander Generator.exe`

## ✨ Highlights

- **Deck Constraints Panel** — auto-detected archetypes from commander oracle text (30+ patterns), min/max per constraint, custom constraints.
- **Type Counters** — Artifact / Sorcery / Instant / Enchantment min + max inputs.
- **Max Tapped Lands** cap.
- **Re-Roll + Card Exclusion** — check cards to exclude from the next generation, then re-roll.
- **My Decks Edit Mode** — remove cards, add from collection, save changes.
- **Background Art** — 🖼 button sets any card as full-screen background (persisted).
- **Deck Price** in My Decks meta.
- **UI Theming** — radial purple gradient, mana symbol scatter overlay, global zoom 1.25.
- **Collection type filter fix** — DFC + Legendary supertype corrected.
- **Deck variety** — shuffled pool + randomised temperature per build.
- **New backend endpoints** — commander-profile, card-lookup, deck PUT.

## 📦 Build / Install

1. Download `MTG-Collection-v1.0.12-win32-x64.zip`
2. Extract anywhere (e.g. `C:\Apps\MTG Collection`)
3. Run `MTG Collection.exe`

> Your `%APPDATA%\MTG Collection\` data (database + saved decks) persists across upgrades.

