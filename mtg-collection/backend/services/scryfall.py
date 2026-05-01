import logging
import httpx
import asyncio
from typing import Optional

logger = logging.getLogger(__name__)

SCRYFALL_BASE = "https://api.scryfall.com"

# Shared AsyncClient to reuse connections
_client: Optional[httpx.AsyncClient] = httpx.AsyncClient(timeout=10)

# Simple in-process rate limiter: ensure at least MIN_DELAY seconds between requests
_rate_lock = asyncio.Lock()
_last_request_time = 0.0
MIN_DELAY = 1.0  # seconds -> ~1 request/sec (reduce 429s)

# Concurrency limiter (serialize requests to Scryfall to be conservative)
_semaphore = asyncio.Semaphore(1)


class ScryfallRateLimit(Exception):
    """Raised when Scryfall indicates the client should wait before retrying."""
    def __init__(self, retry_after: float | None):
        super().__init__(f"rate-limited: retry after {retry_after}")
        self.retry_after = float(retry_after) if retry_after is not None else None


async def _rate_limit() -> None:
    global _last_request_time
    async with _rate_lock:
        loop = asyncio.get_event_loop()
        now = loop.time()
        elapsed = now - _last_request_time
        wait = MIN_DELAY - elapsed
        if wait > 0:
            await asyncio.sleep(wait)
        _last_request_time = loop.time()


async def _get(path: str, *, params: dict | None = None, max_retries: int = 3) -> Optional[dict]:
    url = f"{SCRYFALL_BASE}{path}"
    for attempt in range(1, max_retries + 1):
        try:
            await _rate_limit()
            async with _semaphore:
                resp = await _client.get(url, params=params)

            # Handle 429: respect Retry-After if present
            if resp.status_code == 429:
                retry_after = resp.headers.get("Retry-After")
                try:
                    delay = int(retry_after) if retry_after and retry_after.isdigit() else None
                except Exception:
                    delay = None
                # Notify caller to handle the pause so UI can update
                raise ScryfallRateLimit(delay if delay is not None else 0.5 * attempt)

            # Retry on 5xx
            if 500 <= resp.status_code < 600:
                backoff = 0.5 * attempt
                logger.warning("Scryfall server error %d; backing off %.1fs (attempt %d)", resp.status_code, backoff, attempt)
                await asyncio.sleep(backoff)
                continue

            resp.raise_for_status()
            return resp.json()
        except ScryfallRateLimit:
            raise
        except httpx.TimeoutException:
            logger.warning("Scryfall request timed out for %s (attempt %d)", url, attempt)
            if attempt < max_retries:
                await asyncio.sleep(0.5 * attempt)
                continue
            return None
        except httpx.HTTPError as exc:
            logger.warning("Scryfall HTTP error for %s: %s (attempt %d)", url, exc, attempt)
            if attempt < max_retries:
                await asyncio.sleep(0.5 * attempt)
                continue
            return None
    return None


async def fetch_card_by_name(name: str) -> Optional[dict]:
    """Fetch card data from Scryfall by exact or fuzzy name with retries and rate-limiting."""
    params = {"fuzzy": name}
    return await _get("/cards/named", params=params)


async def fetch_card_by_id(scryfall_id: str) -> Optional[dict]:
    return await _get(f"/cards/{scryfall_id}")


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

# Optional: expose a cleanup function for test teardown or graceful shutdown
async def aclose_client() -> None:
    global _client
    if _client is not None:
        try:
            await _client.aclose()
        except Exception:
            pass

