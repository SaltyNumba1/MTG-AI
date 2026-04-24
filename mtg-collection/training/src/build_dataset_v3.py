"""
Dataset v3 builder — merges all source types and emits Nemo-formatted chat data.

Source types handled:
  - "commander_deck"  (deck-build examples from EDHREC / Archidekt / synthetic)
  - "card_qa"         (Q&A pairs from fetch_scryfall_qa.py)
  - "swap_edit"       (multi-turn edit examples from generate_swap_examples.py)

Chat format:
  Mistral-Nemo's tokenizer (Tekken) uses a chat template of:
      <s>[INST] system + user [/INST] assistant </s>
  We emit OpenAI-style messages and let the tokenizer apply the template at
  training time (cleaner, format-agnostic, and works with the v1 pipeline too
  since both Mistral families understand the same role names).

Usage:
    python src/build_dataset_v3.py \
        --decks data/raw/all_examples_v2.jsonl data/raw/edhrec_examples_v2.jsonl \
        --qa    data/raw/scryfall_qa.jsonl \
        --swaps data/raw/swap_examples.jsonl \
        --output-dir data/processed_v3 \
        --eval-ratio 0.05 \
        --seed 42
"""

import argparse
import json
import random
import unicodedata
from pathlib import Path


SYSTEM_PROMPT = (
    "You are an expert Magic: The Gathering Commander deck builder. "
    "Build legal 99-card decks that respect color identity and singleton, "
    "answer questions about specific cards using their oracle text, and "
    "edit existing decks when asked."
)

BASIC_LAND_NAMES = {
    "plains", "island", "swamp", "mountain", "forest", "wastes",
    "snow-covered plains", "snow-covered island", "snow-covered swamp",
    "snow-covered mountain", "snow-covered forest",
}
MULTI_COPY_LEGAL = {
    "relentless rats", "shadowborn apostle", "dragon's approach",
    "rat colony", "persistent petitioners", "seven dwarves",
    "slime against humanity", "nazgul",
}


# -------- shared helpers --------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Merge v3 dataset sources into chat training files.")
    p.add_argument("--decks", nargs="*", default=[], help="One or more deck JSONL files.")
    p.add_argument("--qa", nargs="*", default=[], help="One or more card-QA JSONL files.")
    p.add_argument("--swaps", nargs="*", default=[], help="One or more swap-edit JSONL files.")
    p.add_argument("--output-dir", default="data/processed_v3", help="Output directory.")
    p.add_argument("--eval-ratio", type=float, default=0.05, help="Eval split fraction (default 0.05).")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument(
        "--cap-qa",
        type=int,
        default=0,
        help="Cap total QA examples (0 = no cap). Useful for balancing.",
    )
    p.add_argument(
        "--cap-swaps",
        type=int,
        default=0,
        help="Cap total swap examples (0 = no cap).",
    )
    return p.parse_args()


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        print(f"  (skip, missing) {path}")
        return []
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    print(f"  {len(rows):>6,}  {path}")
    return rows


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=True) + "\n")


# -------- deck examples --------

def normalize_card(entry: dict) -> dict:
    name = str(entry.get("name", "")).strip()
    qty = int(entry.get("quantity", 1))
    return {"name": name, "quantity": max(1, qty)}


def is_legal_quantity(name: str, qty: int) -> bool:
    key = unicodedata.normalize("NFKD", name.lower()).encode("ascii", "ignore").decode()
    if qty == 1:
        return True
    return key in BASIC_LAND_NAMES or key in MULTI_COPY_LEGAL


def normalize_deck_example(ex: dict) -> dict | None:
    commander = str(ex.get("commander", "")).strip()
    deck = ex.get("deck") or []
    if not commander or not deck:
        return None

    norm = [normalize_card(c) for c in deck if c.get("name")]
    total = sum(c["quantity"] for c in norm)
    if total != 99:
        return None
    for c in norm:
        if not is_legal_quantity(c["name"], c["quantity"]):
            return None

    return {
        "type": "commander_deck",
        "commander": commander,
        "color_identity": [c.upper() for c in (ex.get("color_identity") or []) if c.strip()],
        "strategy": str(ex.get("strategy") or "").strip() or f"Commander deck for {commander}.",
        "tags": [str(t).strip() for t in (ex.get("tags") or []) if str(t).strip()],
        "deck": sorted(norm, key=lambda c: c["name"].lower()),
        "source": str(ex.get("source") or "unknown"),
    }


def deck_to_chat(ex: dict) -> dict:
    user_lines = [
        f"Commander: {ex['commander']}",
        f"Color identity: {', '.join(ex['color_identity']) or 'Colorless'}",
        f"Strategy: {ex['strategy']}",
    ]
    if ex["tags"]:
        user_lines.append(f"Tags: {', '.join(ex['tags'])}")
    user_lines.append("Build a legal 99-card Commander deck. Reply with JSON {\"description\": str, \"deck\": [{\"name\": str, \"quantity\": int}, ...]}.")

    assistant = json.dumps({"description": ex["strategy"], "deck": ex["deck"]}, ensure_ascii=True)
    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "\n".join(user_lines)},
            {"role": "assistant", "content": assistant},
        ],
        "kind": "deck",
    }


