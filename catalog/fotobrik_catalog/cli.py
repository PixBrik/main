from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Sequence

from .community import import_community
from .db import SCHEMA_VERSION, connect, database_stats, initialize_database
from .exporter import export_catalog
from .importer import ImportResult, import_rebrickable
from .rarity import compute_rarity

DEFAULT_DB = "catalog.sqlite3"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
SAMPLE_REBRICKABLE = PROJECT_ROOT / "fixtures" / "rebrickable_sample"
SAMPLE_COMMUNITY = PROJECT_ROOT / "fixtures" / "community_sample"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="fotobrik-catalog",
        description="Build and update Fotobrik's normalized local parts catalog.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init", help="Create or migrate an empty catalog database")
    _database_argument(init_parser)

    import_parser = subparsers.add_parser(
        "import",
        aliases=["import-rebrickable"],
        help="Import local Rebrickable-style CSV or CSV.GZ files",
    )
    _database_argument(import_parser)
    import_parser.add_argument("--input", required=True, type=Path, help="Directory containing downloaded CSV files")
    import_parser.add_argument("--source-version", help="Upstream release/date label")
    import_parser.add_argument("--source-uri", help="Provenance URI or object-storage key (never fetched)")

    community_parser = subparsers.add_parser(
        "community",
        aliases=["import-community"],
        help="Import Fotobrik geometry, store, offer, and wall-sighting observations",
    )
    _database_argument(community_parser)
    community_parser.add_argument("--input", required=True, type=Path)
    community_parser.add_argument("--source-version")
    community_parser.add_argument("--source-uri")

    update_parser = subparsers.add_parser("update", help="Run the repeatable import + rarity refresh workflow")
    _database_argument(update_parser)
    update_parser.add_argument("--rebrickable", required=True, type=Path)
    update_parser.add_argument("--community", type=Path)
    update_parser.add_argument("--source-version")
    update_parser.add_argument("--community-version")

    sample_parser = subparsers.add_parser("sample", help="Load the bundled offline demo catalog")
    _database_argument(sample_parser)

    rarity_parser = subparsers.add_parser("rarity", help="Recompute evidence-based rarity snapshots")
    _database_argument(rarity_parser)

    stats_parser = subparsers.add_parser("stats", help="Show catalog entity and run counts")
    _database_argument(stats_parser)

    export_parser = subparsers.add_parser("export", help="Export an app/search-friendly element view")
    _database_argument(export_parser)
    export_parser.add_argument("--output", required=True, type=Path)
    export_parser.add_argument("--format", choices=("jsonl", "csv"), default="jsonl")

    check_parser = subparsers.add_parser("check", help="Run SQLite integrity and foreign-key checks")
    _database_argument(check_parser)
    return parser


def _database_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--db", default=DEFAULT_DB, type=Path, help=f"SQLite database path (default: {DEFAULT_DB})")


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    connection = connect(args.db)
    try:
        initialize_database(connection)
        if args.command == "init":
            _print({"database": str(args.db.resolve()), "schema_version": SCHEMA_VERSION, "status": "ready"})
        elif args.command in {"import", "import-rebrickable"}:
            result = import_rebrickable(
                connection,
                args.input,
                source_version=args.source_version,
                source_uri=args.source_uri,
            )
            _print_import(result)
        elif args.command in {"community", "import-community"}:
            result = import_community(
                connection,
                args.input,
                source_version=args.source_version,
                source_uri=args.source_uri,
            )
            _print_import(result)
        elif args.command == "update":
            rebrickable_result = import_rebrickable(
                connection,
                args.rebrickable,
                source_version=args.source_version,
            )
            payload: dict[str, object] = {"rebrickable": _result_dict(rebrickable_result)}
            last_run_id = rebrickable_result.run_id
            if args.community:
                community_result = import_community(
                    connection,
                    args.community,
                    source_version=args.community_version,
                )
                payload["community"] = _result_dict(community_result)
                last_run_id = community_result.run_id
            rarity = compute_rarity(connection, run_id=last_run_id)
            payload["rarity"] = {
                "design_scores": rarity.design_scores,
                "element_scores": rarity.element_scores,
                "algorithm_version": rarity.algorithm_version,
            }
            _print(payload)
        elif args.command == "sample":
            rebrickable_result = import_rebrickable(
                connection,
                SAMPLE_REBRICKABLE,
                source_version="offline-sample-v1",
                source_uri="bundled://rebrickable_sample",
            )
            community_result = import_community(
                connection,
                SAMPLE_COMMUNITY,
                source_version="offline-sample-v1",
                source_uri="bundled://community_sample",
            )
            rarity = compute_rarity(connection, run_id=community_result.run_id)
            _print(
                {
                    "rebrickable": _result_dict(rebrickable_result),
                    "community": _result_dict(community_result),
                    "rarity": {
                        "design_scores": rarity.design_scores,
                        "element_scores": rarity.element_scores,
                        "algorithm_version": rarity.algorithm_version,
                    },
                    "stats": _stats_payload(connection),
                }
            )
        elif args.command == "rarity":
            result = compute_rarity(connection)
            _print(
                {
                    "design_scores": result.design_scores,
                    "element_scores": result.element_scores,
                    "algorithm_version": result.algorithm_version,
                }
            )
        elif args.command == "stats":
            _print(_stats_payload(connection))
        elif args.command == "export":
            rows = export_catalog(connection, args.output, output_format=args.format)
            _print({"format": args.format, "output": str(args.output.resolve()), "rows": rows})
        elif args.command == "check":
            integrity = str(connection.execute("PRAGMA integrity_check").fetchone()[0])
            foreign_keys = [dict(row) for row in connection.execute("PRAGMA foreign_key_check")]
            _print({"integrity": integrity, "foreign_key_errors": foreign_keys})
            return 0 if integrity == "ok" and not foreign_keys else 1
        return 0
    except (FileNotFoundError, ValueError, sqlite3.DatabaseError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    finally:
        connection.close()


def _stats_payload(connection: sqlite3.Connection) -> dict[str, object]:
    result: dict[str, object] = {"schema_version": SCHEMA_VERSION, "counts": database_stats(connection)}
    result["rarity_bands"] = {
        str(row["band"]): int(row["count"])
        for row in connection.execute(
            "SELECT band, COUNT(*) AS count FROM rarity_scores WHERE is_current = 1 GROUP BY band ORDER BY band"
        )
    }
    last_run = connection.execute(
        """
        SELECT r.id, s.slug AS source, r.status, r.source_version, r.input_digest,
               r.started_at, r.finished_at, r.rows_read, r.rows_written, r.warning_count
        FROM catalog_runs r JOIN sources s ON s.id = r.source_id
        ORDER BY r.started_at DESC, r.id DESC LIMIT 1
        """
    ).fetchone()
    result["last_run"] = None if last_run is None else dict(last_run)
    return result


def _result_dict(result: ImportResult) -> dict[str, object]:
    return {
        "run_id": result.run_id,
        "input_digest": result.input_digest,
        "rows_read": result.rows_read,
        "rows_written": result.rows_written,
        "warnings": result.warnings,
    }


def _print_import(result: ImportResult) -> None:
    _print(_result_dict(result))


def _print(value: object) -> None:
    print(json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True))
