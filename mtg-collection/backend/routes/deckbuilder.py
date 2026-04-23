import asyncio
import json
import re
from datetime import datetime
from pathlib import Path
from threading import Lock
from fastapi import APIRouter, Depends, HTTPException, Request, Body
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import Card
from services.deck_engine import generate_deck
from services.scryfall import fetch_card_by_name, extract_card_fields

router = APIRouter(prefix="/deck", tags=["deck"])


class DeckRequest(BaseModel):
    prompt: str
    commander_name: str
    keyword_filters: list[str] = []
    must_include_cards: list[str] = []
    basic_land_count: int = 25
    nonbasic_land_count: int = 12
    strict_mode: bool = False


class ImportDeckRequest(BaseModel):
    decklist: str
    deck_name: str | None = None


class AnalyzeDeckRequest(BaseModel):
    deck_file: str

@router.post("/import-deck")
async def import_deck(req: ImportDeckRequest, db: AsyncSession = Depends(get_db)):
    """
    Import a decklist (plain text, one card per line) and save as a deck.
    Returns the saved deck info or errors.
    """
    lines = [line.strip() for line in req.decklist.splitlines() if line.strip()]
    if not lines:
        raise HTTPException(status_code=400, detail="Decklist is empty.")

    # Parse decklist lines from common text formats (Moxfield/Archidekt/manual).
    section = "deck"
    deck_entries: list[dict] = []
    commander_name: str | None = None

    def _clean_name(raw_name: str) -> str:
        cleaned = raw_name.strip()
        cleaned = re.sub(r"\*CMDR\*", "", cleaned, flags=re.IGNORECASE).strip()
        return cleaned

    for line in lines:
        lowered = line.lower().strip()
        if lowered in {"commander", "command zone"}:
            section = "commander"
            continue
        if lowered in {"deck", "mainboard", "main"}:
            section = "deck"
            continue
        if lowered in {"sideboard", "side", "maybeboard", "maybeboard:"}:
            section = "sideboard"
            continue
        if line.startswith("//") or line.startswith("#"):
            continue

        m = re.match(r"^(\d+)\s*x?\s+(.+)$", line, flags=re.IGNORECASE)
        if m:
            qty, name = int(m.group(1)), _clean_name(m.group(2))
        else:
            qty, name = 1, _clean_name(line)
        if not name:
            continue

        is_commander_line = "*cmdr*" in line.lower()
        if section == "commander" or is_commander_line or (commander_name is None and section != "sideboard"):
            commander_name = name
            if section == "commander":
                continue

        if section != "sideboard":
            deck_entries.append({"name": name, "quantity": max(1, qty)})

    if not commander_name:
        raise HTTPException(status_code=400, detail="Could not detect a commander from the decklist.")

    # Try to fetch card details for commander and deck cards
    result = await db.execute(select(Card))
    cards = result.scalars().all()
    card_lookup = {c.name.lower(): c for c in cards}
    commander = card_lookup.get(commander_name.lower()) if commander_name else None
    if not commander and " // " in commander_name:
        commander = card_lookup.get(commander_name.split(" // ")[0].strip().lower())

    deck_cards = []
    missing = []
    commander_consumed = False
    for entry in deck_entries:
        if not commander_consumed and entry["name"].lower() == commander_name.lower():
            commander_consumed = True
            continue
        lookup_name = entry["name"].lower()
        c = card_lookup.get(lookup_name)
        if not c and " // " in entry["name"]:
            c = card_lookup.get(entry["name"].split(" // ")[0].strip().lower())
        if c:
            for _ in range(max(1, int(entry.get("quantity", 1)))):
                deck_cards.append({
                    "name": c.name,
                    "image_uri": c.image_uri,
                    "type_line": c.type_line,
                    "tcgplayer_price": c.tcgplayer_price,
                })
        else:
            missing.append(entry["name"])

    if not commander:
        raise HTTPException(status_code=400, detail=f"Commander '{commander_name}' not found in your collection.")

    # Save deck (reuse save_deck logic)
    payload = DeckSaveRequest(
        name=(req.deck_name or f"Imported Deck ({commander_name})").strip(),
        prompt="Imported decklist",
        commander={
            "name": commander.name,
            "image_uri": commander.image_uri,
            "type_line": commander.type_line,
            "tcgplayer_price": commander.tcgplayer_price,
        },
        deck=deck_cards,
        description=f"Imported decklist. Missing: {', '.join(missing) if missing else 'None'}",
    )
    resp = await save_deck(payload)
    return {"saved": resp, "missing": missing}