# -------- QA examples --------

def qa_to_chat(ex: dict) -> dict:
    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": str(ex["q"]).strip()},
            {"role": "assistant", "content": str(ex["a"]).strip()},
        ],
        "kind": "qa",
    }


# -------- Swap examples (multi-turn) --------

def swap_to_chat(ex: dict) -> dict:
    commander = ex["commander"]
    colors = ", ".join(ex.get("color_identity") or []) or "Colorless"

    initial_user = (
        f"Commander: {commander}\n"
        f"Color identity: {colors}\n"
        "Build a legal 99-card Commander deck. Reply with JSON {\"description\": str, \"deck\": [...]}."
    )
    initial_assistant = json.dumps(
        {"description": f"Commander deck for {commander}.", "deck": ex["deck_before"]},
        ensure_ascii=True,
    )
    edit_request = (
        f"Please swap {len(ex['removed'])} card(s) for {ex['reason']}: "
        f"{ex.get('reason_blurb', '')} "
        f"Remove: {', '.join(ex['removed'])}. Then return the full updated 99-card deck."
    )
    edit_assistant = json.dumps(
        {
            "description": f"Updated {commander} deck — {ex['reason']}.",
            "removed": ex["removed"],
            "added": ex["added"],
            "deck": ex["deck_after"],
        },
        ensure_ascii=True,
    )

    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": initial_user},
            {"role": "assistant", "content": initial_assistant},
            {"role": "user", "content": edit_request},
            {"role": "assistant", "content": edit_assistant},
        ],
        "kind": "swap",
    }


# -------- main --------

def main() -> None:
    args = parse_args()
    rng = random.Random(args.seed)
    out_dir = Path(args.output_dir)

    print("Loading decks:")
    raw_decks: list[dict] = []
    for p in args.decks:
        raw_decks.extend(read_jsonl(Path(p)))

    print("Loading QA:")
    qa_rows: list[dict] = []
    for p in args.qa:
        qa_rows.extend(read_jsonl(Path(p)))

    print("Loading swaps:")
    swap_rows: list[dict] = []
    for p in args.swaps:
        swap_rows.extend(read_jsonl(Path(p)))

    # Normalize + drop bad decks
    normalized_decks: list[dict] = []
    for ex in raw_decks:
        norm = normalize_deck_example(ex)
        if norm:
            normalized_decks.append(norm)
    print(f"\n{len(normalized_decks):,} of {len(raw_decks):,} deck examples passed validation.")

    # Optional caps for balance
    if args.cap_qa and len(qa_rows) > args.cap_qa:
        rng.shuffle(qa_rows)
        qa_rows = qa_rows[: args.cap_qa]
        print(f"Capped QA to {len(qa_rows):,}.")
    if args.cap_swaps and len(swap_rows) > args.cap_swaps:
        rng.shuffle(swap_rows)
        swap_rows = swap_rows[: args.cap_swaps]
        print(f"Capped swaps to {len(swap_rows):,}.")

    # Convert to chat
    chat: list[dict] = []
    chat.extend(deck_to_chat(d) for d in normalized_decks)
    chat.extend(qa_to_chat(q) for q in qa_rows)
    chat.extend(swap_to_chat(s) for s in swap_rows)

    rng.shuffle(chat)
    eval_n = max(1, int(len(chat) * args.eval_ratio))
    eval_set, train_set = chat[:eval_n], chat[eval_n:]

    train_path = out_dir / "chat_train.jsonl"
    eval_path = out_dir / "chat_eval.jsonl"
    decks_path = out_dir / "commander_examples.jsonl"

    # Strip the "kind" field before writing — only used internally for stats
    def _strip(rows):
        return [{k: v for k, v in r.items() if k != "kind"} for r in rows]

    write_jsonl(train_path, _strip(train_set))
    write_jsonl(eval_path, _strip(eval_set))
    write_jsonl(decks_path, normalized_decks)

    # Stats
    def _by_kind(rows):
        c = {"deck": 0, "qa": 0, "swap": 0}
        for r in rows:
            c[r.get("kind", "deck")] = c.get(r.get("kind", "deck"), 0) + 1
        return c

    print(f"\nWrote:")
    print(f"  {train_path}  ({len(train_set):,} rows)  {_by_kind(train_set)}")
    print(f"  {eval_path}  ({len(eval_set):,} rows)  {_by_kind(eval_set)}")
    print(f"  {decks_path}  ({len(normalized_decks):,} decks)")


if __name__ == "__main__":
    main()
