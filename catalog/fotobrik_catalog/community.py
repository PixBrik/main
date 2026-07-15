from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Mapping

from .db import SourceMetadata, ensure_source, finish_run, start_run, upsert_external_id, utc_now
from .importer import CsvBundle, ImportMetrics, ImportResult, _bool, _track, iter_csv

COMMUNITY_SOURCE = SourceMetadata(
    slug="fotobrik-community",
    name="Fotobrik community observations",
    kind="community_observations",
)


def import_community(
    connection: sqlite3.Connection,
    input_dir: str | Path,
    *,
    source_version: str | None = None,
    source_uri: str | None = None,
) -> ImportResult:
    """Import Fotobrik-owned geometry, store, offer, and sighting observations."""
    bundle = CsvBundle(input_dir)
    supported = {
        "geometry.csv",
        "geometry.csv.gz",
        "stores.csv",
        "stores.csv.gz",
        "offers.csv",
        "offers.csv.gz",
        "wall_sightings.csv",
        "wall_sightings.csv.gz",
        "substitutions.csv",
        "substitutions.csv.gz",
    }
    found = [path for path in bundle.files() if path.name in supported]
    if not found:
        raise ValueError("Community bundle has no supported CSV files")
    digest = bundle.digest()
    source_id = ensure_source(connection, COMMUNITY_SOURCE)
    run_id = start_run(
        connection,
        source_id,
        source_version=source_version,
        source_uri=source_uri or str(bundle.root),
        input_digest=digest,
        metadata={"files": [path.name for path in found]},
    )
    metrics = ImportMetrics()
    try:
        connection.execute("BEGIN IMMEDIATE")
        geometry = bundle.find("geometry")
        if geometry:
            _import_geometry(connection, geometry, source_id, run_id, metrics)
        stores = bundle.find("stores")
        if stores:
            _import_stores(connection, stores, source_id, run_id, metrics)
        substitutions = bundle.find("substitutions")
        if substitutions:
            _import_substitutions(connection, substitutions, source_id, run_id, metrics)
        offers = bundle.find("offers")
        if offers:
            _import_offers(connection, offers, source_id, run_id, metrics)
        sightings = bundle.find("wall_sightings")
        if sightings:
            _import_sightings(connection, sightings, source_id, run_id, metrics)
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
    return ImportResult(run_id, metrics.rows_read, metrics.rows_written, metrics.warnings, digest)


def _import_geometry(connection: sqlite3.Connection, path: Path, source_id: int, run_id: str, metrics: ImportMetrics) -> None:
    for line, row in iter_csv(path):
        metrics.rows_read += 1
        design_id = _resolve_any(connection, "part_num", _required(row, "part_num", path, line), "design_id")
        if design_id is None:
            metrics.warnings += 1
            continue
        now = utc_now()
        payload: dict[str, object] = {
            "part_num": row["part_num"],
            "ldraw_ref": row.get("ldraw_ref") or None,
            "width_studs": _float(row.get("width_studs")),
            "depth_studs": _float(row.get("depth_studs")),
            "height_plates": _float(row.get("height_plates")),
            "length_mm": _float(row.get("length_mm")),
            "width_mm": _float(row.get("width_mm")),
            "height_mm": _float(row.get("height_mm")),
            "mass_grams": _float(row.get("mass_grams")),
            "geometry_status": row.get("geometry_status") or "unverified",
            "connection_points_json": row.get("connection_points_json") or "[]",
            "mesh_uri": row.get("mesh_uri") or None,
        }
        existing = connection.execute("SELECT id FROM geometry_metadata WHERE design_id = ? AND source_id = ?", (design_id, source_id)).fetchone()
        connection.execute(
            """
            INSERT INTO geometry_metadata(
                design_id, source_id, ldraw_ref, width_studs, depth_studs,
                height_plates, length_mm, width_mm, height_mm, mass_grams,
                geometry_status, connection_points_json, mesh_uri, last_run_id,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(design_id, source_id) DO UPDATE SET
                ldraw_ref = excluded.ldraw_ref,
                width_studs = excluded.width_studs,
                depth_studs = excluded.depth_studs,
                height_plates = excluded.height_plates,
                length_mm = excluded.length_mm,
                width_mm = excluded.width_mm,
                height_mm = excluded.height_mm,
                mass_grams = excluded.mass_grams,
                geometry_status = excluded.geometry_status,
                connection_points_json = excluded.connection_points_json,
                mesh_uri = excluded.mesh_uri,
                last_run_id = excluded.last_run_id,
                updated_at = excluded.updated_at
            """,
            (design_id, source_id, payload["ldraw_ref"], payload["width_studs"], payload["depth_studs"], payload["height_plates"], payload["length_mm"], payload["width_mm"], payload["height_mm"], payload["mass_grams"], payload["geometry_status"], payload["connection_points_json"], payload["mesh_uri"], run_id, now, now),
        )
        entity_id = _one(connection, "SELECT id FROM geometry_metadata WHERE design_id = ? AND source_id = ?", (design_id, source_id))
        _track(connection, "geometry", entity_id, source_id, run_id, path, line, row, payload, existing is None, metrics)


