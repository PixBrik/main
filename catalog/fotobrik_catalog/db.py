from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

SCHEMA_VERSION = "1"
IMPORTER_VERSION = "0.1.0"


@dataclass(frozen=True)
class SourceMetadata:
    slug: str
    name: str
    kind: str
    homepage_url: str | None = None
    license_name: str | None = None
    license_url: str | None = None
    terms_url: str | None = None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def connect(database: str | Path) -> sqlite3.Connection:
    path = Path(database)
    if str(path) != ":memory:":
        path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(path))
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def initialize_database(connection: sqlite3.Connection) -> None:
    schema_path = Path(__file__).resolve().parent / "schema.sql"
    connection.executescript(schema_path.read_text(encoding="utf-8"))
    actual = connection.execute(
        "SELECT value FROM schema_meta WHERE key = 'schema_version'"
    ).fetchone()[0]
    if actual != SCHEMA_VERSION:
        raise RuntimeError(f"Unsupported schema version {actual}; expected {SCHEMA_VERSION}")
    connection.commit()


def ensure_source(connection: sqlite3.Connection, source: SourceMetadata) -> int:
    now = utc_now()
    connection.execute(
        """
        INSERT INTO sources(
            slug, name, kind, homepage_url, license_name, license_url, terms_url,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET
            name = excluded.name,
            kind = excluded.kind,
            homepage_url = excluded.homepage_url,
            license_name = excluded.license_name,
            license_url = excluded.license_url,
            terms_url = excluded.terms_url,
            updated_at = excluded.updated_at
        """,
        (
            source.slug,
            source.name,
            source.kind,
            source.homepage_url,
            source.license_name,
            source.license_url,
            source.terms_url,
            now,
            now,
        ),
    )
    row = connection.execute("SELECT id FROM sources WHERE slug = ?", (source.slug,)).fetchone()
    assert row is not None
    return int(row[0])


def start_run(
    connection: sqlite3.Connection,
    source_id: int,
    *,
    source_version: str | None,
    source_uri: str | None,
    input_digest: str | None,
    metadata: Mapping[str, Any] | None = None,
) -> str:
    run_id = str(uuid.uuid4())
    connection.execute(
        """
        INSERT INTO catalog_runs(
            id, source_id, status, source_version, source_uri, input_digest,
            importer_version, started_at, metadata_json
        ) VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?)
        """,
        (
            run_id,
            source_id,
            source_version,
            source_uri,
            input_digest,
            IMPORTER_VERSION,
            utc_now(),
            canonical_json(metadata or {}),
        ),
    )
    connection.commit()
    return run_id


def finish_run(
    connection: sqlite3.Connection,
    run_id: str,
    *,
    status: str,
    rows_read: int = 0,
    rows_written: int = 0,
    warning_count: int = 0,
    error_message: str | None = None,
) -> None:
    connection.execute(
        """
        UPDATE catalog_runs
        SET status = ?, finished_at = ?, rows_read = ?, rows_written = ?,
            warning_count = ?, error_message = ?
        WHERE id = ?
        """,
        (
            status,
            utc_now(),
            rows_read,
            rows_written,
            warning_count,
            error_message,
            run_id,
        ),
    )
    connection.commit()


def canonical_json(value: Mapping[str, Any] | list[Any]) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def version_entity(
    connection: sqlite3.Connection,
    *,
    entity_type: str,
    entity_id: int,
    source_id: int,
    run_id: str,
    payload: Mapping[str, Any],
) -> bool:
    """Record a slowly-changing version. Returns True only when state changed."""
    now = utc_now()
    payload_json = canonical_json(dict(payload))
    version_hash = hashlib.sha256(payload_json.encode("utf-8")).hexdigest()
    current = connection.execute(
        """
        SELECT id, version_hash FROM record_versions
        WHERE entity_type = ? AND entity_id = ? AND source_id = ? AND is_current = 1
        ORDER BY id DESC LIMIT 1
        """,
        (entity_type, entity_id, source_id),
    ).fetchone()
    if current is not None and current["version_hash"] == version_hash:
        connection.execute(
            "UPDATE record_versions SET last_seen_at = ? WHERE id = ?",
            (now, current["id"]),
        )
        return False
    if current is not None:
        connection.execute(
            "UPDATE record_versions SET is_current = 0, valid_to = ?, last_seen_at = ? WHERE id = ?",
            (now, now, current["id"]),
        )
    connection.execute(
        """
        INSERT INTO record_versions(
            entity_type, entity_id, source_id, run_id, version_hash, payload_json,
            valid_from, is_current, first_seen_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        """,
        (entity_type, entity_id, source_id, run_id, version_hash, payload_json, now, now, now),
    )
    return True


def record_provenance(
    connection: sqlite3.Connection,
    *,
    entity_type: str,
    entity_id: int,
    source_id: int,
    run_id: str,
    source_file: str,
    source_row: int,
    operation: str,
    raw: Mapping[str, Any],
) -> None:
    connection.execute(
        """
        INSERT INTO record_provenance(
            entity_type, entity_id, source_id, run_id, source_file, source_row,
            operation, observed_at, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entity_type, entity_id, run_id) DO UPDATE SET
            source_file = excluded.source_file,
            source_row = excluded.source_row,
            operation = excluded.operation,
            observed_at = excluded.observed_at,
            raw_json = excluded.raw_json
        """,
        (
            entity_type,
            entity_id,
            source_id,
            run_id,
            source_file,
            source_row,
            operation,
            utc_now(),
            canonical_json(dict(raw)),
        ),
    )


def upsert_external_id(
    connection: sqlite3.Connection,
    *,
    source_id: int,
    namespace: str,
    external_id: str,
    target: str,
    target_id: int,
) -> None:
    target_columns = {
        "design": "design_id",
        "color": "color_id",
        "element": "element_id",
        "store": "store_id",
    }
    if target not in target_columns:
        raise ValueError(f"Unknown external identifier target: {target}")
    now = utc_now()
    values: dict[str, int | None] = {column: None for column in target_columns.values()}
    values[target_columns[target]] = target_id
    connection.execute(
        """
        INSERT INTO external_identifiers(
            source_id, namespace, external_id, design_id, color_id, element_id,
            store_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_id, namespace, external_id) DO UPDATE SET
            design_id = excluded.design_id,
            color_id = excluded.color_id,
            element_id = excluded.element_id,
            store_id = excluded.store_id,
            updated_at = excluded.updated_at
        """,
        (
            source_id,
            namespace,
            external_id,
            values["design_id"],
            values["color_id"],
            values["element_id"],
            values["store_id"],
            now,
            now,
        ),
    )


def database_stats(connection: sqlite3.Connection) -> dict[str, int]:
    tables = (
        "sources",
        "catalog_runs",
        "part_designs",
        "colors",
        "elements",
        "geometry_metadata",
        "part_relationships",
        "catalog_sets",
        "set_appearances",
        "stores",
        "offer_snapshots",
        "offers",
        "wall_sightings",
        "record_versions",
        "record_provenance",
        "rarity_scores",
    )
    return {
        table: int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
        for table in tables
    }
