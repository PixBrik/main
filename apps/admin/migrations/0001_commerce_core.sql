CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS pixbrik;
SET LOCAL search_path TO pixbrik, public;

CREATE TYPE user_kind AS ENUM ('customer', 'staff', 'service');
CREATE TYPE user_status AS ENUM ('invited', 'active', 'suspended', 'deleted');
CREATE TYPE build_status AS ENUM ('draft', 'generating', 'customer_review', 'approved', 'archived');
CREATE TYPE build_version_status AS ENUM ('draft', 'processing', 'review', 'approved', 'rejected', 'published', 'retired');
CREATE TYPE order_status AS ENUM (
  'draft', 'awaiting_design_approval', 'awaiting_payment', 'paid', 'materials_reserved',
  'in_production', 'quality_check', 'ready_to_ship', 'shipped', 'delivered',
  'cancelled', 'partially_refunded', 'refunded', 'disputed'
);
CREATE TYPE payment_status AS ENUM ('pending', 'requires_action', 'succeeded', 'failed', 'cancelled', 'partially_refunded', 'refunded', 'disputed');
CREATE TYPE coupon_kind AS ENUM ('percentage', 'fixed_eur', 'free_shipping');
CREATE TYPE contact_status AS ENUM ('new', 'triaged', 'in_progress', 'waiting_customer', 'resolved', 'closed', 'spam');
CREATE TYPE message_status AS ENUM ('queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'suppressed', 'cancelled');

CREATE TABLE locale (
  code text PRIMARY KEY CHECK (code ~ '^[a-z]{2}$'),
  label text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('ltr', 'rtl')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE currency (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  label text NOT NULL,
  fraction_digits smallint NOT NULL CHECK (fraction_digits BETWEEN 0 AND 3),
  is_base boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX currency_single_base_idx ON currency (is_base) WHERE is_base;

CREATE TABLE market (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_-]+$'),
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  default_locale text NOT NULL REFERENCES locale(code),
  default_currency text NOT NULL REFERENCES currency(code),
  tax_configuration_status text NOT NULL DEFAULT 'review_required'
    CHECK (tax_configuration_status IN ('review_required', 'configured', 'suspended')),
  price_rounding_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE market_country (
  market_id uuid NOT NULL REFERENCES market(id) ON DELETE CASCADE,
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  PRIMARY KEY (market_id, country_code)
);

CREATE TABLE market_locale (
  market_id uuid NOT NULL REFERENCES market(id) ON DELETE CASCADE,
  locale_code text NOT NULL REFERENCES locale(code),
  PRIMARY KEY (market_id, locale_code)
);

CREATE TABLE market_currency (
  market_id uuid NOT NULL REFERENCES market(id) ON DELETE CASCADE,
  currency_code text NOT NULL REFERENCES currency(code),
  PRIMARY KEY (market_id, currency_code)
);

CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_subject text UNIQUE,
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND position('@' IN email) > 1),
  kind user_kind NOT NULL DEFAULT 'customer',
  status user_status NOT NULL DEFAULT 'invited',
  display_name text,
  preferred_locale text NOT NULL DEFAULT 'en' REFERENCES locale(code),
  preferred_currency text NOT NULL DEFAULT 'EUR' REFERENCES currency(code),
  email_verified_at timestamptz,
  last_signed_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE customer_profile (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE RESTRICT,
  phone_e164 text,
  marketing_email_consent boolean NOT NULL DEFAULT false,
  marketing_consent_at timestamptz,
  marketing_consent_source text,
  customer_notes text,
  lifetime_value_eur_minor bigint NOT NULL DEFAULT 0 CHECK (lifetime_value_eur_minor >= 0),
  order_count integer NOT NULL DEFAULT 0 CHECK (order_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customer_address (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  label text,
  recipient_name text NOT NULL,
  company text,
  line1 text NOT NULL,
  line2 text,
  postal_code text,
  city text NOT NULL,
  region text,
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  phone_e164 text,
  is_default_shipping boolean NOT NULL DEFAULT false,
  is_default_billing boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customer_address_user_idx ON customer_address(user_id);

CREATE TABLE role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9._-]+$'),
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9._-]+$'),
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_role (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE role_permission (
  role_id uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE app_setting (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9._-]+$'),
  value jsonb NOT NULL,
  description text,
  updated_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shipping_origin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_-]+$'),
  internal_label text NOT NULL,
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  address jsonb NOT NULL,
  is_customer_visible boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE shipping_zone (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_-]+$'),
  name text NOT NULL,
  priority integer NOT NULL DEFAULT 100 CHECK (priority >= 0),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shipping_zone_country (
  zone_id uuid NOT NULL REFERENCES shipping_zone(id) ON DELETE CASCADE,
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  PRIMARY KEY (zone_id, country_code)
);

CREATE INDEX shipping_zone_country_lookup_idx ON shipping_zone_country(country_code);

CREATE TABLE shipping_rate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES shipping_zone(id) ON DELETE CASCADE,
  origin_id uuid REFERENCES shipping_origin(id) ON DELETE RESTRICT,
  service_code text NOT NULL,
  service_name text NOT NULL,
  min_weight_grams integer NOT NULL DEFAULT 0 CHECK (min_weight_grams >= 0),
  max_weight_grams integer CHECK (max_weight_grams IS NULL OR max_weight_grams > min_weight_grams),
  min_subtotal_eur_minor bigint NOT NULL DEFAULT 0 CHECK (min_subtotal_eur_minor >= 0),
  max_subtotal_eur_minor bigint CHECK (max_subtotal_eur_minor IS NULL OR max_subtotal_eur_minor > min_subtotal_eur_minor),
  amount_eur_minor bigint NOT NULL CHECK (amount_eur_minor >= 0),
  free_over_eur_minor bigint CHECK (free_over_eur_minor IS NULL OR free_over_eur_minor >= 0),
  estimated_days_min smallint CHECK (estimated_days_min IS NULL OR estimated_days_min >= 0),
  estimated_days_max smallint CHECK (estimated_days_max IS NULL OR estimated_days_max >= estimated_days_min),
  enabled boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (zone_id, origin_id, service_code, min_weight_grams, min_subtotal_eur_minor, valid_from),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE INDEX shipping_rate_lookup_idx ON shipping_rate(zone_id, enabled, valid_from, valid_until);

CREATE TABLE fx_rate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency text NOT NULL DEFAULT 'EUR' REFERENCES currency(code),
  quote_currency text NOT NULL REFERENCES currency(code),
  rate numeric(24, 12) NOT NULL CHECK (rate > 0),
  effective_date date NOT NULL,
  source text NOT NULL,
  source_reference text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  raw_payload_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_currency, quote_currency, effective_date, source),
  CHECK (base_currency = 'EUR')
);

CREATE INDEX fx_rate_latest_idx ON fx_rate(quote_currency, effective_date DESC, fetched_at DESC);

CREATE TABLE fx_refresh_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'partial')),
  rates_written integer NOT NULL DEFAULT 0 CHECK (rates_written >= 0),
  error_summary text,
  idempotency_key text NOT NULL UNIQUE
);

