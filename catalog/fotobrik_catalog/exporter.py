from __future__ import annotations

import csv
import json
import sqlite3
from pathlib import Path
from typing import Iterator


EXPORT_FIELDS = (
    "element_ref",
    "element_external_id",
    "design_ref",
    "part_num",
    "part_name",
    "category",
    "material",
    "color_ref",
    "color_external_id",
    "color_name",
    "rgb_hex",
    "is_transparent",
    "width_studs",
    "depth_studs",
    "height_plates",
    "rarity_score",
    "rarity_band",
    "distinct_set_count",
    "active_offer_quantity",
)


def iter_export_rows(connection: sqlite3.Connection) -> Iterator[dict[str, object]]:
    query = """
        SELECT e.canonical_ref AS element_ref,
               ee.external_id AS element_external_id,
               d.canonical_ref AS design_ref,
               de.external_id AS part_num,
               d.name AS part_name,
               pc.name AS category,
               COALESCE(e.material, d.material) AS material,
               c.canonical_ref AS color_ref,
               ce.external_id AS color_external_id,
               c.name AS color_name,
               c.rgb_hex,
               c.is_transparent,
               g.width_studs, g.depth_studs, g.height_plates,
               r.score AS rarity_score, r.band AS rarity_band,
               r.distinct_set_count, r.active_offer_quantity
        FROM elements e
        JOIN part_designs d ON d.id = e.design_id
        JOIN colors c ON c.id = e.color_id
        LEFT JOIN part_categories pc ON pc.id = d.category_id
        LEFT JOIN external_identifiers ee
               ON ee.element_id = e.id AND ee.namespace = 'element_id'
        LEFT JOIN external_identifiers de
               ON de.design_id = d.id AND de.namespace = 'part_num'
        LEFT JOIN external_identifiers ce
               ON ce.color_id = c.id AND ce.namespace = 'color_id'
        LEFT JOIN geometry_metadata g ON g.id = (
            SELECT g2.id FROM geometry_metadata g2
            WHERE g2.design_id = d.id
            ORDER BY CASE g2.geometry_status WHEN 'verified' THEN 0 WHEN 'sample' THEN 1 ELSE 2 END,
                     g2.updated_at DESC LIMIT 1
        )
        LEFT JOIN rarity_scores r ON r.element_id = e.id AND r.is_current = 1
        ORDER BY d.canonical_ref, c.canonical_ref, e.canonical_ref
    """
    cursor = connection.execute(query)
    for row in cursor:
        result = dict(row)
        result["is_transparent"] = bool(result["is_transparent"])
        yield result


def export_catalog(connection: sqlite3.Connection, output: str | Path, *, output_format: str = "jsonl") -> int:
    """Export a stable, denormalized element view for app/search ingestion."""
    destination = Path(output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    if output_format == "jsonl":
        with destination.open("w", encoding="utf-8", newline="\n") as handle:
            for row in iter_export_rows(connection):
                handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
                count += 1
    elif output_format == "csv":
        with destination.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=EXPORT_FIELDS)
            writer.writeheader()
            for row in iter_export_rows(connection):
                writer.writerow(row)
                count += 1
    else:
        raise ValueError("output_format must be 'jsonl' or 'csv'")
    return count
