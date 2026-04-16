import asyncio
import io
import shutil
from datetime import datetime
from pathlib import Path
from threading import Lock

import pandas as pd
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from database import DATABASE_URL, get_db
from models import Card
from services.scryfall import fetch_card_by_name, extract_card_fields

router = APIRouter(prefix="/collection", tags=["collection"])

COMMON_NAME_COLUMNS = ["name", "card name", "cardname", "card_name", "Name"]
COMMON_QTY_COLUMNS = ["quantity", "qty", "count", "amount", "Quantity", "Count"]

IMPORT_STATUS_LOCK = Lock()
IMPORT_STATUS = {
    "active": False,
    "source": None,
    "message": "",
    "current_file": None,
    "total_files": 1,
    "processed": 0,
    "total": 0,
    "percent": 0,
    "imported": 0,
    "updated": 0,
    "failed": 0,
    "started_at": None,
    "finished_at": None,
}


class RetryImportItem(BaseModel):
    name: str
    quantity: int = 1


class RetryImportRequest(BaseModel):
    items: list[RetryImportItem]


class BulkDeleteRequest(BaseModel):
    ids: list[str]


class BulkQuantityRequest(BaseModel):
    ids: list[str]
    action: str
    value: int


class RestoreBackupRequest(BaseModel):
    filename: str


def _set_import_status(**kwargs):
    with IMPORT_STATUS_LOCK:
        IMPORT_STATUS.update(kwargs)


def _get_import_status_snapshot() -> dict:
    with IMPORT_STATUS_LOCK:
        return dict(IMPORT_STATUS)


def _db_file_path() -> Path:
    prefix = "sqlite+aiosqlite:///"
    if not DATABASE_URL.startswith(prefix):
        raise RuntimeError(f"Unsupported database URL: {DATABASE_URL}")
    raw = DATABASE_URL[len(prefix) :]
    p = Path(raw)
    if not p.is_absolute():
        p = (Path.cwd() / p).resolve()
    return p


def _backup_dir() -> Path:
    db_path = _db_file_path()
    return db_path.parent / "backups"


def detect_column(df: pd.DataFrame, candidates: list[str]) -> str | None:
    for col in candidates:
        if col in df.columns:
            return col
    # case-insensitive fallback
    lower_map = {c.lower(): c for c in df.columns}
    for col in candidates:
        if col.lower() in lower_map:
            return lower_map[col.lower()]
    return None


def parse_quantity(value) -> int:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return 1
    try:
        qty = int(float(str(value).strip()))
        return qty if qty > 0 else 1
    except Exception:
        return 1


async def upsert_card_by_name(db: AsyncSession, card_name: str, quantity: int) -> tuple[str, str | None]:
    """
    Returns tuple(status, reason)
    status in {"imported", "updated", "failed"}
    """
    existing = await db.execute(select(Card).where(Card.name == card_name))
    existing_card = existing.scalar_one_or_none()

    if existing_card:
        existing_card.quantity += quantity
        return "updated", None

    data = await fetch_card_by_name(card_name)
    if not data:
        return "failed", "Card not found on Scryfall"

    fields = extract_card_fields(data)
    fields["quantity"] = quantity
    db.add(Card(**fields))
    return "imported", None


@router.get("/")
async def list_cards(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Card).order_by(Card.name))
    cards = result.scalars().all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "quantity": c.quantity,
            "mana_cost": c.mana_cost,
            "cmc": c.cmc,
            "type_line": c.type_line,
            "colors": c.colors,
            "color_identity": c.color_identity,
            "image_uri": c.image_uri,
            "rarity": c.rarity,
            "set_code": c.set_code,
        }
        for c in cards
    ]


@router.get("/import-status")
async def import_status():
    return _get_import_status_snapshot()