CREATE TABLE stored_asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  storage_provider text NOT NULL,
  object_key text NOT NULL UNIQUE,
  original_filename text,
  content_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending_scan' CHECK (status IN ('pending_scan', 'clean', 'quarantined', 'deleted')),
  is_private boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE build (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  title text,
  status build_status NOT NULL DEFAULT 'draft',
  subject_type text CHECK (subject_type IN ('person', 'pet', 'object', 'artwork', 'other')),
  retakes_used smallint NOT NULL DEFAULT 0 CHECK (retakes_used BETWEEN 0 AND 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX build_owner_idx ON build(owner_user_id, created_at DESC);
CREATE INDEX build_status_idx ON build(status, updated_at DESC);

CREATE TABLE build_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id uuid NOT NULL REFERENCES build(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  status build_version_status NOT NULL DEFAULT 'draft',
  source_asset_id uuid REFERENCES stored_asset(id) ON DELETE RESTRICT,
  model_asset_id uuid REFERENCES stored_asset(id) ON DELETE RESTRICT,
  brick_model_asset_id uuid REFERENCES stored_asset(id) ON DELETE RESTRICT,
  preview_asset_id uuid REFERENCES stored_asset(id) ON DELETE RESTRICT,
  provider text,
  provider_job_id text,
  conversion_engine_version text,
  catalog_release text,
  configuration_snapshot jsonb NOT NULL,
  bom_snapshot jsonb,
  width_mm integer CHECK (width_mm IS NULL OR width_mm > 0),
  height_mm integer CHECK (height_mm IS NULL OR height_mm > 0),
  depth_mm integer CHECK (depth_mm IS NULL OR depth_mm > 0),
  brick_count integer CHECK (brick_count IS NULL OR brick_count >= 0),
  base_price_eur_minor bigint CHECK (base_price_eur_minor IS NULL OR base_price_eur_minor >= 0),
  created_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approved_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (build_id, version_number)
);

CREATE INDEX build_version_status_idx ON build_version(status, created_at DESC);
CREATE INDEX build_version_provider_job_idx ON build_version(provider, provider_job_id) WHERE provider_job_id IS NOT NULL;

ALTER TABLE build ADD COLUMN active_version_id uuid REFERENCES build_version(id) ON DELETE RESTRICT;

CREATE TABLE model_category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES model_category(id) ON DELETE RESTRICT,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  localized_name jsonb NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE model_library_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES model_category(id) ON DELETE SET NULL,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  localized_title jsonb NOT NULL,
  localized_description jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'published', 'retired')),
  created_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE model_library_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES model_library_item(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  build_version_id uuid NOT NULL REFERENCES build_version(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'published', 'retired')),
  published_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  published_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, version_number)
);

