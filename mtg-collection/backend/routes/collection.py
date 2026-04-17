import asyncio
import shutil
from datetime import datetime
from pathlib import Path
from threading import Lock

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from database import DATABASE_URL, get_db
from models import Card
from services.import_adapters import CanonicalImportRow, parse_collection_csv
from services.scryfall import fetch_card_by_name, fetch_card_by_id, extract_card_fields

router = APIRouter(prefix="/collection", tags=["collection"])

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


def parse_quantity(value) -> int:
    if value is None:
        return 1
    try:
        raw = str(value).strip()
        if not raw or raw.lower() == "nan":
            return 1
        qty = int(float(raw))
        return qty if qty > 0 else 1
    except Exception:
        return 1


def parse_scryfall_id(value) -> str | None:
    if value is None:
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


def _import_row_label(row: CanonicalImportRow) -> str:
    if row.name:
        return row.name
    if row.scryfall_id:
        return row.scryfall_id
    return "Unknown row"


async def upsert_card(db: AsyncSession, row: CanonicalImportRow) -> tuple[str, str | None]:
    """
    Returns tuple(status, reason)
    status in {"imported", "updated", "failed"}
    """
    card_name = row.name
    quantity = row.quantity
    scryfall_id = row.scryfall_id
    name_candidates = normalized_name_candidates(card_name)
    primary_name = name_candidates[0] if name_candidates else ""

    if scryfall_id:
        existing_by_id = await db.execute(select(Card).where(Card.id == scryfall_id))
        existing_id_card = existing_by_id.scalar_one_or_none()
        if existing_id_card:
            existing_id_card.quantity += quantity
            return "updated", None

    if primary_name:
        existing = await db.execute(select(Card).where(Card.name == primary_name))
        existing_card = existing.scalar_one_or_none()
        if existing_card:
            existing_card.quantity += quantity
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

    existing_resolved_id = await db.execute(select(Card).where(Card.id == data["id"]))
    resolved_card = existing_resolved_id.scalar_one_or_none()
    if resolved_card:
        resolved_card.quantity += quantity
        return "updated", None

    canonical_name = data.get("name", "").strip()
    if canonical_name:
        existing_canonical = await db.execute(select(Card).where(Card.name == canonical_name))
        canonical_card = existing_canonical.scalar_one_or_none()
        if canonical_card:
            canonical_card.quantity += quantity
            return "updated", None

    fields = extract_card_fields(data)
    fields["quantity"] = quantity
    db.add(Card(**fields))
    return "imported", None


async def _import_rows(
    db: AsyncSession,
    rows: list[CanonicalImportRow],
    *,
    current_file: str,
    start_message: str,
    cancel_message: str,
    completion_message: str,
) -> dict:
    results = {
        "imported": 0,
        "updated": 0,
        "failed": [],
        "failed_details": [],
        "touched_names": [],
        "total": len(rows),
    }

    _set_import_status(
        active=True,
        source="upload",
        message=start_message,
        current_file=current_file,
        total_files=1,
        processed=0,
        total=len(rows),
        percent=0,
        imported=0,
        updated=0,
        failed=0,
        started_at=datetime.utcnow().isoformat(),
        finished_at=None,
    )
    _set_import_cancel_requested(False)

    commit_every = 25
    for idx, row in enumerate(rows):
        if _is_import_cancel_requested():
            _set_import_status(
                active=False,
                message=cancel_message,
                finished_at=datetime.utcnow().isoformat(),
            )
            await commit_with_retry(db)
            return results

        if not row.name and not row.scryfall_id:
            _set_import_status(processed=idx + 1, percent=round(((idx + 1) / max(len(rows), 1)) * 100))
            continue

        label = _import_row_label(row)

        try:
            state, reason = await upsert_card(db, row)
            if state == "imported":
                results["imported"] += 1
                if row.name:
                    results["touched_names"].append(row.name)
            elif state == "updated":
                results["updated"] += 1
                if row.name:
                    results["touched_names"].append(row.name)
            else:
                results["failed"].append(label)
                results["failed_details"].append(
                    {
                        "name": label,
                        "quantity": row.quantity,
                        "scryfall_id": row.scryfall_id,
                        "reason": reason or "Unknown error",
                    }
                )
        except Exception as exc:
            results["failed"].append(label)
            results["failed_details"].append(
                {
                    "name": label,
                    "quantity": row.quantity,
                    "scryfall_id": row.scryfall_id,
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
        message=completion_message,
        percent=100,
        finished_at=datetime.utcnow().isoformat(),
        imported=results["imported"],
        updated=results["updated"],
        failed=len(results["failed"]),
    )

    return results


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
    try:
        parse_result = parse_collection_csv(await file.read(), file.filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    results = await _import_rows(
        db,
        parse_result.rows,
        current_file=file.filename or "upload.csv",
        start_message="Import in progress",
        cancel_message="Import canceled by user",
        completion_message="Import completed",
    )
    results["detected_source"] = parse_result.source
    results["matched_columns"] = parse_result.matched_columns
    return results


@router.post("/import/retry-failed")
async def retry_failed_import(payload: RetryImportRequest, db: AsyncSession = Depends(get_db)):
    if not payload.items:
        return {"imported": 0, "updated": 0, "failed": [], "failed_details": [], "total": 0}

    rows = [
        CanonicalImportRow(
            source="retry",
            name=item.name.strip(),
            quantity=parse_quantity(item.quantity),
            scryfall_id=parse_scryfall_id(item.scryfall_id),
            original_row={"name": item.name, "quantity": item.quantity, "scryfall_id": item.scryfall_id},
        )
        for item in payload.items
    ]

    return await _import_rows(
        db,
        rows,
        current_file="retry-failed",
        start_message="Retrying failed rows",
        cancel_message="Retry canceled by user",
        completion_message="Retry completed",
    )


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
