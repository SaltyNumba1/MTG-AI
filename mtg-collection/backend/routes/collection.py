import asyncio
import io
import pandas as pd
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from database import get_db
from models import Card
from services.scryfall import fetch_card_by_name, extract_card_fields

router = APIRouter(prefix="/collection", tags=["collection"])

COMMON_NAME_COLUMNS = ["name", "card name", "cardname", "card_name", "Name"]
COMMON_QTY_COLUMNS = ["quantity", "qty", "count", "amount", "Quantity", "Count"]


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

    results = {"imported": 0, "updated": 0, "failed": [], "total": len(df)}

    async def process_row(row):
        card_name = str(row[name_col]).strip()
        quantity = int(row[qty_col]) if qty_col and pd.notna(row.get(qty_col)) else 1

        if not card_name or card_name.lower() == "nan":
            return

        # Check if already in DB
        existing = await db.execute(select(Card).where(Card.name == card_name))
        existing_card = existing.scalar_one_or_none()

        if existing_card:
            existing_card.quantity += quantity
            results["updated"] += 1
            return

        # Fetch from Scryfall
        data = await fetch_card_by_name(card_name)
        if not data:
            results["failed"].append(card_name)
            return

        fields = extract_card_fields(data)
        fields["quantity"] = quantity
        db.add(Card(**fields))
        results["imported"] += 1

    # Process in batches to respect Scryfall rate limits (10 req/s)
    rows = [row for _, row in df.iterrows()]
    batch_size = 8
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        await asyncio.gather(*[process_row(r) for r in batch])
        await db.commit()
        if i + batch_size < len(rows):
            await asyncio.sleep(0.2)

    return results


@router.delete("/{card_id}")
async def delete_card(card_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Card).where(Card.id == card_id))
    await db.commit()
    return {"deleted": card_id}


@router.delete("/")
async def clear_collection(db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Card))
    await db.commit()
    return {"message": "Collection cleared"}
