from sqlalchemy import Column, String, Integer, Float, Text, JSON
from database import Base


class Card(Base):
    __tablename__ = "cards"

    id = Column(String, primary_key=True)          # Scryfall ID
    name = Column(String, nullable=False, index=True)
    quantity = Column(Integer, default=1)
    mana_cost = Column(String, nullable=True)
    cmc = Column(Float, default=0)
    type_line = Column(String, nullable=True)
    oracle_text = Column(Text, nullable=True)
    colors = Column(JSON, nullable=True)            # ["W","U","B","R","G"]
    color_identity = Column(JSON, nullable=True)
    keywords = Column(JSON, nullable=True)
    power = Column(String, nullable=True)
    toughness = Column(String, nullable=True)
    loyalty = Column(String, nullable=True)
    set_code = Column(String, nullable=True)
    rarity = Column(String, nullable=True)
    image_uri = Column(String, nullable=True)
    legalities = Column(JSON, nullable=True)
