SET LOCAL search_path TO pixbrik, pg_catalog;

DO $$
BEGIN
  IF current_user::text <> 'pixbrik_migrator'
    OR session_user::text <> 'pixbrik_migrator' THEN
    RAISE EXCEPTION 'migration 0005 must run directly as pixbrik_migrator';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'pixbrik_migrator',
      'pixbrik_admin_runtime',
      'pixbrik_customer_runtime',
      'pixbrik_service_runtime'
    ]) AS required(role_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles existing
      WHERE existing.rolname = required.role_name
    )
  ) THEN
    RAISE EXCEPTION 'provision all four PixBrik database roles before migration 0005';
  END IF;
END;
$$;

ALTER TABLE order_item
  ADD COLUMN product_type text;
ALTER TABLE order_item
  ADD CONSTRAINT order_item_product_type_required
  CHECK (product_type IS NOT NULL AND product_type ~ '^[a-z0-9_-]+$') NOT VALID;
ALTER TABLE legal_document ALTER COLUMN product_types DROP DEFAULT;

-- Database roles, not request-controlled settings, decide whether a connection
-- is a customer, an administrator, or a trusted background service. The
-- provider provisions dedicated NOSUPERUSER/NOBYPASSRLS login identities;
-- this migration deliberately never creates a role or embeds a password.
CREATE OR REPLACE FUNCTION request_is_customer_database_role() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $$
  SELECT current_user::text = session_user::text
    AND session_user::text = 'pixbrik_customer_runtime'
$$;

CREATE OR REPLACE FUNCTION request_is_admin_database_role() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $$
  SELECT current_user::text = session_user::text
    AND session_user::text = 'pixbrik_admin_runtime'
$$;

CREATE OR REPLACE FUNCTION request_is_service_database_role() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $$
  SELECT current_user::text = session_user::text
    AND session_user::text = 'pixbrik_service_runtime'
$$;

CREATE OR REPLACE FUNCTION request_is_migrator_database_role() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $$
  SELECT current_user::text = session_user::text
    AND session_user::text = 'pixbrik_migrator'
$$;

-- Keep the old function name for existing policy/application compatibility,
-- but eliminate the caller-writable pixbrik.is_staff trust decision.
CREATE OR REPLACE FUNCTION request_is_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $$
  SELECT current_user::text = session_user::text
    AND session_user::text = 'pixbrik_admin_runtime'
$$;

CREATE OR REPLACE FUNCTION request_user_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN current_user::text = session_user::text
      AND session_user::text IN (
        'pixbrik_customer_runtime',
        'pixbrik_admin_runtime',
        'pixbrik_service_runtime'
      )
    THEN nullif(current_setting('pixbrik.user_id', true), '')::uuid
    ELSE NULL
  END
$$;

-- Remove every legacy policy before rebuilding the authorization boundary.
-- This prevents permissive policies from being ORed with the narrow policies.
DO $$
DECLARE
  policy_record record;
  table_name text;
BEGIN
  FOR policy_record IN
    SELECT tablename, policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'pixbrik'
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON pixbrik.%I',
      policy_record.policyname,
      policy_record.tablename
    );
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'locale', 'currency', 'market', 'market_country', 'market_locale', 'market_currency',
    'app_user', 'customer_profile', 'customer_address', 'role', 'permission', 'user_role',
    'role_permission', 'app_setting', 'shipping_origin', 'shipping_zone',
    'shipping_zone_country', 'shipping_rate', 'fx_rate', 'fx_refresh_run', 'stored_asset',
    'build', 'build_version', 'model_category', 'model_library_item', 'model_library_version',
    'commerce_order', 'order_item', 'order_event', 'payment_transaction', 'invoice_document',
    'coupon', 'coupon_redemption', 'recovery_campaign', 'checkout_recovery',
    'contact_submission', 'communication_template', 'outbound_message',
    'provider_webhook_event', 'legal_document', 'legal_acceptance', 'analytics_event',
    'audit_event', 'inventory_location', 'inventory_catalog_item', 'inventory_balance',
    'inventory_movement', 'inventory_reservation', 'affiliate_partner', 'affiliate_code',
    'affiliate_attribution', 'affiliate_commission', 'affiliate_payout_batch',
    'affiliate_payout_line', 'analytics_visitor', 'analytics_session', 'analytics_page_view',
    'data_export_job'
  ] LOOP
    EXECUTE format('ALTER TABLE pixbrik.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE pixbrik.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON pixbrik.%I FOR ALL USING (pixbrik.request_is_admin_database_role() OR pixbrik.request_is_migrator_database_role()) WITH CHECK (pixbrik.request_is_admin_database_role() OR pixbrik.request_is_migrator_database_role())',
      table_name || '_admin_access',
      table_name
    );
  END LOOP;
END;
$$;

