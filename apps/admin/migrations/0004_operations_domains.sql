SET LOCAL search_path TO pixbrik, public;

CREATE TYPE inventory_movement_kind AS ENUM (
  'receipt', 'reservation', 'release', 'consumption', 'adjustment',
  'damage', 'return', 'transfer_in', 'transfer_out'
);
CREATE TYPE affiliate_partner_status AS ENUM ('applicant', 'active', 'suspended', 'closed');
CREATE TYPE affiliate_commission_status AS ENUM (
  'pending', 'approved', 'held', 'payable', 'paid', 'reversed'
);
CREATE TYPE export_job_status AS ENUM (
  'queued', 'running', 'completed', 'failed', 'cancelled', 'expired'
);

CREATE TABLE inventory_location (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_-]+$'),
  name text NOT NULL,
  location_kind text NOT NULL CHECK (location_kind IN ('supplier', 'warehouse', 'fulfilment', 'transit')),
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  internal_address jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inventory_catalog_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE CHECK (sku ~ '^[A-Z0-9._-]{2,80}$'),
  catalog_release text NOT NULL,
  part_key text NOT NULL,
  color_key text NOT NULL,
  localized_name jsonb NOT NULL DEFAULT '{}'::jsonb,
  weight_grams numeric(12, 3) CHECK (weight_grams IS NULL OR weight_grams >= 0),
  unit_cost_eur_minor bigint CHECK (unit_cost_eur_minor IS NULL OR unit_cost_eur_minor >= 0),
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (catalog_release, part_key, color_key)
);

CREATE TABLE inventory_balance (
  location_id uuid NOT NULL REFERENCES inventory_location(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES inventory_catalog_item(id) ON DELETE RESTRICT,
  on_hand_quantity integer NOT NULL DEFAULT 0 CHECK (on_hand_quantity >= 0),
  reserved_quantity integer NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  damaged_quantity integer NOT NULL DEFAULT 0 CHECK (damaged_quantity >= 0),
  available_quantity integer GENERATED ALWAYS AS (
    on_hand_quantity - reserved_quantity - damaged_quantity
  ) STORED,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, item_id),
  CHECK (reserved_quantity + damaged_quantity <= on_hand_quantity)
);

CREATE TABLE inventory_movement (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id uuid NOT NULL REFERENCES inventory_location(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES inventory_catalog_item(id) ON DELETE RESTRICT,
  movement_kind inventory_movement_kind NOT NULL,
  on_hand_delta integer NOT NULL DEFAULT 0,
  reserved_delta integer NOT NULL DEFAULT 0,
  damaged_delta integer NOT NULL DEFAULT 0,
  order_id uuid REFERENCES commerce_order(id) ON DELETE RESTRICT,
  order_item_id uuid REFERENCES order_item(id) ON DELETE RESTRICT,
  reference_type text,
  reference_id text,
  reason text,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 16 AND 200),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (on_hand_delta <> 0 OR reserved_delta <> 0 OR damaged_delta <> 0)
);

CREATE INDEX inventory_movement_item_time_idx
  ON inventory_movement(item_id, location_id, occurred_at DESC);
CREATE INDEX inventory_movement_order_idx
  ON inventory_movement(order_id, occurred_at DESC) WHERE order_id IS NOT NULL;

CREATE TABLE inventory_reservation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES commerce_order(id) ON DELETE RESTRICT,
  order_item_id uuid REFERENCES order_item(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES inventory_location(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES inventory_catalog_item(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'released', 'consumed', 'expired')),
  expires_at timestamptz,
  released_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, item_id, location_id),
  CHECK (status <> 'released' OR released_at IS NOT NULL),
  CHECK (status <> 'consumed' OR consumed_at IS NOT NULL)
);

CREATE INDEX inventory_reservation_open_idx
  ON inventory_reservation(expires_at) WHERE status = 'reserved';

