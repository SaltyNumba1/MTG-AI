# DeepBrew v1.3.1

## My Decks Stats Panel + Swap-Select UX Fixes

### Highlights

v1.3.1 is the final release of the free, open-source version of DeepBrew. Future versions transition to a tiered commercial product. This release polishes the My Decks experience with an at-a-glance stats panel and fixes a long-standing race condition in the swap-select analyze flow.

---

### My Decks Stats Panel

When you open a saved deck in My Decks, three stats panels are now shown above the sort selector:

- **Mana Curve** — bar chart of non-land card counts by CMC
- **Color Distribution** — breakdown of card counts by color identity (W/U/B/R/G/C)
- **Lands** — count of basic vs. nonbasic lands in the deck

Computed client-side from the deck JSON — no backend call required.

---

### Swap-Select UX Fix

`setSwapSelectMode(false)` now fires at the start of `handleAnalyze` (before the API call) instead of only in the `finally` block. The toggle no longer stays active for the full 30–60 second analyze round-trip.

---

### Swap-Select Hint Bar

A hint bar is now shown when swap-select mode is active but no cards have been selected yet:

> *"Click cards to select them for targeted swap suggestions."*

---

### v1.3.0 Changes (included in this build)

- **`useSettings` hook** — all pages share a single source of truth for the 10 `deepbrew_*` localStorage settings keys.
- **Expanded Settings page** — *Deck Building Defaults* and *Display* sections added.
- **Rename decks** — pencil icon in My Decks, saved via `PATCH /deck/saved/{deck_file}` with path traversal protection.

---

### Install

1. Download and extract `DeepBrew-V1.3.1.zip`
2. Download a model from [Hugging Face → SaltyNumba1](https://huggingface.co/SaltyNumba1) and place it in `%APPDATA%\mtg-collection-frontend\models\`
3. Edit `model-select.env` in that folder to uncomment your chosen model
4. Run `DeepBrew.exe`

| Model | File | VRAM |
|---|---|---|
| Mistral 7B Q4 (default) | `mistral-commander-q4.gguf` | 6 GB |
| Nemo 12B Q3 | `mtg-commander-nemo-q3_k_m.gguf` | 8 GB |
| Nemo 12B Q4 | `mtg-commander-nemo-q4_k_m.gguf` | 10–12 GB |
