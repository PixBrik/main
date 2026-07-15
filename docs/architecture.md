# Architecture and source guardrails

Status: foundation decision record, 2026-07-14.

## Non-negotiable principles

1. Fotobrik owns its internal model and identity. A provider ID is an alias, never the primary key.
2. Catalog facts and commerce observations are different data. A known element can exist without being for sale; an offer is valid only at its observed time.
3. Every imported fact retains its source, source version, import run, and observation time.
4. A generated build pins the catalog view that produced it so it can be reproduced later.
5. Country changes routing and availability, not part identity.
6. Photos are user content, not training data by default.
7. No website scraping, credential sharing, or source activation without a recorded terms/licence review.

## Logical system

    iOS / Android client
            |
        Mobile API
       /    |     \
    Projects Catalog Build jobs
       |       |       |
    Object   Published  Capture analysis
    storage  catalog    -> shape proposal
                       -> part optimiser
                       -> stability checks
                       -> preview / BOM / steps
                               |
                        Purchase-route service
                        (country + fresh observations)

Catalog ingestion is a separate administrative path:

    approved local feed
        -> immutable raw snapshot + digest
        -> source-specific staging
        -> validation and quarantine
        -> normalized records + provenance
        -> approved immutable release

The current catalog foundation imports local Rebrickable CSV or CSV.GZ files; it does not download, scrape, or call a marketplace. Build analysis, live offers, checkout, store inventory, and mobile sync remain proposed components.

## Component contracts

The initial API should expose these concepts, even if the demo uses local fixtures:

- **Project:** photo references, country, user brief, and retention state.
- **Build job:** queued, analysing, proposing, checking, ready, or failed.
- **Build result:** pinned catalog release, assumptions, metrics, variants, BOM, and ordered steps.
- **Part:** Fotobrik public ID, design/element facts, dimensions, colours, aliases, provenance, and build-safety status.
- **Purchase route:** provider, country, destination URL, observation time, and stock-confidence label.

Suggested resource shapes:

    POST /v1/projects
    POST /v1/projects/{projectId}/captures
    POST /v1/projects/{projectId}/builds
    GET  /v1/builds/{buildId}
    GET  /v1/builds/{buildId}/parts
    GET  /v1/builds/{buildId}/purchase-routes?country=FR
    GET  /v1/catalog/releases/current
    GET  /v1/parts/{publicPartId}?release=2026.07.14.1

Long-running work must use an idempotency key and return a job identifier. Purchase-route responses must never be cached beyond the underlying observation's expiry.

## Source and licence gates

This matrix is a research queue, not a declaration that an integration is approved.

| Candidate | Intended role | Foundation stance | Required before production |
|---|---|---|---|
| Rebrickable CSV/API | Core names, categories, mappings, set appearances | Local CSV adapter only; no automatic download | Confirm commercial use, attribution, image reuse, retention, redistribution, and rate/bulk rules in writing or counsel-reviewed terms |
| LDraw official library | Geometry and rendering inputs | Candidate only | Record library/version per asset; implement required attribution; verify licence obligations for modified files, redistribution, and rendered output |
| Brick Owl API/catalog | Offers, country routes, identifiers | Disabled | Obtain API access and written confirmation that Fotobrik's link-out model is permitted; assess ODbL share-alike boundaries; attribute; never scrape |
| BrickLink API/handoff | IDs, catalog facts, price observations, wanted-list handoff | Disabled | Approve credentials, permitted endpoints, caching, attribution, freshness, and handoff UX; do not assume complete mappings |
| LEGO websites/services | Official retail route or store directory | No automated ingestion | Written authorization is required before site content is used for AI purposes; separately review commercial copying, trademarks, deep links, and local terms |
| Community store sightings | Time-limited physical-wall hints | Proposed | Moderation, contributor terms, evidence, expiry, abuse controls, and clear unverified labelling |
| Fotobrik-authored data | Connectivity, substitutions, safety annotations | Preferred owned layer | Document author/reviewer, test evidence, version, and change history |

Official references to review and snapshot in each source record:

- Rebrickable API guidance: https://rebrickable.com/api/v3/docs/
- LDraw legal information: https://www.ldraw.org/legal-info
- Brick Owl API and terms: https://www.brickowl.com/api_docs and https://www.brickowl.com/terms
- BrickLink API: https://www.bricklink.com/v3/api.page
- LEGO terms of use: https://www.lego.com/en-us/legal/terms-of-use

Terms can change. Store the reviewed URL, review date, reviewer, relevant product use, obligations, prohibited uses, and next review date. A passing review for textual catalog data does not automatically approve images, geometry, prices, logos, or user data.

## Integration kill switch

Every source adapter must be independently disableable. Disabling a source must:

- stop future fetches and purchase routing;
- retain only data the recorded licence permits retaining;
- keep builds reproducible through an allowed internal snapshot or mark them unavailable;
- show a neutral unavailable state rather than silently substituting stale stock.

## Photo and child-safety baseline

- Strip EXIF location before durable storage.
- Encrypt upload and storage; use non-guessable object keys.
- Default to deleting the source photo after the build or a short disclosed recovery window.
- Do not train or fine-tune on uploads without separate, explicit, revocable consent.
- Let the user delete a project and its derived imagery.
- Detect and block clearly unsafe or disallowed capture content before processing.
- Complete GDPR, age-assurance, parental-consent, and jurisdiction review before marketing to children.

## Honest-result rules

The UI must distinguish:

- **Catalogued:** present in a pinned approved catalog view.
- **Estimated:** inferred dimension, quantity, colour, price, or structure.
- **Observed:** marketplace or store data with an as-of time.
- **Unverified:** community or physical-store report without retailer confirmation.
- **Demo:** fixture data that must never look live.

No screen may claim “in stock,” “available near you,” or a final total unless the provider, destination country, timestamp, and freshness policy support that wording.