-- Trusted services receive policies only on the records needed for checkout,
-- provider callbacks, generation, messaging, inventory, and analytics.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'locale', 'currency', 'market', 'market_country', 'market_locale', 'market_currency',
    'customer_profile', 'customer_address', 'shipping_origin', 'shipping_zone',
    'shipping_zone_country', 'shipping_rate', 'fx_rate', 'fx_refresh_run', 'stored_asset',
    'model_category', 'model_library_item', 'model_library_version',
    'commerce_order', 'order_item', 'order_event', 'payment_transaction', 'invoice_document',
    'coupon', 'coupon_redemption', 'recovery_campaign', 'checkout_recovery',
    'contact_submission', 'communication_template', 'outbound_message',
    'provider_webhook_event', 'legal_document', 'legal_acceptance', 'analytics_event',
    'audit_event', 'inventory_location', 'inventory_catalog_item', 'inventory_balance',
    'inventory_movement', 'inventory_reservation', 'affiliate_partner', 'affiliate_code',
    'affiliate_attribution', 'affiliate_commission', 'affiliate_payout_batch',
    'affiliate_payout_line', 'analytics_visitor', 'analytics_session', 'analytics_page_view',
    'data_export_job'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON pixbrik.%I FOR ALL USING (pixbrik.request_is_service_database_role()) WITH CHECK (pixbrik.request_is_service_database_role())',
      table_name || '_service_access',
      table_name
    );
  END LOOP;
END;
$$;

CREATE POLICY app_user_service_read ON app_user FOR SELECT
  USING (request_is_service_database_role() AND kind = 'customer');
CREATE POLICY app_user_service_insert ON app_user FOR INSERT
  WITH CHECK (request_is_service_database_role() AND kind = 'customer');
CREATE POLICY app_user_service_update ON app_user FOR UPDATE
  USING (request_is_service_database_role() AND kind = 'customer')
  WITH CHECK (request_is_service_database_role() AND kind = 'customer');

CREATE POLICY build_service_read ON build FOR SELECT
  USING (request_is_service_database_role());
CREATE POLICY build_service_insert ON build FOR INSERT
  WITH CHECK (
    request_is_service_database_role()
    AND status IN ('draft', 'generating', 'customer_review', 'archived')
    AND active_version_id IS NULL
  );
CREATE POLICY build_service_update ON build FOR UPDATE
  USING (
    request_is_service_database_role()
    AND status IN ('draft', 'generating', 'customer_review', 'archived')
  )
  WITH CHECK (
    request_is_service_database_role()
    AND status IN ('draft', 'generating', 'customer_review', 'archived')
    AND active_version_id IS NULL
  );

CREATE POLICY build_version_service_read ON build_version FOR SELECT
  USING (request_is_service_database_role());
CREATE POLICY build_version_service_insert ON build_version FOR INSERT
  WITH CHECK (
    request_is_service_database_role()
    AND status IN ('draft', 'processing', 'review', 'rejected')
    AND approved_by IS NULL AND approved_at IS NULL AND locked_at IS NULL
  );
CREATE POLICY build_version_service_update ON build_version FOR UPDATE
  USING (
    request_is_service_database_role()
    AND status IN ('draft', 'processing', 'review', 'rejected')
  )
  WITH CHECK (
    request_is_service_database_role()
    AND status IN ('draft', 'processing', 'review', 'rejected')
    AND approved_by IS NULL AND approved_at IS NULL AND locked_at IS NULL
  );

-- Customer-visible reference data. Shipping origins intentionally remain
-- internal, and draft/retired library and legal records never pass RLS.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'locale', 'currency', 'market', 'market_country', 'market_locale', 'market_currency',
    'shipping_zone', 'shipping_zone_country', 'shipping_rate'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON pixbrik.%I FOR SELECT USING (pixbrik.request_is_customer_database_role())',
      table_name || '_customer_read',
      table_name
    );
  END LOOP;
END;
$$;

CREATE POLICY app_user_customer_read ON app_user FOR SELECT
  USING (request_is_customer_database_role() AND id = request_user_id());
CREATE POLICY app_user_customer_update ON app_user FOR UPDATE
  USING (request_is_customer_database_role() AND id = request_user_id())
  WITH CHECK (request_is_customer_database_role() AND id = request_user_id());

CREATE POLICY customer_profile_customer_read ON customer_profile FOR SELECT
  USING (request_is_customer_database_role() AND user_id = request_user_id());
CREATE POLICY customer_profile_customer_update ON customer_profile FOR UPDATE
  USING (request_is_customer_database_role() AND user_id = request_user_id())
  WITH CHECK (request_is_customer_database_role() AND user_id = request_user_id());

CREATE POLICY customer_address_customer_read ON customer_address FOR SELECT
  USING (request_is_customer_database_role() AND user_id = request_user_id());
CREATE POLICY customer_address_customer_insert ON customer_address FOR INSERT
  WITH CHECK (request_is_customer_database_role() AND user_id = request_user_id());
CREATE POLICY customer_address_customer_update ON customer_address FOR UPDATE
  USING (request_is_customer_database_role() AND user_id = request_user_id())
  WITH CHECK (request_is_customer_database_role() AND user_id = request_user_id());

CREATE POLICY stored_asset_customer_read ON stored_asset FOR SELECT
  USING (request_is_customer_database_role() AND owner_user_id = request_user_id());
CREATE POLICY stored_asset_customer_insert ON stored_asset FOR INSERT
  WITH CHECK (
    request_is_customer_database_role()
    AND owner_user_id = request_user_id()
    AND status = 'pending_scan'
    AND is_private
  );

CREATE POLICY build_customer_read ON build FOR SELECT
  USING (request_is_customer_database_role() AND owner_user_id = request_user_id());
