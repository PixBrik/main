# Fotobrik catalog foundation

This folder contains an offline-first, versioned parts catalog that can be fed repeatedly as licensed data becomes available. It never downloads or scrapes LEGO or marketplace pages. Network acquisition is deliberately outside the importer.

The working database is SQLite for a zero-service demo. The model uses conventional keys, foreign keys, ISO-8601 timestamps, and JSON stored as text so the same entities transfer cleanly to PostgreSQL (where `TEXT` JSON/timestamps can become `jsonb` and `timestamptz`).

## What is represented

- `part_designs`: a shape/mould-level part, separate from color.
- `elements`: a purchasable design + color variant, with room for material and decoration.
- `colors` and source-namespaced `external_identifiers`.
- `geometry_metadata`: stud/plate and millimetre dimensions, mass, LDraw reference, mesh URI, and connection metadata.
- `part_relationships`: print, mould, assembly, alternate, compatibility, and substitution edges.
- `catalog_sets` and `set_appearances`: evidence used by the basic rarity model.
- `offer_snapshots` and `offers`: country/currency-specific observations, never timeless stock claims.
- `stores` and expiring `wall_sightings`: reported physical availability with confidence and TTL.
- `catalog_runs`, `record_provenance`, and `record_versions`: input digest, upstream version, raw-row origin, and slowly changing state history.
- `rarity_scores`: reproducible snapshots. Rarity is color-specific for elements and is not a guarantee of value or availability.

The complete schema is in [`fotobrik_catalog/schema.sql`](fotobrik_catalog/schema.sql).

## Run the offline demo

Python 3.11+ is enough; there are no runtime dependencies.

```powershell
cd C:\dev\Fotobrik\catalog
python -m fotobrik_catalog sample --db .\demo.sqlite3
python -m fotobrik_catalog stats --db .\demo.sqlite3
python -m fotobrik_catalog export --db .\demo.sqlite3 --output .\demo-elements.jsonl
python -m fotobrik_catalog check --db .\demo.sqlite3
```

The bundled sample is intentionally synthetic/offline. Store names, observations, offers, URLs, and set records are demo data; `.invalid` links cannot be mistaken for real purchasing links.

The optional command-line installation is:

```powershell
python -m pip install -e .
fotobrik-catalog --help
```

## Import real feed files

Download and retain upstream files through a permitted, documented process. Point the importer at a local directory; it recognizes either plain CSV or individually gzipped CSV names:

- Required: `part_categories.csv(.gz)`, `colors.csv(.gz)`, `parts.csv(.gz)`
- Optional: `elements`, `part_relationships`, `sets`, `inventories`, and either `inventory_parts` or `inventories_parts`

```powershell
python -m fotobrik_catalog init --db .\catalog.sqlite3
python -m fotobrik_catalog import `
  --db .\catalog.sqlite3 `
  --input D:\licensed-feeds\rebrickable\2026-07-14 `
  --source-version 2026-07-14 `
  --source-uri s3://fotobrik-raw/rebrickable/2026-07-14/
python -m fotobrik_catalog rarity --db .\catalog.sqlite3
```

`source-uri` is provenance text only; the importer never fetches it. Every run receives a UUID, file-bundle SHA-256 digest, timestamps, counters, status, and source version. Re-importing identical files creates a new auditable run/provenance observation but does not duplicate catalog records or state versions. Changed normalized payloads close the prior `record_versions` row and open a new current version.

Fotobrik-owned or licensed observation files use a separate command:

```powershell
python -m fotobrik_catalog community `
  --db .\catalog.sqlite3 `
  --input D:\fotobrik-feeds\community\2026-07-14 `
  --source-version 2026-07-14T1200Z
```

Supported files and fields are demonstrated in [`fixtures/community_sample`](fixtures/community_sample):

- `geometry.csv`
- `stores.csv`
- `offers.csv`
- `wall_sightings.csv`
- `substitutions.csv`

The regular all-in-one workflow is:

```powershell
python -m fotobrik_catalog update `
  --db .\catalog.sqlite3 `
  --rebrickable D:\licensed-feeds\rebrickable\2026-07-14 `
  --community D:\fotobrik-feeds\community\2026-07-14 `
  --source-version 2026-07-14 `
  --community-version 2026-07-14T1200Z
```

The PowerShell wrapper in [`scripts/refresh-catalog.ps1`](scripts/refresh-catalog.ps1) runs that update, blocks publication on an integrity failure, and writes an app/search JSONL export. It is suitable for a scheduler once the input acquisition process has been licensed and approved:

```powershell
.\scripts\refresh-catalog.ps1 `
  -PartsFeed D:\licensed-feeds\rebrickable\2026-07-14 `
  -CommunityFeed D:\fotobrik-feeds\community\2026-07-14 `
  -SourceVersion 2026-07-14 `
  -CommunityVersion 2026-07-14T1200Z
```

Run `check` before publishing and `export --format jsonl` for streaming app/search ingestion, or `export --format csv` for inspection. Export is one row per element and includes design, color, preferred geometry, and current rarity.

## Suggested update policy

- Parts/design/color metadata: weekly when an upstream release changes.
- Authorized marketplace offers: daily or more often only within API terms and rate limits.
- Community wall sightings: event-driven, always with `observed_at`, `expires_at`, and confidence.
- Publish immutable dated artifacts only after integrity checks; retain the raw licensed bundle in access-controlled storage and associate its URI/digest with the run.

Do not infer that a stale offer or wall sighting is current. The application layer should select the newest offer snapshot for the user's country and suppress expired sightings.

## Rarity v1

`appearance-market-v1` scores 0–100 using distinct set appearances, total set quantity, and quantity in each source/country's newest offer snapshot. Higher means less observed. Bands are `common`, `uncommon`, `rare`, and `very_rare`.

This is a useful sorting signal, not a collector appraisal. Missing data increases the score, so the UI should expose the evidence counts and label low-evidence results. Future versions can add production years, price depth, regional supply, and source coverage without overwriting old rarity snapshots.

## Tests

```powershell
python -m unittest discover -s tests -v
```

Tests cover schema integrity, plain and `.csv.gz` imports, idempotent re-import, changed-record version history, community observations, rarity, JSONL/CSV exports, and every main CLI workflow.
