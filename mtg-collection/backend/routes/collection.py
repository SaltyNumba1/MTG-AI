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
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from database import DATABASE_URL, get_db
from models import Card
from services.scryfall import fetch_card_by_name, fetch_card_by_id, extract_card_fields

router = APIRouter(prefix="/collection", tags=["collection"])

COMMON_NAME_COLUMNS = ["name", "card name", "cardname", "card_name", "Name"]
COMMON_QTY_COLUMNS = ["quantity", "qty", "count", "amount", "Quantity", "Count"]
COMMON_SCRYFALL_ID_COLUMNS = ["scryfall id", "scryfall_id", "scryfallid", "Scryfall ID"]

IMPORT_STATUS_LOCK = Lock()
IMPORT_CANCEL_LOCK = Lock()
IMPORT_CANCEL_REQUESTED = False
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
    scryfall_id: str | None = None


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


def _set_import_cancel_requested(value: bool):
    global IMPORT_CANCEL_REQUESTED
    with IMPORT_CANCEL_LOCK:
        IMPORT_CANCEL_REQUESTED = value


def _is_import_cancel_requested() -> bool:
    with IMPORT_CANCEL_LOCK:
        return IMPORT_CANCEL_REQUESTED


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


def parse_scryfall_id(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    raw = str(value).strip()
    if not raw or raw.lower() == "nan":
        return None
    return raw


def normalized_name_candidates(card_name: str) -> list[str]:
    name = (card_name or "").strip()
    if not name:
        return []

    candidates = [name]
    if " // " in name:
        first_face = name.split(" // ")[0].strip()
        if first_face:
            candidates.append(first_face)
    if " / " in name and " // " not in name:
        first_half = name.split(" / ")[0].strip()
        if first_half:
            candidates.append(first_half)

    deduped = []
    seen = set()
    for candidate in candidates:
        key = candidate.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


async def commit_with_retry(db: AsyncSession, *, retries: int = 3, base_delay: float = 0.2) -> tuple[bool, str | None]:
    for attempt in range(retries):
        try:
            await db.commit()
            return True, None
        except OperationalError as exc:
            await db.rollback()
            # SQLite can throw transient lock errors during concurrent writes.
            if "database is locked" in str(exc).lower() and attempt < retries - 1:
                await asyncio.sleep(base_delay * (attempt + 1))
                continue
            return False, str(exc)
        except SQLAlchemyError as exc:
            await db.rollback()
            return False, str(exc)

    return False, "Unknown commit failure"


async def upsert_card(db: AsyncSession, card_name: str, quantity: int, scryfall_id: str | None = None) -> tuple[str, str | None]:
    """
    Returns tuple(status, reason)
    status in {"imported", "updated", "failed"}
    """
    name_candidates = normalized_name_candidates(card_name)
    primary_name = name_candidates[0] if name_candidates else ""

    # Keep historical behavior: if the card exists by name, adjust quantity directly.
    if primary_name:
        existing = await db.execute(select(Card).where(Card.name == primary_name))
        existing_card = existing.scalar_one_or_none()
        if existing_card:
            existing_card.quantity += quantity
            return "updated", None

    # Prefer an exact ID match when CSV provides one.
    if scryfall_id:
        existing_by_id = await db.execute(select(Card).where(Card.id == scryfall_id))
        existing_id_card = existing_by_id.scalar_one_or_none()
        if existing_id_card:
            existing_id_card.quantity += quantity
            return "updated", None

    data = None
    if scryfall_id:
        data = await fetch_card_by_id(scryfall_id)

    if data is None:
        for candidate in name_candidates:
            data = await fetch_card_by_name(candidate)
            if data:
                break

    if not data:
        if scryfall_id:
            return "failed", f"Card not found on Scryfall by ID or name ({scryfall_id})"
        return "failed", "Card not found on Scryfall"

    # If Scryfall resolves to an existing name, update that row instead of inserting duplicates.
    canonical_name = data.get("name", "").strip()
    if canonical_name:
        existing_canonical = await db.execute(select(Card).where(Card.name == canonical_name))
        canonical_card = existing_canonical.scalar_one_or_none()
        if canonical_card:
            canonical_card.quantity += quantity
            return "updated", None

    existing_resolved_id = await db.execute(select(Card).where(Card.id == data["id"]))
    resolved_card = existing_resolved_id.scalar_one_or_none()
    if resolved_card:
        resolved_card.quantity += quantity
        return "updated", None

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
            "tcgplayer_price": c.tcgplayer_price,
        }
        for c in cards
    ]


@router.get("/import-status")
async def import_status():
    return _get_import_status_snapshot()


async def _cancel_import_impl():
    status = _get_import_status_snapshot()
    if not status.get("active"):
        return {"cancel_requested": False, "message": "No active import"}
    _set_import_cancel_requested(True)
    _set_import_status(message="Cancel requested. Stopping import...")
    return {"cancel_requested": True}


