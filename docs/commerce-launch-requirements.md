# PixBrik commerce launch requirements

Status: owner-confirmed product configuration and implementation guardrails, 18 July 2026.

This document records the commercial scope approved by the owner. It is not
legal or tax advice. Customer-facing legal text, tax registrations, product
safety evidence, and importer-of-record arrangements must be approved before
live payment collection is enabled.

## Launch configuration

- Admin owner: `sam@benisty.ca`
- Customer contact and email sender: `hello@pixbrik.com`
- Languages: English (`en`), French (`fr`), Spanish (`es`), Italian (`it`),
  and Arabic (`ar`)
- Arabic layout direction: right-to-left; stored values such as order IDs,
  SKUs, email addresses, and currency codes remain directionally isolated
- Accounting and source price currency: EUR
- Presentment currencies: EUR, GBP, USD, CAD, AUD
- Markets: European Union, United Kingdom, United States, Canada, Australia,
  and Middle East
- Shipping zones: EU, UK, North America (US and Canada), Australia, and Middle
  East (Saudi Arabia, United Arab Emirates, Bahrain, and Oman)
- Fulfilment origin: editable and versioned in the admin. The current internal
  origin is China. It must not be presented as a marketing claim, but it must
  remain available to tax, customs, carrier, compliance, and support systems.

## Architecture

The existing Expo/React Native buyer app remains the customer creation flow.
Add a desktop-first admin, PostgreSQL-backed commerce API, and secure customer
portal. Browser storage is never authoritative for orders, prices, discounts,
payments, inventory, permissions, or customer files.

Every paid order must freeze:

- the approved source image/model and generated 3D version;
- selected build profile, dimensions, solid/hollow setting, and colour mode;
- pinned catalog release, exact BOM, assembly plan, and manual version;
- base EUR amounts, presentment currency, archived FX snapshot and rounding;
- discount, tax, shipping rule, fulfilment origin, and legal-text versions;
- customer locale and the preview/specification the customer approved.

## Currency and exchange rates

All prices originate as integer EUR cents. A daily archived FX snapshot may
convert the quote into a supported presentment currency. The paid quote stores
the exact source, effective date, fetched time, rate, rounding rule, base EUR
amount, and presented amount; historical orders are never re-priced.

The rate service must support a bounded weekend/provider-outage fallback and
must stop quoting an affected currency when the latest usable rate is too old.
ECB reference rates are useful as an auditable reference, but the ECB states
that its reference rates are informational. The provider remains replaceable
so PixBrik can add currencies and a commercial SLA without changing orders.

## Shipping and tax

Shipping rules are editable and versioned by zone, country allow/exclusion
list, origin, service, weight, dimensions, order value, item count, price,
handling/transit window, priority, and effective dates.

Do not encode `20% France and 0% elsewhere` as a global rule. Applicable tax
depends on the real dispatch origin, destination, consignment value, importer
of record, customer type, registrations, and whether OSS/IOSS applies. Stripe
Tax (or an approved equivalent) may calculate tax only after the corresponding
registrations and product/shipping tax codes are configured.

China-to-EU fulfilment requires an explicit DDP/DAP and importer-of-record
decision. IOSS can be relevant for qualifying consignments up to EUR 150.
Unexpected tax or duty collection at delivery must not be hidden from buyers.

## Returns, cancellations, and statutory remedies

PixBrik may decline voluntary change-of-mind returns for a kit that is genuinely
made from the customer's content and approved specification, where the local
personalised-goods exception applies. The exception must be shown clearly
before payment and confirmed by email. Standard ready-made library products
need their own policy and may retain a statutory withdrawal right.

The following approved wording is the policy baseline:

> Each custom PixBrik kit is created from the customer's submitted content and
> approved build specification. Because it is clearly personalised, the
> statutory right of withdrawal does not apply where the law permits. Once the
> final design is approved and the order is placed, PixBrik does not offer a
> voluntary change-of-mind cancellation or return. This does not affect
> mandatory legal rights concerning late or failed delivery, incorrect,
> damaged, defective, unsafe, or non-conforming products.

Credits can be offered as a voluntary remedy, but must not replace a mandatory
repair, replacement, price reduction, refund, or other statutory remedy.
Reasonable photos and order information may be requested for investigation;
the flow must not impose proof requirements that unlawfully reverse the burden
of proof. Product dissatisfaction alone is not a defect when the delivered kit
materially conforms to the clearly disclosed and approved brick preview and
specification, subject always to mandatory law.

## Discounts and checkout recovery

The server-authoritative discount system supports:

