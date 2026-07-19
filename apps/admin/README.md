# PixBrik commerce and operations console

This application is the isolated foundation for PixBrik's desktop admin and secure customer portal. Its complete public surface is mounted at `/backoffice`; it intentionally does not modify or replace the Expo buyer application.

## Included in this scaffold

- A desktop-first operations shell with launch-readiness and module views.
- Fail-closed built-in staff password authentication with PostgreSQL authorization, forced temporary-password replacement, revocable sessions and optional provider adapters.
- Server-side permission checks for every protected layout.
- PostgreSQL migrations for identity, RBAC, markets, shipping, EUR-based FX, builds and immutable build versions, orders, payments, invoices, coupons, checkout recovery, contact requests, localized messaging, analytics and audit events.
- Append-only inventory movements and reservations, affiliate attribution/commissions/payouts, consent-aware visitor/session/page-view facts, and auditable private export jobs.
- Searchable customer records with authoritative order history, localized newsletter campaigns, consent history, suppressions, and a leased Resend delivery queue.
- Prebuilt PixBrik lifecycle and newsletter templates in English, French, Spanish, Italian and Arabic. Every lifecycle automation is installed disabled and must be deliberately enabled by an authorized operator.
- Seed data for English, French, Spanish, Italian and Arabic; EUR, GBP, USD, CAD and AUD; the requested markets and shipping zones; and the invited owner `sam@benisty.ca`.
- Runtime environment inspection that never returns secret values.

No tax, refund, cancellation, product-safety or trademark position is encoded as legal fact. Those policies must be reviewed by qualified counsel/accounting specialists for every market before publishing or enabling checkout.

## Local setup

Requirements: Node.js 24+, npm and PostgreSQL 15+.

```powershell
cd C:\dev\Fotobrik\apps\admin
Copy-Item .env.example .env.local
npm install
```

Provision the five separate database roles described in
`docs/database-security.md`. Put the four least-privilege runtime URLs in
`.env.local`. In a separate controlled operator process, inject the direct
`MIGRATION_DATABASE_URL`, apply migrations, and remove that variable before
starting the app. Do not save the migrator URL in `.env.local`.

```powershell
npm run db:migrate
Remove-Item Env:MIGRATION_DATABASE_URL -ErrorAction SilentlyContinue
```

For a brand-new provider database, the controlled role provisioner can create
those five logins once. First disable Windows clipboard history and clipboard
sync. Copy the Neon provider-owner **direct** connection into the OS clipboard,
then run:

```powershell
.\scripts\prepare-database-provisioning.ps1
```

The command refuses an existing role or migrated database; it never rotates a
credential. Before touching PostgreSQL it stores the generated values in a
Windows-user-encrypted, one-time recovery file. The clipboard is then replaced
with runtime variables only: pooled role URLs and the two authentication keys.
It never contains the provider-owner or migrator URL.

In Vercel, import that clipboard bundle into **Production only** for the
`pixbrik-backoffice` project. Explicitly leave Preview and Development
unchecked, and remove any owner-level URL that the provider integration added
automatically. Keep the clipboard unchanged until initialization completes.
Then pass the encrypted file path printed by the preparation command:

```powershell
.\scripts\initialize-database-from-clipboard.ps1 -RecoveryFile '<printed .dpapi path>'
```

The initializer cross-checks every role, password, key, Neon branch, pooled
runtime hostname, and direct migration hostname before making a database call.
It runs migrations, bootstraps `sam@benisty.ca`, shows the temporary password
once, restores the caller's process environment, and removes the clipboard and
encrypted recovery file after success. If clipboard delivery fails after role
creation, copy the Neon owner direct URL again and recover the runtime bundle:

```powershell
.\scripts\resume-database-provisioning.ps1 -RecoveryFile '<printed .dpapi path>'
```

Never add the provider-owner or migrator connection to Vercel runtime variables.

For local UI development only, set:

```env
AUTH_MODE=development
DEV_ADMIN_EMAIL=sam@benisty.ca
```