CREATE POLICY build_customer_insert ON build FOR INSERT
  WITH CHECK (
    request_is_customer_database_role()
    AND owner_user_id = request_user_id()
    AND status = 'draft'
    AND active_version_id IS NULL
    AND retakes_used = 0
  );
CREATE POLICY build_customer_update ON build FOR UPDATE
  USING (request_is_customer_database_role() AND owner_user_id = request_user_id())
  WITH CHECK (request_is_customer_database_role() AND owner_user_id = request_user_id());

CREATE POLICY build_version_customer_read ON build_version FOR SELECT
  USING (
    request_is_customer_database_role()
    AND EXISTS (
      SELECT 1 FROM build parent
      WHERE parent.id = build_id AND parent.owner_user_id = request_user_id()
    )
  );
CREATE POLICY commerce_order_customer_read ON commerce_order FOR SELECT
  USING (request_is_customer_database_role() AND customer_user_id = request_user_id());
CREATE POLICY order_item_customer_read ON order_item FOR SELECT
  USING (
    request_is_customer_database_role()
    AND EXISTS (
      SELECT 1 FROM commerce_order parent
      WHERE parent.id = order_id AND parent.customer_user_id = request_user_id()
    )
  );
CREATE POLICY invoice_document_customer_read ON invoice_document FOR SELECT
  USING (
    request_is_customer_database_role()
    AND EXISTS (
      SELECT 1 FROM commerce_order parent
      WHERE parent.id = order_id AND parent.customer_user_id = request_user_id()
    )
  );
CREATE POLICY checkout_recovery_customer_read ON checkout_recovery FOR SELECT
  USING (request_is_customer_database_role() AND customer_user_id = request_user_id());

CREATE POLICY model_category_customer_read ON model_category FOR SELECT
  USING (request_is_customer_database_role() AND enabled);
CREATE POLICY model_library_item_customer_read ON model_library_item FOR SELECT
  USING (request_is_customer_database_role() AND status = 'published');
CREATE POLICY model_library_version_customer_read ON model_library_version FOR SELECT
  USING (
    request_is_customer_database_role()
    AND status = 'published'
    AND EXISTS (
      SELECT 1 FROM model_library_item item
      WHERE item.id = item_id AND item.status = 'published'
    )
  );
CREATE POLICY legal_document_customer_read ON legal_document FOR SELECT
  USING (
    request_is_customer_database_role()
    AND status = 'effective'
    AND effective_at <= now()
    AND (retired_at IS NULL OR retired_at > now())
  );
CREATE POLICY legal_acceptance_customer_read ON legal_acceptance FOR SELECT
  USING (
    request_is_customer_database_role()
    AND user_id = request_user_id()
    AND (
      order_id IS NULL
      OR EXISTS (
        SELECT 1 FROM commerce_order parent
        WHERE parent.id = order_id AND parent.customer_user_id = request_user_id()
      )
    )
  );
-- A placed order's line items are part of the immutable commercial snapshot.
CREATE FUNCTION prevent_placed_order_item_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM commerce_order parent
    WHERE parent.id IN (
      CASE WHEN TG_OP = 'INSERT' THEN NEW.order_id ELSE OLD.order_id END,
      CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END
    )
      AND parent.placed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'placed order line items are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_item_placed_order_lock ON order_item;
CREATE TRIGGER order_item_placed_order_lock
  BEFORE INSERT OR UPDATE OR DELETE ON order_item
  FOR EACH ROW EXECUTE FUNCTION prevent_placed_order_item_mutation();

-- The normalized language x subdivision x product x permitted-use legal release
-- scope is intentionally not guessed in this migration. Keep every order before
-- placement/payment until a reviewed follow-up migration replaces this trigger.
CREATE FUNCTION block_checkout_until_legal_release_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_temp
AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR (OLD.placed_at IS NULL AND OLD.paid_at IS NULL))
    AND (
      NEW.placed_at IS NOT NULL
      OR NEW.paid_at IS NOT NULL
      OR NEW.stripe_checkout_session_id IS NOT NULL
      OR NEW.stripe_payment_intent_id IS NOT NULL
      OR NEW.status NOT IN ('draft', 'awaiting_design_approval')
    ) THEN
    RAISE EXCEPTION 'checkout blocked: normalized approved legal release scope is not implemented';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commerce_order_legal_release_gate ON commerce_order;
CREATE TRIGGER commerce_order_legal_release_gate
  BEFORE INSERT OR UPDATE ON commerce_order
  FOR EACH ROW EXECUTE FUNCTION block_checkout_until_legal_release_scope();

CREATE FUNCTION validate_payment_transaction_order() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM commerce_order parent
    WHERE parent.id = NEW.order_id AND parent.placed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'payment transactions require an already placed order';
  END IF;
  IF NEW.provider <> 'stripe' THEN
    RAISE EXCEPTION 'unsupported payment provider';
  END IF;
  IF NEW.raw_event_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM provider_webhook_event event
    WHERE event.provider = 'stripe'
      AND event.provider_event_id = NEW.raw_event_id
      AND event.signature_verified
  ) THEN
    RAISE EXCEPTION 'Stripe payment transactions require a verified webhook event';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_transaction_order_guard ON payment_transaction;
