from __future__ import annotations

import csv
import gzip
import hashlib
import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Mapping

from .db import (
    SourceMetadata,
    ensure_source,
    finish_run,
    record_provenance,
    start_run,
    upsert_external_id,
    utc_now,
    version_entity,
)

REBRICKABLE_SOURCE = SourceMetadata(
    slug="rebrickable",
    name="Rebrickable",
    kind="parts_catalog",
    homepage_url="https://rebrickable.com/",
    terms_url="https://rebrickable.com/terms/",
)

RELATIONSHIP_TYPES = {
    "P": "print_of",
    "M": "mold_variant_of",
    "A": "alternate_of",
    "T": "assembly_of",
}


@dataclass
class ImportMetrics:
    rows_read: int = 0
    rows_written: int = 0
    warnings: int = 0


@dataclass(frozen=True)
class ImportResult:
    run_id: str
    rows_read: int
    rows_written: int
    warnings: int
    input_digest: str


class CsvBundle:
    """A local folder of CSV or individually gzipped CSV files."""

    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        if not self.root.is_dir():
            raise ValueError(f"Input must be a directory: {self.root}")

    def find(self, *stems: str, required: bool = False) -> Path | None:
        for stem in stems:
            for filename in (f"{stem}.csv", f"{stem}.csv.gz"):
                candidate = self.root / filename
                if candidate.is_file():
                    return candidate
        if required:
            names = ", ".join(f"{stem}.csv(.gz)" for stem in stems)
            raise FileNotFoundError(f"Missing required catalog file: {names}")
        return None

    def files(self) -> list[Path]:
        return sorted(
            (path for path in self.root.iterdir() if path.name.endswith((".csv", ".csv.gz"))),
            key=lambda path: path.name,
        )

    def digest(self) -> str:
        digest = hashlib.sha256()
        for path in self.files():
            digest.update(path.name.encode("utf-8"))
            digest.update(b"\0")
            with path.open("rb") as source:
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
        return digest.hexdigest()


def iter_csv(path: Path) -> Iterator[tuple[int, dict[str, str]]]:
    if path.suffix == ".gz":
        handle_context = gzip.open(path, mode="rt", encoding="utf-8-sig", newline="")
    else:
        handle_context = path.open(mode="rt", encoding="utf-8-sig", newline="")
    with handle_context as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise ValueError(f"CSV has no header: {path}")
        for line_number, raw in enumerate(reader, start=2):
            yield line_number, {
                str(key).strip(): (value.strip() if isinstance(value, str) else "")
                for key, value in raw.items()
                if key is not None
            }


def import_rebrickable(
    connection: sqlite3.Connection,
    input_dir: str | Path,
    *,
    source_version: str | None = None,
    source_uri: str | None = None,
) -> ImportResult:
    """Import a downloaded Rebrickable CSV bundle without network access."""
    bundle = CsvBundle(input_dir)
    input_digest = bundle.digest()
    source_id = ensure_source(connection, REBRICKABLE_SOURCE)
    run_id = start_run(
        connection,
        source_id,
        source_version=source_version,
        source_uri=source_uri or str(bundle.root),
        input_digest=input_digest,
        metadata={"files": [path.name for path in bundle.files()]},
    )
    metrics = ImportMetrics()
    try:
        connection.execute("BEGIN IMMEDIATE")
        _import_categories(connection, bundle.find("part_categories", required=True), source_id, run_id, metrics)
        _import_colors(connection, bundle.find("colors", required=True), source_id, run_id, metrics)
        _import_parts(connection, bundle.find("parts", required=True), source_id, run_id, metrics)
        elements = bundle.find("elements")
        if elements:
            _import_elements(connection, elements, source_id, run_id, metrics)
        relationships = bundle.find("part_relationships")
        if relationships:
            _import_relationships(connection, relationships, source_id, run_id, metrics)
        sets = bundle.find("sets")
        if sets:
            _import_sets(connection, sets, source_id, run_id, metrics)
        inventories = bundle.find("inventories")
        inventory_parts = bundle.find("inventory_parts", "inventories_parts")
        if inventories and inventory_parts:
            inventory_map = _read_inventory_map(inventories, metrics)
            _import_inventory_parts(
                connection,
                inventory_parts,
                inventory_map,
                source_id,
                run_id,
                metrics,
            )
        elif inventories or inventory_parts:
            metrics.warnings += 1
        finish_run(
            connection,
            run_id,
            status="succeeded",
            rows_read=metrics.rows_read,
            rows_written=metrics.rows_written,
            warning_count=metrics.warnings,
        )
    except Exception as exc:
        connection.rollback()
        finish_run(
            connection,
            run_id,
            status="failed",
            rows_read=metrics.rows_read,
            rows_written=metrics.rows_written,
            warning_count=metrics.warnings,
            error_message=str(exc)[:2000],
        )
        raise
    return ImportResult(run_id, metrics.rows_read, metrics.rows_written, metrics.warnings, input_digest)