CREATE SEQUENCE order_number_sequence START 100000;

CREATE TABLE commerce_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE DEFAULT (
    'PB-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(nextval('order_number_sequence')::text, 8, '0')
  ),
  customer_user_id uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  customer_email text NOT NULL CHECK (customer_email = lower(customer_email) AND position('@' IN customer_email) > 1),
  status order_status NOT NULL DEFAULT 'draft',
  locale_code text NOT NULL REFERENCES locale(code),
  presentment_currency text NOT NULL REFERENCES currency(code),
  market_id uuid REFERENCES market(id) ON DELETE RESTRICT,
  fx_rate_id uuid REFERENCES fx_rate(id) ON DELETE RESTRICT,
  fx_rate_snapshot numeric(24, 12) NOT NULL CHECK (fx_rate_snapshot > 0),
  fx_effective_date date NOT NULL,
  subtotal_eur_minor bigint NOT NULL CHECK (subtotal_eur_minor >= 0),
  discount_eur_minor bigint NOT NULL DEFAULT 0 CHECK (discount_eur_minor >= 0),
  shipping_eur_minor bigint NOT NULL DEFAULT 0 CHECK (shipping_eur_minor >= 0),
  tax_eur_minor bigint NOT NULL DEFAULT 0 CHECK (tax_eur_minor >= 0),
  total_eur_minor bigint NOT NULL CHECK (total_eur_minor >= 0),
  subtotal_presentment_minor bigint NOT NULL CHECK (subtotal_presentment_minor >= 0),
  discount_presentment_minor bigint NOT NULL DEFAULT 0 CHECK (discount_presentment_minor >= 0),
  shipping_presentment_minor bigint NOT NULL DEFAULT 0 CHECK (shipping_presentment_minor >= 0),
  tax_presentment_minor bigint NOT NULL DEFAULT 0 CHECK (tax_presentment_minor >= 0),
  total_presentment_minor bigint NOT NULL CHECK (total_presentment_minor >= 0),
  tax_calculation_status text NOT NULL DEFAULT 'pending'
    CHECK (tax_calculation_status IN ('pending', 'quoted', 'final', 'not_applicable', 'failed')),
  tax_jurisdiction_country text CHECK (tax_jurisdiction_country IS NULL OR tax_jurisdiction_country ~ '^[A-Z]{2}$'),
  tax_evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  shipping_zone_id uuid REFERENCES shipping_zone(id) ON DELETE RESTRICT,
  shipping_rate_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  shipping_origin_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  shipping_address_snapshot jsonb NOT NULL,
  billing_address_snapshot jsonb NOT NULL,
  pricing_snapshot jsonb NOT NULL,
  accepted_policy_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  checkout_idempotency_key text NOT NULL UNIQUE,
  stripe_customer_id text,
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text UNIQUE,
  placed_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX commerce_order_customer_idx ON commerce_order(customer_user_id, created_at DESC);
CREATE INDEX commerce_order_email_idx ON commerce_order(customer_email, created_at DESC);
CREATE INDEX commerce_order_status_idx ON commerce_order(status, updated_at DESC);
CREATE INDEX commerce_order_placed_idx ON commerce_order(placed_at DESC) WHERE placed_at IS NOT NULL;