CREATE TRIGGER payment_transaction_order_guard
  BEFORE INSERT OR UPDATE ON payment_transaction
  FOR EACH ROW EXECUTE FUNCTION validate_payment_transaction_order();

-- A webhook's signed identity and payload evidence is append-only. Processing
-- workers may only advance the processing fields after the event is recorded.
CREATE FUNCTION prevent_webhook_event_fact_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'provider webhook evidence cannot be deleted';
  END IF;
  IF NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id
    OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.signature_verified IS DISTINCT FROM OLD.signature_verified
    OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
    OR NEW.received_at IS DISTINCT FROM OLD.received_at
  THEN
    RAISE EXCEPTION 'provider webhook signed facts are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS provider_webhook_event_fact_lock ON provider_webhook_event;
CREATE TRIGGER provider_webhook_event_fact_lock
  BEFORE UPDATE OR DELETE ON provider_webhook_event
  FOR EACH ROW EXECUTE FUNCTION prevent_webhook_event_fact_mutation();

-- Coupon definitions are manageable, but redemption stays disabled until a
-- normalized database evaluator enforces first-order, market, currency,
-- subtotal, expiry and exact discount-amount rules together.
CREATE FUNCTION block_coupon_redemption_until_policy_engine() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('reserved', 'applied') THEN
    RAISE EXCEPTION 'coupon redemption blocked: database eligibility evaluator is not implemented';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coupon_redemption_policy_gate ON coupon_redemption;
CREATE TRIGGER coupon_redemption_policy_gate
  BEFORE INSERT OR UPDATE ON coupon_redemption
  FOR EACH ROW EXECUTE FUNCTION block_coupon_redemption_until_policy_engine();

-- Extend legal-document version immutability to fields introduced after 0001.
CREATE OR REPLACE FUNCTION prevent_effective_legal_document_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_temp
AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'approved legal document versions cannot be deleted';
    END IF;
    IF NEW.document_key IS DISTINCT FROM OLD.document_key
      OR NEW.locale_code IS DISTINCT FROM OLD.locale_code
      OR NEW.version IS DISTINCT FROM OLD.version
      OR NEW.title IS DISTINCT FROM OLD.title
      OR NEW.body_markdown IS DISTINCT FROM OLD.body_markdown
      OR NEW.markets IS DISTINCT FROM OLD.markets
      OR NEW.product_types IS DISTINCT FROM OLD.product_types
      OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
      OR (OLD.status IN ('effective', 'retired') AND NEW.effective_at IS DISTINCT FROM OLD.effective_at)
      OR (OLD.status = 'retired' AND NEW.status <> 'retired')
      OR (OLD.status = 'effective' AND NEW.status NOT IN ('effective', 'retired'))
    THEN
      RAISE EXCEPTION 'approved legal document content and applicability are immutable; create a new version';
    END IF;
    IF NEW.status = 'retired' AND NEW.retired_at IS NULL THEN
      RAISE EXCEPTION 'retired legal documents require retired_at';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_legal_acceptance() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_temp
AS $$
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
  IF NEW.user_id IS NOT NULL AND NEW.order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce_order parent
    WHERE parent.id = NEW.order_id AND parent.customer_user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'legal acceptance user must own the referenced order';
  END IF;
  IF NEW.order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM legal_document document
    JOIN commerce_order accepted_order ON accepted_order.id = NEW.order_id
    JOIN market accepted_market ON accepted_market.id = accepted_order.market_id
    WHERE document.id = NEW.legal_document_id
      AND document.locale_code = accepted_order.locale_code
      AND cardinality(document.markets) > 0
      AND accepted_market.code = ANY(document.markets)
      AND EXISTS (
        SELECT 1 FROM order_item item
        WHERE item.order_id = accepted_order.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM order_item item
        WHERE item.order_id = accepted_order.id
          AND (
            item.product_type IS NULL
            OR item.product_type = ''
            OR item.product_type <> ALL(document.product_types)
          )
      )
  ) THEN
    RAISE EXCEPTION 'legal document must cover the order market and every product type';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS legal_acceptance_effective_guard ON legal_acceptance;
CREATE TRIGGER legal_acceptance_effective_guard
  BEFORE INSERT ON legal_acceptance
  FOR EACH ROW EXECUTE FUNCTION validate_legal_acceptance();
DROP TRIGGER IF EXISTS legal_acceptance_no_mutation ON legal_acceptance;
CREATE TRIGGER legal_acceptance_no_mutation
  BEFORE UPDATE OR DELETE ON legal_acceptance
  FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

