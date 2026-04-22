from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.deck_engine import (
    extract_json,
    _build_deck_selection,
    _apply_land_targets,
    _allocate_basic_land_counts,
    _rebalance_nonlands_for_quality,
)


class ExtractJsonTests(unittest.TestCase):
    def test_extracts_embedded_json_object(self):
        raw = 'Here is the deck: {"description": "tokens", "card_indices": [1, 5, 12]}'

        result = extract_json(raw)

        self.assertEqual(result["description"], "tokens")
        self.assertEqual(result["card_indices"], [1, 5, 12])

    def test_falls_back_to_numbered_card_list(self):
        raw = (
            ",Discover 801. Zombie Infestation // Undead Burough | Land - Town // Legendary Land | "
            "CMC:3.0 | Transform,Menace 802. Akroma's Will | Legendary Enchantment | CMG:0.0 | "
            "Flyover 803. Animate Dead | Instant | CMG:1.0 | Zombie army!"
        )

        result = extract_json(raw)

        self.assertEqual(result["description"], "Discover")
        self.assertEqual(result["card_indices"], [801, 802, 803])
        self.assertEqual(
            result["card_names"],
            [
                "Zombie Infestation // Undead Burough",
                "Akroma's Will",
                "Animate Dead",
            ],
        )

    def test_rejects_empty_response(self):
        with self.assertRaisesRegex(ValueError, "empty"):
            extract_json("   ")


class DeckSelectionTests(unittest.TestCase):
    def test_recovers_with_name_matching_and_nonland_backfill(self):
        all_candidates = [
            {"id": "c1", "name": "Sol Ring", "type_line": "Artifact"},
            {"id": "c2", "name": "Swords to Plowshares", "type_line": "Instant"},
            {"id": "c3", "name": "Plains", "type_line": "Basic Land - Plains"},
        ]
        model_candidates = [all_candidates[2]]
        result = {
            "card_indices": [801, 802],
            "card_names": ["Sol Ring", "Swords to Plowshares"],
        }

        selected = _build_deck_selection(model_candidates, all_candidates, result)

        self.assertEqual(len(selected), 99)
        self.assertEqual(selected[0]["name"], "Sol Ring")
        self.assertEqual(selected[1]["name"], "Swords to Plowshares")

    def test_applies_requested_land_targets(self):
        nonlands = [
            {"id": f"n{i}", "name": f"Spell {i}", "type_line": "Instant"}
            for i in range(1, 90)
        ]
        nonbasic_lands = [
            {"id": f"nb{i}", "name": f"Dual Land {i}", "type_line": "Land"}
            for i in range(1, 20)
        ]
        basic_lands = [
            {"id": f"b{i}", "name": f"Basic {i}", "type_line": "Basic Land - Swamp"}
            for i in range(1, 20)
        ]
        all_candidates = nonlands + nonbasic_lands + basic_lands
        selected = all_candidates[:99]

        balanced = _apply_land_targets(
            selected,
            all_candidates,
            basic_land_count=10,
            nonbasic_land_count=12,
            commander_identity=["B"],
        )

        self.assertEqual(len(balanced), 99)
        self.assertEqual(sum(1 for c in balanced if "land" in c["type_line"].lower() and "basic" in c["type_line"].lower()), 10)
        self.assertEqual(sum(1 for c in balanced if "land" in c["type_line"].lower() and "basic" not in c["type_line"].lower()), 12)

    def test_allocates_basic_lands_by_nonland_color_ratio(self):
        selected_nonlands = []
        selected_nonlands.extend(
            [
                {"id": f"b{i}", "name": f"Black Spell {i}", "type_line": "Sorcery", "color_identity": ["B"]}
                for i in range(1, 41)
            ]
        )
        selected_nonlands.extend(
            [
                {"id": f"g{i}", "name": f"Green Spell {i}", "type_line": "Creature", "color_identity": ["G"]}
                for i in range(1, 16)
            ]
        )

        allocation = _allocate_basic_land_counts(selected_nonlands, 30, ["B", "G"])

        self.assertEqual(allocation["B"], 22)
        self.assertEqual(allocation["G"], 8)

    def test_rebalances_nonlands_toward_akawalli_synergy(self):
        selected = [
            {"id": "x1", "name": "Vanilla Beater", "type_line": "Creature", "cmc": 5, "oracle_text": ""},
            {"id": "x2", "name": "Big Top End", "type_line": "Creature", "cmc": 7, "oracle_text": ""},
        ]
        all_candidates = selected + [
            {
                "id": "s1",
                "name": "Satyr Wayfinder",
                "type_line": "Creature",
                "cmc": 2,
                "oracle_text": "Mill four cards.",
                "keywords": [],
            },
            {
                "id": "s2",
                "name": "Victimize",
                "type_line": "Sorcery",
                "cmc": 3,
                "oracle_text": "Sacrifice a creature. Return two target creature cards from your graveyard.",
                "keywords": [],
            },
            {
                "id": "s3",
                "name": "Midrange Body",
                "type_line": "Creature",
                "cmc": 4,
                "oracle_text": "",
                "keywords": [],
            },
        ]

        picked = _rebalance_nonlands_for_quality(
            selected=selected,
            all_candidates=all_candidates,
            nonland_target=2,
            commander_name="Akawalli, the Seething Tower",
            keyword_filters=[],
            strict_mode=False,
        )

        picked_names = {c["name"] for c in picked}
        self.assertIn("Satyr Wayfinder", picked_names)
        self.assertIn("Victimize", picked_names)

    def test_strict_mode_prefers_keyword_matching_pool(self):
        selected = []
        all_candidates = [
            {
                "id": "k1",
                "name": "Grisly Salvage",
                "type_line": "Instant",
                "cmc": 2,
                "oracle_text": "Reveal top five cards, put a creature or land into hand and the rest into your graveyard.",
                "keywords": [],
            },
            {
                "id": "k2",
                "name": "Stitcher's Supplier",
                "type_line": "Creature",
                "cmc": 1,
                "oracle_text": "When this enters or dies, mill three cards.",
                "keywords": [],
            },
            {
                "id": "n1",
                "name": "Random Body",
                "type_line": "Creature",
                "cmc": 3,
                "oracle_text": "",
                "keywords": [],
            },
        ]

        picked = _rebalance_nonlands_for_quality(
            selected=selected,
            all_candidates=all_candidates,
            nonland_target=2,
            commander_name="Akawalli, the Seething Tower",
            keyword_filters=["mill", "graveyard"],
            strict_mode=True,
        )

        picked_names = {c["name"] for c in picked}
        self.assertIn("Grisly Salvage", picked_names)
        self.assertIn("Stitcher's Supplier", picked_names)
        self.assertNotIn("Random Body", picked_names)


if __name__ == "__main__":
    unittest.main()