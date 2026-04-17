from dataclasses import dataclass
import io
import re
from typing import Any

import pandas as pd


HEADER_ALIASES = {
    "name": {
        "name",
        "cardname",
        "cardtitle",
        "card",
    },
    "quantity": {
        "quantity",
        "qty",
        "count",
        "amount",
        "ownedqty",
        "ownedquantity",
        "copies",
    },
    "scryfall_id": {
        "scryfallid",
        "scryfalluuid",
        "scryfallcardid",
        "oracleid",
    },
    "set_code": {
        "set",
        "setcode",
        "edition",
        "expansion",
        "setname",
    },
    "collector_number": {
        "collectornumber",
        "collectorno",
        "collector",
    },
    "finish": {
        "finish",
        "printing",
        "treatment",
        "foil",
    },
    "language": {
        "language",
        "lang",
    },
    "condition": {
        "condition",
        "cardcondition",
    },
}

SOURCE_PRIORITY = ["moxfield", "manabox", "archidekt", "generic"]


def _normalize_token(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.strip().lower())


def _clean_optional_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    return text


def _parse_quantity(value: Any) -> int:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return 1
    try:
        quantity = int(float(str(value).strip()))
        return quantity if quantity > 0 else 1
    except Exception:
        return 1


def _column_lookup(df: pd.DataFrame) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for column in df.columns:
        normalized = _normalize_token(str(column))
        if normalized and normalized not in lookup:
            lookup[normalized] = str(column)
    return lookup


def _find_column(lookup: dict[str, str], field_name: str) -> str | None:
    for alias in HEADER_ALIASES[field_name]:
        match = lookup.get(alias)
        if match:
            return match
    return None


def _has_columns(lookup: dict[str, str], *columns: str) -> bool:
    return all(column in lookup for column in columns)


def _normalize_finish(value: str | None) -> str | None:
    if not value:
        return None
    normalized = _normalize_token(value)
    if normalized in {"foil", "etched"}:
        return normalized
    if normalized in {"true", "yes", "1"}:
        return "foil"
    if normalized in {"false", "no", "0", "nonfoil", "normal"}:
        return None
    return value.strip()


@dataclass(slots=True)
class CanonicalImportRow:
    source: str
    name: str
    quantity: int = 1
    scryfall_id: str | None = None
    set_code: str | None = None
    collector_number: str | None = None
    finish: str | None = None
    language: str | None = None
    condition: str | None = None
    original_row: dict[str, Any] | None = None


@dataclass(slots=True)
class ImportParseResult:
    source: str
    rows: list[CanonicalImportRow]
    matched_columns: dict[str, str]


class CsvImportAdapter:
    source = "generic"

    def supports(self, df: pd.DataFrame, filename: str | None = None) -> bool:
        raise NotImplementedError

    def parse(self, df: pd.DataFrame, filename: str | None = None) -> ImportParseResult:
        raise NotImplementedError

    def _matched_columns(self, lookup: dict[str, str]) -> dict[str, str]:
        return {
            field_name: column
            for field_name in HEADER_ALIASES
            for column in [_find_column(lookup, field_name)]
            if column
        }

    def _build_rows(
        self,
        df: pd.DataFrame,
        matched_columns: dict[str, str],
        *,
        source: str | None = None,
    ) -> list[CanonicalImportRow]:
        rows: list[CanonicalImportRow] = []
        for _, row in df.iterrows():
            row_data = row.to_dict()
            finish_value = _clean_optional_text(row_data.get(matched_columns.get("finish", "")))
            rows.append(
                CanonicalImportRow(
                    source=source or self.source,
                    name=_clean_optional_text(row_data.get(matched_columns.get("name", ""))) or "",
                    quantity=_parse_quantity(row_data.get(matched_columns.get("quantity", ""))),
                    scryfall_id=_clean_optional_text(row_data.get(matched_columns.get("scryfall_id", ""))),
                    set_code=_clean_optional_text(row_data.get(matched_columns.get("set_code", ""))),
                    collector_number=_clean_optional_text(row_data.get(matched_columns.get("collector_number", ""))),
                    finish=_normalize_finish(finish_value),
                    language=_clean_optional_text(row_data.get(matched_columns.get("language", ""))),
                    condition=_clean_optional_text(row_data.get(matched_columns.get("condition", ""))),
                    original_row=row_data,
                )
            )
        return rows

    def _parse_with_matched_columns(
        self,
        df: pd.DataFrame,
        matched_columns: dict[str, str],
        *,
        source: str | None = None,
    ) -> ImportParseResult:
        if not matched_columns.get("name") and not matched_columns.get("scryfall_id"):
            raise ValueError(f"Could not find a card name column. Columns found: {list(df.columns)}")

        detected_source = source or self.source
        return ImportParseResult(
            source=detected_source,
            rows=self._build_rows(df, matched_columns, source=detected_source),
            matched_columns=matched_columns,
        )


