import asyncio
import json
import re
from datetime import datetime
from pathlib import Path
from threading import Lock
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import Card
from services.deck_engine import generate_deck

router = APIRouter(prefix="/deck", tags=["deck"])


class DeckRequest(BaseModel):
    prompt: str
    commander_name: str


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
    "thoughts": [],
}


def _set_build_status(**kwargs):
    with BUILD_STATUS_LOCK:
        BUILD_STATUS.update(kwargs)


def _append_thought(message: str):
    with BUILD_STATUS_LOCK:
        thoughts = list(BUILD_STATUS.get("thoughts", []))
        thoughts.append({"time": datetime.utcnow().isoformat(), "message": message})
        BUILD_STATUS["thoughts"] = thoughts[-50:]
        BUILD_STATUS["message"] = message


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

    card_lines = [f"1 {payload.commander.get('name', 'Unknown Commander')}", ""]
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