def _import_categories(
    connection: sqlite3.Connection,
    path: Path,
    source_id: int,
    run_id: str,
    metrics: ImportMetrics,
) -> None:
    for line, row in iter_csv(path):
        metrics.rows_read += 1
        external_id = _required(row, "id", path, line)
        name = _required(row, "name", path, line)
        now = utc_now()
        existing = connection.execute(
            "SELECT id FROM part_categories WHERE source_id = ? AND external_id = ?",
            (source_id, external_id),
        ).fetchone()
        connection.execute(
            """
            INSERT INTO part_categories(source_id, external_id, name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(source_id, external_id) DO UPDATE SET
                name = excluded.name, updated_at = excluded.updated_at
            """,
            (source_id, external_id, name, now, now),
        )
        entity_id = _single_id(
            connection,
            "SELECT id FROM part_categories WHERE source_id = ? AND external_id = ?",
            (source_id, external_id),
        )
        _track(connection, "part_category", entity_id, source_id, run_id, path, line, row, {"external_id": external_id, "name": name}, existing is None, metrics)


def _import_colors(
    connection: sqlite3.Connection,
    path: Path,
    source_id: int,
    run_id: str,
    metrics: ImportMetrics,
) -> None:
    for line, row in iter_csv(path):
        metrics.rows_read += 1
        external_id = _required(row, "id", path, line)
        name = _required(row, "name", path, line)
        rgb = _clean_hex(row.get("rgb"))
        transparent = _bool(row.get("is_trans"))
        metallic = any(word in name.lower() for word in ("chrome", "metallic", "pearl"))
        canonical_ref = f"rebrickable:color:{external_id}"
        now = utc_now()
        existing = connection.execute("SELECT id FROM colors WHERE canonical_ref = ?", (canonical_ref,)).fetchone()
        connection.execute(
            """
            INSERT INTO colors(
                canonical_ref, name, rgb_hex, is_transparent, is_metallic,
                source_id, last_run_id, created_at, updated_at, first_seen_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(canonical_ref) DO UPDATE SET
                name = excluded.name,
                rgb_hex = excluded.rgb_hex,
                is_transparent = excluded.is_transparent,
                is_metallic = excluded.is_metallic,
                last_run_id = excluded.last_run_id,
                updated_at = excluded.updated_at,
                last_seen_at = excluded.last_seen_at
            """,
            (canonical_ref, name, rgb, transparent, metallic, source_id, run_id, now, now, now, now),
        )
        entity_id = _single_id(connection, "SELECT id FROM colors WHERE canonical_ref = ?", (canonical_ref,))
        upsert_external_id(connection, source_id=source_id, namespace="color_id", external_id=external_id, target="color", target_id=entity_id)
        payload = {"external_id": external_id, "name": name, "rgb_hex": rgb, "is_transparent": bool(transparent), "is_metallic": metallic}
        _track(connection, "color", entity_id, source_id, run_id, path, line, row, payload, existing is None, metrics)


