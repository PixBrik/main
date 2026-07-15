# Catalog operations

## What the catalog must answer

For any build the catalog should eventually answer:

- What physical design is this?
- Which colour, material, decoration, and mould variant is intended?
- What are its reliable dimensions and connection points?
- Which external references describe the same or a related item?
- Can the optimiser safely use it, and what can substitute for it?
- How common or rare is this exact variant in a pinned catalog view?
- Where was it observed for sale for a destination country, and when?

Unknown facts remain null with provenance; they are not guessed from a part name.

## Normalized model

The current SQLite foundation maps cleanly to a future PostgreSQL service:

| Entity | Purpose |
|---|---|
| part_designs | Shape-level record independent of colour |
| elements | Design plus colour, material, and decoration |
| colors | Canonical Fotobrik colour plus source mappings |
| external_identifiers | Namespaced provider IDs for any entity |
| geometry_metadata | Units, bounding box, asset reference, checksum, and validation state |
| part_relationships | Alias, variant, replacement, print, assembly, or other typed relation |
| catalog_sets / set_appearances | Evidence that an element or design appeared in a set |
| stores | Provider-scoped store identity and location facts |
| offer_snapshots / offers | Time-stamped, destination-aware commerce observations |
| wall_sightings | Community or retailer observations with an explicit expiry |
| rarity_scores | Derived score with algorithm version and catalog context |
| catalog_runs | Import source, source version, digest, timestamps, and status |
| record_versions / record_provenance | Slowly changing fact history plus source file/row evidence |

Catalog metadata, geometry, connectivity, and offers evolve independently. A price update must not create a new part.

## Identifier strategy

### Internal database IDs

Version 1 uses integer keys for compact joins and portability to PostgreSQL sequences. They are implementation details and must never appear in shared links or mobile API contracts.

### External identifiers

Each identifier is namespaced and points to exactly one supported entity type:

    source = rebrickable
    namespace = part
    target = design
    external_id = 3001

The version 1 uniqueness boundary is source + namespace + external ID. The target is one of design, element, colour, or store. The same text in another namespace is not assumed equivalent. Source IDs are preserved exactly as text, including leading zeroes, suffixes, and case where meaningful.

### Public Fotobrik IDs

Before an external API ships, add an immutable opaque public ID for designs, elements, colours, stores, and builds. Recommended form:

    fbk_d_01J...
    fbk_e_01J...
    fbk_c_01J...

Persist the value; do not derive it from a provider ID or mutable attributes. UUIDv7 or ULID payloads are suitable. Merging records keeps one canonical public ID and creates an explicit redirect from the retired ID.

### Design versus element

A design describes geometry. An element describes a specific observed combination of:

- design;
- canonical colour;
- material when known;
- decoration or print when known;
- mould/geometry revision when it changes compatibility.

An official “element ID” or marketplace item number is stored as an external identifier. It is evidence, not the Fotobrik element key.

### Merge rules

Automatic merging is allowed only when an approved mapping source asserts equivalence or all of the following match: validated geometry revision, colour/material/decoration, and a reviewed cross-reference. Name similarity alone never merges parts.

Conflicts create a review item. Corrections are versioned; records are retired or redirected, not hard-deleted.

## Dimensions and connectivity

Store metric dimensions as the canonical numeric values and optional stud/plate convenience values:

- bounding box x/y/z in millimetres;
- nominal stud width/depth and plate height when meaningful;
- mass in grams when sourced;
- coordinate-system and unit metadata for geometry;
- connection points with type, position, orientation, tolerance, and test status.

Every value carries source/run provenance and confidence: reported, geometry-derived, measured, or estimated. Only reviewed connectivity and geometry may enter the build-safe optimiser pool.

## Import and publication workflow

1. **Register:** create a catalog run UUID with source, source version, terms-review reference, and expected files.
2. **Snapshot:** keep the original local input unchanged and record a SHA-256 digest.
3. **Stage:** parse into source-shaped staging tables; never normalize during parsing.
4. **Validate:** check schema, encodings, required files, uniqueness, references, enums, and numeric ranges.
5. **Normalize:** upsert through source-namespaced mappings and write record versions.
6. **Compare:** produce counts for added, changed, retired, conflicted, and quarantined records.
7. **Review:** require a human for unexpected volume shifts, ambiguous merges, licence changes, and geometry conflicts.
8. **Publish:** atomically promote an immutable catalog release pointer.
9. **Verify:** run known-ID, relationship, colour, BOM, and reproducibility smoke tests.
10. **Report:** retain the manifest, validation report, reviewer, timestamps, and rollback target.

The current foundation implements run tracking and local Rebrickable CSV normalization. Formal immutable release rows and promotion tooling are the next catalog milestone.

## Release and cadence policy

Use CalVer for approved catalog views:

    YYYY.MM.DD.N

N increments when more than one release is approved on the same UTC date. A release is immutable. A build stores its release ID; “current” is only an atomic pointer.

Planned cadence after each source is approved:

| Data class | Target cadence | Publication rule |
|---|---|---|
| Core metadata and mappings | Weekly delta/import | Publish only after validation and change review |
| Full reconciliation | Monthly | Compare all source records and repair drift; never erase unresolved conflicts |
| Geometry/connectivity | As reviewed | Publish only assets/checks that pass build-safe gates |
| Authorized offer feeds | Daily or provider-supported cadence | Separate observed-at snapshots and TTL; never overwrite history |
| Community wall sightings | Event-driven | Short explicit expiry; display as unverified |
| Terms/licence review | Quarterly and before adapter changes | Disable affected adapter if review is overdue or terms are incompatible |

Until an adapter is approved, use versioned fixtures. Fixture releases use the prefix demo- and cannot be promoted to production.

## Validation gates

A release fails closed when:

- a required file or digest is missing;
- referential integrity fails;
- an external ID maps to multiple canonical records without an approved relationship;
- a destructive change exceeds its reviewed threshold;
- colour/material/decoration would be lost during normalization;
- geometry has unknown units or a checksum mismatch;
- a source's terms review is missing or expired;
- the smoke-test BOM cannot be reproduced from the candidate release.

Quarantined rows do not block unrelated valid records unless they break an identity mapping used by an existing build.

## Rarity and availability

Rarity is derived for an exact element, algorithm version, region, and catalog release. Inputs may include appearance frequency, recency, number of fresh offers, and observed quantity. Display the contributing signals; never present “rare” as an intrinsic permanent fact.

Availability is an observation, never a property of an element. Keep:

- provider and seller/store;
- destination country and seller country;
- condition and currency;
- unit price, observed quantity, and minimum lot when supplied;
- observed_at, expires_at, source run, and destination URL;
- confidence label and any provider caveat.

Expired observations remain available for audit but are excluded from current purchase results.