def _import_stores(connection: sqlite3.Connection, path: Path, source_id: int, run_id: str, metrics: ImportMetrics) -> None:
    for line, row in iter_csv(path):
        metrics.rows_read += 1
        store_ref = _required(row, "store_ref", path, line)
        canonical_ref = f"fotobrik-community:store:{store_ref}"
        payload: dict[str, object] = {
            "store_ref": store_ref,
            "name": _required(row, "name", path, line),
            "country_code": _required(row, "country_code", path, line).upper(),
            "city": row.get("city") or None,
            "address_line": row.get("address_line") or None,
            "postal_code": row.get("postal_code") or None,
            "latitude": _float(row.get("latitude")),
            "longitude": _float(row.get("longitude")),
            "website_url": row.get("website_url") or None,
            "has_pick_a_brick": _bool(row.get("has_pick_a_brick")),
        }
        now = utc_now()
        existing = connection.execute("SELECT id FROM stores WHERE canonical_ref = ?", (canonical_ref,)).fetchone()
        connection.execute(
            """
            INSERT INTO stores(
                canonical_ref, name, country_code, city, address_line, postal_code,
                latitude, longitude, website_url, has_pick_a_brick, source_id,
                last_run_id, created_at, updated_at, first_seen_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(canonical_ref) DO UPDATE SET
                name = excluded.name,
                country_code = excluded.country_code,
                city = excluded.city,
                address_line = excluded.address_line,
                postal_code = excluded.postal_code,
                latitude = excluded.latitude,
                longitude = excluded.longitude,
                website_url = excluded.website_url,
                has_pick_a_brick = excluded.has_pick_a_brick,
                last_run_id = excluded.last_run_id,
                updated_at = excluded.updated_at,
                last_seen_at = excluded.last_seen_at
            """,
            (canonical_ref, payload["name"], payload["country_code"], payload["city"], payload["address_line"], payload["postal_code"], payload["latitude"], payload["longitude"], payload["website_url"], payload["has_pick_a_brick"], source_id, run_id, now, now, now, now),
        )
        entity_id = _one(connection, "SELECT id FROM stores WHERE canonical_ref = ?", (canonical_ref,))
        upsert_external_id(connection, source_id=source_id, namespace="store_ref", external_id=store_ref, target="store", target_id=entity_id)
        _track(connection, "store", entity_id, source_id, run_id, path, line, row, payload, existing is None, metrics)