@router.post("/import")
async def import_csv(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    """
    Import cards from a CSV file.
    Expected columns: name (required), quantity (optional, defaults to 1).
    Compatible with exports from Moxfield, Archidekt, and generic spreadsheets.
    """
    content = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {e}")

    name_col = detect_column(df, COMMON_NAME_COLUMNS)
    if not name_col:
        raise HTTPException(
            status_code=400,
            detail=f"Could not find a card name column. Columns found: {list(df.columns)}",
        )

    qty_col = detect_column(df, COMMON_QTY_COLUMNS)

    results = {
        "imported": 0,
        "updated": 0,
        "failed": [],
        "failed_details": [],
        "touched_names": [],
        "total": len(df),
    }

    _set_import_status(
        active=True,
        source="upload",
        message="Import in progress",
        current_file=file.filename,
        total_files=1,
        processed=0,
        total=len(df),
        percent=0,
        imported=0,
        updated=0,
        failed=0,
        started_at=datetime.utcnow().isoformat(),
        finished_at=None,
    )

    rows = [row for _, row in df.iterrows()]
    commit_every = 25
    for idx, row in enumerate(rows):
        card_name = str(row[name_col]).strip()
        quantity = parse_quantity(row.get(qty_col)) if qty_col else 1

        if not card_name or card_name.lower() == "nan":
            _set_import_status(processed=idx + 1, percent=round(((idx + 1) / max(len(rows), 1)) * 100))
            continue

        try:
            state, reason = await upsert_card_by_name(db, card_name, quantity)
            if state == "imported":
                results["imported"] += 1
                results["touched_names"].append(card_name)
            elif state == "updated":
                results["updated"] += 1
                results["touched_names"].append(card_name)
            else:
                results["failed"].append(card_name)
                results["failed_details"].append(
                    {"name": card_name, "quantity": quantity, "reason": reason or "Unknown error"}
                )
        except Exception as exc:
            results["failed"].append(card_name)
            results["failed_details"].append(
                {"name": card_name, "quantity": quantity, "reason": str(exc)}
            )

        if (idx + 1) % commit_every == 0:
            await db.commit()

        _set_import_status(
            processed=idx + 1,
            percent=round(((idx + 1) / max(len(rows), 1)) * 100),
            imported=results["imported"],
            updated=results["updated"],
            failed=len(results["failed"]),
        )

        if idx + 1 < len(rows):
            await asyncio.sleep(0.1)

    # Commit any remaining changes.
    await db.commit()

    _set_import_status(
        active=False,
        message="Import completed",
        percent=100,
        finished_at=datetime.utcnow().isoformat(),
        imported=results["imported"],
        updated=results["updated"],
        failed=len(results["failed"]),
    )

    return results


@router.post("/import/retry-failed")
async def retry_failed_import(payload: RetryImportRequest, db: AsyncSession = Depends(get_db)):
    if not payload.items:
        return {"imported": 0, "updated": 0, "failed": [], "failed_details": [], "total": 0}

    results = {
        "imported": 0,
        "updated": 0,
        "failed": [],
        "failed_details": [],
        "touched_names": [],
        "total": len(payload.items),
    }

    _set_import_status(
        active=True,
        source="upload",
        message="Retrying failed rows",
        current_file="retry-failed",
        total_files=1,
        processed=0,
        total=len(payload.items),
        percent=0,
        imported=0,
        updated=0,
        failed=0,
        started_at=datetime.utcnow().isoformat(),
        finished_at=None,
    )

    for idx, item in enumerate(payload.items):
        name = item.name.strip()
        quantity = item.quantity if item.quantity > 0 else 1
        if not name:
            _set_import_status(processed=idx + 1, percent=round(((idx + 1) / max(len(payload.items), 1)) * 100))
            continue

        try:
            state, reason = await upsert_card_by_name(db, name, quantity)
            if state == "imported":
                results["imported"] += 1
                results["touched_names"].append(name)
            elif state == "updated":
                results["updated"] += 1
                results["touched_names"].append(name)
            else:
                results["failed"].append(name)
                results["failed_details"].append({"name": name, "quantity": quantity, "reason": reason or "Unknown error"})
        except Exception as exc:
            results["failed"].append(name)
            results["failed_details"].append({"name": name, "quantity": quantity, "reason": str(exc)})

        if (idx + 1) % 25 == 0:
            await db.commit()

        _set_import_status(
            processed=idx + 1,
            percent=round(((idx + 1) / max(len(payload.items), 1)) * 100),
            imported=results["imported"],
            updated=results["updated"],
            failed=len(results["failed"]),
        )

        if idx + 1 < len(payload.items):
            await asyncio.sleep(0.05)

    await db.commit()

    _set_import_status(
        active=False,
        message="Retry completed",
        percent=100,
        finished_at=datetime.utcnow().isoformat(),
        imported=results["imported"],
        updated=results["updated"],
        failed=len(results["failed"]),
    )

    return results


@router.delete("/{card_id}")
async def delete_card(card_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Card).where(Card.id == card_id))
    await db.commit()
    return {"deleted": card_id}