CREATE TABLE order_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES commerce_order(id) ON DELETE RESTRICT,
  build_version_id uuid NOT NULL REFERENCES build_version(id) ON DELETE RESTRICT,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  title_snapshot text NOT NULL,
  configuration_snapshot jsonb NOT NULL,
  bom_snapshot jsonb NOT NULL,
  catalog_release_snapshot text,
  unit_price_eur_minor bigint NOT NULL CHECK (unit_price_eur_minor >= 0),
  unit_price_presentment_minor bigint NOT NULL CHECK (unit_price_presentment_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_item_order_idx ON order_item(order_id);
CREATE INDEX order_item_build_version_idx ON order_item(build_version_id);

CREATE TABLE order_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES commerce_order(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  from_status order_status,
  to_status order_status,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_event_order_idx ON order_event(order_id, occurred_at DESC);

CREATE TABLE payment_transaction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES commerce_order(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'stripe',
  provider_payment_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('authorization', 'capture', 'payment', 'refund', 'credit', 'chargeback')),
  status payment_status NOT NULL,
  amount_presentment_minor bigint NOT NULL CHECK (amount_presentment_minor >= 0),
  presentment_currency text NOT NULL REFERENCES currency(code),
  amount_eur_minor bigint NOT NULL CHECK (amount_eur_minor >= 0),
  provider_created_at timestamptz,
  raw_event_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id, kind)
);

CREATE INDEX payment_transaction_order_idx ON payment_transaction(order_id, created_at DESC);

CREATE TABLE invoice_document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES commerce_order(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('invoice', 'credit_note', 'proforma')),
  status text NOT NULL CHECK (status IN ('draft', 'issued', 'void')),
  locale_code text NOT NULL REFERENCES locale(code),
  asset_id uuid REFERENCES stored_asset(id) ON DELETE RESTRICT,
  document_snapshot jsonb NOT NULL,
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE coupon (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code = upper(code) AND code ~ '^[A-Z0-9_-]{3,40}$'),
  name text NOT NULL,
  kind coupon_kind NOT NULL,
  percentage_basis_points integer,
  fixed_amount_eur_minor bigint,
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  max_redemptions_per_customer integer CHECK (max_redemptions_per_customer IS NULL OR max_redemptions_per_customer > 0),
  minimum_subtotal_eur_minor bigint CHECK (minimum_subtotal_eur_minor IS NULL OR minimum_subtotal_eur_minor >= 0),
  first_order_only boolean NOT NULL DEFAULT false,
  allowed_market_codes text[] NOT NULL DEFAULT '{}',
  allowed_currency_codes text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CHECK (
    (kind = 'percentage' AND percentage_basis_points IS NOT NULL AND percentage_basis_points BETWEEN 1 AND 10000 AND fixed_amount_eur_minor IS NULL)
    OR (kind = 'fixed_eur' AND fixed_amount_eur_minor IS NOT NULL AND fixed_amount_eur_minor > 0 AND percentage_basis_points IS NULL)
    OR (kind = 'free_shipping' AND fixed_amount_eur_minor IS NULL AND percentage_basis_points IS NULL)
  )
);

CREATE INDEX coupon_active_window_idx ON coupon(active, starts_at, ends_at);

CREATE TABLE coupon_redemption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES coupon(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES commerce_order(id) ON DELETE RESTRICT,
  customer_user_id uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  customer_email text NOT NULL CHECK (customer_email = lower(customer_email) AND position('@' IN customer_email) > 1),
  discount_eur_minor bigint NOT NULL CHECK (discount_eur_minor >= 0),
  discount_presentment_minor bigint NOT NULL CHECK (discount_presentment_minor >= 0),
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('reserved', 'applied', 'released', 'reversed')),
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  UNIQUE (coupon_id, order_id)
);

CREATE INDEX coupon_redemption_stats_idx ON coupon_redemption(coupon_id, status, redeemed_at DESC);
CREATE INDEX coupon_redemption_customer_idx ON coupon_redemption(coupon_id, customer_user_id, redeemed_at DESC);