CREATE FUNCTION apply_inventory_movement() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pixbrik, public
AS $$
BEGIN
  IF NOT request_is_staff() THEN
    RAISE EXCEPTION 'inventory movements require an authenticated staff context';
  END IF;

  NEW.actor_user_id := COALESCE(NEW.actor_user_id, request_user_id());
  INSERT INTO inventory_balance (
    location_id, item_id, on_hand_quantity, reserved_quantity, damaged_quantity, updated_at
  ) VALUES (
    NEW.location_id,
    NEW.item_id,
    NEW.on_hand_delta,
    NEW.reserved_delta,
    NEW.damaged_delta,
    now()
  )
  ON CONFLICT (location_id, item_id) DO UPDATE SET
    on_hand_quantity = inventory_balance.on_hand_quantity + EXCLUDED.on_hand_quantity,
    reserved_quantity = inventory_balance.reserved_quantity + EXCLUDED.reserved_quantity,
    damaged_quantity = inventory_balance.damaged_quantity + EXCLUDED.damaged_quantity,
    updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_movement_apply_balance
  BEFORE INSERT ON inventory_movement
  FOR EACH ROW EXECUTE FUNCTION apply_inventory_movement();

CREATE FUNCTION prevent_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is an immutable ledger; append a correcting entry', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER inventory_movement_no_mutation
  BEFORE UPDATE OR DELETE ON inventory_movement
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

CREATE TABLE affiliate_partner (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES app_user(id) ON DELETE RESTRICT,
  public_name text NOT NULL,
  contact_email text NOT NULL CHECK (contact_email = lower(contact_email) AND position('@' IN contact_email) > 1),
  status affiliate_partner_status NOT NULL DEFAULT 'applicant',
  default_commission_basis_points integer NOT NULL DEFAULT 0
    CHECK (default_commission_basis_points BETWEEN 0 AND 10000),
  payout_currency text NOT NULL DEFAULT 'EUR' REFERENCES currency(code),
  terms_version text,
  approved_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'active' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE affiliate_code (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES affiliate_partner(id) ON DELETE RESTRICT,
  code text NOT NULL UNIQUE CHECK (code = upper(code) AND code ~ '^[A-Z0-9_-]{3,40}$'),
  destination_path text NOT NULL DEFAULT '/',
  commission_basis_points integer CHECK (commission_basis_points BETWEEN 0 AND 10000),
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE affiliate_attribution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id uuid NOT NULL REFERENCES affiliate_code(id) ON DELETE RESTRICT,
  anonymous_id_hash text CHECK (anonymous_id_hash IS NULL OR length(anonymous_id_hash) >= 32),
  session_id_hash text CHECK (session_id_hash IS NULL OR length(session_id_hash) >= 32),
  user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  attribution_model text NOT NULL DEFAULT 'last_click'
    CHECK (attribution_model IN ('first_click', 'last_click', 'manual')),
  consent_state text NOT NULL DEFAULT 'not_required'
    CHECK (consent_state IN ('granted', 'denied', 'not_required', 'unknown')),
  landing_path text,
  referrer_host text,
  occurred_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  converted_order_id uuid UNIQUE REFERENCES commerce_order(id) ON DELETE RESTRICT,
  converted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > occurred_at),
  CHECK (converted_order_id IS NULL OR converted_at IS NOT NULL),
  CHECK (anonymous_id_hash IS NOT NULL OR session_id_hash IS NOT NULL OR user_id IS NOT NULL)
);

CREATE INDEX affiliate_attribution_lookup_idx
  ON affiliate_attribution(code_id, occurred_at DESC);

CREATE TABLE affiliate_commission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES affiliate_partner(id) ON DELETE RESTRICT,
  attribution_id uuid REFERENCES affiliate_attribution(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL UNIQUE REFERENCES commerce_order(id) ON DELETE RESTRICT,
  status affiliate_commission_status NOT NULL DEFAULT 'pending',
  qualifying_revenue_eur_minor bigint NOT NULL CHECK (qualifying_revenue_eur_minor >= 0),
  commission_basis_points integer NOT NULL CHECK (commission_basis_points BETWEEN 0 AND 10000),
  commission_eur_minor bigint NOT NULL CHECK (commission_eur_minor >= 0),
  eligible_at timestamptz,
  approved_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approved_at timestamptz,
  hold_reason text,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status <> 'reversed' OR (reversed_at IS NOT NULL AND reversal_reason IS NOT NULL))
);

CREATE INDEX affiliate_commission_partner_status_idx
  ON affiliate_commission(partner_id, status, created_at DESC);