class MoxfieldCsvAdapter(CsvImportAdapter):
    source = "moxfield"

    def supports(self, df: pd.DataFrame, filename: str | None = None) -> bool:
        lookup = _column_lookup(df)
        return _has_columns(lookup, "count", "name", "edition", "foil", "collectornumber")

    def parse(self, df: pd.DataFrame, filename: str | None = None) -> ImportParseResult:
        lookup = _column_lookup(df)
        matched_columns = {
            "name": lookup.get("name"),
            "quantity": lookup.get("count"),
            "set_code": lookup.get("edition"),
            "condition": lookup.get("condition"),
            "language": lookup.get("language"),
            "finish": lookup.get("foil"),
            "collector_number": lookup.get("collectornumber"),
        }
        return self._parse_with_matched_columns(df, {k: v for k, v in matched_columns.items() if v})


class ManaBoxCsvAdapter(CsvImportAdapter):
    source = "manabox"

    def supports(self, df: pd.DataFrame, filename: str | None = None) -> bool:
        lookup = _column_lookup(df)
        has_identity = bool(lookup.get("scryfallid")) or (
            bool(lookup.get("cardname") or lookup.get("name")) and bool(lookup.get("setcode") or lookup.get("setname"))
        )
        has_manabox_fields = any(
            field in lookup
            for field in [
                "purchasecurrency",
                "purchasepricecurrency",
                "misprint",
                "altered",
                "cardnumber",
                "collectornumber",
                "purchaseprice",
                "manaboxid",
            ]
        )
        return has_identity and has_manabox_fields

    def parse(self, df: pd.DataFrame, filename: str | None = None) -> ImportParseResult:
        lookup = _column_lookup(df)
        matched_columns = {
            "name": lookup.get("cardname") or lookup.get("name"),
            "quantity": lookup.get("quantity"),
            "scryfall_id": lookup.get("scryfallid"),
            "set_code": lookup.get("setcode") or lookup.get("setname"),
            "collector_number": lookup.get("cardnumber") or lookup.get("collectornumber"),
            "finish": lookup.get("foil"),
            "language": lookup.get("language"),
            "condition": lookup.get("condition"),
        }
        return self._parse_with_matched_columns(df, {k: v for k, v in matched_columns.items() if v})


class ArchidektCsvAdapter(CsvImportAdapter):
    source = "archidekt"

    def supports(self, df: pd.DataFrame, filename: str | None = None) -> bool:
        lookup = _column_lookup(df)
        normalized_filename = _normalize_token(filename or "")
        if _has_columns(lookup, "quantity", "name", "scryfallid"):
            return True
        if "archidekt" in normalized_filename and bool(lookup.get("quantity")):
            return True
        return bool(lookup.get("cardname") and lookup.get("quantity") and (lookup.get("edition") or lookup.get("setcode")))

    def parse(self, df: pd.DataFrame, filename: str | None = None) -> ImportParseResult:
        lookup = _column_lookup(df)
        matched_columns = {
            "name": lookup.get("cardname") or lookup.get("name"),
            "quantity": lookup.get("quantity") or lookup.get("count"),
            "scryfall_id": lookup.get("scryfallid"),
            "set_code": lookup.get("edition") or lookup.get("setcode") or lookup.get("set"),
            "collector_number": lookup.get("collectornumber") or lookup.get("collector"),
            "finish": lookup.get("foil") or lookup.get("finish"),
            "language": lookup.get("language"),
            "condition": lookup.get("condition"),
        }
        return self._parse_with_matched_columns(df, {k: v for k, v in matched_columns.items() if v})


class GenericCsvAdapter(CsvImportAdapter):
    source = "generic"

    def supports(self, df: pd.DataFrame, filename: str | None = None) -> bool:
        lookup = _column_lookup(df)
        return bool(_find_column(lookup, "name") or _find_column(lookup, "scryfall_id"))

    def parse(self, df: pd.DataFrame, filename: str | None = None) -> ImportParseResult:
        lookup = _column_lookup(df)
        return self._parse_with_matched_columns(df, self._matched_columns(lookup))


ADAPTERS: list[CsvImportAdapter] = [
    MoxfieldCsvAdapter(),
    ManaBoxCsvAdapter(),
    ArchidektCsvAdapter(),
    GenericCsvAdapter(),
]


def parse_collection_csv(content: bytes, filename: str | None = None) -> ImportParseResult:
    try:
        dataframe = pd.read_csv(io.BytesIO(content))
    except Exception as exc:
        raise ValueError(f"Could not parse CSV: {exc}") from exc

    for adapter in ADAPTERS:
        if adapter.supports(dataframe, filename):
            return adapter.parse(dataframe, filename)

    raise ValueError(f"Could not find a supported card name column. Columns found: {list(dataframe.columns)}")