def _import_parts(
    connection: sqlite3.Connection,
    path: Path,
    source_id: int,
    run_id: str,
    metrics: ImportMetrics,
) -> None:
    for line, row in iter_csv(path):
        metrics.rows_read += 1
        part_num = _required(row, "part_num", path, line)
        name = _required(row, "name", path, line)
        category_external = row.get("part_cat_id") or ""
        category_id = _optional_id(
            connection,
            "SELECT id FROM part_categories WHERE source_id = ? AND external_id = ?",
            (source_id, category_external),
        )
        if category_external and category_id is None:
            metrics.warnings += 1
        canonical_ref = f"rebrickable:part:{part_num}"
        material = row.get("part_material") or None
        now = utc_now()
        existing = connection.execute("SELECT id FROM part_designs WHERE canonical_ref = ?", (canonical_ref,)).fetchone()
        connection.execute(
            """
            INSERT INTO part_designs(
                canonical_ref, name, category_id, material, source_id, last_run_id,
                created_at, updated_at, first_seen_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(canonical_ref) DO UPDATE SET
                name = excluded.name,
                category_id = excluded.category_id,
                material = excluded.material,
                is_active = 1,
                last_run_id = excluded.last_run_id,
                updated_at = excluded.updated_at,
                last_seen_at = excluded.last_seen_at
            """,
            (canonical_ref, name, category_id, material, source_id, run_id, now, now, now, now),
        )
        entity_id = _single_id(connection, "SELECT id FROM part_designs WHERE canonical_ref = ?", (canonical_ref,))
        upsert_external_id(connection, source_id=source_id, namespace="part_num", external_id=part_num, target="design", target_id=entity_id)
        payload = {"part_num": part_num, "name": name, "category_external_id": category_external or None, "material": material}
        _track(connection, "part_design", entity_id, source_id, run_id, path, line, row, payload, existing is None, metrics)


def _import_elements(
    connection: sqlite3.Connection,
    path: Path,
    source_id: int,
    run_id: str,
    metrics: ImportMetrics,
) -> None:
    for line, row in iter_csv(path):
        metrics.rows_read += 1
        external_id = _required(row, "element_id", path, line)
        part_num = _required(row, "part_num", path, line)
        color_external = _required(row, "color_id", path, line)
        design_id = _resolve_external(connection, source_id, "part_num", part_num, "design_id")
        color_id = _resolve_external(connection, source_id, "color_id", color_external, "color_id")
        if design_id is None or color_id is None:
            metrics.warnings += 1
            continue
        canonical_ref = f"rebrickable:element:{external_id}"
        now = utc_now()
        existing = connection.execute("SELECT id FROM elements WHERE canonical_ref = ?", (canonical_ref,)).fetchone()
        connection.execute(
            """
            INSERT INTO elements(
                canonical_ref, design_id, color_id, source_id, last_run_id,
                created_at, updated_at, first_seen_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(canonical_ref) DO UPDATE SET
                design_id = excluded.design_id,
                color_id = excluded.color_id,
                is_active = 1,
                last_run_id = excluded.last_run_id,
                updated_at = excluded.updated_at,
                last_seen_at = excluded.last_seen_at
            """,
            (canonical_ref, design_id, color_id, source_id, run_id, now, now, now, now),
        )
        entity_id = _single_id(connection, "SELECT id FROM elements WHERE canonical_ref = ?", (canonical_ref,))
        upsert_external_id(connection, source_id=source_id, namespace="element_id", external_id=external_id, target="element", target_id=entity_id)
        supplied_design_id = row.get("design_id")
        if supplied_design_id:
            upsert_external_id(connection, source_id=source_id, namespace="design_id", external_id=supplied_design_id, target="design", target_id=design_id)
        payload = {"element_id": external_id, "part_num": part_num, "color_id": color_external, "design_id": supplied_design_id or None}
        _track(connection, "element", entity_id, source_id, run_id, path, line, row, payload, existing is None, metrics)