- percentage or fixed-EUR discounts;
- one redemption per customer or reusable codes;
- global redemption caps and validity windows;
- enabling/disabling without deleting history;
- eligibility rules and immutable redemption records;
- usage, revenue, conversion, and cost reporting;
- optional, non-obstructive exit offers;
- resumable abandoned checkouts that restore the exact build/version;
- locale-aware recovery email where the necessary consent or other approved
  lawful basis exists.

Recovery URLs use opaque, expiring, revocable tokens. They contain no customer
PII, pricing authority, discount authority, or raw provider credentials.

## Email and contact

Resend is the transactional provider. React Email templates share PixBrik's
design tokens and localized content with the product, and always include a
plain-text alternative. Transactional and marketing consent are separate.

Required messages include account verification, order confirmation, invoice,
3D review, retake, build approval, payment failure, production, shipment,
delivery, remedy updates, and consented checkout recovery. Each send uses a
deterministic idempotency key and records Resend delivery/bounce/complaint/
suppression events.

The public contact form sends to `hello@pixbrik.com`, validates and limits input,
uses a honeypot and provider-independent rate-limit hook, and never exposes the
Resend key. Replies use the verified customer address as `Reply-To`, not `From`.

## Vercel environment variables

Values must be entered in Vercel, never pasted into chat or committed.

| Name | Value/source | Exposure |
| --- | --- | --- |
| `ADMIN_DATABASE_URL` | PostgreSQL URL for `pixbrik_admin_runtime` | server only |
| `CUSTOMER_DATABASE_URL` | PostgreSQL URL for `pixbrik_customer_runtime` | server only |
| `SERVICE_DATABASE_URL` | PostgreSQL URL for `pixbrik_service_runtime` | server only |
| `MIGRATION_DATABASE_URL` | Direct PostgreSQL URL for `pixbrik_migrator`; deployment only | server only |
| `RESEND_API_KEY` | Resend API key beginning `re_` | server only |
| `RESEND_WEBHOOK_SECRET` | Signing secret created for the Resend webhook | server only |
| `RESEND_FROM_EMAIL` | `PixBrik <hello@pixbrik.com>` after domain verification | server only |
| `CONTACT_RECIPIENT_EMAIL` | `hello@pixbrik.com` | server only |
| `CONTACT_ALLOWED_ORIGINS` | `https://pixbrik.com,https://www.pixbrik.com` | server only |
| `PIXBRIK_APP_URL` | `https://pixbrik.com` | server only |
| `STRIPE_SECRET_KEY` | PixBrik Stripe sandbox key beginning `sk_test_` | server only |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Matching sandbox key beginning `pk_test_` | public |
| `STRIPE_WEBHOOK_SECRET` | Signing secret beginning `whsec_` | server only |
| `EXPO_PUBLIC_APP_URL` | `https://pixbrik.com`; canonical API origin for native builds | public |
| `EXPO_PUBLIC_DEPLOYMENT_ENV` | `production` in Production; `preview` only in isolated Preview builds | public |
| `EXPO_PUBLIC_LEGAL_DRAFTS_ENABLED` | `0` in Production; Preview-only review gate | public |

Stripe's documented card numbers are test payment inputs, not a substitute for
PixBrik's own sandbox API keys. QA may use Stripe's documented `4242 4242 4242
4242` success card only with the PixBrik sandbox keys.

## Legal and compliance launch gates

The following are still required before live checkout:

- exact legal entity name and form, share capital if applicable, SIREN/SIRET,
  RCS/RNE, VAT identification number, customer-service phone, publication
  director, and hosting disclosure;
- an approved French consumer mediator and its published contact details;
- privacy/cookie records, retention rules, and localized legal review;
- importer-of-record, customs, DDP/DAP, OSS/IOSS, and destination-tax decisions;
- intended age grading and final determination of toy versus adult collectible;
- supplier identity, materials evidence, applicable tests, risk assessment,
  conformity assessment, technical file, Declaration of Conformity, CE mark,
  warnings, batch traceability, complaint/recall process, and product-liability
  insurance for every product family placed on the EU market;
- French/EU consumer counsel and tax-accountant approval.

No disclaimer substitutes for conformity, CE/GPSR obligations, the legal
guarantee, or product-liability rules. Live payment collection remains gated
until these items are recorded as approved.

## Brand independence

Use generic language such as "interlocking building bricks". Do not use a
third-party toy-brand logo, imagery, trade dress, copied instructions, product
name, or catalog photography. A limited factual disclaimer may state:

> LEGO® is a trademark of the LEGO Group. PixBrik is an independent company
> and is not sponsored, authorised, endorsed by, or affiliated with the LEGO
> Group.

The disclaimer does not cure otherwise infringing use. Any compatibility claim
or third-party part/geometry source requires documented IP and licence review.
