# Fotobrik

Fotobrik is a standalone foundation for turning an object photo into an original interlocking-brick build plan: variations, a bill of materials, country-aware buying routes, nearby-store observations, and guided assembly.

This repository is intentionally independent from every pre-existing project. Its working location is `C:\dev\Fotobrik`.

## What is ready

- A provenance-aware SQLite catalog with normalized designs, colour-specific elements, dimensions, relationships, set appearances, time-stamped offers, stores, wall sightings, rarity, source runs, and record history.
- Repeatable local CSV/CSV.GZ imports, offline fixtures, integrity checks, rarity calculation, and JSONL/CSV exports.
- A distinctive Expo prototype for iOS, Android, and web with the original **Signal Workshop** visual language and interactive 3D preview.
- A complete ten-screen demo: capture choice → demo camera → build preferences → processing → variations → parts → country-aware routes → stores → instructions.
- Product architecture, data/licensing guardrails, catalog operations, demo script, and an MVP backlog.

The current photo analysis, generated model, prices, matches, and store contents are clearly labelled demo fixtures. No live AI, retailer, marketplace, or store-stock integration is implied.

## Project map

```text
Fotobrik/
├─ apps/mobile/          Expo iOS/Android/web prototype
├─ catalog/              Catalog schema, importer, CLI, fixtures, and tests
├─ docs/                 Product, architecture, identity, and demo documentation
└─ scripts/              Whole-project verification
```

## Run the mobile demo

Requirements: Node.js 22+ and npm.

```powershell
cd C:\dev\Fotobrik\apps\mobile
npm install
npm run web
```

Use `npm run ios` or `npm run android` when an appropriate simulator/device is available. The complete walkthrough is in [docs/demo-script.md](docs/demo-script.md).

## Build the sample catalog

Requirements: Python 3.11+; runtime dependencies are standard-library only.

If Python is not on `PATH`, set `FOTOBRIK_PYTHON` to its executable before using the PowerShell helpers.

```powershell
cd C:\dev\Fotobrik\catalog
python -m fotobrik_catalog sample --db .\demo.sqlite3
python -m fotobrik_catalog stats --db .\demo.sqlite3
python -m fotobrik_catalog check --db .\demo.sqlite3
python -m fotobrik_catalog export --db .\demo.sqlite3 --output .\demo-elements.jsonl
```

For recurring approved feeds, use `catalog/scripts/refresh-catalog.ps1` or the equivalent `python -m fotobrik_catalog update` command. Acquisition stays outside the importer: only locally supplied, permitted feed files are read.

## Verify everything

```powershell
cd C:\dev\Fotobrik
.\scripts\verify.ps1
```

Or run the suites independently:

```powershell
cd catalog
python -m unittest discover -s tests -v

cd ..\apps\mobile
npm run check
npx expo-doctor
```

Start with [docs/README.md](docs/README.md) for the full handoff and [catalog/README.md](catalog/README.md) for the data contract and update workflow.
