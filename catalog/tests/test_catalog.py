from __future__ import annotations

import contextlib
import gzip
import io
import json
import tempfile
import unittest
from pathlib import Path

from fotobrik_catalog.cli import main
from fotobrik_catalog.community import import_community
from fotobrik_catalog.db import connect, database_stats, initialize_database
from fotobrik_catalog.exporter import export_catalog
from fotobrik_catalog.importer import import_rebrickable
from fotobrik_catalog.rarity import compute_rarity

ROOT = Path(__file__).resolve().parent.parent
REBRICKABLE_FIXTURE = ROOT / "fixtures" / "rebrickable_sample"
COMMUNITY_FIXTURE = ROOT / "fixtures" / "community_sample"


class CatalogTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.database = self.root / "catalog.sqlite3"
        self.connection = connect(self.database)
        self.addCleanup(self.connection.close)
        initialize_database(self.connection)

    def test_schema_initializes_with_foreign_keys(self) -> None:
        self.assertEqual("1", self.connection.execute("SELECT value FROM schema_meta WHERE key = 'schema_version'").fetchone()[0])
        self.assertEqual([], self.connection.execute("PRAGMA foreign_key_check").fetchall())
        self.assertIn("part_designs", database_stats(self.connection))

    def test_rebrickable_import_is_repeatable_and_provenance_aware(self) -> None:
        first = import_rebrickable(self.connection, REBRICKABLE_FIXTURE, source_version="sample-1")
        first_stats = database_stats(self.connection)
        second = import_rebrickable(self.connection, REBRICKABLE_FIXTURE, source_version="sample-1")
        second_stats = database_stats(self.connection)

        self.assertEqual(6, first_stats["part_designs"])
        self.assertEqual(7, first_stats["elements"])
        self.assertEqual(3, first_stats["catalog_sets"])
        self.assertEqual(12, first_stats["set_appearances"])
        self.assertEqual(first.input_digest, second.input_digest)
        self.assertGreater(first.rows_written, 0)
        self.assertEqual(0, second.rows_written)
        self.assertEqual(first_stats["record_versions"], second_stats["record_versions"])
        self.assertEqual(2, second_stats["catalog_runs"])
        self.assertGreater(second_stats["record_provenance"], first_stats["record_provenance"])
        self.assertEqual([], self.connection.execute("PRAGMA foreign_key_check").fetchall())

    def test_gzipped_csv_update_creates_a_new_record_version(self) -> None:
        bundle = self.root / "gz_bundle"
        bundle.mkdir()
        for filename in ("part_categories.csv", "colors.csv", "parts.csv"):
            data = (REBRICKABLE_FIXTURE / filename).read_text(encoding="utf-8")
            with gzip.open(bundle / f"{filename}.gz", "wt", encoding="utf-8", newline="") as handle:
                handle.write(data)

        first = import_rebrickable(self.connection, bundle, source_version="2026-07-01")
        changed = (REBRICKABLE_FIXTURE / "parts.csv").read_text(encoding="utf-8").replace(
            "Brick 2 x 4,1,Plastic", "Brick 2 x 4 updated,1,Plastic"
        )
        with gzip.open(bundle / "parts.csv.gz", "wt", encoding="utf-8", newline="") as handle:
            handle.write(changed)
        second = import_rebrickable(self.connection, bundle, source_version="2026-07-08")

        design_id = self.connection.execute(
            "SELECT id FROM part_designs WHERE canonical_ref = 'rebrickable:part:3001'"
        ).fetchone()[0]
        versions = self.connection.execute(
            "SELECT is_current FROM record_versions WHERE entity_type = 'part_design' AND entity_id = ? ORDER BY id",
            (design_id,),
        ).fetchall()
        self.assertNotEqual(first.input_digest, second.input_digest)
        self.assertEqual([0, 1], [row[0] for row in versions])
        self.assertEqual(
            "Brick 2 x 4 updated",
            self.connection.execute("SELECT name FROM part_designs WHERE id = ?", (design_id,)).fetchone()[0],
        )

    def test_community_rarity_and_exports(self) -> None:
        import_rebrickable(self.connection, REBRICKABLE_FIXTURE, source_version="sample-1")
        community = import_community(self.connection, COMMUNITY_FIXTURE, source_version="sample-1")
        rarity = compute_rarity(self.connection, run_id=community.run_id)
        stats = database_stats(self.connection)

        self.assertEqual(6, stats["geometry_metadata"])
        self.assertEqual(2, stats["stores"])
        self.assertEqual(3, stats["offers"])
        self.assertEqual(2, stats["wall_sightings"])
        self.assertEqual(6, rarity.design_scores)
        self.assertEqual(7, rarity.element_scores)
        rare_band = self.connection.execute(
            """
            SELECT r.band FROM rarity_scores r
            JOIN elements e ON e.id = r.element_id
            WHERE e.canonical_ref = 'rebrickable:element:sample-e-rare-red' AND r.is_current = 1
            """
        ).fetchone()[0]
        self.assertEqual("very_rare", rare_band)

        jsonl_path = self.root / "catalog.jsonl"
        csv_path = self.root / "catalog.csv"
        self.assertEqual(7, export_catalog(self.connection, jsonl_path, output_format="jsonl"))
        self.assertEqual(7, export_catalog(self.connection, csv_path, output_format="csv"))
        exported = [json.loads(line) for line in jsonl_path.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(7, len(exported))
        self.assertIn("rarity_band", exported[0])
        self.assertEqual([], self.connection.execute("PRAGMA foreign_key_check").fetchall())

    def test_cli_init_import_community_update_stats_export_and_check(self) -> None:
        self.connection.close()
        db = self.root / "cli.sqlite3"
        export_path = self.root / "cli-export.jsonl"

        commands = (
            ["init", "--db", str(db)],
            ["import", "--db", str(db), "--input", str(REBRICKABLE_FIXTURE), "--source-version", "sample-1"],
            ["community", "--db", str(db), "--input", str(COMMUNITY_FIXTURE), "--source-version", "sample-1"],
            ["stats", "--db", str(db)],
            ["export", "--db", str(db), "--output", str(export_path)],
            ["update", "--db", str(db), "--rebrickable", str(REBRICKABLE_FIXTURE), "--community", str(COMMUNITY_FIXTURE)],
            ["check", "--db", str(db)],
        )
        for command in commands:
            with self.subTest(command=command[0]), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(0, main(command))
        self.assertTrue(export_path.is_file())
        self.assertEqual(7, len(export_path.read_text(encoding="utf-8").splitlines()))


if __name__ == "__main__":
    unittest.main()
