from __future__ import annotations

import math
import sqlite3
from dataclasses import dataclass

from .db import utc_now

ALGORITHM_VERSION = "appearance-market-v1"


@dataclass(frozen=True)
class RarityResult:
    design_scores: int
    element_scores: int
    algorithm_version: str = ALGORITHM_VERSION


def score_rarity(set_count: int, set_quantity: int, offer_quantity: int) -> tuple[float, str]:
    """Return a 0-100 evidence score; higher means harder to source."""
    set_component = 72.0 if set_count == 0 else min(70.0, 58.0 / math.sqrt(set_count))
    quantity_component = 18.0 if set_quantity == 0 else min(18.0, 18.0 / math.sqrt(set_quantity))
    market_component = 10.0 if offer_quantity == 0 else min(10.0, 10.0 / math.sqrt(offer_quantity))
    score = round(min(100.0, set_component + quantity_component + market_component), 2)
    if score < 30:
        band = "common"
    elif score < 55:
        band = "uncommon"
    elif score < 80:
        band = "rare"
    else:
        band = "very_rare"
    return score, band


def compute_rarity(connection: sqlite3.Connection, *, run_id: str | None = None) -> RarityResult:
    """Snapshot design- and color-specific rarity from set and latest-offer evidence."""
    if run_id is None:
        row = connection.execute(
            "SELECT id FROM catalog_runs WHERE status = 'succeeded' ORDER BY finished_at DESC, id DESC LIMIT 1"
        ).fetchone()
        run_id = None if row is None else str(row[0])
    now = utc_now()
    connection.execute("UPDATE rarity_scores SET is_current = 0 WHERE is_current = 1")

    design_rows = connection.execute(
        """
        WITH appearance AS (
            SELECT design_id,
                   COUNT(DISTINCT CASE WHEN is_spare = 0 THEN set_id END) AS set_count,
                   COALESCE(SUM(CASE WHEN is_spare = 0 THEN quantity ELSE 0 END), 0) AS set_quantity
            FROM set_appearances GROUP BY design_id
        ),
        latest AS (
            SELECT source_id, country_code, MAX(observed_at) AS observed_at
            FROM offer_snapshots GROUP BY source_id, country_code
        ),
        current_offers AS (
            SELECT o.* FROM offers o
            JOIN offer_snapshots s ON s.id = o.snapshot_id
            JOIN latest l ON l.source_id = s.source_id
                         AND l.country_code = s.country_code
                         AND l.observed_at = s.observed_at
        ),
        market AS (
            SELECT e.design_id,
                   COUNT(o.id) AS offer_count,
                   COALESCE(SUM(CASE WHEN o.availability IN ('in_stock', 'limited')
                                     THEN COALESCE(o.quantity_available, 0) ELSE 0 END), 0) AS offer_quantity
            FROM current_offers o
            JOIN elements e ON e.id = o.element_id
            GROUP BY e.design_id
        )
        SELECT d.id,
               COALESCE(a.set_count, 0), COALESCE(a.set_quantity, 0),
               COALESCE(m.offer_count, 0), COALESCE(m.offer_quantity, 0)
        FROM part_designs d
        LEFT JOIN appearance a ON a.design_id = d.id
        LEFT JOIN market m ON m.design_id = d.id
        ORDER BY d.id
        """
    ).fetchall()
    for design_id, set_count, set_quantity, offer_count, offer_quantity in design_rows:
        score, band = score_rarity(int(set_count), int(set_quantity), int(offer_quantity))
        connection.execute(
            """
            INSERT INTO rarity_scores(
                design_id, score, band, distinct_set_count, total_set_quantity,
                active_offer_count, active_offer_quantity, algorithm_version,
                computed_at, run_id, is_current
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            """,
            (design_id, score, band, set_count, set_quantity, offer_count, offer_quantity, ALGORITHM_VERSION, now, run_id),
        )

    element_rows = connection.execute(
        """
        WITH appearance AS (
            SELECT design_id, color_id,
                   COUNT(DISTINCT CASE WHEN is_spare = 0 THEN set_id END) AS set_count,
                   COALESCE(SUM(CASE WHEN is_spare = 0 THEN quantity ELSE 0 END), 0) AS set_quantity
            FROM set_appearances GROUP BY design_id, color_id
        ),
        latest AS (
            SELECT source_id, country_code, MAX(observed_at) AS observed_at
            FROM offer_snapshots GROUP BY source_id, country_code
        ),
        current_offers AS (
            SELECT o.* FROM offers o
            JOIN offer_snapshots s ON s.id = o.snapshot_id
            JOIN latest l ON l.source_id = s.source_id
                         AND l.country_code = s.country_code
                         AND l.observed_at = s.observed_at
        ),
        market AS (
            SELECT element_id, COUNT(id) AS offer_count,
                   COALESCE(SUM(CASE WHEN availability IN ('in_stock', 'limited')
                                     THEN COALESCE(quantity_available, 0) ELSE 0 END), 0) AS offer_quantity
            FROM current_offers GROUP BY element_id
        )
        SELECT e.id,
               COALESCE(a.set_count, 0), COALESCE(a.set_quantity, 0),
               COALESCE(m.offer_count, 0), COALESCE(m.offer_quantity, 0)
        FROM elements e
        LEFT JOIN appearance a ON a.design_id = e.design_id AND a.color_id = e.color_id
        LEFT JOIN market m ON m.element_id = e.id
        ORDER BY e.id
        """
    ).fetchall()
    for element_id, set_count, set_quantity, offer_count, offer_quantity in element_rows:
        score, band = score_rarity(int(set_count), int(set_quantity), int(offer_quantity))
        connection.execute(
            """
            INSERT INTO rarity_scores(
                element_id, score, band, distinct_set_count, total_set_quantity,
                active_offer_count, active_offer_quantity, algorithm_version,
                computed_at, run_id, is_current
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            """,
            (element_id, score, band, set_count, set_quantity, offer_count, offer_quantity, ALGORITHM_VERSION, now, run_id),
        )
    connection.commit()
    return RarityResult(len(design_rows), len(element_rows))
