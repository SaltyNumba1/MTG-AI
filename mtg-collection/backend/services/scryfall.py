import httpx
from typing import Optional

SCRYFALL_BASE = "https://api.scryfall.com"


async def fetch_card_by_name(name: str) -> Optional[dict]:
    """Fetch card data from Scryfall by exact or fuzzy name."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SCRYFALL_BASE}/cards/named",
            params={"fuzzy": name},
            timeout=10,
        )
        if resp.status_code == 200:
            return resp.json()
        return None


async def fetch_card_by_id(scryfall_id: str) -> Optional[dict]:
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{SCRYFALL_BASE}/cards/{scryfall_id}", timeout=10)
        if resp.status_code == 200:
            return resp.json()
        return None


def extract_card_fields(data: dict) -> dict:
    """Normalize Scryfall card data into our DB schema."""
    image_uri = None
    tcgplayer_price = None
    if "image_uris" in data:
        image_uri = data["image_uris"].get("normal")
    elif "card_faces" in data and data["card_faces"]:
        face = data["card_faces"][0]
        image_uri = face.get("image_uris", {}).get("normal")

    prices = data.get("prices") or {}
    tcgplayer_price = prices.get("usd") or prices.get("usd_foil") or prices.get("usd_etched")

    return {
        "id": data["id"],
        "name": data["name"],
        "mana_cost": data.get("mana_cost") or (
            data["card_faces"][0].get("mana_cost") if "card_faces" in data else None
        ),
        "cmc": data.get("cmc", 0),
        "type_line": data.get("type_line"),
        "oracle_text": data.get("oracle_text") or (
            data["card_faces"][0].get("oracle_text") if "card_faces" in data else None
        ),
        "colors": data.get("colors", []),
        "color_identity": data.get("color_identity", []),
        "keywords": data.get("keywords", []),
        "power": data.get("power"),
        "toughness": data.get("toughness"),
        "loyalty": data.get("loyalty"),
        "set_code": data.get("set"),
        "rarity": data.get("rarity"),
        "tcgplayer_price": tcgplayer_price,
        "image_uri": image_uri,
        "legalities": data.get("legalities", {}),
    }