CREATE TABLE recovery_campaign (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('exit_intent', 'email')),
  active boolean NOT NULL DEFAULT false,
  coupon_id uuid REFERENCES coupon(id) ON DELETE SET NULL,
  trigger_delay_minutes integer NOT NULL DEFAULT 0 CHECK (trigger_delay_minutes >= 0),
  audience_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  localized_content jsonb NOT NULL DEFAULT '{}'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE checkout_recovery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  email text,
  recovery_token_hash text NOT NULL UNIQUE CHECK (length(recovery_token_hash) >= 43),
  locale_code text NOT NULL REFERENCES locale(code),
  presentment_currency text NOT NULL REFERENCES currency(code),
  stage text NOT NULL,
  recoverable_state_snapshot jsonb NOT NULL,
  build_version_id uuid REFERENCES build_version(id) ON DELETE RESTRICT,
  campaign_id uuid REFERENCES recovery_campaign(id) ON DELETE SET NULL,
  email_marketing_consent boolean NOT NULL DEFAULT false,
  abandoned_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_resumed_at timestamptz,
  recovery_email_sent_at timestamptz,
  converted_order_id uuid REFERENCES commerce_order(id) ON DELETE RESTRICT,
  converted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > abandoned_at)
);

CREATE INDEX checkout_recovery_due_idx ON checkout_recovery(abandoned_at, recovery_email_sent_at)
  WHERE converted_at IS NULL;

CREATE TABLE contact_submission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  name text NOT NULL,
  email text NOT NULL CHECK (email = lower(email) AND position('@' IN email) > 1),
  locale_code text NOT NULL REFERENCES locale(code),
  subject text NOT NULL,
  message text NOT NULL,
  status contact_status NOT NULL DEFAULT 'new',
  source_path text,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  privacy_consent_at timestamptz NOT NULL,
  assigned_to uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX contact_submission_queue_idx ON contact_submission(status, created_at);
CREATE INDEX contact_submission_email_idx ON contact_submission(email, created_at DESC);

CREATE TABLE communication_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL CHECK (template_key ~ '^[a-z0-9._-]+$'),
  locale_code text NOT NULL REFERENCES locale(code),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  subject text NOT NULL,
  preview_text text,
  content_definition jsonb NOT NULL,
  approved_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_key, locale_code, version)
);

CREATE TABLE outbound_message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL DEFAULT 'email' CHECK (channel = 'email'),
  recipient text NOT NULL,
  template_id uuid NOT NULL REFERENCES communication_template(id) ON DELETE RESTRICT,
  locale_code text NOT NULL REFERENCES locale(code),
  payload jsonb NOT NULL,
  status message_status NOT NULL DEFAULT 'queued',
  idempotency_key text NOT NULL UNIQUE,
  provider_message_id text UNIQUE,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  failure_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outbound_message_queue_idx ON outbound_message(status, scheduled_at);

CREATE TABLE provider_webhook_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('stripe', 'resend', 'storage', 'identity', 'other')),
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  signature_verified boolean NOT NULL,
  payload_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processing', 'processed', 'ignored', 'failed')),
  error_summary text,
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE legal_document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_key text NOT NULL CHECK (document_key ~ '^[a-z0-9._-]+$'),
  locale_code text NOT NULL REFERENCES locale(code),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'effective', 'retired')),
  title text NOT NULL,
  body_markdown text NOT NULL,
  markets text[] NOT NULL DEFAULT '{}',
  approved_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approved_at timestamptz,
  effective_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_key, locale_code, version),
  CHECK (status = 'draft' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status <> 'effective' OR (effective_at IS NOT NULL AND effective_at >= approved_at)),
  CHECK (
    (status = 'retired' AND retired_at IS NOT NULL)
    OR (status <> 'retired' AND retired_at IS NULL)
  ),
  CHECK (retired_at IS NULL OR effective_at IS NULL OR retired_at > effective_at)
);

CREATE TABLE legal_acceptance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES commerce_order(id) ON DELETE RESTRICT,
  legal_document_id uuid NOT NULL REFERENCES legal_document(id) ON DELETE RESTRICT,
  identity_snapshot jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  request_id text,
  CHECK (user_id IS NOT NULL OR order_id IS NOT NULL)
);

CREATE TABLE analytics_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_name text NOT NULL,
  anonymous_id text,
  session_id text,
  user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  path text,
  locale_code text REFERENCES locale(code),
  market_code text,
  referrer_host text,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX analytics_event_name_time_idx ON analytics_event(event_name, occurred_at DESC);
CREATE INDEX analytics_event_session_time_idx ON analytics_event(session_id, occurred_at) WHERE session_id IS NOT NULL;

CREATE TABLE audit_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  actor_subject text,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  request_id text,
  ip_hash text,
  user_agent text,
  reason text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_event_actor_idx ON audit_event(actor_user_id, occurred_at DESC);
CREATE INDEX audit_event_target_idx ON audit_event(target_type, target_id, occurred_at DESC);
CREATE INDEX audit_event_action_idx ON audit_event(action, occurred_at DESC);

CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION prevent_locked_build_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL AND (TG_OP = 'DELETE' OR NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'locked build versions are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION prevent_issued_invoice_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'issued' AND (TG_OP = 'DELETE' OR NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'issued invoice documents are immutable; issue a credit note instead';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_active_build_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.active_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM build_version version
    WHERE version.id = NEW.active_version_id
      AND version.build_id = NEW.id
      AND version.locked_at IS NOT NULL
      AND version.status IN ('approved', 'published')
  ) THEN
    RAISE EXCEPTION 'active build version must be a locked approved version of the same build';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_order_item_build_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM build_version version
    JOIN build parent_build ON parent_build.id = version.build_id
    JOIN commerce_order parent_order ON parent_order.id = NEW.order_id
    WHERE version.id = NEW.build_version_id
      AND version.locked_at IS NOT NULL
      AND version.status IN ('approved', 'published')
      AND (parent_order.customer_user_id IS NULL OR parent_build.owner_user_id = parent_order.customer_user_id)
  ) THEN
    RAISE EXCEPTION 'order items require a locked approved build version owned by the order customer';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION prevent_placed_order_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.placed_at IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'placed orders cannot be deleted';
    END IF;
    IF NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id
      OR NEW.customer_email IS DISTINCT FROM OLD.customer_email
      OR NEW.locale_code IS DISTINCT FROM OLD.locale_code
      OR NEW.presentment_currency IS DISTINCT FROM OLD.presentment_currency
      OR NEW.market_id IS DISTINCT FROM OLD.market_id
      OR NEW.fx_rate_id IS DISTINCT FROM OLD.fx_rate_id
      OR NEW.fx_rate_snapshot IS DISTINCT FROM OLD.fx_rate_snapshot
      OR NEW.fx_effective_date IS DISTINCT FROM OLD.fx_effective_date
      OR NEW.subtotal_eur_minor IS DISTINCT FROM OLD.subtotal_eur_minor
      OR NEW.discount_eur_minor IS DISTINCT FROM OLD.discount_eur_minor
      OR NEW.shipping_eur_minor IS DISTINCT FROM OLD.shipping_eur_minor
      OR NEW.tax_eur_minor IS DISTINCT FROM OLD.tax_eur_minor
      OR NEW.total_eur_minor IS DISTINCT FROM OLD.total_eur_minor
      OR NEW.subtotal_presentment_minor IS DISTINCT FROM OLD.subtotal_presentment_minor
      OR NEW.discount_presentment_minor IS DISTINCT FROM OLD.discount_presentment_minor
      OR NEW.shipping_presentment_minor IS DISTINCT FROM OLD.shipping_presentment_minor
      OR NEW.tax_presentment_minor IS DISTINCT FROM OLD.tax_presentment_minor
      OR NEW.total_presentment_minor IS DISTINCT FROM OLD.total_presentment_minor
      OR NEW.tax_jurisdiction_country IS DISTINCT FROM OLD.tax_jurisdiction_country
      OR NEW.tax_evidence_snapshot IS DISTINCT FROM OLD.tax_evidence_snapshot
      OR NEW.shipping_zone_id IS DISTINCT FROM OLD.shipping_zone_id
      OR NEW.shipping_rate_snapshot IS DISTINCT FROM OLD.shipping_rate_snapshot
      OR NEW.shipping_origin_snapshot IS DISTINCT FROM OLD.shipping_origin_snapshot
      OR NEW.shipping_address_snapshot IS DISTINCT FROM OLD.shipping_address_snapshot
      OR NEW.billing_address_snapshot IS DISTINCT FROM OLD.billing_address_snapshot
      OR NEW.pricing_snapshot IS DISTINCT FROM OLD.pricing_snapshot
      OR NEW.accepted_policy_versions IS DISTINCT FROM OLD.accepted_policy_versions
      OR NEW.checkout_idempotency_key IS DISTINCT FROM OLD.checkout_idempotency_key
      OR NEW.placed_at IS DISTINCT FROM OLD.placed_at
    THEN
      RAISE EXCEPTION 'placed order commercial snapshots are immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION prevent_overlapping_shipping_rate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.enabled THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.zone_id::text || '|' || COALESCE(NEW.origin_id::text, '*') || '|' || NEW.service_code,
    0
  ));
  IF EXISTS (
    SELECT 1
    FROM shipping_rate existing
    WHERE existing.id <> NEW.id
      AND existing.enabled
      AND existing.zone_id = NEW.zone_id
      AND existing.origin_id IS NOT DISTINCT FROM NEW.origin_id
      AND existing.service_code = NEW.service_code
      AND tstzrange(existing.valid_from, existing.valid_until, '[)') && tstzrange(NEW.valid_from, NEW.valid_until, '[)')
      AND int8range(existing.min_weight_grams::bigint, existing.max_weight_grams::bigint, '[)')
        && int8range(NEW.min_weight_grams::bigint, NEW.max_weight_grams::bigint, '[)')
      AND int8range(existing.min_subtotal_eur_minor, existing.max_subtotal_eur_minor, '[)')
        && int8range(NEW.min_subtotal_eur_minor, NEW.max_subtotal_eur_minor, '[)')
  ) THEN
    RAISE EXCEPTION 'shipping rate overlaps an enabled rate for the same zone, origin and service';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION enforce_coupon_redemption_limits() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  coupon_record coupon%ROWTYPE;
  global_usage integer;
  customer_usage integer;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IN ('reserved', 'applied') THEN
    IF NEW.coupon_id IS DISTINCT FROM OLD.coupon_id
      OR NEW.order_id IS DISTINCT FROM OLD.order_id
      OR NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id
      OR NEW.customer_email IS DISTINCT FROM OLD.customer_email
      OR NEW.discount_eur_minor IS DISTINCT FROM OLD.discount_eur_minor
      OR NEW.discount_presentment_minor IS DISTINCT FROM OLD.discount_presentment_minor
    THEN
      RAISE EXCEPTION 'active coupon redemption facts are immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('reserved', 'applied') THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.coupon_id::text, 0));
  SELECT * INTO coupon_record FROM coupon WHERE id = NEW.coupon_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'coupon does not exist'; END IF;
  IF NOT coupon_record.active OR coupon_record.disabled_at IS NOT NULL THEN
    RAISE EXCEPTION 'coupon is disabled';
  END IF;
  IF coupon_record.starts_at IS NOT NULL AND coupon_record.starts_at > now() THEN
    RAISE EXCEPTION 'coupon is not active yet';
  END IF;
  IF coupon_record.ends_at IS NOT NULL AND coupon_record.ends_at <= now() THEN
    RAISE EXCEPTION 'coupon has expired';
  END IF;

  SELECT count(*) INTO global_usage
  FROM coupon_redemption redemption
  WHERE redemption.coupon_id = NEW.coupon_id
    AND redemption.id <> NEW.id
    AND redemption.status IN ('reserved', 'applied');
  IF coupon_record.max_redemptions IS NOT NULL AND global_usage >= coupon_record.max_redemptions THEN
    RAISE EXCEPTION 'coupon redemption limit reached';
  END IF;

  SELECT count(*) INTO customer_usage
  FROM coupon_redemption redemption
  WHERE redemption.coupon_id = NEW.coupon_id
    AND redemption.id <> NEW.id
    AND redemption.status IN ('reserved', 'applied')
    AND (redemption.customer_email = NEW.customer_email
      OR (NEW.customer_user_id IS NOT NULL AND redemption.customer_user_id = NEW.customer_user_id));
  IF coupon_record.max_redemptions_per_customer IS NOT NULL
    AND customer_usage >= coupon_record.max_redemptions_per_customer
  THEN
    RAISE EXCEPTION 'coupon customer redemption limit reached';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION prevent_effective_legal_document_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'approved legal document versions cannot be deleted'; END IF;
    IF NEW.document_key IS DISTINCT FROM OLD.document_key
      OR NEW.locale_code IS DISTINCT FROM OLD.locale_code
      OR NEW.version IS DISTINCT FROM OLD.version
      OR NEW.title IS DISTINCT FROM OLD.title
      OR NEW.body_markdown IS DISTINCT FROM OLD.body_markdown
      OR NEW.markets IS DISTINCT FROM OLD.markets
      OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
      OR (OLD.status IN ('effective', 'retired') AND NEW.effective_at IS DISTINCT FROM OLD.effective_at)
      OR (OLD.status = 'retired' AND NEW.status <> 'retired')
      OR (OLD.status = 'effective' AND NEW.status NOT IN ('effective', 'retired'))
    THEN
      RAISE EXCEPTION 'approved legal document content is immutable; create a new version';
    END IF;
    IF NEW.status = 'retired' AND NEW.retired_at IS NULL THEN
      RAISE EXCEPTION 'retired legal documents require retired_at';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_legal_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM legal_document document
    WHERE document.id = NEW.legal_document_id
      AND document.status = 'effective'
      AND document.effective_at <= NEW.accepted_at
      AND (document.retired_at IS NULL OR NEW.accepted_at < document.retired_at)
  ) THEN
    RAISE EXCEPTION 'legal acceptance requires an effective approved document version';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION prevent_append_only_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER market_touch_updated_at BEFORE UPDATE ON market
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER app_user_touch_updated_at BEFORE UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER customer_profile_touch_updated_at BEFORE UPDATE ON customer_profile
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER customer_address_touch_updated_at BEFORE UPDATE ON customer_address
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER role_touch_updated_at BEFORE UPDATE ON role
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER shipping_origin_touch_updated_at BEFORE UPDATE ON shipping_origin
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER shipping_zone_touch_updated_at BEFORE UPDATE ON shipping_zone
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER shipping_rate_touch_updated_at BEFORE UPDATE ON shipping_rate
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER shipping_rate_overlap_guard BEFORE INSERT OR UPDATE ON shipping_rate
  FOR EACH ROW EXECUTE FUNCTION prevent_overlapping_shipping_rate();