@router.post("/import-cancel")
async def cancel_import_post():
    return await _cancel_import_impl()


@router.delete("/import-cancel")
async def cancel_import_delete():
    return await _cancel_import_impl()


@router.post("/import/cancel")
async def cancel_import_post_alias():
    return await _cancel_import_impl()


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
    scryfall_id_col = detect_column(df, COMMON_SCRYFALL_ID_COLUMNS)

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
    _set_import_cancel_requested(False)

    rows = [row for _, row in df.iterrows()]
    commit_every = 25
    for idx, row in enumerate(rows):
        if _is_import_cancel_requested():
            _set_import_status(
                active=False,
                message="Import canceled by user",
                finished_at=datetime.utcnow().isoformat(),
            )
            await commit_with_retry(db)
            return results

        card_name = str(row[name_col]).strip() if name_col else ""
        quantity = parse_quantity(row.get(qty_col)) if qty_col else 1
        scryfall_id = parse_scryfall_id(row.get(scryfall_id_col)) if scryfall_id_col else None

        if (not card_name or card_name.lower() == "nan") and not scryfall_id:
            _set_import_status(processed=idx + 1, percent=round(((idx + 1) / max(len(rows), 1)) * 100))
            continue

        try:
            state, reason = await upsert_card(db, card_name, quantity, scryfall_id=scryfall_id)
            if state == "imported":
                results["imported"] += 1
                results["touched_names"].append(card_name)
            elif state == "updated":
                results["updated"] += 1
                results["touched_names"].append(card_name)
            else:
                results["failed"].append(card_name)
                results["failed_details"].append(
                    {
                        "name": card_name,
                        "quantity": quantity,
                        "scryfall_id": scryfall_id,
                        "reason": reason or "Unknown error",
                    }
                )
        except Exception as exc:
            results["failed"].append(card_name)
            results["failed_details"].append(
                {
                    "name": card_name,
                    "quantity": quantity,
                    "scryfall_id": scryfall_id,
                    "reason": str(exc),
                }
            )

        if (idx + 1) % commit_every == 0:
            ok, reason = await commit_with_retry(db)
            if not ok:
                _set_import_status(
                    active=False,
                    message=f"Import aborted: commit failed ({reason})",
                    finished_at=datetime.utcnow().isoformat(),
                )
                return results

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
    ok, reason = await commit_with_retry(db)
    if not ok:
        _set_import_status(
            active=False,
            message=f"Import aborted: final commit failed ({reason})",
            finished_at=datetime.utcnow().isoformat(),
            imported=results["imported"],
            updated=results["updated"],
            failed=len(results["failed"]),
        )
        return results

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
    _set_import_cancel_requested(False)

    for idx, item in enumerate(payload.items):
        if _is_import_cancel_requested():
            _set_import_status(
                active=False,
                message="Retry canceled by user",
                finished_at=datetime.utcnow().isoformat(),
            )
            await commit_with_retry(db)
            return results

        name = item.name.strip()
        quantity = item.quantity if item.quantity > 0 else 1
        scryfall_id = parse_scryfall_id(item.scryfall_id)
        if not name and not scryfall_id:
            _set_import_status(processed=idx + 1, percent=round(((idx + 1) / max(len(payload.items), 1)) * 100))
            continue

        try:
            state, reason = await upsert_card(db, name, quantity, scryfall_id=scryfall_id)
            if state == "imported":
                results["imported"] += 1
                results["touched_names"].append(name)
            elif state == "updated":
                results["updated"] += 1
                results["touched_names"].append(name)
            else:
                results["failed"].append(name)
                results["failed_details"].append(
                    {
                        "name": name,
                        "quantity": quantity,
                        "scryfall_id": scryfall_id,
                        "reason": reason or "Unknown error",
                    }
                )
        except Exception as exc:
            results["failed"].append(name)
            results["failed_details"].append(
                {"name": name, "quantity": quantity, "scryfall_id": scryfall_id, "reason": str(exc)}
            )

        if (idx + 1) % 25 == 0:
            ok, reason = await commit_with_retry(db)
            if not ok:
                _set_import_status(
                    active=False,
                    message=f"Retry aborted: commit failed ({reason})",
                    finished_at=datetime.utcnow().isoformat(),
                )
                return results

        _set_import_status(
            processed=idx + 1,
            percent=round(((idx + 1) / max(len(payload.items), 1)) * 100),
            imported=results["imported"],
            updated=results["updated"],
            failed=len(results["failed"]),
        )

        if idx + 1 < len(payload.items):
            await asyncio.sleep(0.05)

    ok, reason = await commit_with_retry(db)
    if not ok:
        _set_import_status(
            active=False,
            message=f"Retry aborted: final commit failed ({reason})",
            finished_at=datetime.utcnow().isoformat(),
            imported=results["imported"],
            updated=results["updated"],
            failed=len(results["failed"]),
        )
        return results

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
