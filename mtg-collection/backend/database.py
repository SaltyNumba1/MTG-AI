import os
from pathlib import Path
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy import text

# Allow overriding the DB path via environment variable (use absolute path for production/dev)
_raw_db_url = os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///./mtg_collection.db")
_prefix = "sqlite+aiosqlite:///"

# Normalize sqlite URL: resolve relative paths relative to the backend package directory
if _raw_db_url.startswith(_prefix):
    raw_path = _raw_db_url[len(_prefix) :]
    p = Path(raw_path)
    if not p.is_absolute():
        pkg_base = Path(__file__).resolve().parents[1]
        p = (pkg_base / p).resolve()
    DATABASE_URL = _prefix + str(p)
else:
    DATABASE_URL = _raw_db_url

# Helpful startup log (visible in packaged or dev runs)
print(f"Using DATABASE_URL={DATABASE_URL}")

engine = create_async_engine(DATABASE_URL, echo=False, connect_args={"timeout": 30})
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    from models import Card  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Keep old local SQLite files compatible when adding new columns.
        pragma = await conn.execute(text("PRAGMA table_info(cards)"))
        columns = {row[1] for row in pragma.fetchall()}
        if "tcgplayer_price" not in columns:
            await conn.execute(text("ALTER TABLE cards ADD COLUMN tcgplayer_price VARCHAR"))


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
