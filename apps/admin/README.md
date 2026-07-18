# PixBrik commerce and operations console

This application is the isolated foundation for PixBrik's desktop admin and secure customer portal. It intentionally does not modify or replace the Expo buyer application.

## Included in this scaffold

- A desktop-first operations shell with launch-readiness and module views.
- A fail-closed, provider-neutral authentication/authorization boundary.
- Server-side permission checks for every protected layout.
- PostgreSQL migrations for identity, RBAC, markets, shipping, EUR-based FX, builds and immutable build versions, orders, payments, invoices, coupons, checkout recovery, contact requests, localized messaging, analytics and audit events.
- Append-only inventory movements and reservations, affiliate attribution/commissions/payouts, consent-aware visitor/session/page-view facts, and auditable private export jobs.
- Seed data for English, French, Spanish, Italian and Arabic; EUR, GBP, USD, CAD and AUD; the requested markets and shipping zones; and the invited owner `sam@benisty.ca`.
- Runtime environment inspection that never returns secret values.

No tax, refund, cancellation, product-safety or trademark position is encoded as legal fact. Those policies must be reviewed by qualified counsel/accounting specialists for every market before publishing or enabling checkout.

## Local setup

Requirements: Node.js 22+, npm and PostgreSQL 15+.

```powershell
cd C:\dev\Fotobrik\apps\admin
Copy-Item .env.example .env.local
npm install
```

Provision the four separate database roles described in `docs/database-security.md`. Set `ADMIN_DATABASE_URL`, `CUSTOMER_DATABASE_URL`, `SERVICE_DATABASE_URL`, and deployment-only `MIGRATION_DATABASE_URL`, then apply migrations:

```powershell
npm run db:migrate
```

For local UI development only, set:

```env
AUTH_MODE=development
DEV_ADMIN_EMAIL=sam@benisty.ca
```

`AUTH_MODE=development` is rejected when `NODE_ENV=production`. With authentication disabled, protected routes redirect to `/sign-in`; they never become public by accident.

Then run:

```powershell
npm run dev -- --port 3001
```

## Authentication integration boundary

`src/lib/auth` separates identity verification from PixBrik authorization. Production identity must be supplied by a reviewed adapter (recommended candidates are Clerk or Auth0), while roles and permissions remain in PostgreSQL. Never make provider metadata or a route proxy the only authorization gate.

The owner row is seeded as an invitation with no external identity. After choosing the provider, link its immutable subject identifier to `pixbrik.app_user.external_subject`. The application then loads roles and permissions from the database on every authorization-sensitive request.

## Vercel environment variables

Add secret values in Vercel Project Settings, separately for Preview and Production. Do not paste keys into source control.

Required before live traffic:

- `ADMIN_DATABASE_URL` (dedicated `pixbrik_admin_runtime` login)
- `CUSTOMER_DATABASE_URL` (dedicated `pixbrik_customer_runtime` login; buyer handlers only)
- `SERVICE_DATABASE_URL` (dedicated `pixbrik_service_runtime` login; jobs/webhooks only)
- `MIGRATION_DATABASE_URL` using the provider's direct (non-pooler) endpoint, only in the controlled migration/deployment environment; never expose it to runtime functions
- the variables required by the selected identity provider
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`
- `RESEND_FROM_EMAIL=PixBrik <hello@pixbrik.com>`
- `RESEND_REPLY_TO_EMAIL=hello@pixbrik.com`
- `BLOB_READ_WRITE_TOKEN`
- `FX_PROVIDER_URL` and, when required, `FX_PROVIDER_TOKEN`
- `CRON_SECRET`

The Resend API key value starts with `re_`; create a restricted sending key for this project. Verify the selected sending domain and configure SPF, DKIM and DMARC before production. The app stores email locale, template version and provider event history so transactional messages can be audited without storing API keys.

## Money and FX rules

- Catalog and reporting prices are authoritative in EUR integer minor units.
- Daily EUR quote rates are stored with source, effective date and retrieval time.
- The exact rate and both EUR/presentment totals are frozen on an order.
- Currency conversion is never repeated for an existing order, invoice, refund or credit.
- Currency-specific rounding belongs in versioned market configuration, not UI code.

## Legal and compliance gate

The requested blanket statements such as "20% VAT only in France", "no refunds", "no cancellations" and universal liability exclusions are not implemented. Consumer, VAT, product-safety and withdrawal rights vary by destination and circumstances and cannot be waived merely through site wording. The launch dashboard keeps this work visibly blocked until reviewed policy versions are approved for each market.

The brand/trademark review should also ensure PixBrik does not suggest sponsorship or affiliation with LEGO or any other third-party brand. Product descriptions should use PixBrik-owned language, substantiated compatibility statements and appropriate notices approved by counsel.

## Migration behavior

`scripts/migrate.mjs` records an LF-normalized SHA-256 checksum for every applied migration. It refuses to continue if an already-applied migration has changed, while accepting the legacy CRLF checksum produced by the earlier Windows runner. Add a new numbered migration instead of editing an applied file.

The migrator applies the complete pending batch under one transaction-scoped PostgreSQL advisory lock, preventing concurrent deployments from racing the same DDL even when infrastructure uses transaction pooling. Configure the privileged migration credential with the provider's direct endpoint anyway: migration DDL must not depend on a runtime pooler's statement support, timeouts or routing. Migration files must remain transaction-safe (for example, do not use `CREATE INDEX CONCURRENTLY`). The runtime logins are separate from the schema owner and receive no schema-change or delete grant; customer-owned records additionally use forced row-level security. See `docs/database-security.md` before connecting application queries.