@router.post("/analyze-deck")
async def analyze_deck(req: AnalyzeDeckRequest, db: AsyncSession = Depends(get_db)):
    """
    Analyze a saved deck and suggest improvements using the user's collection.
    Returns AI suggestions (text or structured).
    """
    # Load deck
    deck_dir = _saved_decks_dir()
    deck_path = (deck_dir / req.deck_file).resolve()
    if not str(deck_path).startswith(str(deck_dir)) or not deck_path.exists():
        raise HTTPException(status_code=404, detail="Deck file not found")
    deck_data = json.loads(deck_path.read_text(encoding="utf-8"))

    # Get user's collection
    result = await db.execute(select(Card))
    cards = result.scalars().all()
    collection = [
        {
            "id": c.id,
            "name": c.name,
            "quantity": c.quantity,
            "mana_cost": c.mana_cost,
            "cmc": c.cmc,
            "type_line": c.type_line,
            "oracle_text": c.oracle_text,
            "colors": c.colors,
            "color_identity": c.color_identity,
            "keywords": c.keywords,
            "power": c.power,
            "toughness": c.toughness,
            "image_uri": c.image_uri,
            "tcgplayer_price": c.tcgplayer_price,
            "legalities": c.legalities,
        }
        for c in cards
    ]

    # Use the deck_engine to generate suggestions (reuse generate_deck logic, but with a prompt for improvement)
    from services.deck_engine import generate_deck
    def progress_callback(msg):
        pass  # No streaming for now
    suggestions = await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: generate_deck(
            prompt=f"Analyze and suggest improvements for this deck using my collection. Only suggest cards I own. Deck: {deck_data['name']}",
            commander_name=deck_data['commander']['name'],
            collection=collection,
            keyword_filters=[],
            progress_callback=progress_callback,
            current_deck=deck_data['deck'],
        ),
    )
    return {"suggestions": suggestions}


# SSE endpoint for real-time build status streaming
@router.get("/build-stream")
async def build_stream(request: Request):
    """Stream build status and thoughts as server-sent events (SSE)."""
    last_message = None
    async def event_generator():
        nonlocal last_message
        while True:
            if await request.is_disconnected():
                break
            status = _build_status_snapshot()
            message = status.get("message", "")
            if message != last_message:
                yield f"data: {json.dumps(status)}\n\n"
                last_message = message
            await asyncio.sleep(0.5)
    return StreamingResponse(event_generator(), media_type="text/event-stream")


class DeckSaveRequest(BaseModel):
    name: str
    prompt: str
    commander: dict
    deck: list[dict]
    description: str = ""


BUILD_STATUS_LOCK = Lock()
BUILD_STATUS = {
    "active": False,
    "phase": "idle",
    "message": "",
    "started_at": None,
    "finished_at": None,
    "last_activity_at": None,
    "thoughts": [],
}


def _set_build_status(**kwargs):
    with BUILD_STATUS_LOCK:
        BUILD_STATUS.update(kwargs)


def _append_thought(message: str):
    with BUILD_STATUS_LOCK:
        thoughts = list(BUILD_STATUS.get("thoughts", []))
        now = datetime.utcnow().isoformat()
        thoughts.append({"time": now, "message": message})
        BUILD_STATUS["thoughts"] = thoughts[-50:]
        BUILD_STATUS["message"] = message
        BUILD_STATUS["last_activity_at"] = now


def _build_status_snapshot() -> dict:
    with BUILD_STATUS_LOCK:
        return dict(BUILD_STATUS)


def _is_legal_commander(card: Card) -> bool:
    if not card.type_line:
        return False
    type_line = card.type_line.lower()
    return (
        "legendary" in type_line
        and "creature" in type_line
        and (card.legalities or {}).get("commander") == "legal"
    )


def _saved_decks_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "saved_decks"


def _sanitize_filename(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9 _-]", "", value).strip()
    cleaned = re.sub(r"\s+", "_", cleaned)
    return cleaned[:80] or "deck"