def _import_substitutions(connection: sqlite3.Connection, path: Path, source_id: int, run_id: str, metrics: ImportMetrics) -> None:
    for line, row in iter_csv(path):
        metrics.rows_read += 1
        from_ref = _required(row, "from_part_num", path, line)
        to_ref = _required(row, "to_part_num", path, line)
        from_id = _resolve_any(connection, "part_num", from_ref, "design_id")
        to_id = _resolve_any(connection, "part_num", to_ref, "design_id")
        if from_id is None or to_id is None:
            metrics.warnings += 1
            continue
        relationship_type = row.get("relationship_type") or "substitute"
        confidence = _float(row.get("confidence"))
        confidence = 0.75 if confidence is None else confidence
        now = utc_now()
        existing = connection.execute(
            "SELECT id FROM part_relationships WHERE from_design_id = ? AND to_design_id = ? AND relationship_type = ? AND source_id = ?",
            (from_id, to_id, relationship_type, source_id),
        ).fetchone()
        connection.execute(
            """
            INSERT INTO part_relationships(
                from_design_id, to_design_id, relationship_type, confidence, notes,
                source_id, last_run_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(from_design_id, to_design_id, relationship_type, source_id) DO UPDATE SET
                confidence = excluded.confidence,
                notes = excluded.notes,
                last_run_id = excluded.last_run_id,
                updated_at = excluded.updated_at
            """,
            (from_id, to_id, relationship_type, confidence, row.get("notes") or None, source_id, run_id, now, now),
        )
        entity_id = _one(connection, "SELECT id FROM part_relationships WHERE from_design_id = ? AND to_design_id = ? AND relationship_type = ? AND source_id = ?", (from_id, to_id, relationship_type, source_id))
        payload = {"from_part_num": from_ref, "to_part_num": to_ref, "relationship_type": relationship_type, "confidence": confidence, "notes": row.get("notes") or None}
        _track(connection, "part_relationship", entity_id, source_id, run_id, path, line, row, payload, existing is None, metrics)


def _import_offers(connection: sqlite3.Connection, path: Path, source_id: int, run_id: str, metrics: ImportMetrics) -> None:
    for line, row in iter_csv(path):
        metrics.rows_read += 1
        element_ref = _required(row, "element_id", path, line)
        element_id = _resolve_any(connection, "element_id", element_ref, "element_id")
        if element_id is None:
            metrics.warnings += 1
            continue
        snapshot_ref = _required(row, "snapshot_ref", path, line)
        observed_at = _required(row, "observed_at", path, line)
        now = utc_now()
        connection.execute(
            """
            INSERT INTO offer_snapshots(
                snapshot_ref, source_id, country_code, currency_code, observed_at,
                run_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_id, snapshot_ref) DO UPDATE SET
                country_code = excluded.country_code,
                currency_code = excluded.currency_code,
                observed_at = excluded.observed_at,
                run_id = excluded.run_id
            """,
            (snapshot_ref, source_id, _required(row, "country_code", path, line).upper(), _required(row, "currency_code", path, line).upper(), observed_at, run_id, now),
        )
        snapshot_id = _one(connection, "SELECT id FROM offer_snapshots WHERE source_id = ? AND snapshot_ref = ?", (source_id, snapshot_ref))
        store_id = None
        if row.get("store_ref"):
            store_id = _resolve_external_for_source(connection, source_id, "store_ref", row["store_ref"], "store_id")
        offer_ref = _required(row, "offer_ref", path, line)
        payload: dict[str, object] = {
            "snapshot_ref": snapshot_ref,
            "element_id": element_ref,
            "store_ref": row.get("store_ref") or None,
            "offer_ref": offer_ref,
            "condition": row.get("condition") or "new",
            "unit_price": _float(row.get("unit_price")),
            "quantity_available": _int(row.get("quantity_available")),
            "availability": row.get("availability") or "unknown",
            "product_url": row.get("product_url") or None,
        }
        existing = connection.execute("SELECT id FROM offers WHERE snapshot_id = ? AND external_offer_ref = ?", (snapshot_id, offer_ref)).fetchone()
        connection.execute(
            """
            INSERT INTO offers(
                snapshot_id, element_id, store_id, external_offer_ref, item_condition,
                unit_price, quantity_available, availability, product_url, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(snapshot_id, external_offer_ref) DO UPDATE SET
                element_id = excluded.element_id,
                store_id = excluded.store_id,
                item_condition = excluded.item_condition,
                unit_price = excluded.unit_price,
                quantity_available = excluded.quantity_available,
                availability = excluded.availability,
                product_url = excluded.product_url,
                updated_at = excluded.updated_at
            """,
            (snapshot_id, element_id, store_id, offer_ref, payload["condition"], payload["unit_price"], payload["quantity_available"], payload["availability"], payload["product_url"], now, now),
        )
        entity_id = _one(connection, "SELECT id FROM offers WHERE snapshot_id = ? AND external_offer_ref = ?", (snapshot_id, offer_ref))
        _track(connection, "offer", entity_id, source_id, run_id, path, line, row, payload, existing is None, metrics)


