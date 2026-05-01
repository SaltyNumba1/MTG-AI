import asyncio
import logging
import re
import sqlite3
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
from services.import_adapters import (
    CanonicalImportRow,
    parse_collection_csv,
    parse_collection_csv_chunked,
    estimate_csv_row_count,
)
from services.scryfall import fetch_card_by_name, fetch_card_by_id, extract_card_fields, ScryfallRateLimit

# For serving Archidekt precon data
import json as _json
ARCHIDEKT_PRECONS_PATH = Path(__file__).parent.parent / "archidekt_commander_precons.json"
router = APIRouter(prefix="/collection", tags=["collection"])
def load_archidekt_precons():
    try:
        with open(ARCHIDEKT_PRECONS_PATH, encoding="utf-8") as f:
            return _json.load(f)
    except Exception as e:
        return {"error": str(e)}
@router.get("/archidekt-precons")
async def get_archidekt_precons():
    """Return grouped Commander precons from Archidekt as JSON."""
    return load_archidekt_precons()

logger = logging.getLogger(__name__)


MAX_CSV_FILE_SIZE = 100 * 1024 * 1024  # 100 MB hard limit
CHUNK_THRESHOLD = 2 * 1024 * 1024      # 2 MB — files above this use chunked parsing

IMPORT_STATUS_LOCK = Lock()
IMPORT_CANCEL_LOCK = Lock()
IMPORT_CANCEL_REQUESTED = False
IMPORT_STATUS_DEFAULT = {
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
IMPORT_STATUS = dict(IMPORT_STATUS_DEFAULT)
import threading
def _reset_import_status():
    with IMPORT_STATUS_LOCK:
        IMPORT_STATUS.clear()
        IMPORT_STATUS.update(IMPORT_STATUS_DEFAULT)

def _schedule_import_status_reset(delay_seconds: float = 5.0):
    def reset_later():
        # Wait, then reset status
        threading.Timer(delay_seconds, _reset_import_status).start()
    reset_later()


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


class AddCardRequest(BaseModel):
    name: str = ""
    quantity: int = 1
    scryfall_id: str | None = None


class ImportTextRequest(BaseModel):
    text: str = ""


class AddDeckToCollectionRequest(BaseModel):
    filename: str


def _saved_decks_dir() -> Path:
    """Return the saved_decks directory for collection-related actions.

    Mirrors the logic in deckbuilder._saved_decks_dir so saved decks are
    consistently located for both routes.
    """
    import os
    import sys
    try:
        env = os.environ.get("SAVED_DECKS_DIR")
        if env:
            return Path(env).resolve()
    except Exception:
        pass

    try:
        repo_release_saved = (
            Path(__file__).resolve().parents[2]
            / "frontend"
            / "release"
            / "MTG Collection-win32-x64"
            / "resources"
            / "backend"
            / "dist"
            / "saved_decks"
        )
        if repo_release_saved.exists():
            return repo_release_saved
    except Exception:
        pass

    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "saved_decks"

    return Path(__file__).resolve().parents[1] / "saved_decks"


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

    print(f"[upsert_card] Called with: name={card_name!r}, quantity={quantity}, scryfall_id={scryfall_id!r}, name_candidates={name_candidates}")

    if scryfall_id:
        existing_by_id = await db.execute(select(Card).where(Card.id == scryfall_id))
        existing_id_card = existing_by_id.scalar_one_or_none()
        if existing_id_card:
            print(f"[upsert_card] Found existing card by scryfall_id: {scryfall_id}, incrementing quantity.")
            existing_id_card.quantity += quantity
            return "updated", None

    if primary_name:
        existing = await db.execute(select(Card).where(Card.name == primary_name))
        existing_card = existing.scalar_one_or_none()
        if existing_card:
            print(f"[upsert_card] Found existing card by name: {primary_name}, incrementing quantity.")
            existing_card.quantity += quantity
            return "updated", None

    data = None
    if scryfall_id:
        logger.debug("[upsert_card] Fetching card from Scryfall by ID: %s", scryfall_id)
        data = await fetch_card_by_id(scryfall_id)
        logger.debug("[upsert_card] Scryfall fetch by ID result: %s", str(data)[:200])

    if data is None:
        for candidate in name_candidates:
            logger.debug("[upsert_card] Fetching card from Scryfall by name: %s", candidate)
            data = await fetch_card_by_name(candidate)
            logger.debug("[upsert_card] Scryfall fetch by name result: %s", str(data)[:200])
            if data:
                break

    if not data:
        print(f"[upsert_card] No card data found from Scryfall for scryfall_id={scryfall_id}, candidates={name_candidates}")
        if scryfall_id:
            return "failed", f"Card not found on Scryfall by ID or name ({scryfall_id})"
        return "failed", "Card not found on Scryfall"

    existing_resolved_id = await db.execute(select(Card).where(Card.id == data["id"]))
    resolved_card = existing_resolved_id.scalar_one_or_none()
    if resolved_card:
        print(f"[upsert_card] Found card by resolved Scryfall ID: {data['id']}, incrementing quantity.")
        resolved_card.quantity += quantity
        return "updated", None

    canonical_name = data.get("name", "").strip()
    if canonical_name:
        existing_canonical = await db.execute(select(Card).where(Card.name == canonical_name))
        canonical_card = existing_canonical.scalar_one_or_none()
        if canonical_card:
            print(f"[upsert_card] Found card by canonical name: {canonical_name}, incrementing quantity.")
            canonical_card.quantity += quantity
            return "updated", None

    fields = extract_card_fields(data)
    fields["quantity"] = quantity
    print(f"[upsert_card] Adding new card to DB with fields: {fields}")
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
            await db.rollback()
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
        except ScryfallRateLimit as rl:
            # Pause processing and update import status so the front-end can show a pause message
            pause_seconds = rl.retry_after or 1
            _set_import_status(
                message=f"Rate-limited by Scryfall; retrying in {int(pause_seconds)}s",
                processed=idx + 1,
                imported=results["imported"],
                updated=results["updated"],
                failed=len(results["failed"]),
            )
            await asyncio.sleep(pause_seconds)
            # Retry the same row after the pause
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
    _schedule_import_status_reset()
    return results


async def _import_rows_chunked(
    db: AsyncSession,
    row_batches,
    *,
    total_rows: int,
    current_file: str,
    start_message: str,
    cancel_message: str,
    completion_message: str,
) -> dict:
    """Process card imports from a chunked row generator, keeping memory low for large files."""
    results = {
        "imported": 0,
        "updated": 0,
        "failed": [],
        "failed_details": [],
        "touched_names": [],
        "total": total_rows,
    }

    _set_import_status(
        active=True,
        source="upload",
        message=start_message,
        current_file=current_file,
        total_files=1,
        processed=0,
        total=total_rows,
        percent=0,
        imported=0,
        updated=0,
        failed=0,
        started_at=datetime.utcnow().isoformat(),
        finished_at=None,
    )
    _set_import_cancel_requested(False)

    commit_every = 25
    global_idx = 0

    for batch in row_batches:
        for row in batch:
            if _is_import_cancel_requested():
                _set_import_status(
                    active=False,
                    message=cancel_message,
                    finished_at=datetime.utcnow().isoformat(),
                )
                await db.rollback()
                return results

            if not row.name and not row.scryfall_id:
                global_idx += 1
                _set_import_status(
                    processed=global_idx,
                    percent=round((global_idx / max(total_rows, 1)) * 100),
                )
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
            except ScryfallRateLimit as rl:
                pause_seconds = rl.retry_after or 1
                _set_import_status(
                    message=f"Rate-limited by Scryfall; retrying in {int(pause_seconds)}s",
                    processed=global_idx,
                    imported=results["imported"],
                    updated=results["updated"],
                    failed=len(results["failed"]),
                )
                await asyncio.sleep(pause_seconds)
                # Retry the same row
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

            global_idx += 1
            if global_idx % commit_every == 0:
                ok, reason = await commit_with_retry(db)
                if not ok:
                    _set_import_status(
                        active=False,
                        message=f"Import aborted: commit failed ({reason})",
                        finished_at=datetime.utcnow().isoformat(),
                    )
                    return results

            _set_import_status(
                processed=global_idx,
                percent=round((global_idx / max(total_rows, 1)) * 100),
                imported=results["imported"],
                updated=results["updated"],
                failed=len(results["failed"]),
            )

            if global_idx < total_rows:
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
    _schedule_import_status_reset()
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
    Large files (>2 MB) are automatically parsed in chunks to keep memory usage low.
    """
    content = await file.read()

    if len(content) > MAX_CSV_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large ({len(content) // (1024 * 1024)}MB). Maximum allowed size is {MAX_CSV_FILE_SIZE // (1024 * 1024)}MB.",
        )

    # Large files: chunked parsing to avoid loading entire DataFrame at once
    if len(content) > CHUNK_THRESHOLD:
        logger.info("Large CSV detected (%d bytes), using chunked import", len(content))
        try:
            source, matched_columns, batches = parse_collection_csv_chunked(content, file.filename)
            total_rows = estimate_csv_row_count(content)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        results = await _import_rows_chunked(
            db,
            batches,
            total_rows=total_rows,
            current_file=file.filename or "upload.csv",
            start_message=f"Import in progress (chunked, ~{total_rows} rows)",
            cancel_message="Import canceled by user",
            completion_message="Import completed",
        )
        results["detected_source"] = source
        results["matched_columns"] = matched_columns
        return results

    # Normal path for small files
    try:
        parse_result = parse_collection_csv(content, file.filename)
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


@router.post("/add-card")
async def add_card(payload: AddCardRequest, db: AsyncSession = Depends(get_db)):
    name = (payload.name or "").strip()
    scryfall_id = parse_scryfall_id(payload.scryfall_id)
    quantity = parse_quantity(payload.quantity)
    if quantity <= 0:
        quantity = 1
    if not name and not scryfall_id:
        raise HTTPException(status_code=400, detail="Provide a card name or Scryfall ID")

    row = CanonicalImportRow(
        source="manual",
        name=name,
        quantity=quantity,
        scryfall_id=scryfall_id,
        original_row={"name": name, "quantity": quantity, "scryfall_id": scryfall_id},
    )

    try:
        status, reason = await upsert_card(db, row)
    except SQLAlchemyError as exc:
        await db.rollback()
        logger.exception("add_card upsert failed")
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")

    if status == "failed":
        await db.rollback()
        raise HTTPException(status_code=404, detail=reason or "Card not found")

    committed, commit_error = await commit_with_retry(db)
    if not committed:
        raise HTTPException(status_code=500, detail=commit_error or "Commit failed")

    label = name or scryfall_id or "card"
    return {"status": status, "name": label, "quantity": quantity}


@router.post("/import-text")
async def import_text(payload: ImportTextRequest, db: AsyncSession = Depends(get_db)):
    """Add cards parsed from a decklist-style text blob to the existing collection.

    Accepts lines like ``1x Sol Ring``, ``2 Lightning Bolt``, or just ``Sol Ring``.
    Section headers (Commander/Deck/Sideboard) and comments are ignored. Cards are
    upserted (existing quantities are incremented), not replaced.
    """
    print("[import-text] BEGIN IMPORT TEXT")
    raw = (payload.text or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Text is empty.")


    import csv
    rows: list[CanonicalImportRow] = []
    failed_lines: list[dict] = []
    for line in raw.splitlines():
        print(f"[import-text] Processing line: {line!r}")
        orig_line = line
        line = line.strip()
        if not line:
            continue
        lowered = line.lower()
        if lowered in {"commander", "command zone", "deck", "mainboard", "main", "sideboard", "side", "maybeboard", "maybeboard:"}:
            print(f"[import-text] Skipping section header: {orig_line!r}")
            continue
        if line.startswith("//") or line.startswith("#"):
            print(f"[import-text] Skipping comment: {orig_line!r}")
            continue

        # Try to parse as CSV (comma-separated, possibly quoted)
        csv_fields = None
        try:
            csv_fields = next(csv.reader([line]))
        except Exception:
            pass
        print(f"[import-text] csv_fields for line: {orig_line!r} -> {csv_fields}")

        # If csv_fields is not a list or has fewer than 2 fields, try manual split
        if csv_fields is not None and (not isinstance(csv_fields, list) or len(csv_fields) < 2):
            print(f"[import-text] manual split fallback for line: {orig_line!r}")
            csv_fields = [f.strip() for f in line.split(",")]
            print(f"[import-text] manual split csv_fields for line: {orig_line!r} -> {csv_fields}")

        # Use CSV branch if csv_fields is a list and has at least 2 fields
        if isinstance(csv_fields, list) and len(csv_fields) >= 2:
            try:
                qty_field = csv_fields[0].strip()
                qty = int(qty_field) if qty_field.isdigit() else 1
                name = csv_fields[1].strip()
                scryfall_id = csv_fields[2].strip() if len(csv_fields) > 2 and csv_fields[2] else None
                name = re.sub(r"\*CMDR\*", "", name, flags=re.IGNORECASE).strip()
                name = re.sub(r"\([^)]*\)\s*\d*\s*$", "", name).strip()
                print(f"[import-text] CSV branch: qty={qty}, name={name}, scryfall_id={scryfall_id}")
                if not name:
                    print(f"[import-text] Skipping empty/invalid name after cleaning: {orig_line!r}")
                    continue
                row = CanonicalImportRow(
                    source="text",
                    name=name,
                    quantity=max(1, qty),
                    scryfall_id=scryfall_id,
                    original_row={"name": name, "quantity": qty, "scryfall_id": scryfall_id},
                )
                print(f"[import-text] Parsed CSV line: {orig_line!r} -> {row}")
                rows.append(row)
                continue
            except Exception as exc:
                print(f"[import-text] Failed to parse CSV line: {orig_line!r} ({exc})")
                failed_lines.append({"line": orig_line, "reason": str(exc)})
                continue

        # Fallback to old regex logic ONLY if csv_fields is None, not a list, or has fewer than 2 fields
        print(f"[import-text] REGEX branch for line: {orig_line!r}")
        if csv_fields is None or not isinstance(csv_fields, list) or len(csv_fields) < 2:
            m = re.match(r"^(\d+)\s*x?\s+(.+)$", line, flags=re.IGNORECASE)
            if m:
                qty, name = int(m.group(1)), m.group(2).strip()
                print(f"[import-text] REGEX branch: qty={qty}, name={name}")
            else:
                qty, name = 1, line
                print(f"[import-text] REGEX branch fallback: qty={qty}, name={name}")
            name = re.sub(r"\*CMDR\*", "", name, flags=re.IGNORECASE).strip()
            name = re.sub(r"\([^)]*\)\s*\d*\s*$", "", name).strip()
            if not name:
                print(f"[import-text] Skipping empty/invalid name after cleaning: {orig_line!r}")
                failed_lines.append({"line": orig_line, "reason": "empty after cleaning"})
                continue
            row = CanonicalImportRow(
                source="text",
                name=name,
                quantity=max(1, qty),
                original_row={"name": name, "quantity": qty},
            )
            print(f"[import-text] Parsed line: {orig_line!r} -> {row}")
            rows.append(row)

    if failed_lines:
        print(f"[import-text] Failed lines: {failed_lines}")

    if not rows:
        raise HTTPException(status_code=400, detail="No card entries found in text.")

    results = await _import_rows(
        db,
        rows,
        current_file="text-import",
        start_message="Importing cards from text…",
        cancel_message="Text import cancelled.",
        completion_message=f"Imported cards from text ({len(rows)} entries).",
    )
    return results


@router.post("/add-deck")
async def add_deck_to_collection(payload: AddDeckToCollectionRequest, db: AsyncSession = Depends(get_db)):
    """Load a saved deck JSON and import its cards into the collection via the existing import pipeline."""
    deck_dir = _saved_decks_dir()
    deck_path = (deck_dir / payload.filename).resolve()
    if not str(deck_path).startswith(str(deck_dir.resolve())) or not deck_path.exists():
        raise HTTPException(status_code=404, detail="Deck file not found")

    try:
        deck_data = _json.loads(deck_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to read deck file: {exc}")

    deck_cards = deck_data.get("deck") or []
    if not deck_cards:
        raise HTTPException(status_code=400, detail="Deck contains no cards")

    rows: list[CanonicalImportRow] = []
    for c in deck_cards:
        name = (c.get("name") or "").strip()
        qty = parse_quantity(c.get("quantity"))
        if not name:
            continue
        rows.append(CanonicalImportRow(source="saved-deck", name=name, quantity=qty, original_row=c))

    results = await _import_rows(
        db,
        rows,
        current_file=payload.filename,
        start_message="Importing deck to collection",
        cancel_message="Deck import canceled",
        completion_message="Deck import completed",
    )

    return {
        "imported": results.get("imported"),
        "updated": results.get("updated"),
        "failed": results.get("failed"),
        "failed_details": results.get("failed_details"),
    }


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


import httpx
from services.scryfall import SCRYFALL_BASE


_PRECONS_CACHE: dict = {"data": None, "fetched_at": None}


def _is_precon_set(s: dict) -> bool:
    """A set qualifies as a "WOTC precon product" if it is one of the
    set_types Scryfall uses for preconstructed products."""
    return s.get("set_type") in {
        "commander",
        "duel_deck",
        "premium_deck",
        "from_the_vault",
        "planechase",
        "archenemy",
        "starter",
    }


@router.get("/precons")
async def list_precons():
    """Return a cached list of WOTC preconstructed sets from Scryfall."""
    if _PRECONS_CACHE["data"] is not None:
        return _PRECONS_CACHE["data"]

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(f"{SCRYFALL_BASE}/sets")
            resp.raise_for_status()
            payload = resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Scryfall sets fetch failed: {exc}")

    sets = payload.get("data", []) or []
    precons = [
        {
            "code": s.get("code"),
            "name": s.get("name"),
            "released_at": s.get("released_at"),
            "set_type": s.get("set_type"),
            "card_count": s.get("card_count"),
        }
        for s in sets
        if _is_precon_set(s) and s.get("code") and s.get("name")
    ]
    precons.sort(key=lambda x: x.get("released_at") or "", reverse=True)
    _PRECONS_CACHE["data"] = precons
    _PRECONS_CACHE["fetched_at"] = datetime.utcnow().isoformat()
    return precons


class PreconImportRequest(BaseModel):
    set_code: str


@router.post("/import-precon")
async def import_precon(payload: PreconImportRequest, db: AsyncSession = Depends(get_db)):
    """Import every card from the given preconstructed set into the collection."""
    set_code = (payload.set_code or "").strip().lower()
    if not set_code:
        raise HTTPException(status_code=400, detail="set_code is required")

    cards: list[dict] = []
    next_url: str | None = (
        f"{SCRYFALL_BASE}/cards/search?q=set%3A{set_code}&unique=cards&order=name"
    )
    page_count = 0
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            while next_url and page_count < 10:
                page_count += 1
                resp = await client.get(next_url)
                if resp.status_code == 404:
                    raise HTTPException(status_code=404, detail=f"No cards found for set '{set_code}'")
                resp.raise_for_status()
                page = resp.json()
                cards.extend(page.get("data", []) or [])
                if page.get("has_more"):
                    next_url = page.get("next_page")
                    await asyncio.sleep(0.1)
                else:
                    next_url = None
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Scryfall card fetch failed: {exc}")

    if not cards:
        raise HTTPException(status_code=404, detail=f"No cards found for set '{set_code}'")

    imported = 0
    updated = 0
    failed: list[str] = []
    set_name = cards[0].get("set_name") or set_code.upper()

    for card in cards:
        name = card.get("name") or ""
        sid = card.get("id")
        if not name or not sid:
            failed.append(card.get("name") or "(unknown)")
            continue
        row = CanonicalImportRow(
            source="precon",
            name=name,
            quantity=1,
            scryfall_id=sid,
            original_row={"name": name, "scryfall_id": sid, "set": set_code},
        )
        try:
            status, _reason = await upsert_card(db, row)
        except SQLAlchemyError:
            await db.rollback()
            failed.append(name)
            continue
        if status == "imported":
            imported += 1
        elif status == "updated":
            updated += 1
        else:
            failed.append(name)

    committed, commit_error = await commit_with_retry(db)
    if not committed:
        raise HTTPException(status_code=500, detail=commit_error or "Commit failed")

    return {
        "set_code": set_code,
        "set_name": set_name,
        "imported": imported,
        "updated": updated,
        "failed": failed,
        "total": len(cards),
    }