def _import_relationships(
    connection: sqlite3.Connection,
    path: Path,
    source_id: int,
    run_id: str,
    metrics: ImportMetrics,
) -> None:
    for line, row in iter_csv(path):
        metrics.rows_read += 1
        child = _required(row, "child_part_num", path, line)
        parent = _required(row, "parent_part_num", path, line)
        rel_code = _required(row, "rel_type", path, line)
        from_id = _resolve_external(connection, source_id, "part_num", child, "design_id")
        to_id = _resolve_external(connection, source_id, "part_num", parent, "design_id")
        if from_id is None or to_id is None:
            metrics.warnings += 1
            continue
        relationship_type = RELATIONSHIP_TYPES.get(rel_code, f"source:{rel_code}")
        now = utc_now()
        existing = connection.execute(
            """SELECT id FROM part_relationships
               WHERE from_design_id = ? AND to_design_id = ? AND relationship_type = ? AND source_id = ?""",
            (from_id, to_id, relationship_type, source_id),
        ).fetchone()
        connection.execute(
            """
            INSERT INTO part_relationships(
                from_design_id, to_design_id, relationship_type, source_id,
                last_run_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(from_design_id, to_design_id, relationship_type, source_id) DO UPDATE SET
                last_run_id = excluded.last_run_id, updated_at = excluded.updated_at
            """,
            (from_id, to_id, relationship_type, source_id, run_id, now, now),
        )
        entity_id = _single_id(
            connection,
            """SELECT id FROM part_relationships
               WHERE from_design_id = ? AND to_design_id = ? AND relationship_type = ? AND source_id = ?""",
            (from_id, to_id, relationship_type, source_id),
        )
        payload = {"child_part_num": child, "parent_part_num": parent, "relationship_type": relationship_type}
        _track(connection, "part_relationship", entity_id, source_id, run_id, path, line, row, payload, existing is None, metrics)


def _import_sets(
    connection: sqlite3.Connection,
    path: Path,
    source_id: int,
    run_id: str,
    metrics: ImportMetrics,
) -> None:
    for line, row in iter_csv(path):
        metrics.rows_read += 1
        set_ref = _required(row, "set_num", path, line)
        payload = {
            "set_ref": set_ref,
            "name": row.get("name") or None,
            "year": _int_or_none(row.get("year")),
            "theme_id": row.get("theme_id") or None,
            "part_count": _int_or_none(row.get("num_parts")),
            "set_url": row.get("set_img_url") or None,
        }
        now = utc_now()
        existing = connection.execute("SELECT id FROM catalog_sets WHERE source_id = ? AND set_ref = ?", (source_id, set_ref)).fetchone()
        connection.execute(
            """
            INSERT INTO catalog_sets(
                source_id, set_ref, name, year, theme_id, part_count, set_url,
                last_run_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_id, set_ref) DO UPDATE SET
                name = excluded.name,
                year = excluded.year,
                theme_id = excluded.theme_id,
                part_count = excluded.part_count,
                set_url = excluded.set_url,
                last_run_id = excluded.last_run_id,
                updated_at = excluded.updated_at
            """,
            (source_id, set_ref, payload["name"], payload["year"], payload["theme_id"], payload["part_count"], payload["set_url"], run_id, now, now),
        )
        entity_id = _single_id(connection, "SELECT id FROM catalog_sets WHERE source_id = ? AND set_ref = ?", (source_id, set_ref))
        _track(connection, "catalog_set", entity_id, source_id, run_id, path, line, row, payload, existing is None, metrics)


def _read_inventory_map(path: Path, metrics: ImportMetrics) -> dict[str, str]:
    result: dict[str, str] = {}
    for line, row in iter_csv(path):
        metrics.rows_read += 1
        inventory_id = _required(row, "id", path, line)
        set_ref = _required(row, "set_num", path, line)
        result[inventory_id] = set_ref
    return result