CREATE TABLE affiliate_payout_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_reference text NOT NULL UNIQUE,
  presentment_currency text NOT NULL REFERENCES currency(code),
  fx_rate_snapshot numeric(24, 12) NOT NULL CHECK (fx_rate_snapshot > 0),
  total_eur_minor bigint NOT NULL CHECK (total_eur_minor >= 0),
  total_presentment_minor bigint NOT NULL CHECK (total_presentment_minor >= 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'processing', 'paid', 'failed', 'cancelled')),
  provider_reference text,
  approved_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);

CREATE TABLE affiliate_payout_line (
  batch_id uuid NOT NULL REFERENCES affiliate_payout_batch(id) ON DELETE RESTRICT,
  commission_id uuid NOT NULL UNIQUE REFERENCES affiliate_commission(id) ON DELETE RESTRICT,
  partner_id uuid NOT NULL REFERENCES affiliate_partner(id) ON DELETE RESTRICT,
  amount_eur_minor bigint NOT NULL CHECK (amount_eur_minor >= 0),
  amount_presentment_minor bigint NOT NULL CHECK (amount_presentment_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, commission_id)
);

CREATE FUNCTION prevent_final_affiliate_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_TABLE_NAME = 'affiliate_commission' AND OLD.status IN ('paid', 'reversed'))
     OR (TG_TABLE_NAME = 'affiliate_payout_batch' AND OLD.status = 'paid') THEN
    RAISE EXCEPTION 'final affiliate financial records are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER affiliate_commission_final_guard
  BEFORE UPDATE OR DELETE ON affiliate_commission
  FOR EACH ROW EXECUTE FUNCTION prevent_final_affiliate_mutation();
CREATE TRIGGER affiliate_payout_batch_final_guard
  BEFORE UPDATE OR DELETE ON affiliate_payout_batch
  FOR EACH ROW EXECUTE FUNCTION prevent_final_affiliate_mutation();

CREATE TABLE analytics_visitor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_id_hash text NOT NULL UNIQUE CHECK (length(anonymous_id_hash) >= 32),
  user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  consent_state text NOT NULL CHECK (consent_state IN ('granted', 'denied', 'not_required', 'unknown')),
  do_not_track boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  initial_referrer_host text,
  initial_utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (last_seen_at >= first_seen_at)
);

CREATE TABLE analytics_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id_hash text NOT NULL UNIQUE CHECK (length(session_id_hash) >= 32),
  visitor_id uuid REFERENCES analytics_visitor(id) ON DELETE SET NULL,
  user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  consent_state text NOT NULL CHECK (consent_state IN ('granted', 'denied', 'not_required', 'unknown')),
  locale_code text REFERENCES locale(code),
  market_code text,
  landing_path text NOT NULL,
  referrer_host text,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX analytics_session_started_idx ON analytics_session(started_at DESC);