`AUTH_MODE=development` is rejected when `NODE_ENV=production`. With authentication disabled, protected routes redirect to `/backoffice/sign-in`; they never become public by accident.

Then run:

```powershell
npm run dev -- --port 3001
```

Open `http://localhost:3001/backoffice`. The authenticated dashboard uses that exact canonical path; staff sign-in is at `http://localhost:3001/backoffice/sign-in`.

## Staff authentication and authorization

`AUTH_MODE=password` is the simplest production staff-login option. Passwords
are Argon2id verifiers with a server-only pepper; the database stores only the
verifier and an HMAC digest of each random session token. Temporary passwords
expire after 24 hours and must be replaced on first sign-in. Ordinary sessions
idle after 30 minutes and expire after 12 hours. Password resets, suspension,
removal and password changes revoke existing sessions.

Generate two independent 32-byte keys without printing them into build logs and
set them using the versioned format `v1:<canonical-base64url>`:

```env
AUTH_MODE=password
AUTH_PASSWORD_PEPPER=v1:<32-byte-base64url>
AUTH_SESSION_HMAC_KEY=v1:<different-32-byte-base64url>
```

For a controlled pepper rotation, increment the current version and temporarily
set `AUTH_PASSWORD_PEPPER_PREVIOUS` to at most four comma-separated older keys.
Their versions must be lower and all key material must be unique. A successful
sign-in rehashes an older verifier with the current pepper; remove an old key
only after no credential references that version.

After migration `0007_local_staff_auth.sql` is applied, run the one-time owner
bootstrap from a controlled, non-CI shell using only `IDENTITY_DATABASE_URL`
and `AUTH_PASSWORD_PEPPER`. The two confirmations prevent an accidental reset
or a temporary password being written to deployment logs:

```powershell
$env:CONFIRM_OWNER_BOOTSTRAP='sam@benisty.ca'
$env:CONFIRM_TEMP_PASSWORD_OUTPUT='sam@benisty.ca'
npm run auth:bootstrap-owner
```

The command activates the exact pre-seeded `sam@benisty.ca` owner, prints one
random temporary password once, and cannot be replayed. It does not store the
plaintext in SQL, Vercel, Git or the audit trail. The owner-only **Manage users**
screen can create staff, reset a password to a new one-time temporary value,
change roles, suspend/restore access and soft-remove access. Sensitive changes
require current-password confirmation and are reauthorized in PostgreSQL.

Existing passwords are never displayed or edited. “Reset password” creates a
new temporary password, shows it once and signs that staff member out everywhere.

If the primary owner loses access, the runtime app still cannot reset that
account. A deployment operator can use the separately audited migrator-only
recovery path from a controlled shell:

```powershell
$env:CONFIRM_OWNER_RECOVERY='sam@benisty.ca'
$env:CONFIRM_TEMP_PASSWORD_OUTPUT='sam@benisty.ca'
$env:OWNER_RECOVERY_REASON='Owner requested emergency access recovery'
npm run auth:recover-owner
```

The recovery command requires `MIGRATION_DATABASE_URL`, revokes every existing
owner session, forces another password change, records the reason, and prints
the new temporary password only once. It refuses to print in CI unless an
operator deliberately sets the documented break-glass override.

### Optional Clerk adapter

`AUTH_MODE=clerk` uses the current `@clerk/nextjs` adapter for staff authentication. Create a **separate Clerk application/instance for the admin**; do not reuse the public buyer application's publishable or secret keys. Disable public sign-up, invite only approved staff, require primary-email verification, and configure the `setup-mfa` session task as mandatory. Pending Clerk sessions are treated as signed out, and the server also rejects an active identity that has not enabled two-factor authentication.

Set these runtime variables only after that dedicated instance is configured:

```env
AUTH_MODE=clerk
CLERK_SECRET_KEY=<staff-instance-secret-key>
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<staff-instance-publishable-key>
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/backoffice/sign-in
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/backoffice
NEXT_PUBLIC_CLERK_PROXY_URL=/backoffice/__clerk
```