CREATE TRIGGER build_touch_updated_at BEFORE UPDATE ON build
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER model_category_touch_updated_at BEFORE UPDATE ON model_category
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER model_library_item_touch_updated_at BEFORE UPDATE ON model_library_item
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER commerce_order_touch_updated_at BEFORE UPDATE ON commerce_order
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER commerce_order_snapshot_lock BEFORE UPDATE OR DELETE ON commerce_order
  FOR EACH ROW EXECUTE FUNCTION prevent_placed_order_snapshot_mutation();
CREATE TRIGGER invoice_document_touch_updated_at BEFORE UPDATE ON invoice_document
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER coupon_touch_updated_at BEFORE UPDATE ON coupon
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER recovery_campaign_touch_updated_at BEFORE UPDATE ON recovery_campaign
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER contact_submission_touch_updated_at BEFORE UPDATE ON contact_submission
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER outbound_message_touch_updated_at BEFORE UPDATE ON outbound_message
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER build_version_lock BEFORE UPDATE OR DELETE ON build_version
  FOR EACH ROW EXECUTE FUNCTION prevent_locked_build_version_mutation();
CREATE TRIGGER build_active_version_guard BEFORE INSERT OR UPDATE OF active_version_id ON build
  FOR EACH ROW EXECUTE FUNCTION validate_active_build_version();