@router.post("/bulk-delete")
async def bulk_delete(payload: BulkDeleteRequest, db: AsyncSession = Depends(get_db)):
    ids = [i for i in payload.ids if i]
    if not ids:
        return {"deleted": 0}

    cards = await db.execute(select(Card).where(Card.id.in_(ids)))
    found = cards.scalars().all()
    for card in found:
        await db.delete(card)
    await db.commit()
    return {"deleted": len(found)}


@router.post("/bulk-quantity")
async def bulk_quantity(payload: BulkQuantityRequest, db: AsyncSession = Depends(get_db)):
    if payload.action not in {"set", "adjust"}:
        raise HTTPException(status_code=400, detail="action must be 'set' or 'adjust'")

    ids = [i for i in payload.ids if i]
    if not ids:
        return {"updated": 0}

    cards = await db.execute(select(Card).where(Card.id.in_(ids)))
    found = cards.scalars().all()

    for card in found:
        if payload.action == "set":
            card.quantity = max(0, payload.value)
        else:
            card.quantity = max(0, (card.quantity or 0) + payload.value)

    await db.commit()
    return {"updated": len(found)}


@router.delete("/")
async def clear_collection(db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Card))
    await db.commit()
    return {"message": "Collection cleared"}


@router.post("/backup")
async def create_backup():
    db_path = _db_file_path()
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="Database file not found")

    backup_dir = _backup_dir()
    backup_dir.mkdir(parents=True, exist_ok=True)

    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    backup_name = f"mtg_collection-{stamp}.db"
    backup_path = backup_dir / backup_name
    shutil.copy2(db_path, backup_path)

    return {"filename": backup_name, "path": str(backup_path)}


@router.get("/backups")
async def list_backups():
    backup_dir = _backup_dir()
    if not backup_dir.exists():
        return []

    backups = []
    for p in sorted(backup_dir.glob("*.db"), key=lambda x: x.stat().st_mtime, reverse=True):
        s = p.stat()
        backups.append(
            {
                "filename": p.name,
                "size": s.st_size,
                "modified_at": datetime.utcfromtimestamp(s.st_mtime).isoformat(),
            }
        )
    return backups


@router.post("/restore")
async def restore_backup(payload: RestoreBackupRequest):
    backup_dir = _backup_dir()
    backup_path = (backup_dir / payload.filename).resolve()
    if not str(backup_path).startswith(str(backup_dir.resolve())):
        raise HTTPException(status_code=400, detail="Invalid backup filename")
    if not backup_path.exists():
        raise HTTPException(status_code=404, detail="Backup file not found")

    db_path = _db_file_path()
    if db_path.exists():
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        safety = db_path.with_name(f"{db_path.stem}.pre-restore-{stamp}{db_path.suffix}")
        shutil.copy2(db_path, safety)

    journal = db_path.with_name(f"{db_path.name}-journal")
    if journal.exists():
        journal.unlink()

    shutil.copy2(backup_path, db_path)
    return {"restored": payload.filename, "db_path": str(db_path)}