CREATE TABLE analytics_page_view (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES analytics_session(id) ON DELETE RESTRICT,
  path text NOT NULL,
  page_title text,
  previous_path text,
  locale_code text REFERENCES locale(code),
  market_code text,
  started_at timestamptz NOT NULL,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  engaged boolean,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX analytics_page_view_path_time_idx
  ON analytics_page_view(path, started_at DESC);

CREATE TRIGGER analytics_page_view_no_mutation
  BEFORE UPDATE OR DELETE ON analytics_page_view
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

CREATE TABLE data_export_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  export_kind text NOT NULL
    CHECK (export_kind IN ('orders', 'customers', 'inventory', 'models', 'analytics', 'affiliates', 'audit')),
  format text NOT NULL CHECK (format IN ('csv', 'jsonl', 'xlsx')),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status export_job_status NOT NULL DEFAULT 'queued',
  result_asset_id uuid REFERENCES stored_asset(id) ON DELETE RESTRICT,
  row_count bigint CHECK (row_count IS NULL OR row_count >= 0),
  error_summary text,
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'completed' OR (result_asset_id IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK (expires_at IS NULL OR expires_at > created_at)
);

-- A contact privacy notice is presented for transparency; it is not marketing
-- consent and must not be described as contractual acceptance.
ALTER TABLE contact_submission
  RENAME COLUMN privacy_consent_at TO privacy_notice_presented_at;
ALTER TABLE contact_submission
  ADD COLUMN privacy_notice_version text NOT NULL DEFAULT 'legacy-unversioned';

-- Legal applicability is a product/market decision, separate from translation.
ALTER TABLE legal_document
  ADD COLUMN product_types text[] NOT NULL DEFAULT ARRAY['custom_kit']::text[],
  ADD COLUMN content_sha256 text GENERATED ALWAYS AS (
    encode(digest(body_markdown, 'sha256'), 'hex')
  ) STORED,
  ADD CONSTRAINT legal_document_product_types_not_empty CHECK (cardinality(product_types) > 0);
ALTER TABLE legal_acceptance
  ADD COLUMN interaction_kind text NOT NULL DEFAULT 'acceptance'
    CHECK (interaction_kind IN ('acceptance', 'acknowledgement', 'presentation'));

CREATE TRIGGER inventory_location_touch_updated_at BEFORE UPDATE ON inventory_location
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER inventory_catalog_item_touch_updated_at BEFORE UPDATE ON inventory_catalog_item
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER inventory_reservation_touch_updated_at BEFORE UPDATE ON inventory_reservation
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER affiliate_partner_touch_updated_at BEFORE UPDATE ON affiliate_partner
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER affiliate_code_touch_updated_at BEFORE UPDATE ON affiliate_code
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER affiliate_commission_touch_updated_at BEFORE UPDATE ON affiliate_commission
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER affiliate_payout_batch_touch_updated_at BEFORE UPDATE ON affiliate_payout_batch
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER analytics_visitor_touch_updated_at BEFORE UPDATE ON analytics_visitor
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER analytics_session_touch_updated_at BEFORE UPDATE ON analytics_session
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER data_export_job_touch_updated_at BEFORE UPDATE ON data_export_job
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Operational data is staff-only at the database boundary. Affiliate users
-- may read their own partner and commission records, never other partners'.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'inventory_location', 'inventory_catalog_item', 'inventory_balance',
    'inventory_movement', 'inventory_reservation', 'affiliate_code',
    'affiliate_attribution', 'affiliate_payout_batch', 'affiliate_payout_line',
    'analytics_visitor', 'analytics_session', 'analytics_page_view', 'data_export_job'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (request_is_staff()) WITH CHECK (request_is_staff())',
      table_name || '_staff_only', table_name
    );
  END LOOP;
END;
$$;

ALTER TABLE affiliate_partner ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_partner FORCE ROW LEVEL SECURITY;
CREATE POLICY affiliate_partner_staff_write ON affiliate_partner
  FOR ALL USING (request_is_staff()) WITH CHECK (request_is_staff());
CREATE POLICY affiliate_partner_owner_read ON affiliate_partner
  FOR SELECT USING (request_is_staff() OR user_id = request_user_id());

ALTER TABLE affiliate_commission ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_commission FORCE ROW LEVEL SECURITY;
CREATE POLICY affiliate_commission_staff_write ON affiliate_commission
  FOR ALL USING (request_is_staff()) WITH CHECK (request_is_staff());
CREATE POLICY affiliate_commission_owner_read ON affiliate_commission
  FOR SELECT USING (
    request_is_staff()
    OR EXISTS (
      SELECT 1 FROM affiliate_partner partner
      WHERE partner.id = partner_id AND partner.user_id = request_user_id()
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pixbrik_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON
      inventory_location, inventory_catalog_item, inventory_balance,
      inventory_movement, inventory_reservation, affiliate_partner,
      affiliate_code, affiliate_attribution, affiliate_commission,
      affiliate_payout_batch, affiliate_payout_line, analytics_visitor,
      analytics_session, analytics_page_view, data_export_job
      TO pixbrik_runtime;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pixbrik TO pixbrik_runtime;
    GRANT EXECUTE ON FUNCTION apply_inventory_movement() TO pixbrik_runtime;
    REVOKE INSERT, UPDATE ON inventory_balance FROM pixbrik_runtime;
    REVOKE UPDATE ON inventory_movement, analytics_page_view FROM pixbrik_runtime;
  END IF;
END;
$$;

COMMENT ON TABLE inventory_movement IS 'Append-only inventory ledger; balance is maintained by its insert trigger.';
COMMENT ON COLUMN contact_submission.privacy_notice_presented_at IS 'Timestamp when the support privacy notice was presented; not consent.';
COMMENT ON TABLE analytics_page_view IS 'Consent-aware page view facts. Raw IP addresses are deliberately not stored.';
COMMENT ON TABLE data_export_job IS 'Auditable asynchronous exports; result assets must use private storage and expiry.';
