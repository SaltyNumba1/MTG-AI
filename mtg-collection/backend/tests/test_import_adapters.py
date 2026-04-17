from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.import_adapters import parse_collection_csv


FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


class ParseCollectionCsvTests(unittest.TestCase):
    def _parse_fixture(self, fixture_name: str):
        fixture_path = FIXTURES_DIR / fixture_name
        return parse_collection_csv(fixture_path.read_bytes(), fixture_path.name)

    def test_detects_real_moxfield_export(self):
        result = self._parse_fixture("moxfield_collection.csv")

        self.assertEqual(result.source, "moxfield")
        self.assertEqual(result.matched_columns["quantity"], "Count")
        self.assertEqual(result.matched_columns["set_code"], "Edition")
        self.assertEqual(result.rows[0].name, "Aang, A Lot to Learn")
        self.assertEqual(result.rows[0].quantity, 2)
        self.assertEqual(result.rows[0].set_code, "tle")
        self.assertEqual(result.rows[1].finish, "foil")
        self.assertEqual(result.rows[1].collector_number, "1")

    def test_detects_manabox_export(self):
        result = self._parse_fixture("manabox_collection.csv")

        self.assertEqual(result.source, "manabox")
        self.assertEqual(result.matched_columns["name"], "Name")
        self.assertEqual(result.matched_columns["set_code"], "Set code")
        self.assertEqual(result.matched_columns["collector_number"], "Collector number")
        self.assertEqual(result.rows[0].name, "Uchbenbak, the Great Mistake")
        self.assertEqual(result.rows[0].scryfall_id, "a062202c-f9fb-4dd6-989a-c3083644f1c0")
        self.assertIsNone(result.rows[0].finish)
        self.assertEqual(result.rows[1].finish, "foil")
        self.assertEqual(result.rows[1].language, "en")
        self.assertEqual(result.rows[2].quantity, 2)

    def test_detects_archidekt_fixture(self):
        result = self._parse_fixture("archidekt_collection.csv")

        self.assertEqual(result.source, "archidekt")
        self.assertEqual(result.matched_columns["name"], "Name")
        self.assertEqual(result.matched_columns["quantity"], "Quantity")
        self.assertEqual(result.matched_columns["scryfall_id"], "Scryfall ID")
        self.assertEqual(result.rows[0].name, "Aang, A Lot to Learn")
        self.assertEqual(result.rows[0].quantity, 2)
        self.assertEqual(result.rows[1].scryfall_id, "fea89ca0-8070-4f28-9851-994314f9d248")
        self.assertIsNone(result.rows[1].finish)

    def test_falls_back_to_generic_csv(self):
        result = self._parse_fixture("generic_collection.csv")

        self.assertEqual(result.source, "generic")
        self.assertEqual(result.rows[0].name, "Lightning Bolt")
        self.assertEqual(result.rows[0].quantity, 4)
        self.assertEqual(result.rows[1].quantity, 2)


if __name__ == "__main__":
    unittest.main()
