SET LOCAL search_path TO pixbrik, pg_catalog;

-- The identity bootstrap login is deliberately narrower than the admin and
-- service logins. Provision it through the database provider before applying
-- this migration; it receives only schema USAGE and EXECUTE on one function.
DO $migration$
DECLARE
  identity_oid oid;
BEGIN
  IF current_user::text <> 'pixbrik_migrator'
    OR session_user::text <> 'pixbrik_migrator' THEN
    RAISE EXCEPTION 'migration 0006 must run directly as pixbrik_migrator';
  END IF;

  SELECT role.oid
  INTO identity_oid
  FROM pg_catalog.pg_roles role
  WHERE role.rolname = 'pixbrik_identity_runtime';

  IF identity_oid IS NULL THEN
    RAISE EXCEPTION 'provision pixbrik_identity_runtime before migration 0006';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles role
    WHERE role.oid = identity_oid
      AND (
        NOT role.rolcanlogin
        OR role.rolsuper
        OR role.rolcreatedb
        OR role.rolcreaterole
        OR role.rolinherit
        OR role.rolreplication
        OR role.rolbypassrls
      )
  ) THEN
    RAISE EXCEPTION 'pixbrik_identity_runtime has unsafe role attributes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members membership
    WHERE membership.member = identity_oid
       OR membership.roleid = identity_oid
  ) THEN
    RAISE EXCEPTION 'pixbrik_identity_runtime must have no role memberships';
  END IF;
END;
$migration$;

-- FORCE RLS also applies while this migrator-owned SECURITY DEFINER function
-- runs. These policies authorize only the narrow owner claim when the immutable
-- session login is the dedicated identity role.
CREATE POLICY app_user_clerk_owner_claim_read
ON app_user FOR SELECT
USING (
  current_user::text = 'pixbrik_migrator'
  AND session_user::text = 'pixbrik_identity_runtime'
  AND email = 'sam@benisty.ca'
  AND kind = 'staff'
);

CREATE POLICY app_user_clerk_owner_claim_update
ON app_user FOR UPDATE
USING (
  current_user::text = 'pixbrik_migrator'
  AND session_user::text = 'pixbrik_identity_runtime'
  AND email = 'sam@benisty.ca'
  AND kind = 'staff'
)
WITH CHECK (
  current_user::text = 'pixbrik_migrator'
  AND session_user::text = 'pixbrik_identity_runtime'
  AND email = 'sam@benisty.ca'
  AND kind = 'staff'
  AND status = 'active'
  AND deleted_at IS NULL
  AND email_verified_at IS NOT NULL
  AND external_subject ~ '^clerk:user_[A-Za-z0-9_-]+$'
);

CREATE POLICY role_clerk_owner_claim_read
ON role FOR SELECT
USING (
  current_user::text = 'pixbrik_migrator'
  AND session_user::text = 'pixbrik_identity_runtime'
  AND key = 'owner'
);

CREATE POLICY user_role_clerk_owner_claim_read
ON user_role FOR SELECT
USING (
  current_user::text = 'pixbrik_migrator'
  AND session_user::text = 'pixbrik_identity_runtime'
  AND EXISTS (
    SELECT 1
    FROM app_user seeded
    WHERE seeded.id = user_role.user_id
      AND seeded.email = 'sam@benisty.ca'
      AND seeded.kind = 'staff'
  )
);

CREATE POLICY audit_event_clerk_owner_claim_insert
ON audit_event FOR INSERT
WITH CHECK (
  current_user::text = 'pixbrik_migrator'
  AND session_user::text = 'pixbrik_identity_runtime'
  AND action = 'identity.owner_claimed'
  AND target_type = 'app_user'
  AND actor_user_id IS NOT NULL
  AND target_id = actor_user_id::text
  AND actor_subject ~ '^clerk:user_[A-Za-z0-9_-]+$'
  AND request_id IS NOT NULL
  AND metadata ->> 'identity_provider' = 'clerk'
);

CREATE UNIQUE INDEX audit_event_owner_claim_request_once
  ON audit_event (request_id)
  WHERE action = 'identity.owner_claimed'
    AND request_id IS NOT NULL;