def _import_sightings(connection: sqlite3.Connection, path: Path, source_id: int, run_id: str, metrics: ImportMetrics) -> None:
    for line, row in iter_csv(path):
        metrics.rows_read += 1
        store_id = _resolve_external_for_source(connection, source_id, "store_ref", _required(row, "store_ref", path, line), "store_id")
        element_id = _resolve_any(connection, "element_id", _required(row, "element_id", path, line), "element_id")
        if store_id is None or element_id is None:
            metrics.warnings += 1
            continue
        observed_at = _required(row, "observed_at", path, line)
        reporter_ref = row.get("reporter_ref") or "anonymous"
        payload: dict[str, object] = {
            "store_ref": row["store_ref"],
            "element_id": row["element_id"],
            "observed_at": observed_at,
            "expires_at": row.get("expires_at") or None,
            "quantity_status": row.get("quantity_status") or "seen",
            "confidence": _float(row.get("confidence")) or 0.5,
            "reporter_ref": reporter_ref,
            "notes": row.get("notes") or None,
        }
        now = utc_now()
        existing = connection.execute(
            "SELECT id FROM wall_sightings WHERE source_id = ? AND store_id = ? AND element_id = ? AND observed_at = ? AND reporter_ref = ?",
            (source_id, store_id, element_id, observed_at, reporter_ref),
        ).fetchone()
        connection.execute(
            """
            INSERT INTO wall_sightings(
                source_id, store_id, element_id, observed_at, expires_at,
                quantity_status, confidence, reporter_ref, notes, last_run_id,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_id, store_id, element_id, observed_at, reporter_ref) DO UPDATE SET
                expires_at = excluded.expires_at,
                quantity_status = excluded.quantity_status,
                confidence = excluded.confidence,
                notes = excluded.notes,
                last_run_id = excluded.last_run_id,
                updated_at = excluded.updated_at
            """,
            (source_id, store_id, element_id, observed_at, payload["expires_at"], payload["quantity_status"], payload["confidence"], reporter_ref, payload["notes"], run_id, now, now),
        )
        entity_id = _one(connection, "SELECT id FROM wall_sightings WHERE source_id = ? AND store_id = ? AND element_id = ? AND observed_at = ? AND reporter_ref = ?", (source_id, store_id, element_id, observed_at, reporter_ref))
        _track(connection, "wall_sighting", entity_id, source_id, run_id, path, line, row, payload, existing is None, metrics)


def _resolve_any(connection: sqlite3.Connection, namespace: str, external_id: str, column: str) -> int | None:
    if column not in {"design_id", "color_id", "element_id", "store_id"}:
        raise ValueError("Invalid target column")
    row = connection.execute(
        f"SELECT {column} FROM external_identifiers WHERE namespace = ? AND external_id = ? AND {column} IS NOT NULL ORDER BY id LIMIT 1",
        (namespace, external_id),
    ).fetchone()
    return None if row is None else int(row[0])


def _resolve_external_for_source(connection: sqlite3.Connection, source_id: int, namespace: str, external_id: str, column: str) -> int | None:
    if column not in {"design_id", "color_id", "element_id", "store_id"}:
        raise ValueError("Invalid target column")
    row = connection.execute(
        f"SELECT {column} FROM external_identifiers WHERE source_id = ? AND namespace = ? AND external_id = ?",
        (source_id, namespace, external_id),
    ).fetchone()
    return None if row is None or row[0] is None else int(row[0])


def _required(row: Mapping[str, str], field: str, path: Path, line: int) -> str:
    value = row.get(field, "").strip()
    if not value:
        raise ValueError(f"{path.name}:{line}: required field '{field}' is empty")
    return value


def _float(value: str | None) -> float | None:
    return None if value is None or not value.strip() else float(value)


def _int(value: str | None) -> int | None:
    return None if value is None or not value.strip() else int(value)


def _one(connection: sqlite3.Connection, sql: str, params: tuple[object, ...]) -> int:
    row = connection.execute(sql, params).fetchone()
    if row is None:
        raise RuntimeError("Upserted row could not be resolved")
    return int(row[0])