CREATE TRIGGER order_item_build_version_guard BEFORE INSERT OR UPDATE OF build_version_id, order_id ON order_item
  FOR EACH ROW EXECUTE FUNCTION validate_order_item_build_version();
CREATE TRIGGER invoice_document_lock BEFORE UPDATE OR DELETE ON invoice_document
  FOR EACH ROW EXECUTE FUNCTION prevent_issued_invoice_mutation();
CREATE TRIGGER coupon_redemption_limit_guard BEFORE INSERT OR UPDATE ON coupon_redemption
  FOR EACH ROW EXECUTE FUNCTION enforce_coupon_redemption_limits();
CREATE TRIGGER coupon_redemption_no_delete BEFORE DELETE ON coupon_redemption
  FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
CREATE TRIGGER legal_document_version_lock BEFORE UPDATE OR DELETE ON legal_document
  FOR EACH ROW EXECUTE FUNCTION prevent_effective_legal_document_mutation();
CREATE TRIGGER legal_acceptance_effective_guard BEFORE INSERT OR UPDATE ON legal_acceptance
  FOR EACH ROW EXECUTE FUNCTION validate_legal_acceptance();
CREATE TRIGGER audit_event_no_update BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
CREATE TRIGGER order_event_no_update BEFORE UPDATE OR DELETE ON order_event
  FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

COMMENT ON TABLE fx_rate IS 'Immutable daily EUR quote-rate observations. Orders freeze the applied rate and effective date.';
COMMENT ON COLUMN shipping_origin.is_customer_visible IS 'Operational origin data remains internal unless an approved customer-facing use requires it.';
COMMENT ON TABLE legal_document IS 'Only counsel-approved versions may become effective. Draft rows are never customer policy.';
COMMENT ON TABLE audit_event IS 'Append-only administrative security and business audit trail.';