The Next.js 16 request proxy installs Clerk request context only in Clerk mode. It proxies Clerk's Frontend API through `/backoffice/__clerk` and restricts token authorized-party validation to the origin derived from `APP_URL`; `APP_URL` must therefore be the absolute public admin URL, including `/backoffice`. The request proxy does not grant access. Protected server layouts still load the immutable namespaced subject (`clerk:<userId>`) from PostgreSQL and re-evaluate active, non-expired RBAC permissions on every authorization-sensitive request.

The seeded owner row for `sam@benisty.ca` starts as an unbound invitation. On the first MFA-complete Clerk session, the server requires the Clerk primary email object to be verified and calls the migrator-owned `pixbrik.claim_seeded_clerk_owner` function through the isolated `pixbrik_identity_runtime` login. That function accepts only the exact seeded invitation, takes a row lock, verifies an existing non-expired owner assignment, binds the immutable Clerk user ID, and writes an append-only audit event. It never creates authority and email matching alone is never authorization. Other staff identities must be provisioned through a separately reviewed, audited invitation workflow before launch.

`AUTH_MODE=development` remains local-only and is rejected in production. `disabled` remains fail-closed. The trusted-gateway adapter remains available for controlled migrations but is not the recommended production admin mode.

## Vercel environment variables

Add the runtime values below in Vercel Project Settings. Scope Production
credentials to Production, and use separate non-production providers, databases,
senders and recipients for Preview. Do not paste keys into source control and do
not give a Preview deployment access to Production data.

Required before live traffic:

- `ADMIN_DATABASE_URL` (dedicated `pixbrik_admin_runtime` login)
- `CUSTOMER_DATABASE_URL` (dedicated `pixbrik_customer_runtime` login; buyer handlers only)
- `IDENTITY_DATABASE_URL` (dedicated `pixbrik_identity_runtime` login; execute-only owner invitation claim)
- `SERVICE_DATABASE_URL` (dedicated `pixbrik_service_runtime` login; jobs/webhooks only)
- `APP_URL=https://pixbrik-backoffice.vercel.app/backoffice` (or the future dedicated admin hostname)
- `CUSTOMER_APP_URL=https://www.pixbrik.com` (the only origin permitted for customer-facing email links)
- `PUBLIC_EMAIL_APP_URL=https://www.pixbrik.com/backoffice` (public base for unsubscribe and one-click unsubscribe URLs)
- `AUTH_MODE=password`, `AUTH_PASSWORD_PEPPER`, and `AUTH_SESSION_HMAC_KEY` for the built-in staff login; the two authentication keys must be independently generated versioned 32-byte base64url values
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`
- `RESEND_FROM_EMAIL=PixBrik <hello@pixbrik.com>`
- `RESEND_REPLY_TO_EMAIL=hello@pixbrik.com`
- `EMAIL_DELIVERY_APPROVED=true` only after sender DNS, the signed webhook, and a production smoke email have been verified
- `CUSTOMER_PORTAL_EMAIL_LINKS_READY=true` only after customer order/payment links work end to end
- `CHECKOUT_RECOVERY_EMAIL_READY=true` only after persisted carts and exact resume links work end to end
- `CUSTOMER_APP_EMAIL_LINKS_READY=true` only after create/contact email deep links work on a fresh browser
- `BLOB_READ_WRITE_TOKEN`
- `FX_PROVIDER_URL` and, when required, `FX_PROVIDER_TOKEN`
- `CRON_SECRET` (an independently generated secret containing at least 32 random bytes)

`MIGRATION_DATABASE_URL` is deliberately absent from that Vercel runtime list.
It is a privileged direct (non-pooler) Neon connection for the controlled
operator shell only. Inject it into the shell that runs `npm run db:migrate`,
then remove it from the process. Never add it to Vercel Project Settings,
Preview or Production, and never use it for a build or runtime function. A
normal Vercel deployment does not apply migrations automatically; apply every
new numbered migration through this controlled workflow before deploying code
that reads its schema.

## Resend lifecycle email setup

1. Verify `pixbrik.com` (or an approved mail subdomain) in Resend and publish
   the required SPF and DKIM records. Configure DMARC before sending to live
   customers.
2. Create a restricted Resend sending key for this project and set
   `RESEND_API_KEY`. Set the verified sender and reply-to values shown above.
3. In Resend, create a webhook pointing directly to
   `https://pixbrik-backoffice.vercel.app/backoffice/api/webhooks/resend`.
   Subscribe to `email.sent`, `email.delivered`, `email.failed`,
   `email.bounced`, `email.complained`, `email.suppressed`, and
   `contact.updated`, then put its `whsec_` signing secret in
   `RESEND_WEBHOOK_SECRET`. Use the direct admin deployment URL so provider
   callbacks do not depend on the storefront redirect.
