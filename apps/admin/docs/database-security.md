# Database credentials and row security

PixBrik uses five independently rotated PostgreSQL credentials:

- `MIGRATION_DATABASE_URL`: a privileged schema owner used only by controlled deployment migrations.
- `ADMIN_DATABASE_URL`: the `pixbrik_admin_runtime` login used only by the authenticated desktop admin.
- `CUSTOMER_DATABASE_URL`: the `pixbrik_customer_runtime` login used only by buyer-facing server handlers.
- `IDENTITY_DATABASE_URL`: the `pixbrik_identity_runtime` login used only to execute narrow audited identity functions for owner bootstrap, password sessions and staff access management. It has no direct table privileges.
- `SERVICE_DATABASE_URL`: the `pixbrik_service_runtime` login used only by verified webhooks, queues, generation, messaging, and scheduled jobs.

All runtime roles must be `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`. Never use the retired `pixbrik_runtime` credential: migration `0005_security_hardening.sql` revokes it completely.

Never reuse the migration credential in Vercel runtime variables. Prefer a provider that supports independently rotated database roles and point-in-time recovery.

## One-time role provisioning

Run equivalent commands through the database provider's privileged console. Generate unique passwords outside source control.

```sql
CREATE ROLE pixbrik_admin_runtime LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
  PASSWORD '<generated-admin-password>';
CREATE ROLE pixbrik_customer_runtime LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
  PASSWORD '<generated-customer-password>';
CREATE ROLE pixbrik_identity_runtime LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
  PASSWORD '<generated-identity-password>';
CREATE ROLE pixbrik_service_runtime LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
  PASSWORD '<generated-service-password>';
CREATE ROLE pixbrik_migrator LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
  PASSWORD '<generated-migrator-password>';

-- Through the provider owner console, grant pixbrik_migrator only the database
-- CREATE/ownership capabilities needed to apply this repository's migrations.
-- Apply migration 0001 onward with that role so it owns the PixBrik objects.
-- It must never be used by a web process.
```

Provision the original admin, customer, service, and migrator roles before applying `0005_security_hardening.sql`, then provision the membership-free identity role before `0006_clerk_owner_identity.sql`. Both migrations deliberately fail closed when a required role is absent. Do not manually restore grants to `pixbrik_runtime`.

For a clean install, run migration `0001` onward directly as `pixbrik_migrator`, which must own the `pixbrik` schema and every object created in it. For an existing database where `0001`-`0004` were applied by a provider-owner role, use the provider's reviewed ownership-transfer procedure for the schema, tables, sequences, functions, and types before running `0005`. Do not work around the ownership check with a superuser or by changing the role names; `0005` intentionally requires `current_user = session_user = 'pixbrik_migrator'` so its `SECURITY DEFINER` ownership is deterministic.

## Request context

The customer-facing database policies use transaction-local context. Every request must:

1. Verify the identity provider session.
2. Load the active PixBrik user and non-expired roles from PostgreSQL.
3. Open a database transaction.
4. Call `set_config('pixbrik.user_id', '<verified-uuid>', true)` inside that transaction.
5. Run all customer-scoped queries through the same transaction.

The final `true` makes the user setting transaction-local, preventing identity leakage through pooled connections. It never grants staff authority. Staff/service authority is derived only from the immutable PostgreSQL login (`session_user` plus `current_user`), and the application must not use `SET ROLE`. Never use session-level `SET` with a serverless connection pool.

RLS is defense in depth. Admin requests must still pass the granular permission checks in `src/lib/auth`; the admin database role alone is not sufficient authorization for refunds, exports, publishing, pricing, or role changes. Customer code receives read access to its own records and narrow profile/address/build writes only. Legal evidence, contact submissions, and webhooks are written by the service role behind narrow handlers with validation, idempotency, rate limiting, and signed-provider verification rather than direct database access.

Migrations `0005` through `0007` must be syntax- and behavior-tested against a disposable PostgreSQL 15+ database before Production. Static contract tests are not a substitute for exercising all five roles, forced RLS, triggers, owner bootstrap, lockout, forced password change, session rotation/revocation, last-owner races and `SECURITY DEFINER` behavior with real connections.

The database client requires an explicit `admin`, `customer`, `identity`, or `service` role and opens a separate pool for each URL. Every transaction verifies both `current_user` and `session_user` against the expected immutable login before running application SQL. The identity login has no role memberships, table access, sequence access, or general function access. Migrations `0006` and `0007` grant only explicitly named, fixed-search-path identity functions. Those functions recheck active account state, non-expired roles, granular `staff.manage` permission and recent password confirmation where required. Buyer-portal and service handlers remain unwired until they explicitly select their dedicated role.

The built-in password bootstrap accepts only the existing invited staff row for `sam@benisty.ca`. It confirms that the seeded owner assignment already exists, activates a one-time Argon2id verifier under a row lock, forces immediate password replacement and records an append-only audit event. It does not create a user or grant a role. The optional Clerk claim remains separately available when `AUTH_MODE=clerk`. Keep the identity credential independently rotated and alert on every owner-bootstrap or identity-claim audit event.

Bootstrap and emergency owner recovery must run from a controlled, non-CI shell
with explicit target and temporary-output confirmations. Recovery uses only the
deployment-held `MIGRATION_DATABASE_URL`, requires a human-readable reason,
revokes all owner sessions, and writes a system/deployment-attributed audit
event. Neither function is executable by any runtime database role. Never put a
temporary password in Vercel environment variables, build output, tickets, or
source control.

Password-pepper rotation uses a bounded keyring: one current
`AUTH_PASSWORD_PEPPER` plus, during migration only, up to four older keys in
`AUTH_PASSWORD_PEPPER_PREVIOUS`. Previous versions must be lower than the
current version and may never reuse the session-HMAC key. Successful
authentication upgrades an older verifier atomically. Retain each old pepper
until database reporting confirms that no credential still references it.

The current legal evidence guard validates document language, market, and every explicit order-item product type. It does not yet persist the complete language × subdivision jurisdiction × product × permitted-use release scope used by legal governance. Checkout must remain blocked until a follow-up schema and real PostgreSQL integration test enforce that full approved release matrix; application-only metadata is not sufficient.

Migration `0005` therefore blocks new checkout/payment-provider references and any transition beyond design approval. It also blocks coupon reservation/application until a normalized database evaluator enforces every eligibility rule and the exact discount amount. Stripe transaction facts require both an already-placed legacy order and a verified Stripe webhook event. These fail-closed triggers are temporary launch gates, not completed checkout or discount implementations.

## Operational controls

- Rotate admin, customer, identity, service, and migration credentials independently.
- Restrict migration execution to the deployment workflow and serialize it with the advisory lock in `scripts/migrate.mjs`.
- Keep Preview and Production databases, credentials and object stores separate.
- Export database audit logs to immutable retention storage.
- Test backups and point-in-time recovery before live checkout.