@router.post("/build")
async def build_deck(req: DeckRequest, db: AsyncSession = Depends(get_db)):
    status = _build_status_snapshot()
    if status.get("active"):
        raise HTTPException(status_code=409, detail="A deck build is already in progress.")

    _set_build_status(
        active=True,
        phase="starting",
        message="Preparing deck build",
        started_at=datetime.utcnow().isoformat(),
        finished_at=None,
        thoughts=[],
    )
    _append_thought(f"Starting deck build for commander: {req.commander_name}")

    result = await db.execute(select(Card))
    cards = result.scalars().all()

    if not cards:
        _set_build_status(active=False, phase="failed", finished_at=datetime.utcnow().isoformat())
        _append_thought("Build failed: collection is empty")
        raise HTTPException(status_code=400, detail="Your collection is empty. Import cards first.")

    selected_commander = None
    for c in cards:
        if c.name.lower() == req.commander_name.lower():
            selected_commander = c
            break

    if not selected_commander:
        _set_build_status(active=False, phase="failed", finished_at=datetime.utcnow().isoformat())
        _append_thought("Build failed: selected commander was not found")
        raise HTTPException(status_code=400, detail=f"Commander '{req.commander_name}' not found in your collection.")

    if not _is_legal_commander(selected_commander):
        _set_build_status(active=False, phase="failed", finished_at=datetime.utcnow().isoformat())
        _append_thought("Build failed: selected card is not a legal legendary commander")
        raise HTTPException(
            status_code=400,
            detail="Selected commander is not legal. Commander must be a legendary creature legal in commander format.",
        )

    collection = [
        {
            "id": c.id,
            "name": c.name,
            "quantity": c.quantity,
            "mana_cost": c.mana_cost,
            "cmc": c.cmc,
            "type_line": c.type_line,
            "oracle_text": c.oracle_text,
            "colors": c.colors,
            "color_identity": c.color_identity,
            "keywords": c.keywords,
            "power": c.power,
            "toughness": c.toughness,
            "image_uri": c.image_uri,
            "tcgplayer_price": c.tcgplayer_price,
            "legalities": c.legalities,
        }
        for c in cards
    ]

    # Resolve must-include cards: keep collection-owned versions when present,
    # otherwise fetch from Scryfall so the AI can include them anyway.
    raw_must = [n.strip() for n in (getattr(req, "must_include_cards", None) or []) if isinstance(n, str) and n.strip()]
    seen_must: set[str] = set()
    must_include_names: list[str] = []
    existing_names_lower = {c["name"].lower(): c["name"] for c in collection}
    for name in raw_must:
        key = name.lower()
        if key in seen_must:
            continue
        seen_must.add(key)
        if key in existing_names_lower:
            must_include_names.append(existing_names_lower[key])
            continue
        data = await fetch_card_by_name(name)
        if not data:
            _append_thought(f"Must-include skipped (not found on Scryfall): {name}")
            continue
        fields = extract_card_fields(data)
        fields["quantity"] = 1
        collection.append(fields)
        must_include_names.append(fields["name"])
        _append_thought(f"Must-include resolved from Scryfall: {fields['name']}")

    try:
        _set_build_status(phase="building")
        _append_thought("Applying commander legality and color identity filters")

        # Run the synchronous Ollama call in a thread so we don't block the event loop
        deck = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: generate_deck(
                prompt=req.prompt,
                commander_name=req.commander_name,
                collection=collection,
                keyword_filters=getattr(req, "keyword_filters", []),
                must_include_cards=must_include_names,
                basic_land_count=getattr(req, "basic_land_count", 37),
                nonbasic_land_count=getattr(req, "nonbasic_land_count", 5),
                strict_mode=getattr(req, "strict_mode", False),
                progress_callback=_append_thought,
            ),
        )
        _set_build_status(active=False, phase="completed", finished_at=datetime.utcnow().isoformat())
        _append_thought("Deck build finished successfully")
    except ValueError as e:
        _set_build_status(active=False, phase="failed", finished_at=datetime.utcnow().isoformat())
        _append_thought(f"Build failed: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        _set_build_status(active=False, phase="failed", finished_at=datetime.utcnow().isoformat())
        _append_thought(f"Build failed unexpectedly: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Deck generation failed: {e}")

    return deck


@router.get("/build-status")
async def build_status():
    return _build_status_snapshot()


@router.post("/reset")
async def reset_build():
    """Force-reset a hung build. Only meaningful when a build is active and stale."""
    _set_build_status(
        active=False,
        phase="reset",
        message="Build was manually reset.",
        finished_at=datetime.utcnow().isoformat(),
        last_activity_at=datetime.utcnow().isoformat(),
    )
    _append_thought("⚠️ Build was force-reset by user.")
    return {"reset": True}


@router.get("/commanders")
async def list_commanders(db: AsyncSession = Depends(get_db)):
    """Return all legendary creatures in the collection that can be commanders."""
    result = await db.execute(select(Card))
    cards = result.scalars().all()
    commanders = [
        {
            "id": c.id,
            "name": c.name,
            "color_identity": c.color_identity,
            "image_uri": c.image_uri,
            "tcgplayer_price": c.tcgplayer_price,
        }
        for c in cards
        if _is_legal_commander(c)
    ]
    return commanders


@router.post("/save")
async def save_deck(payload: DeckSaveRequest):
    deck_dir = _saved_decks_dir()
    deck_dir.mkdir(parents=True, exist_ok=True)

    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    safe_name = _sanitize_filename(payload.name)
    base_filename = f"{stamp}_{safe_name}"
    json_path = deck_dir / f"{base_filename}.json"
    txt_path = deck_dir / f"{base_filename}.txt"

    card_lines = [f"1 {payload.commander.get('name', 'Unknown Commander')} *CMDR*", ""]
    card_lines.extend([f"1 {c.get('name', 'Unknown Card')}" for c in payload.deck])

    payload_data = {
        "name": payload.name,
        "prompt": payload.prompt,
        "description": payload.description,
        "saved_at": datetime.utcnow().isoformat(),
        "commander": payload.commander,
        "deck": payload.deck,
        "card_count": 1 + len(payload.deck),
    }

    json_path.write_text(json.dumps(payload_data, indent=2), encoding="utf-8")
    txt_path.write_text("\n".join(card_lines), encoding="utf-8")

    return {
        "folder": str(deck_dir),
        "json_file": json_path.name,
        "txt_file": txt_path.name,
    }


@router.get("/saved")
async def list_saved_decks():
    deck_dir = _saved_decks_dir()
    if not deck_dir.exists():
        return []

    rows = []
    for p in sorted(deck_dir.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            rows.append(
                {
                    "file": p.name,
                    "name": data.get("name") or p.stem,
                    "saved_at": data.get("saved_at"),
                    "commander": (data.get("commander") or {}).get("name", ""),
                    "card_count": data.get("card_count", 0),
                }
            )
        except Exception:
            rows.append(
                {
                    "file": p.name,
                    "name": p.stem,
                    "saved_at": None,
                    "commander": "",
                    "card_count": 0,
                }
            )
    return rows


@router.get("/saved/{deck_file}")
async def get_saved_deck(deck_file: str):
    if "/" in deck_file or "\\" in deck_file:
        raise HTTPException(status_code=400, detail="Invalid file path")
    deck_dir = _saved_decks_dir().resolve()
    target = (deck_dir / deck_file).resolve()
    if not str(target).startswith(str(deck_dir)):
        raise HTTPException(status_code=400, detail="Invalid deck file")
    if not target.exists() or target.suffix.lower() != ".json":
        raise HTTPException(status_code=404, detail="Saved deck not found")
    return json.loads(target.read_text(encoding="utf-8"))


@router.delete("/saved/{deck_file}")
async def delete_saved_deck(deck_file: str):
    if "/" in deck_file or "\\" in deck_file:
        raise HTTPException(status_code=400, detail="Invalid file path")
    deck_dir = _saved_decks_dir().resolve()
    target = (deck_dir / deck_file).resolve()
    if not str(target).startswith(str(deck_dir)):
        raise HTTPException(status_code=400, detail="Invalid deck file")
    if not target.exists() or target.suffix.lower() != ".json":
        raise HTTPException(status_code=404, detail="Saved deck not found")

    txt_target = target.with_suffix(".txt")
    target.unlink(missing_ok=True)
    txt_target.unlink(missing_ok=True)
    return {"deleted": deck_file}
