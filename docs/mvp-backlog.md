# MVP backlog and acceptance criteria

## Release goal

Prove that a user can move from one photo to an honest, understandable brick-build proposal, inspect a reproducible bill of materials, compare variants, and reach clearly labelled country-aware purchase handoffs or exports.

MVP is complete only when the full story works with a versioned approved catalog or a visibly labelled demo catalog. Live marketplace, official-store, and physical-wall integrations are not required.

## P0 — Governance and foundation

### F0.1 Independent product identity

Acceptance criteria:

- Signal Workshop tokens, persistent branding, and layout rules are implemented in a shared mobile theme.
- App icon, wordmark, icons, renders, and sample photography are original and documented.
- A brand/IP review records prohibited assets and approved compatibility wording.
- No screen implies official status or sponsorship.

### F0.2 Privacy-safe projects

Acceptance criteria:

- Upload requires an explicit user action and a disclosed purpose.
- EXIF location is removed before durable storage.
- Project deletion removes source and derived user imagery according to a tested retention job.
- Training consent is absent by default and separate if introduced.

### F0.3 Source register and adapter kill switches

Acceptance criteria:

- Every adapter has owner, reviewed terms URL/date, permitted fields/use, attribution, retention, credentials, and next review.
- An unapproved or overdue adapter cannot run in production.
- Disabling one adapter removes its current purchase routes without breaking catalog browsing.

## P1 — Catalog

### F1.1 Reproducible local import

Acceptance criteria:

- Import accepts only explicitly supplied, supported CSV or CSV.GZ fixtures/feed files.
- Each run records UUID, source version, SHA-256 digest, start/end, status, counts, and errors.
- Re-running identical input is idempotent and does not duplicate canonical records.
- A failed run cannot partially publish.

### F1.2 Normalized identity

Acceptance criteria:

- Design, element, colour, material, and decoration are not collapsed.
- External IDs are source-namespaced and preserve their original text.
- Ambiguous mappings are quarantined rather than guessed.
- Retired/merged records keep history and redirect evidence.

### F1.3 Catalog publication

Acceptance criteria:

- Approved views receive immutable CalVer IDs.
- The current pointer updates atomically and can roll back.
- A build pins one release and reproduces the same BOM after a newer release.
- Validation and change reports are retained with the release.

### F1.4 Build-safe subset

Acceptance criteria:

- An initial common-parts subset has validated dimensions, geometry units/checksums, and reviewed connections.
- Unknown or unreviewed parts are excluded from automatic structure generation.
- Each included part has at least one deterministic render and substitution policy.

## P2 — Mobile journey

### F2.1 Capture and subject confirmation

Acceptance criteria:

- Camera/library, retake, crop, subject choice, and cancel work on supported iOS and Android targets.
- The user sees privacy/retention information before upload.
- Low confidence triggers a choice or recovery prompt; it never silently selects a subject.

### F2.2 Build brief

Acceptance criteria:

- User can choose size, priority, palette, and country in plain language.
- Country is editable and stored per build, not assumed permanently from locale.
- The screen gives an approximate range and labels it as an estimate.

### F2.3 Result and variants

Acceptance criteria:

- Result shows preview, dimensions, pieces, difficulty, assumptions, and catalog version.
- Efficient, Balanced, and Detailed variants describe their trade-off.
- Preview remains understandable without 3D gestures.
- Back/foreground and app restart preserve a ready result.

### F2.4 Accessible navigation

Acceptance criteria:

- Linear pre-result flow and 3D/Parts/Source/Build post-result dock pass screen-reader navigation.
- Dynamic type does not clip actions or path labels.
- Touch targets meet platform guidance and essential text meets WCAG AA.
- Reduced-motion mode completes every flow.

## P3 — Build proposal

### F3.1 Deterministic demo pipeline

Acceptance criteria:

- Prepared sample input produces a versioned, deterministic result with no network.
- Progress explicitly says Demo simulation.
- Counts, dimensions, variants, BOM, and steps are reproducible in automated tests.

### F3.2 Honest photo interpretation

Acceptance criteria:

- A one-photo result discloses hidden-surface and scale assumptions.
- User can correct orientation and target size.
- Unsupported geometry returns a recovery option such as mosaic/bas-relief or a clear failure.

### F3.3 BOM and substitutions

Acceptance criteria:

- BOM rows contain public Fotobrik ID, design/element distinction, colour, quantity, and provenance/confidence.
- Totals match Preview and Build steps exactly.
- A substitution re-runs connection/collision checks and produces a new result revision.

### F3.4 Instructions

Acceptance criteria:

- Every BOM item is introduced exactly as many times as its required quantity.
- Steps have a deterministic order, highlighted additions, text alternative, and resumable progress.
- No build is labelled structurally safe without the defined validation checks.

## P4 — Purchase routes

### F4.1 Country-aware route contract

Acceptance criteria:

- Request requires destination country.
- Result includes provider, condition, currency, observed_at, expires_at, and confidence.
- Expired or wrong-country observations cannot appear as current.
- No-result state preserves BOM and export options.

### F4.2 Export

Acceptance criteria:

- CSV and JSON exports contain Fotobrik IDs, quantities, colours, optional approved external IDs, catalog release, and schema version.
- Re-import reproduces the same BOM.
- Provider-specific formats are enabled only after their terms and format are approved.

### F4.3 Nearby stores

Acceptance criteria:

- A store directory and exact wall contents are separate facts.
- Wall sightings require evidence/source, observed time, and expiry.
- Without fresh exact data, copy says “contents unverified”; it never implies guaranteed stock.

## Suggested delivery slices

1. **Foundation:** local catalog import, source register, public-ID migration, demo fixtures, mobile tokens.
2. **Clickable story:** Home through Reveal with deterministic result.
3. **Useful result:** variants, reconciled BOM, substitutions, and steps.
4. **Honest routes:** country contract, export, demo purchase/store cards.
5. **Pilot hardening:** accessibility, privacy deletion, telemetry, offline/retry, release rollback, and legal sign-off.

## Definition of done

For every shipped story:

- acceptance criteria have automated tests where feasible and a recorded manual device check otherwise;
- fixtures and screenshots contain no unapproved third-party imagery or marks;
- analytics contain no raw photos, external credentials, or unnecessary precise location;
- error, empty, stale, offline, and permission-denied states are designed;
- source provenance and freshness survive API-to-UI transformation;
- copy is localized-ready and never overstates certainty;
- security, accessibility, privacy, and licence checks pass before release.

## Explicitly after MVP

- General one-photo 3D reconstruction for arbitrary objects
- Multi-angle/orbit capture
- Broad advanced-technique and moving-part solver
- Guaranteed structural engineering
- Live seller carts or marketplace checkout
- Exact physical store-bin inventory
- Community moderation at scale
- Child-directed launch

