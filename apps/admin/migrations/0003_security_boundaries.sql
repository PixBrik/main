SET LOCAL search_path TO pixbrik, public;

REVOKE ALL ON SCHEMA pixbrik FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA pixbrik FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA pixbrik FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pixbrik FROM PUBLIC;

CREATE FUNCTION request_user_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('pixbrik.user_id', true), '')::uuid
$$;

CREATE FUNCTION request_is_staff() RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(current_setting('pixbrik.is_staff', true), 'false') = 'true'
$$;

ALTER TABLE customer_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_profile_isolation ON customer_profile
  FOR ALL
  USING (request_is_staff() OR user_id = request_user_id())
  WITH CHECK (request_is_staff() OR user_id = request_user_id());

ALTER TABLE customer_address ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_address FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_address_isolation ON customer_address
  FOR ALL
  USING (request_is_staff() OR user_id = request_user_id())
  WITH CHECK (request_is_staff() OR user_id = request_user_id());

ALTER TABLE stored_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE stored_asset FORCE ROW LEVEL SECURITY;
CREATE POLICY stored_asset_isolation ON stored_asset
  FOR ALL
  USING (request_is_staff() OR owner_user_id = request_user_id())
  WITH CHECK (request_is_staff() OR owner_user_id = request_user_id());

ALTER TABLE build ENABLE ROW LEVEL SECURITY;
ALTER TABLE build FORCE ROW LEVEL SECURITY;
CREATE POLICY build_isolation ON build
  FOR ALL
  USING (request_is_staff() OR owner_user_id = request_user_id())
  WITH CHECK (request_is_staff() OR owner_user_id = request_user_id());

ALTER TABLE build_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_version FORCE ROW LEVEL SECURITY;
CREATE POLICY build_version_isolation ON build_version
  FOR ALL
  USING (
    request_is_staff()
    OR EXISTS (SELECT 1 FROM build parent WHERE parent.id = build_id AND parent.owner_user_id = request_user_id())
  )
  WITH CHECK (
    request_is_staff()
    OR EXISTS (SELECT 1 FROM build parent WHERE parent.id = build_id AND parent.owner_user_id = request_user_id())
  );

ALTER TABLE commerce_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_order FORCE ROW LEVEL SECURITY;
CREATE POLICY commerce_order_isolation ON commerce_order
  FOR ALL
  USING (request_is_staff() OR customer_user_id = request_user_id())
  WITH CHECK (request_is_staff() OR customer_user_id = request_user_id());

ALTER TABLE order_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_item FORCE ROW LEVEL SECURITY;
CREATE POLICY order_item_isolation ON order_item
  FOR ALL
  USING (
    request_is_staff()
    OR EXISTS (SELECT 1 FROM commerce_order parent WHERE parent.id = order_id AND parent.customer_user_id = request_user_id())
  )
  WITH CHECK (
    request_is_staff()
    OR EXISTS (SELECT 1 FROM commerce_order parent WHERE parent.id = order_id AND parent.customer_user_id = request_user_id())
  );

ALTER TABLE invoice_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_document FORCE ROW LEVEL SECURITY;
CREATE POLICY invoice_document_isolation ON invoice_document
  FOR ALL
  USING (
    request_is_staff()
    OR EXISTS (SELECT 1 FROM commerce_order parent WHERE parent.id = order_id AND parent.customer_user_id = request_user_id())
  )
  WITH CHECK (
    request_is_staff()
    OR EXISTS (SELECT 1 FROM commerce_order parent WHERE parent.id = order_id AND parent.customer_user_id = request_user_id())
  );

ALTER TABLE checkout_recovery ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_recovery FORCE ROW LEVEL SECURITY;
CREATE POLICY checkout_recovery_isolation ON checkout_recovery
  FOR ALL
  USING (request_is_staff() OR customer_user_id = request_user_id())
  WITH CHECK (request_is_staff() OR customer_user_id = request_user_id());

ALTER TABLE legal_acceptance ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_acceptance FORCE ROW LEVEL SECURITY;
CREATE POLICY legal_acceptance_isolation ON legal_acceptance
  FOR ALL
  USING (request_is_staff() OR user_id = request_user_id())
  WITH CHECK (request_is_staff() OR user_id = request_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pixbrik_runtime') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA pixbrik TO pixbrik_runtime';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA pixbrik TO pixbrik_runtime';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pixbrik TO pixbrik_runtime';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pixbrik TO pixbrik_runtime';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA pixbrik GRANT SELECT, INSERT, UPDATE ON TABLES TO pixbrik_runtime';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA pixbrik GRANT USAGE, SELECT ON SEQUENCES TO pixbrik_runtime';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA pixbrik GRANT EXECUTE ON FUNCTIONS TO pixbrik_runtime';
  END IF;
END;
$$;

COMMENT ON FUNCTION request_user_id IS 'Returns the per-transaction user context set after server-side authentication.';
COMMENT ON FUNCTION request_is_staff IS 'Defense-in-depth staff context; the application must still enforce granular RBAC.';