-- Inventory movement remains the sole balance mutation path. Authorization is
-- derived from the immutable login identity; actor_user_id supplied by callers
-- is discarded in favor of the verified request context.
CREATE OR REPLACE FUNCTION apply_inventory_movement() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pixbrik, pg_temp
AS $$
BEGIN
  IF session_user::text NOT IN ('pixbrik_admin_runtime', 'pixbrik_service_runtime') THEN
    RAISE EXCEPTION 'inventory movements require an admin or service database role';
  END IF;

  IF NEW.order_item_id IS NOT NULL AND (
    NEW.order_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM order_item item
      WHERE item.id = NEW.order_item_id AND item.order_id = NEW.order_id
    )
  ) THEN
    RAISE EXCEPTION 'inventory movement order item must belong to its order';
  END IF;

  NEW.actor_user_id := CASE
    WHEN session_user::text = 'pixbrik_admin_runtime'
    THEN nullif(current_setting('pixbrik.user_id', true), '')::uuid
    ELSE NULL
  END;

  INSERT INTO inventory_balance (
    location_id, item_id, on_hand_quantity, reserved_quantity, damaged_quantity, updated_at
  ) VALUES (
    NEW.location_id, NEW.item_id, NEW.on_hand_delta, NEW.reserved_delta,
    NEW.damaged_delta, now()
  )
  ON CONFLICT (location_id, item_id) DO UPDATE SET
    on_hand_quantity = inventory_balance.on_hand_quantity + EXCLUDED.on_hand_quantity,
    reserved_quantity = inventory_balance.reserved_quantity + EXCLUDED.reserved_quantity,
    damaged_quantity = inventory_balance.damaged_quantity + EXCLUDED.damaged_quantity,
    updated_at = now();
  RETURN NEW;
END;
$$;

ALTER FUNCTION apply_inventory_movement() OWNER TO pixbrik_migrator;
REVOKE ALL ON FUNCTION apply_inventory_movement() FROM PUBLIC;

-- SECURITY DEFINER changes current_user to the function owner. This narrowly
-- scoped policy authorizes its balance write from a trusted immutable login;
-- neither runtime role receives direct balance INSERT/UPDATE privileges.
CREATE POLICY inventory_balance_movement_apply ON inventory_balance
  FOR ALL
  USING (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text IN ('pixbrik_admin_runtime', 'pixbrik_service_runtime')
  )
  WITH CHECK (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text IN ('pixbrik_admin_runtime', 'pixbrik_service_runtime')
  );

CREATE POLICY order_item_inventory_movement_lookup ON order_item
  FOR SELECT
  USING (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text IN ('pixbrik_admin_runtime', 'pixbrik_service_runtime')
  );

CREATE FUNCTION validate_inventory_reservation_order_item() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_temp
AS $$
BEGIN
  IF NEW.order_item_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM order_item item
    WHERE item.id = NEW.order_item_id AND item.order_id = NEW.order_id
  ) THEN
    RAISE EXCEPTION 'inventory reservation requires an order item belonging to its order';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_reservation_order_item_guard ON inventory_reservation;
CREATE TRIGGER inventory_reservation_order_item_guard
  BEFORE INSERT OR UPDATE OF order_id, order_item_id ON inventory_reservation
  FOR EACH ROW EXECUTE FUNCTION validate_inventory_reservation_order_item();

-- Payout lines must remain tied to the commission and cannot be rewritten once
-- the batch leaves draft. Batch totals are verified at approval/payment.
CREATE OR REPLACE FUNCTION prevent_final_affiliate_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_temp
AS $$
BEGIN
  IF OLD.status IN ('paid', 'reversed') THEN
    RAISE EXCEPTION 'final affiliate financial records are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'pending' AND NEW.status IN ('approved', 'held', 'reversed'))
    OR (OLD.status = 'approved' AND NEW.status IN ('payable', 'held', 'reversed'))
    OR (OLD.status = 'held' AND NEW.status IN ('approved', 'payable', 'reversed'))
    OR (OLD.status = 'payable' AND NEW.status IN ('paid', 'held', 'reversed'))
  ) THEN
    RAISE EXCEPTION 'invalid affiliate commission status transition';
  END IF;
  IF (
    OLD.status IN ('approved', 'held', 'payable')
    OR NEW.status IN ('approved', 'held', 'payable', 'paid', 'reversed')
  ) AND (
    NEW.partner_id IS DISTINCT FROM OLD.partner_id
    OR NEW.attribution_id IS DISTINCT FROM OLD.attribution_id
    OR NEW.order_id IS DISTINCT FROM OLD.order_id
    OR NEW.qualifying_revenue_eur_minor IS DISTINCT FROM OLD.qualifying_revenue_eur_minor
    OR NEW.commission_basis_points IS DISTINCT FROM OLD.commission_basis_points
    OR NEW.commission_eur_minor IS DISTINCT FROM OLD.commission_eur_minor
  ) THEN
    RAISE EXCEPTION 'approved affiliate commission financial facts are immutable';
  END IF;
  IF NEW.status = 'paid' AND NOT EXISTS (
    SELECT 1
    FROM affiliate_payout_line line
    JOIN affiliate_payout_batch batch ON batch.id = line.batch_id
    WHERE line.commission_id = NEW.id
      AND line.partner_id = NEW.partner_id
      AND line.amount_eur_minor = NEW.commission_eur_minor
      AND batch.status IN ('processing', 'paid')
  ) THEN
    RAISE EXCEPTION 'paid commissions require a matching processing payout batch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_affiliate_payout_line() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_temp