def _import_inventory_parts(
    connection: sqlite3.Connection,
    path: Path,
    inventory_map: Mapping[str, str],
    source_id: int,
    run_id: str,
    metrics: ImportMetrics,
) -> None:
    for line, row in iter_csv(path):
        metrics.rows_read += 1
        inventory_ref = _required(row, "inventory_id", path, line)
        part_num = _required(row, "part_num", path, line)
        color_external = _required(row, "color_id", path, line)
        design_id = _resolve_external(connection, source_id, "part_num", part_num, "design_id")
        color_id = _resolve_external(connection, source_id, "color_id", color_external, "color_id")
        if design_id is None or color_id is None:
            metrics.warnings += 1
            continue
        set_ref = inventory_map.get(inventory_ref)
        set_id = None
        if set_ref:
            set_id = _optional_id(connection, "SELECT id FROM catalog_sets WHERE source_id = ? AND set_ref = ?", (source_id, set_ref))
        else:
            metrics.warnings += 1
        quantity = _int_or_none(row.get("quantity")) or 0
        is_spare = _bool(row.get("is_spare"))
        now = utc_now()
        existing = connection.execute(
            """SELECT id FROM set_appearances
               WHERE source_id = ? AND inventory_ref = ? AND design_id = ? AND color_id = ? AND is_spare = ?""",
            (source_id, inventory_ref, design_id, color_id, is_spare),
        ).fetchone()
        connection.execute(
            """
            INSERT INTO set_appearances(
                source_id, inventory_ref, set_id, design_id, color_id, quantity,
                is_spare, last_run_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_id, inventory_ref, design_id, color_id, is_spare) DO UPDATE SET
                set_id = excluded.set_id,
                quantity = excluded.quantity,
                last_run_id = excluded.last_run_id,
                updated_at = excluded.updated_at
            """,
            (source_id, inventory_ref, set_id, design_id, color_id, quantity, is_spare, run_id, now, now),
        )
        entity_id = _single_id(
            connection,
            """SELECT id FROM set_appearances
               WHERE source_id = ? AND inventory_ref = ? AND design_id = ? AND color_id = ? AND is_spare = ?""",
            (source_id, inventory_ref, design_id, color_id, is_spare),
        )
        payload = {"inventory_ref": inventory_ref, "set_ref": set_ref, "part_num": part_num, "color_id": color_external, "quantity": quantity, "is_spare": bool(is_spare)}
        _track(connection, "set_appearance", entity_id, source_id, run_id, path, line, row, payload, existing is None, metrics)


def _track(
    connection: sqlite3.Connection,
    entity_type: str,
    entity_id: int,
    source_id: int,
    run_id: str,
    path: Path,
    line: int,
    raw: Mapping[str, str],
    payload: Mapping[str, object],
    inserted: bool,
    metrics: ImportMetrics,
) -> None:
    changed = version_entity(
        connection,
        entity_type=entity_type,
        entity_id=entity_id,
        source_id=source_id,
        run_id=run_id,
        payload=payload,
    )
    operation = "inserted" if inserted else ("updated" if changed else "seen")
    record_provenance(
        connection,
        entity_type=entity_type,
        entity_id=entity_id,
        source_id=source_id,
        run_id=run_id,
        source_file=path.name,
        source_row=line,
        operation=operation,
        raw=raw,
    )
    if changed:
        metrics.rows_written += 1


def _resolve_external(
    connection: sqlite3.Connection,
    source_id: int,
    namespace: str,
    external_id: str,
    target_column: str,
) -> int | None:
    if target_column not in {"design_id", "color_id", "element_id", "store_id"}:
        raise ValueError("Invalid external identifier target column")
    row = connection.execute(
        f"SELECT {target_column} FROM external_identifiers WHERE source_id = ? AND namespace = ? AND external_id = ?",
        (source_id, namespace, external_id),
    ).fetchone()
    if row is None or row[0] is None:
        return None
    return int(row[0])


def _required(row: Mapping[str, str], field: str, path: Path, line: int) -> str:
    value = row.get(field, "").strip()
    if not value:
        raise ValueError(f"{path.name}:{line}: required field '{field}' is empty")
    return value


def _single_id(connection: sqlite3.Connection, sql: str, params: tuple[object, ...]) -> int:
    row = connection.execute(sql, params).fetchone()
    if row is None:
        raise RuntimeError("Upserted row could not be resolved")
    return int(row[0])


def _optional_id(connection: sqlite3.Connection, sql: str, params: tuple[object, ...]) -> int | None:
    row = connection.execute(sql, params).fetchone()
    return None if row is None else int(row[0])


def _bool(value: str | None) -> int:
    return int(str(value or "").strip().lower() in {"1", "true", "yes", "y"})


def _int_or_none(value: str | None) -> int | None:
    if value is None or not value.strip():
        return None
    return int(value)


def _clean_hex(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = value.strip().lstrip("#").upper()
    if len(cleaned) != 6 or any(char not in "0123456789ABCDEF" for char in cleaned):
        return None
    return cleaned
