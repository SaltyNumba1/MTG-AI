from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy import text

DATABASE_URL = "sqlite+aiosqlite:///./mtg_collection.db"

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