AS $$
DECLARE
  commission_record affiliate_commission%ROWTYPE;
  batch_record affiliate_payout_batch%ROWTYPE;
  old_batch_status text;
  partner_currency text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT * INTO batch_record FROM affiliate_payout_batch WHERE id = OLD.batch_id FOR UPDATE;
    IF batch_record.status <> 'draft' THEN
      RAISE EXCEPTION 'non-draft affiliate payout lines are immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.batch_id IS DISTINCT FROM NEW.batch_id THEN
    SELECT status INTO old_batch_status
    FROM affiliate_payout_batch WHERE id = OLD.batch_id FOR UPDATE;
    IF old_batch_status <> 'draft' THEN
      RAISE EXCEPTION 'non-draft affiliate payout lines are immutable';
    END IF;
  END IF;

  SELECT * INTO commission_record FROM affiliate_commission
    WHERE id = NEW.commission_id FOR UPDATE;
  SELECT * INTO batch_record FROM affiliate_payout_batch
    WHERE id = NEW.batch_id FOR UPDATE;
  SELECT payout_currency INTO partner_currency FROM affiliate_partner
    WHERE id = NEW.partner_id;

  IF NOT FOUND OR batch_record.id IS NULL OR commission_record.id IS NULL THEN
    RAISE EXCEPTION 'affiliate payout references must exist';
  END IF;
  IF batch_record.status <> 'draft' THEN
    RAISE EXCEPTION 'non-draft affiliate payout lines are immutable';
  END IF;
  IF commission_record.partner_id <> NEW.partner_id THEN
    RAISE EXCEPTION 'payout line partner must match its commission';
  END IF;
  IF commission_record.status NOT IN ('approved', 'payable') THEN
    RAISE EXCEPTION 'only approved or payable commissions may enter a payout';
  END IF;
  IF NEW.amount_eur_minor <> commission_record.commission_eur_minor THEN
    RAISE EXCEPTION 'payout line amount must match its commission';
  END IF;
  IF NEW.amount_presentment_minor <>
    round(commission_record.commission_eur_minor::numeric * batch_record.fx_rate_snapshot)::bigint
  THEN
    RAISE EXCEPTION 'payout line presentment amount must match the frozen FX rate';
  END IF;
  IF partner_currency <> batch_record.presentment_currency THEN
    RAISE EXCEPTION 'payout batch currency must match partner payout currency';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS affiliate_payout_line_integrity_guard ON affiliate_payout_line;
CREATE TRIGGER affiliate_payout_line_integrity_guard
  BEFORE INSERT OR UPDATE OR DELETE ON affiliate_payout_line
  FOR EACH ROW EXECUTE FUNCTION validate_affiliate_payout_line();

CREATE FUNCTION validate_affiliate_payout_batch_totals() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_temp
AS $$
DECLARE
  line_count bigint;
  eur_total bigint;
  presentment_total bigint;