4. Generate `CRON_SECRET` independently and set it only as a server-side Vercel
   variable. Vercel Cron sends it as `Authorization: Bearer <CRON_SECRET>` to
   `/backoffice/api/cron/email-dispatch`; do not put it in the URL or a public
   environment variable.
5. Leave all readiness flags false while configuring. Set
   `EMAIL_DELIVERY_APPROVED=true` only after the DNS, webhook, and smoke-send
   checks pass. The portal and checkout-recovery flags are separate capability
   gates; never use them to bypass an unfinished customer journey.
6. Apply migration `0009_customer_marketing_operations.sql`, deploy, and open
   **Backoffice > Marketing**. The runtime checklist must be fully ready before
   a campaign can be queued or an automation can be enabled.

The committed cron runs once daily at 09:00 UTC so the current Vercel Hobby
project can deploy it. Hobby timing can drift within that hour, so this cadence
is suitable only while every lifecycle automation remains disabled. Before
enabling welcome, transactional or checkout-recovery delivery, upgrade the
project to Vercel Pro (or install an approved external scheduler), change the
schedule to at least every 15 minutes, and verify executions and failures in
the Production function logs.

The seeded templates cover welcome, abandoned checkout, order confirmation,
payment failure, shipment, delivery review, gift ideas and new builds in all
five supported languages. They are content snapshots, not arbitrary admin
HTML. Marketing sends require explicit subscription and include preference-page
and RFC 8058 one-click unsubscribe links. Hard bounces, complaints and provider
suppressions are recorded before further marketing delivery.

All automation rules are deliberately seeded **disabled**. Configuration alone
never starts sending, and activation starts at that moment rather than sweeping
historical events. Review the localized copy, test each template with
controlled addresses, confirm webhook delivery and suppression handling, then
enable only the approved rules in the Marketing screen. Disabling a rule stops
new messages from being created; inspect the delivery queue separately for
messages already queued.

Two integrations remain deliberately incomplete and must not be inferred from
the database schema. The migration exposes an evidence-required,
service-role-only `record_marketing_subscription` command, but the buyer and
checkout applications do not yet call it, so there is no live public newsletter
opt-in flow. The backoffice also has no provider test-send action or rendered
inbox preview. Keep delivery approval and the affected automation capability
flags false until those buyer integrations and an end-to-end controlled send
have been implemented and verified.

The `/backoffice` base path is compiled into the Next.js client bundles. Deploy
this directory as the admin application on an origin isolated from the buyer
site. The public `www.pixbrik.com/backoffice` entry must **redirect** (not
reverse-proxy) to that isolated deployment. This separation prevents a buyer
site script from inheriting the admin cookie or origin. Deploying this app alone
does not add the entry route to the separate Expo buyer deployment.

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

The migrator applies the complete pending batch under one transaction-scoped PostgreSQL advisory lock, preventing concurrent deployments from racing the same DDL even when infrastructure uses transaction pooling. Configure the privileged migration credential with the provider's direct endpoint anyway: migration DDL must not depend on a runtime pooler's statement support, timeouts or routing. Migration files must remain transaction-safe (for example, do not use `CREATE INDEX CONCURRENTLY`). The runtime logins are separate from the schema owner and receive no schema-change or delete grant; customer-owned records additionally use forced row-level security. The identity login has no table or sequence privileges and can execute only the audited owner-claim function. See `docs/database-security.md` before connecting application queries.