CREATE FUNCTION claim_seeded_clerk_owner(
  p_clerk_user_id text,
  p_verified_email text,
  p_clerk_email_id text,
  p_request_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  constant_owner_email constant text := 'sam@benisty.ca';
  clerk_user_id text;
  clerk_email_id text;
  normalized_email text;
  namespaced_subject text;
  claimed_at timestamptz := pg_catalog.clock_timestamp();
  before_user pixbrik.app_user%ROWTYPE;
  after_user pixbrik.app_user%ROWTYPE;
BEGIN
  IF current_user::text <> 'pixbrik_migrator'
    OR session_user::text <> 'pixbrik_identity_runtime' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'owner claim rejected';
  END IF;

  clerk_user_id := pg_catalog.btrim(p_clerk_user_id);
  clerk_email_id := pg_catalog.btrim(p_clerk_email_id);
  normalized_email := pg_catalog.lower(pg_catalog.btrim(p_verified_email));

  IF clerk_user_id IS NULL
    OR pg_catalog.length(clerk_user_id) < 6
    OR pg_catalog.length(clerk_user_id) > 245
    OR pg_catalog.left(clerk_user_id, 5) <> 'user_'
    OR clerk_user_id ~ '[^A-Za-z0-9_-]'
    OR clerk_email_id IS NULL
    OR pg_catalog.length(clerk_email_id) < 5
    OR pg_catalog.length(clerk_email_id) > 245
    OR pg_catalog.left(clerk_email_id, 4) <> 'idn_'
    OR clerk_email_id ~ '[^A-Za-z0-9_-]'
    OR normalized_email IS DISTINCT FROM constant_owner_email
    OR p_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'owner claim rejected';
  END IF;

  namespaced_subject := 'clerk:' || clerk_user_id;

  SELECT seeded.*
  INTO before_user
  FROM pixbrik.app_user seeded
  WHERE seeded.email = constant_owner_email
  FOR UPDATE;

  IF NOT FOUND
    OR before_user.kind <> 'staff'
    OR before_user.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'owner claim rejected';
  END IF;

  -- Claiming binds an existing invitation; it must never create owner authority.
  IF NOT EXISTS (
    SELECT 1
    FROM pixbrik.user_role assignment
    JOIN pixbrik.role assigned_role ON assigned_role.id = assignment.role_id
    WHERE assignment.user_id = before_user.id
      AND assigned_role.key = 'owner'
      AND (assignment.expires_at IS NULL OR assignment.expires_at > claimed_at)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'owner claim rejected';
  END IF;

  -- A retry from the same immutable subject is safe and creates no second audit.
  IF before_user.status = 'active'
    AND before_user.external_subject = namespaced_subject
    AND before_user.email_verified_at IS NOT NULL THEN
    RETURN before_user.id;
  END IF;

  IF before_user.status <> 'invited'
    OR before_user.external_subject IS NOT NULL
    OR before_user.email_verified_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'owner claim rejected';
  END IF;

  BEGIN
    UPDATE pixbrik.app_user AS seeded
    SET
      external_subject = namespaced_subject,
      status = 'active',
      email_verified_at = claimed_at,
      last_signed_in_at = claimed_at
    WHERE seeded.id = before_user.id
      AND seeded.status = 'invited'
      AND seeded.external_subject IS NULL
    RETURNING seeded.* INTO after_user;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'owner claim rejected';
  END;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'owner claim rejected';
  END IF;

  INSERT INTO pixbrik.audit_event (
    actor_user_id,
    actor_subject,
    action,
    target_type,
    target_id,
    request_id,
    reason,
    before_state,
    after_state,
    metadata
  ) VALUES (
    after_user.id,
    namespaced_subject,
    'identity.owner_claimed',
    'app_user',
    after_user.id::text,
    p_request_id::text,
    'Seeded owner invitation accepted after server-side Clerk verification',
    pg_catalog.jsonb_build_object(
      'status', before_user.status,
      'external_subject_bound', before_user.external_subject IS NOT NULL,
      'email_verified_at', before_user.email_verified_at
    ),
    pg_catalog.jsonb_build_object(
      'status', after_user.status,
      'external_subject_bound', after_user.external_subject IS NOT NULL,
      'email_verified_at', after_user.email_verified_at
    ),
    pg_catalog.jsonb_build_object(
      'identity_provider', 'clerk',
      'provider_email_id', clerk_email_id,
      'email_check', 'primary_verified_exact_match',
      'claim_version', 1
    )
  );

  RETURN after_user.id;
END;
$function$;

ALTER FUNCTION claim_seeded_clerk_owner(text, text, text, uuid)
  OWNER TO pixbrik_migrator;

-- Remove accidental historical grants, then expose exactly one capability.
REVOKE ALL PRIVILEGES ON SCHEMA pixbrik FROM pixbrik_identity_runtime;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA pixbrik FROM pixbrik_identity_runtime;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA pixbrik FROM pixbrik_identity_runtime;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA pixbrik FROM pixbrik_identity_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA pixbrik
  REVOKE ALL ON TABLES FROM pixbrik_identity_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA pixbrik
  REVOKE ALL ON SEQUENCES FROM pixbrik_identity_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA pixbrik
  REVOKE ALL ON FUNCTIONS FROM pixbrik_identity_runtime;

REVOKE ALL ON FUNCTION claim_seeded_clerk_owner(text, text, text, uuid)
  FROM PUBLIC, pixbrik_admin_runtime, pixbrik_customer_runtime,
    pixbrik_service_runtime;

GRANT USAGE ON SCHEMA pixbrik TO pixbrik_identity_runtime;
GRANT EXECUTE ON FUNCTION claim_seeded_clerk_owner(text, text, text, uuid)
  TO pixbrik_identity_runtime;

COMMENT ON FUNCTION claim_seeded_clerk_owner(text, text, text, uuid) IS
  'One-time, row-locked, audited binding of the seeded PixBrik owner invitation to a server-verified Clerk identity.';