BEGIN
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'paid affiliate payout batches are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'non-draft affiliate payout batches cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'affiliate payout batches cannot return to draft';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'draft' AND NEW.status IN ('approved', 'cancelled'))
    OR (OLD.status = 'approved' AND NEW.status IN ('processing', 'cancelled'))
    OR (OLD.status = 'processing' AND NEW.status IN ('paid', 'failed'))
    OR (OLD.status = 'failed' AND NEW.status IN ('processing', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid affiliate payout batch status transition';
  END IF;
  IF (OLD.status <> 'draft' OR NEW.status <> 'draft') AND (
    NEW.batch_reference IS DISTINCT FROM OLD.batch_reference
    OR NEW.presentment_currency IS DISTINCT FROM OLD.presentment_currency
    OR NEW.fx_rate_snapshot IS DISTINCT FROM OLD.fx_rate_snapshot
    OR NEW.total_eur_minor IS DISTINCT FROM OLD.total_eur_minor
    OR NEW.total_presentment_minor IS DISTINCT FROM OLD.total_presentment_minor
  ) THEN
    RAISE EXCEPTION 'approved affiliate payout financial facts are immutable';
  END IF;
  IF NEW.status IN ('approved', 'processing', 'paid') THEN
    SELECT count(*), coalesce(sum(amount_eur_minor), 0), coalesce(sum(amount_presentment_minor), 0)
      INTO line_count, eur_total, presentment_total
    FROM affiliate_payout_line WHERE batch_id = NEW.id;
    IF line_count = 0 OR eur_total <> NEW.total_eur_minor
      OR presentment_total <> NEW.total_presentment_minor THEN
      RAISE EXCEPTION 'affiliate payout batch totals must equal its lines';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM affiliate_payout_line line
      JOIN affiliate_commission commission ON commission.id = line.commission_id
      JOIN affiliate_partner partner ON partner.id = line.partner_id
      WHERE line.batch_id = NEW.id
        AND (
          line.partner_id <> commission.partner_id
          OR line.amount_eur_minor <> commission.commission_eur_minor
          OR partner.payout_currency <> NEW.presentment_currency
          OR commission.status NOT IN ('approved', 'payable', 'paid')
        )
    ) THEN
      RAISE EXCEPTION 'affiliate payout lines no longer match their commissions';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS affiliate_payout_batch_final_guard ON affiliate_payout_batch;
CREATE TRIGGER affiliate_payout_batch_final_guard
  BEFORE UPDATE OR DELETE ON affiliate_payout_batch
  FOR EACH ROW EXECUTE FUNCTION validate_affiliate_payout_batch_totals();

-- Pin every inherited trigger function to trusted schemas. This both makes
-- unqualified 0001 references deterministic and prevents pg_temp/public object
-- shadowing while privileged or cross-table triggers execute.
ALTER FUNCTION touch_updated_at() SET search_path TO pixbrik, pg_temp;
ALTER FUNCTION prevent_locked_build_version_mutation() SET search_path TO pixbrik, pg_temp;
ALTER FUNCTION prevent_issued_invoice_mutation() SET search_path TO pixbrik, pg_temp;
ALTER FUNCTION validate_active_build_version() SET search_path TO pixbrik, pg_temp;
ALTER FUNCTION validate_order_item_build_version() SET search_path TO pixbrik, pg_temp;
ALTER FUNCTION prevent_placed_order_snapshot_mutation() SET search_path TO pixbrik, pg_temp;
ALTER FUNCTION prevent_overlapping_shipping_rate() SET search_path TO pixbrik, pg_temp;
ALTER FUNCTION enforce_coupon_redemption_limits() SET search_path TO pixbrik, pg_temp;
ALTER FUNCTION prevent_effective_legal_document_mutation() SET search_path TO pixbrik, pg_temp;
ALTER FUNCTION validate_legal_acceptance() SET search_path TO pixbrik, pg_temp;
ALTER FUNCTION prevent_append_only_mutation() SET search_path TO pixbrik, pg_temp;
ALTER FUNCTION prevent_ledger_mutation() SET search_path TO pixbrik, pg_temp;
ALTER FUNCTION prevent_final_affiliate_mutation() SET search_path TO pixbrik, pg_temp;

-- Remove the broad legacy grants and future-object defaults. These commands
-- are conditional so managed PostgreSQL providers can provision roles outside
-- the migration owner. Missing replacement roles leave the database closed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pixbrik_runtime') THEN
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA pixbrik FROM pixbrik_runtime;
    REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA pixbrik FROM pixbrik_runtime;
    REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA pixbrik FROM pixbrik_runtime;
    REVOKE USAGE ON SCHEMA pixbrik FROM pixbrik_runtime;
    ALTER DEFAULT PRIVILEGES IN SCHEMA pixbrik REVOKE ALL ON TABLES FROM pixbrik_runtime;
    ALTER DEFAULT PRIVILEGES IN SCHEMA pixbrik REVOKE ALL ON SEQUENCES FROM pixbrik_runtime;
    ALTER DEFAULT PRIVILEGES IN SCHEMA pixbrik REVOKE ALL ON FUNCTIONS FROM pixbrik_runtime;
  END IF;
END;
$$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pixbrik FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA pixbrik REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  request_user_id(), request_is_staff(), request_is_customer_database_role(),
  request_is_admin_database_role(), request_is_service_database_role(),
  request_is_migrator_database_role()
TO pixbrik_migrator, pixbrik_admin_runtime, pixbrik_customer_runtime,
  pixbrik_service_runtime;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pixbrik_customer_runtime') THEN
    GRANT USAGE ON SCHEMA pixbrik TO pixbrik_customer_runtime;
    GRANT SELECT ON
      locale, currency, market, market_country, market_locale, market_currency,
      shipping_zone, shipping_zone_country, shipping_rate, app_user, customer_profile,
      customer_address, stored_asset, build, build_version, model_category,
      model_library_item, model_library_version, commerce_order, order_item,
      invoice_document, checkout_recovery, legal_document, legal_acceptance
      TO pixbrik_customer_runtime;
    GRANT UPDATE (display_name, preferred_locale, preferred_currency)
      ON app_user TO pixbrik_customer_runtime;
    GRANT UPDATE (
      phone_e164, marketing_email_consent, marketing_consent_at, marketing_consent_source
    ) ON customer_profile TO pixbrik_customer_runtime;
    GRANT INSERT (
      user_id, label, recipient_name, company, line1, line2, postal_code, city,
      region, country_code, phone_e164, is_default_shipping, is_default_billing
    ) ON customer_address TO pixbrik_customer_runtime;
    GRANT UPDATE (
      label, recipient_name, company, line1, line2, postal_code, city, region,
      country_code, phone_e164, is_default_shipping, is_default_billing
    ) ON customer_address TO pixbrik_customer_runtime;
    GRANT INSERT (
      owner_user_id, storage_provider, object_key, original_filename, content_type,
      byte_size, sha256, is_private, metadata
    ) ON stored_asset TO pixbrik_customer_runtime;
    GRANT INSERT (owner_user_id, title, subject_type)
      ON build TO pixbrik_customer_runtime;
    GRANT UPDATE (title, subject_type) ON build TO pixbrik_customer_runtime;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pixbrik_admin_runtime') THEN
    GRANT USAGE ON SCHEMA pixbrik TO pixbrik_admin_runtime;
    GRANT SELECT ON
      locale, currency, market, market_country, market_locale, market_currency,
      app_user, customer_profile, customer_address, role, permission, user_role,
      role_permission, app_setting, shipping_origin, shipping_zone,
      shipping_zone_country, shipping_rate, fx_rate, fx_refresh_run, stored_asset,
      build, build_version, model_category, model_library_item, model_library_version,
      commerce_order, order_item, order_event, payment_transaction, invoice_document,
      coupon, coupon_redemption, recovery_campaign, checkout_recovery,
      contact_submission, communication_template, outbound_message,
      provider_webhook_event, legal_document, legal_acceptance, analytics_event,
      audit_event, inventory_location, inventory_catalog_item, inventory_balance,
      inventory_movement, inventory_reservation, affiliate_partner, affiliate_code,
      affiliate_attribution, affiliate_commission, affiliate_payout_batch,
      affiliate_payout_line, analytics_visitor, analytics_session, analytics_page_view,
      data_export_job
      TO pixbrik_admin_runtime;
    GRANT INSERT, UPDATE ON
      locale, currency, market, market_country, market_locale, market_currency,
      app_user, customer_profile, customer_address, role, permission, user_role,
      role_permission, app_setting, shipping_origin, shipping_zone,
      shipping_zone_country, shipping_rate, fx_refresh_run, stored_asset, build,
      build_version, model_category, model_library_item, model_library_version,
      commerce_order, order_item, invoice_document, coupon, coupon_redemption,
      recovery_campaign, checkout_recovery, contact_submission, communication_template,
      outbound_message, legal_document, inventory_location,
      inventory_catalog_item, inventory_reservation, affiliate_partner, affiliate_code,
      affiliate_attribution, affiliate_commission, affiliate_payout_batch,
      affiliate_payout_line, analytics_visitor, analytics_session, data_export_job
      TO pixbrik_admin_runtime;
    GRANT INSERT ON provider_webhook_event TO pixbrik_admin_runtime;
    GRANT UPDATE (processed_at, processing_status, error_summary)
      ON provider_webhook_event TO pixbrik_admin_runtime;
    GRANT INSERT ON
      fx_rate, order_event, payment_transaction, legal_acceptance, analytics_event,
      audit_event, inventory_movement, analytics_page_view
      TO pixbrik_admin_runtime;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pixbrik TO pixbrik_admin_runtime;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pixbrik_service_runtime') THEN
    GRANT USAGE ON SCHEMA pixbrik TO pixbrik_service_runtime;
    GRANT SELECT ON
      locale, currency, market, market_country, market_locale, market_currency,
      shipping_origin, shipping_zone, shipping_zone_country, shipping_rate, fx_rate,
      app_user, customer_profile, customer_address, stored_asset, build, build_version,
      model_category, model_library_item, model_library_version, commerce_order,
      order_item, coupon, coupon_redemption, recovery_campaign, checkout_recovery,
      communication_template, provider_webhook_event, legal_document,
      inventory_location, inventory_catalog_item,
      inventory_balance, inventory_movement, inventory_reservation
      TO pixbrik_service_runtime;
    GRANT INSERT, UPDATE ON
      customer_profile, stored_asset, commerce_order,
      order_item, invoice_document, coupon_redemption, checkout_recovery,
      contact_submission, outbound_message, inventory_reservation
      TO pixbrik_service_runtime;
    GRANT INSERT ON provider_webhook_event TO pixbrik_service_runtime;
    GRANT UPDATE (processed_at, processing_status, error_summary)
      ON provider_webhook_event TO pixbrik_service_runtime;
    GRANT INSERT (
      external_subject, email, status, display_name, preferred_locale,
      preferred_currency, email_verified_at, last_signed_in_at, deleted_at
    ) ON app_user TO pixbrik_service_runtime;
    GRANT UPDATE (
      external_subject, email, status, display_name, preferred_locale,
      preferred_currency, email_verified_at, last_signed_in_at, deleted_at
    ) ON app_user TO pixbrik_service_runtime;
    GRANT INSERT (owner_user_id, title, status, subject_type, retakes_used, archived_at)
      ON build TO pixbrik_service_runtime;
    GRANT UPDATE (title, status, subject_type, retakes_used, archived_at)
      ON build TO pixbrik_service_runtime;
    GRANT INSERT (
      build_id, version_number, status, source_asset_id, model_asset_id,
      brick_model_asset_id, preview_asset_id, provider, provider_job_id,
      conversion_engine_version, catalog_release, configuration_snapshot,
      bom_snapshot, width_mm, height_mm, depth_mm, brick_count,
      base_price_eur_minor, created_by
    ) ON build_version TO pixbrik_service_runtime;
    GRANT UPDATE (
      status, source_asset_id, model_asset_id, brick_model_asset_id,
      preview_asset_id, provider, provider_job_id, conversion_engine_version,
      catalog_release, configuration_snapshot, bom_snapshot, width_mm,
      height_mm, depth_mm, brick_count, base_price_eur_minor
    ) ON build_version TO pixbrik_service_runtime;
    GRANT INSERT ON
      order_event, payment_transaction, legal_acceptance, analytics_event, audit_event,
      inventory_movement, analytics_visitor, analytics_session, analytics_page_view
      TO pixbrik_service_runtime;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pixbrik TO pixbrik_service_runtime;
  END IF;

  GRANT USAGE, CREATE ON SCHEMA pixbrik TO pixbrik_migrator;
  GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA pixbrik TO pixbrik_migrator;
  GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA pixbrik TO pixbrik_migrator;
  GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA pixbrik TO pixbrik_migrator;
END;
$$;

COMMENT ON FUNCTION request_is_staff() IS
  'True only for the dedicated admin database login; request GUCs cannot grant staff authority.';
COMMENT ON FUNCTION apply_inventory_movement() IS
  'Security-definer trigger with a fixed trusted search path, immutable login authorization, and context-derived actor.';
COMMENT ON TABLE legal_acceptance IS
  'Append-only evidence. Corrections require a new interaction record and never overwrite historical evidence.';
