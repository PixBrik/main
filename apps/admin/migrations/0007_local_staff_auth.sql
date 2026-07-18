SET LOCAL search_path TO pixbrik, pg_catalog;

-- Local staff authentication deliberately reuses the membership-free identity
-- login. It receives no direct table access: every capability below is exposed
-- through a fixed-search-path SECURITY DEFINER function owned by the migrator.
DO $migration$
DECLARE
  identity_oid oid;
BEGIN
  IF current_user::text <> 'pixbrik_migrator'
    OR session_user::text <> 'pixbrik_migrator' THEN
    RAISE EXCEPTION 'migration 0007 must run directly as pixbrik_migrator';
  END IF;

  SELECT role.oid
  INTO identity_oid
  FROM pg_catalog.pg_roles role
  WHERE role.rolname = 'pixbrik_identity_runtime';

  IF identity_oid IS NULL THEN
    RAISE EXCEPTION 'provision pixbrik_identity_runtime before migration 0007';
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

CREATE TYPE staff_credential_status AS ENUM ('pending', 'active', 'retired');

CREATE TABLE staff_credential (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE RESTRICT,
  credential_status staff_credential_status NOT NULL DEFAULT 'pending',
  password_hash text,
  password_pepper_version integer,
  password_version bigint NOT NULL DEFAULT 0 CHECK (password_version >= 0),
  session_generation bigint NOT NULL DEFAULT 1 CHECK (session_generation > 0),
  must_change_password boolean NOT NULL DEFAULT false,
  temporary_password_expires_at timestamptz,
  failed_login_count smallint NOT NULL DEFAULT 0 CHECK (failed_login_count BETWEEN 0 AND 100),
  failure_window_started_at timestamptz,
  locked_until timestamptz,
  last_failed_at timestamptz,
  last_authenticated_at timestamptz,
  is_primary_owner boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (credential_status = 'pending'
      AND password_hash IS NULL
      AND password_pepper_version IS NULL
      AND password_version = 0)
    OR
    (credential_status = 'active'
      AND password_hash IS NOT NULL
      AND password_hash ~ '^\$argon2id\$v=19\$m=65536,t=3,p=1\$'
      AND password_pepper_version IS NOT NULL
      AND password_pepper_version > 0
      AND password_version > 0)
    OR
    (credential_status = 'retired'
      AND password_hash IS NULL
      AND password_pepper_version IS NULL)
  ),
  CHECK (
    (must_change_password
      AND credential_status = 'active'
      AND temporary_password_expires_at IS NOT NULL)
    OR
    (NOT must_change_password AND temporary_password_expires_at IS NULL)
  ),
  CHECK (
    (failed_login_count = 0
      AND failure_window_started_at IS NULL
      AND last_failed_at IS NULL)
    OR
    (failed_login_count > 0
      AND failure_window_started_at IS NOT NULL
      AND last_failed_at IS NOT NULL)
  ),
  CHECK (locked_until IS NULL OR last_failed_at IS NOT NULL)
);

CREATE UNIQUE INDEX staff_credential_single_primary_owner_idx
  ON staff_credential (is_primary_owner)
  WHERE is_primary_owner;

CREATE TABLE staff_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  token_digest text NOT NULL UNIQUE CHECK (token_digest ~ '^[A-Za-z0-9_-]{43}$'),
  token_key_version integer NOT NULL CHECK (token_key_version > 0),
  password_version bigint NOT NULL CHECK (password_version > 0),
  session_generation bigint NOT NULL CHECK (session_generation > 0),
  authenticated_at timestamptz NOT NULL DEFAULT now(),
  reauthenticated_at timestamptz,
  reauthentication_failed_count smallint NOT NULL DEFAULT 0
    CHECK (reauthentication_failed_count BETWEEN 0 AND 5),
  last_reauthentication_failed_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  revoke_reason text,
  created_ip_hash text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (idle_expires_at > authenticated_at),
  CHECK (expires_at >= idle_expires_at),
  CHECK (reauthenticated_at IS NULL OR reauthenticated_at >= authenticated_at),
  CHECK (
    (reauthentication_failed_count = 0 AND last_reauthentication_failed_at IS NULL)
    OR
    (reauthentication_failed_count > 0 AND last_reauthentication_failed_at IS NOT NULL)
  ),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)),
  CHECK (revoke_reason IS NULL OR length(revoke_reason) BETWEEN 1 AND 200),
  CHECK (created_ip_hash IS NULL OR length(created_ip_hash) BETWEEN 16 AND 200),
  CHECK (user_agent IS NULL OR length(user_agent) <= 1000)
);

CREATE INDEX staff_session_user_active_idx
  ON staff_session (user_id, expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX staff_session_expiry_idx
  ON staff_session (expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE staff_login_throttle (
  ip_digest text PRIMARY KEY CHECK (ip_digest ~ '^[A-Za-z0-9_-]{43}$'),
  failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count BETWEEN 0 AND 10000),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (locked_until IS NULL OR last_failed_at IS NOT NULL)
);

CREATE INDEX staff_login_throttle_locked_idx
  ON staff_login_throttle (locked_until)
  WHERE locked_until IS NOT NULL;

ALTER TABLE staff_credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_credential FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_session FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_login_throttle ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_login_throttle FORCE ROW LEVEL SECURITY;

-- Migration 0005 deliberately gave the legacy admin database login broad
-- commerce access. Local staff authentication must not inherit that login's
-- ability to mint staff identities, rewrite RBAC, or forge reserved audit
-- events. Keep customer-commerce administration intact while making all staff
-- authority changes execute-only through the functions below.
DROP POLICY app_user_admin_access ON app_user;
CREATE POLICY app_user_migrator_access ON app_user FOR ALL
  USING (request_is_migrator_database_role())
  WITH CHECK (request_is_migrator_database_role());
CREATE POLICY app_user_admin_commerce_read ON app_user FOR SELECT
  USING (request_is_admin_database_role());
CREATE POLICY app_user_admin_customer_insert ON app_user FOR INSERT
  WITH CHECK (request_is_admin_database_role() AND kind = 'customer');
CREATE POLICY app_user_admin_customer_update ON app_user FOR UPDATE
  USING (request_is_admin_database_role() AND kind = 'customer')
  WITH CHECK (request_is_admin_database_role() AND kind = 'customer');

DROP POLICY role_admin_access ON role;
DROP POLICY permission_admin_access ON permission;
DROP POLICY user_role_admin_access ON user_role;
DROP POLICY role_permission_admin_access ON role_permission;

CREATE POLICY role_migrator_access ON role FOR ALL
  USING (request_is_migrator_database_role())
  WITH CHECK (request_is_migrator_database_role());
CREATE POLICY role_admin_read ON role FOR SELECT
  USING (request_is_admin_database_role());
CREATE POLICY permission_migrator_access ON permission FOR ALL
  USING (request_is_migrator_database_role())
  WITH CHECK (request_is_migrator_database_role());
CREATE POLICY permission_admin_read ON permission FOR SELECT
  USING (request_is_admin_database_role());
CREATE POLICY user_role_migrator_access ON user_role FOR ALL
  USING (request_is_migrator_database_role())
  WITH CHECK (request_is_migrator_database_role());
CREATE POLICY user_role_admin_read ON user_role FOR SELECT
  USING (request_is_admin_database_role());
CREATE POLICY role_permission_migrator_access ON role_permission FOR ALL
  USING (request_is_migrator_database_role())
  WITH CHECK (request_is_migrator_database_role());
CREATE POLICY role_permission_admin_read ON role_permission FOR SELECT
  USING (request_is_admin_database_role());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON role, permission, user_role, role_permission
  FROM pixbrik_admin_runtime;

-- PostgreSQL combines ordinary policies with OR. A restrictive policy is
-- therefore required to reserve these action names even though the legacy
-- admin and service policies remain useful for non-authentication audits.
CREATE POLICY audit_event_reserved_local_actions
  ON audit_event AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    action NOT IN (
      'identity.local_owner_bootstrapped', 'identity.local_owner_recovered',
      'auth.login_failed', 'auth.login_succeeded', 'auth.logout',
      'auth.reauthentication_failed', 'auth.session_reauthenticated',
      'auth.password_changed', 'auth.password_pepper_upgraded',
      'staff.created', 'staff.password_reset',
      'staff.suspended', 'staff.restored', 'staff.removed',
      'staff.roles_changed'
    )
    OR (
      current_user::text = 'pixbrik_migrator'
      AND session_user::text IN ('pixbrik_migrator', 'pixbrik_identity_runtime')
    )
  );

-- Password mode supersedes the one-shot Clerk claim endpoint from migration
-- 0006. Taking the table-policy locks before credential seeding makes an
-- in-flight claim finish first (and become a supported already-claimed owner)
-- or wait until its execute privilege and policies have been removed.
REVOKE ALL ON FUNCTION claim_seeded_clerk_owner(text, text, text, uuid)
  FROM pixbrik_identity_runtime;
DROP POLICY app_user_clerk_owner_claim_read ON app_user;
DROP POLICY app_user_clerk_owner_claim_update ON app_user;
DROP POLICY role_clerk_owner_claim_read ON role;
DROP POLICY user_role_clerk_owner_claim_read ON user_role;
DROP POLICY audit_event_clerk_owner_claim_insert ON audit_event;

-- SECURITY DEFINER functions run as the migrator while preserving the immutable
-- identity session login. Direct identity-role queries do not match these rules.
CREATE POLICY staff_credential_local_auth_access ON staff_credential
  FOR ALL
  USING (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text IN ('pixbrik_migrator', 'pixbrik_identity_runtime')
  )
  WITH CHECK (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text IN ('pixbrik_migrator', 'pixbrik_identity_runtime')
  );

CREATE POLICY staff_credential_admin_guard_read ON staff_credential FOR SELECT
  USING (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text = 'pixbrik_admin_runtime'
  );

CREATE POLICY staff_session_local_auth_access ON staff_session
  FOR ALL
  USING (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text IN ('pixbrik_migrator', 'pixbrik_identity_runtime')
  )
  WITH CHECK (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text IN ('pixbrik_migrator', 'pixbrik_identity_runtime')
  );

CREATE POLICY staff_login_throttle_local_auth_access ON staff_login_throttle
  FOR ALL
  USING (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text IN ('pixbrik_migrator', 'pixbrik_identity_runtime')
  )
  WITH CHECK (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text IN ('pixbrik_migrator', 'pixbrik_identity_runtime')
  );

CREATE POLICY app_user_local_staff_auth_read ON app_user FOR SELECT
  USING (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text IN ('pixbrik_identity_runtime', 'pixbrik_admin_runtime')
  );
CREATE POLICY app_user_local_staff_auth_insert ON app_user FOR INSERT
  WITH CHECK (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text = 'pixbrik_identity_runtime'
    AND kind = 'staff'
  );
CREATE POLICY app_user_local_staff_auth_update ON app_user FOR UPDATE
  USING (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text = 'pixbrik_identity_runtime'
    AND kind = 'staff'
  )
  WITH CHECK (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text = 'pixbrik_identity_runtime'
    AND kind = 'staff'
  );

CREATE POLICY role_local_staff_auth_read ON role FOR SELECT
  USING (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text IN ('pixbrik_identity_runtime', 'pixbrik_admin_runtime')
  );
CREATE POLICY permission_local_staff_auth_read ON permission FOR SELECT
  USING (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text IN ('pixbrik_identity_runtime', 'pixbrik_admin_runtime')
  );
CREATE POLICY role_permission_local_staff_auth_read ON role_permission FOR SELECT
  USING (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text IN ('pixbrik_identity_runtime', 'pixbrik_admin_runtime')
  );
CREATE POLICY user_role_local_staff_auth_read ON user_role FOR SELECT
  USING (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text IN ('pixbrik_identity_runtime', 'pixbrik_admin_runtime')
  );
CREATE POLICY user_role_local_staff_auth_insert ON user_role FOR INSERT
  WITH CHECK (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text = 'pixbrik_identity_runtime'
  );
CREATE POLICY user_role_local_staff_auth_update ON user_role FOR UPDATE
  USING (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text = 'pixbrik_identity_runtime'
  )
  WITH CHECK (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text = 'pixbrik_identity_runtime'
  );

CREATE POLICY audit_event_local_staff_auth_insert ON audit_event FOR INSERT
  WITH CHECK (
    current_user::text = 'pixbrik_migrator'
    AND session_user::text = 'pixbrik_identity_runtime'
    AND action IN (
      'identity.local_owner_bootstrapped', 'identity.local_owner_recovered',
      'auth.login_failed', 'auth.login_succeeded', 'auth.logout',
      'auth.reauthentication_failed', 'auth.session_reauthenticated',
      'auth.password_changed', 'auth.password_pepper_upgraded',
      'staff.created', 'staff.password_reset', 'staff.suspended',
      'staff.restored', 'staff.removed', 'staff.roles_changed'
    )
    AND request_id IS NOT NULL
    AND metadata ->> 'identity_provider' = 'local'
  );

CREATE UNIQUE INDEX audit_event_local_auth_request_once
  ON audit_event (request_id)
  WHERE request_id IS NOT NULL
    AND action IN (
      'identity.local_owner_bootstrapped', 'identity.local_owner_recovered',
      'auth.login_failed', 'auth.login_succeeded', 'auth.logout',
      'auth.reauthentication_failed', 'auth.session_reauthenticated',
      'auth.password_changed', 'auth.password_pepper_upgraded',
      'staff.created', 'staff.password_reset', 'staff.suspended',
      'staff.restored', 'staff.removed', 'staff.roles_changed'
    );

CREATE FUNCTION local_assert_identity_caller() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF current_user::text <> 'pixbrik_migrator'
    OR session_user::text <> 'pixbrik_identity_runtime' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'local staff authentication rejected';
  END IF;
END;
$function$;

CREATE FUNCTION local_assert_request_id(p_request_id uuid) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'request identifier is required';
  END IF;
END;
$function$;

CREATE FUNCTION local_assert_password_hash(
  p_password_hash text,
  p_password_pepper_version integer
) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_password_hash IS NULL
    OR p_password_hash !~ '^\$argon2id\$v=19\$m=65536,t=3,p=1\$'
    OR pg_catalog.length(p_password_hash) > 1024
    OR p_password_pepper_version IS NULL
    OR p_password_pepper_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid password verifier';
  END IF;
END;
$function$;

CREATE FUNCTION local_assert_token_digest(
  p_token_digest text,
  p_token_key_version integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_token_digest IS NULL
    OR p_token_digest !~ '^[A-Za-z0-9_-]{43}$'
    OR (p_token_key_version IS NOT NULL AND p_token_key_version < 1) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid session token digest';
  END IF;
END;
$function$;

CREATE FUNCTION local_user_is_owner(p_user_id uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, pixbrik
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM pixbrik.user_role assignment
    JOIN pixbrik.role assigned_role ON assigned_role.id = assignment.role_id
    WHERE assignment.user_id = p_user_id
      AND assigned_role.key = 'owner'
      AND (assignment.expires_at IS NULL OR assignment.expires_at > pg_catalog.clock_timestamp())
  )
$function$;

CREATE FUNCTION local_usable_owner_count(p_excluded_user_id uuid DEFAULT NULL) RETURNS bigint
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, pixbrik
AS $function$
  SELECT pg_catalog.count(DISTINCT account.id)
  FROM pixbrik.app_user account
  JOIN pixbrik.staff_credential credential ON credential.user_id = account.id
  JOIN pixbrik.user_role assignment ON assignment.user_id = account.id
  JOIN pixbrik.role assigned_role ON assigned_role.id = assignment.role_id
  WHERE account.kind = 'staff'
    AND account.status = 'active'
    AND account.deleted_at IS NULL
    AND credential.credential_status = 'active'
    AND credential.password_hash IS NOT NULL
    AND (
      NOT credential.must_change_password
      OR credential.temporary_password_expires_at > pg_catalog.clock_timestamp()
    )
    AND assigned_role.key = 'owner'
    AND (assignment.expires_at IS NULL OR assignment.expires_at > pg_catalog.clock_timestamp())
    AND (p_excluded_user_id IS NULL OR account.id <> p_excluded_user_id)
$function$;

CREATE FUNCTION local_require_session(
  p_token_digest text,
  p_required_permission text,
  p_allow_forced_change boolean,
  p_require_recent_reauthentication boolean
) RETURNS TABLE (
  actor_user_id uuid,
  actor_session_id uuid,
  actor_is_primary_owner boolean,
  actor_password_version bigint,
  actor_session_generation bigint
)
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  matched record;
  now_at timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM pixbrik.local_assert_identity_caller();
  PERFORM pixbrik.local_assert_token_digest(p_token_digest, NULL);

  SELECT
    account.id AS user_id,
    session.id AS session_id,
    credential.is_primary_owner,
    credential.password_version,
    credential.session_generation
  INTO matched
  FROM pixbrik.staff_session session
  JOIN pixbrik.staff_credential credential ON credential.user_id = session.user_id
  JOIN pixbrik.app_user account ON account.id = session.user_id
  WHERE session.token_digest = p_token_digest
    AND session.revoked_at IS NULL
    AND session.expires_at > now_at
    AND session.idle_expires_at > now_at
    AND session.password_version = credential.password_version
    AND session.session_generation = credential.session_generation
    AND credential.credential_status = 'active'
    AND credential.password_hash IS NOT NULL
    AND (
      NOT credential.must_change_password
      OR credential.temporary_password_expires_at > now_at
    )
    AND account.kind = 'staff'
    AND account.status = 'active'
    AND account.deleted_at IS NULL
    AND (p_allow_forced_change OR NOT credential.must_change_password)
    AND (
      NOT p_require_recent_reauthentication
      OR session.reauthenticated_at >= now_at - interval '10 minutes'
    )
  FOR UPDATE OF session, credential, account;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'staff session rejected';
  END IF;

  IF p_required_permission IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM pixbrik.user_role assignment
    JOIN pixbrik.role assigned_role ON assigned_role.id = assignment.role_id
    JOIN pixbrik.role_permission role_grant ON role_grant.role_id = assigned_role.id
    JOIN pixbrik.permission granted_permission ON granted_permission.id = role_grant.permission_id
    WHERE assignment.user_id = matched.user_id
      AND (assignment.expires_at IS NULL OR assignment.expires_at > now_at)
      AND granted_permission.key = p_required_permission
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'staff permission rejected';
  END IF;

  actor_user_id := matched.user_id;
  actor_session_id := matched.session_id;
  actor_is_primary_owner := matched.is_primary_owner;
  actor_password_version := matched.password_version;
  actor_session_generation := matched.session_generation;
  RETURN NEXT;
END;
$function$;

-- The existing seeded invitation is the only account that can become the
-- immutable primary owner. No password is present until the one-time script
-- calls bootstrap_seeded_local_owner.
DO $seed_primary_owner$
DECLARE
  owner_user_id uuid;
BEGIN
  SELECT account.id
  INTO owner_user_id
  FROM pixbrik.app_user account
  WHERE account.email = 'sam@benisty.ca'
    AND account.kind = 'staff'
    AND account.deleted_at IS NULL
    AND (
      (
        account.status = 'invited'
        AND account.external_subject IS NULL
        AND account.email_verified_at IS NULL
      )
      OR
      (
        account.status = 'active'
        AND account.external_subject ~ '^clerk:user_[A-Za-z0-9_-]+$'
        AND account.email_verified_at IS NOT NULL
      )
    );

  IF owner_user_id IS NULL OR NOT pixbrik.local_user_is_owner(owner_user_id) THEN
    RAISE EXCEPTION 'exact seeded owner invitation is required before migration 0007';
  END IF;

  INSERT INTO pixbrik.staff_credential (
    user_id,
    credential_status,
    is_primary_owner
  ) VALUES (
    owner_user_id,
    'pending',
    true
  );
END;
$seed_primary_owner$;

CREATE FUNCTION guard_primary_staff_credential() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_primary_owner AND session_user::text <> 'pixbrik_migrator' THEN
      RAISE EXCEPTION 'primary owner can only be established by a reviewed migration';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.is_primary_owner THEN
    IF TG_OP = 'DELETE'
      OR NOT NEW.is_primary_owner
      OR NEW.credential_status = 'retired' THEN
      RAISE EXCEPTION 'primary owner credential is protected';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF pixbrik.local_user_is_owner(OLD.user_id) THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('pixbrik-local-staff-owners', 0)
      );
      IF pixbrik.local_usable_owner_count(OLD.user_id) < 1 THEN
        RAISE EXCEPTION 'at least one usable owner must remain';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.credential_status = 'active'
    AND (NEW.credential_status <> 'active' OR NEW.password_hash IS NULL)
    AND pixbrik.local_user_is_owner(OLD.user_id) THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('pixbrik-local-staff-owners', 0)
    );
    IF pixbrik.local_usable_owner_count(OLD.user_id) < 1 THEN
      RAISE EXCEPTION 'at least one usable owner must remain';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER staff_credential_primary_owner_guard
  BEFORE INSERT OR UPDATE OR DELETE ON staff_credential
  FOR EACH ROW EXECUTE FUNCTION guard_primary_staff_credential();

CREATE FUNCTION guard_primary_staff_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  primary_owner boolean;
  was_active_owner boolean;
BEGIN
  SELECT credential.is_primary_owner
  INTO primary_owner
  FROM pixbrik.staff_credential credential
  WHERE credential.user_id = OLD.id;

  IF COALESCE(primary_owner, false) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'primary owner account is protected';
    END IF;
    IF NEW.email IS DISTINCT FROM OLD.email
      OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW.external_subject IS DISTINCT FROM OLD.external_subject
      OR NEW.email_verified_at IS DISTINCT FROM OLD.email_verified_at
      OR NEW.deleted_at IS NOT NULL
      OR NEW.status IN ('suspended', 'deleted')
      OR (OLD.status = 'active' AND NEW.status <> 'active') THEN
      RAISE EXCEPTION 'primary owner account is protected';
    END IF;
  END IF;

  was_active_owner := OLD.kind = 'staff'
    AND OLD.status = 'active'
    AND OLD.deleted_at IS NULL
    AND pixbrik.local_user_is_owner(OLD.id);

  IF was_active_owner AND (
    TG_OP = 'DELETE'
    OR NEW.kind <> 'staff'
    OR NEW.status <> 'active'
    OR NEW.deleted_at IS NOT NULL
  ) THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('pixbrik-local-staff-owners', 0)
    );
    IF pixbrik.local_usable_owner_count(OLD.id) < 1 THEN
      RAISE EXCEPTION 'at least one usable owner must remain';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER app_user_primary_owner_guard
  BEFORE UPDATE OR DELETE ON app_user
  FOR EACH ROW EXECUTE FUNCTION guard_primary_staff_user();

CREATE FUNCTION guard_staff_owner_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  old_is_owner boolean := false;
  new_is_owner boolean := false;
  primary_owner boolean := false;
  owner_removed boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT assigned_role.key = 'owner'
    INTO old_is_owner
    FROM pixbrik.role assigned_role
    WHERE assigned_role.id = OLD.role_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT assigned_role.key = 'owner'
    INTO new_is_owner
    FROM pixbrik.role assigned_role
    WHERE assigned_role.id = NEW.role_id;
  END IF;

  IF new_is_owner AND NEW.expires_at IS NOT NULL AND NEW.expires_at > pg_catalog.now() THEN
    RAISE EXCEPTION 'owner assignments cannot have a future automatic expiry';
  END IF;

  IF old_is_owner THEN
    SELECT credential.is_primary_owner
    INTO primary_owner
    FROM pixbrik.staff_credential credential
    WHERE credential.user_id = OLD.user_id;

    owner_removed := TG_OP = 'DELETE'
      OR NOT new_is_owner
      OR NEW.user_id <> OLD.user_id
      OR (NEW.expires_at IS NOT NULL AND NEW.expires_at <= pg_catalog.now());

    IF owner_removed THEN
      IF COALESCE(primary_owner, false) THEN
        RAISE EXCEPTION 'primary owner role is protected';
      END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('pixbrik-local-staff-owners', 0)
      );
      IF pixbrik.local_usable_owner_count(OLD.user_id) < 1 THEN
        RAISE EXCEPTION 'at least one usable owner must remain';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER user_role_owner_guard
  BEFORE INSERT OR UPDATE OR DELETE ON user_role
  FOR EACH ROW EXECUTE FUNCTION guard_staff_owner_role();

CREATE TRIGGER staff_credential_touch_updated_at
  BEFORE UPDATE ON staff_credential
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE FUNCTION bootstrap_seeded_local_owner(
  p_password_hash text,
  p_password_pepper_version integer,
  p_request_id uuid
) RETURNS TABLE (
  user_id uuid,
  temporary_password_expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  seeded pixbrik.app_user%ROWTYPE;
  expiry timestamptz;
BEGIN
  PERFORM pixbrik.local_assert_identity_caller();
  PERFORM pixbrik.local_assert_request_id(p_request_id);
  PERFORM pixbrik.local_assert_password_hash(
    p_password_hash,
    p_password_pepper_version
  );

  SELECT account.*
  INTO seeded
  FROM pixbrik.app_user account
  JOIN pixbrik.staff_credential credential ON credential.user_id = account.id
  WHERE account.email = 'sam@benisty.ca'
    AND account.kind = 'staff'
    AND account.deleted_at IS NULL
    AND (
      (
        account.status = 'invited'
        AND account.external_subject IS NULL
        AND account.email_verified_at IS NULL
      )
      OR
      (
        account.status = 'active'
        AND account.external_subject ~ '^clerk:user_[A-Za-z0-9_-]+$'
        AND account.email_verified_at IS NOT NULL
      )
    )
    AND credential.is_primary_owner
    AND credential.credential_status = 'pending'
    AND credential.password_hash IS NULL
    AND credential.password_version = 0
  FOR UPDATE OF account, credential;

  IF NOT FOUND OR NOT pixbrik.local_user_is_owner(seeded.id) THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'local owner bootstrap rejected';
  END IF;

  expiry := pg_catalog.clock_timestamp() + interval '24 hours';

  UPDATE pixbrik.staff_credential credential
  SET
    credential_status = 'active',
    password_hash = p_password_hash,
    password_pepper_version = p_password_pepper_version,
    password_version = 1,
    session_generation = credential.session_generation + 1,
    must_change_password = true,
    temporary_password_expires_at = expiry,
    failed_login_count = 0,
    failure_window_started_at = NULL,
    locked_until = NULL,
    last_failed_at = NULL,
    updated_by = NULL
  WHERE credential.user_id = seeded.id;

  UPDATE pixbrik.app_user account
  SET status = 'active'
  WHERE account.id = seeded.id;

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
    NULL,
    'identity-runtime:local-owner-bootstrap',
    'identity.local_owner_bootstrapped',
    'app_user',
    seeded.id::text,
    p_request_id::text,
    'Exact seeded owner activated with a one-time local credential',
    pg_catalog.jsonb_build_object(
      'user_status', seeded.status,
      'credential_status', 'pending',
      'password_version', 0,
      'external_subject_bound', seeded.external_subject IS NOT NULL
    ),
    pg_catalog.jsonb_build_object(
      'user_status', 'active',
      'credential_status', 'active',
      'password_version', 1,
      'must_change_password', true,
      'temporary_password_expires_at', expiry
    ),
    pg_catalog.jsonb_build_object(
      'identity_provider', 'local',
      'actor_type', 'identity_runtime',
      'bootstrap_version', 1,
      'password_pepper_version', p_password_pepper_version
    )
  );

  user_id := seeded.id;
  temporary_password_expires_at := expiry;
  RETURN NEXT;
END;
$function$;

-- Emergency owner recovery is intentionally unavailable to every web-runtime
-- role. It requires the deployment-only migrator login, an explicit reason,
-- and still targets only the immutable seeded primary owner.
CREATE FUNCTION recover_seeded_local_owner(
  p_password_hash text,
  p_password_pepper_version integer,
  p_request_id uuid,
  p_reason text
) RETURNS TABLE (
  user_id uuid,
  temporary_password_expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  account pixbrik.app_user%ROWTYPE;
  credential pixbrik.staff_credential%ROWTYPE;
  normalized_reason text := pg_catalog.btrim(p_reason);
  expiry timestamptz;
  now_at timestamptz;
BEGIN
  IF current_user::text <> 'pixbrik_migrator'
    OR session_user::text <> 'pixbrik_migrator' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'local owner recovery rejected';
  END IF;
  PERFORM pixbrik.local_assert_request_id(p_request_id);
  PERFORM pixbrik.local_assert_password_hash(
    p_password_hash,
    p_password_pepper_version
  );
  IF normalized_reason IS NULL
    OR pg_catalog.length(normalized_reason) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'an owner recovery reason is required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pixbrik-local-staff-owners', 0)
  );

  SELECT stored_account.*
  INTO account
  FROM pixbrik.app_user stored_account
  WHERE stored_account.email = 'sam@benisty.ca'
    AND stored_account.kind = 'staff'
    AND stored_account.status = 'active'
    AND stored_account.deleted_at IS NULL
    AND (
      (
        stored_account.external_subject IS NULL
        AND stored_account.email_verified_at IS NULL
      )
      OR
      (
        stored_account.external_subject ~ '^clerk:user_[A-Za-z0-9_-]+$'
        AND stored_account.email_verified_at IS NOT NULL
      )
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'local owner recovery rejected';
  END IF;

  SELECT stored_credential.*
  INTO credential
  FROM pixbrik.staff_credential stored_credential
  WHERE stored_credential.user_id = account.id
  FOR UPDATE;

  IF NOT FOUND
    OR NOT credential.is_primary_owner
    OR credential.credential_status <> 'active'
    OR credential.password_hash IS NULL
    OR credential.password_pepper_version IS NULL
    OR credential.password_version < 1
    OR NOT pixbrik.local_user_is_owner(account.id) THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'local owner recovery rejected';
  END IF;

  now_at := pg_catalog.clock_timestamp();
  expiry := now_at + interval '24 hours';

  UPDATE pixbrik.staff_credential stored
  SET
    password_hash = p_password_hash,
    password_pepper_version = p_password_pepper_version,
    password_version = credential.password_version + 1,
    session_generation = credential.session_generation + 1,
    must_change_password = true,
    temporary_password_expires_at = expiry,
    failed_login_count = 0,
    failure_window_started_at = NULL,
    locked_until = NULL,
    last_failed_at = NULL,
    updated_by = NULL
  WHERE stored.user_id = account.id;

  UPDATE pixbrik.staff_session session
  SET
    revoked_at = now_at,
    revoked_by = NULL,
    revoke_reason = 'primary_owner_recovered'
  WHERE session.user_id = account.id
    AND session.revoked_at IS NULL;

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
    NULL,
    'deployment:pixbrik_migrator',
    'identity.local_owner_recovered',
    'staff_credential',
    account.id::text,
    p_request_id::text,
    normalized_reason,
    pg_catalog.jsonb_build_object(
      'password_version', credential.password_version,
      'session_generation', credential.session_generation
    ),
    pg_catalog.jsonb_build_object(
      'password_version', credential.password_version + 1,
      'session_generation', credential.session_generation + 1,
      'must_change_password', true,
      'temporary_password_expires_at', expiry
    ),
    pg_catalog.jsonb_build_object(
      'identity_provider', 'local',
      'actor_type', 'deployment_migrator',
      'external_subject_bound', account.external_subject IS NOT NULL,
      'recovery_channel', 'deployment_migrator',
      'password_pepper_version', p_password_pepper_version
    )
  );

  user_id := account.id;
  temporary_password_expires_at := expiry;
  RETURN NEXT;
END;
$function$;

CREATE FUNCTION local_auth_lookup_credential(p_email text)
RETURNS TABLE (
  user_id uuid,
  email text,
  password_hash text,
  password_pepper_version integer,
  password_version bigint,
  credential_status staff_credential_status,
  must_change_password boolean,
  temporary_password_expires_at timestamptz,
  failed_login_count smallint,
  locked_until timestamptz,
  user_status user_status
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  normalized_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
BEGIN
  PERFORM pixbrik.local_assert_identity_caller();
  IF normalized_email IS NULL
    OR pg_catalog.length(normalized_email) > 320
    OR pg_catalog.strpos(normalized_email, '@') <= 1 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    account.id,
    account.email,
    credential.password_hash,
    credential.password_pepper_version,
    credential.password_version,
    credential.credential_status,
    credential.must_change_password,
    credential.temporary_password_expires_at,
    credential.failed_login_count,
    credential.locked_until,
    account.status
  FROM pixbrik.app_user account
  JOIN pixbrik.staff_credential credential ON credential.user_id = account.id
  WHERE account.email = normalized_email
    AND account.kind = 'staff'
    AND account.status = 'active'
    AND account.deleted_at IS NULL
    AND credential.credential_status = 'active'
    AND credential.password_hash IS NOT NULL
    AND credential.password_pepper_version IS NOT NULL
    AND credential.password_version > 0
  LIMIT 1;
END;
$function$;

CREATE FUNCTION local_auth_check_throttle(p_ip_digest text)
RETURNS TABLE (
  failed_login_count integer,
  locked_until timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
BEGIN
  PERFORM pixbrik.local_assert_identity_caller();
  PERFORM pixbrik.local_assert_token_digest(p_ip_digest, NULL);

  RETURN QUERY
  SELECT throttle.failed_login_count, throttle.locked_until
  FROM pixbrik.staff_login_throttle throttle
  WHERE throttle.ip_digest = p_ip_digest
  LIMIT 1;

  IF NOT FOUND THEN
    failed_login_count := 0;
    locked_until := NULL;
    RETURN NEXT;
  END IF;
END;
$function$;

CREATE FUNCTION local_auth_record_failure(
  p_user_id uuid,
  p_expected_password_version bigint,
  p_request_id uuid,
  p_ip_hash text,
  p_user_agent text
) RETURNS TABLE (
  failed_login_count smallint,
  locked_until timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  credential pixbrik.staff_credential%ROWTYPE;
  throttle pixbrik.staff_login_throttle%ROWTYPE;
  next_count smallint := 0;
  next_lock timestamptz;
  next_failure_window_started_at timestamptz;
  next_ip_count integer;
  next_ip_lock timestamptz;
  next_window_started_at timestamptz;
  now_at timestamptz := pg_catalog.clock_timestamp();
  matched boolean := false;
BEGIN
  PERFORM pixbrik.local_assert_identity_caller();
  PERFORM pixbrik.local_assert_request_id(p_request_id);

  PERFORM pixbrik.local_assert_token_digest(p_ip_hash, NULL);

  INSERT INTO pixbrik.staff_login_throttle (
    ip_digest,
    failed_login_count,
    window_started_at,
    updated_at
  ) VALUES (
    p_ip_hash,
    0,
    now_at,
    now_at
  )
  ON CONFLICT (ip_digest) DO NOTHING;

  SELECT stored.*
  INTO throttle
  FROM pixbrik.staff_login_throttle stored
  WHERE stored.ip_digest = p_ip_hash
  FOR UPDATE;

  IF throttle.locked_until IS NOT NULL AND throttle.locked_until > now_at THEN
    -- Do not let hostile traffic roll a fixed lock into a permanent lock.
    next_ip_count := throttle.failed_login_count;
    next_window_started_at := throttle.window_started_at;
    next_ip_lock := throttle.locked_until;
  ELSIF throttle.window_started_at <= now_at - interval '1 hour' THEN
    next_ip_count := 1;
    next_window_started_at := now_at;
    next_ip_lock := NULL;
  ELSE
    next_ip_count := least(throttle.failed_login_count + 1, 10000);
    next_window_started_at := throttle.window_started_at;
    next_ip_lock := CASE
      WHEN next_ip_count >= 20 THEN now_at + interval '1 hour'
      WHEN next_ip_count >= 10 THEN now_at + interval '15 minutes'
      ELSE NULL
    END;
  END IF;

  UPDATE pixbrik.staff_login_throttle stored
  SET
    failed_login_count = next_ip_count,
    window_started_at = next_window_started_at,
    last_failed_at = now_at,
    locked_until = next_ip_lock,
    updated_at = now_at
  WHERE stored.ip_digest = p_ip_hash;

  IF p_user_id IS NOT NULL THEN
    SELECT stored.*
    INTO credential
    FROM pixbrik.staff_credential stored
    WHERE stored.user_id = p_user_id
    FOR UPDATE;

    matched := FOUND
      AND credential.credential_status = 'active'
      AND credential.password_version = p_expected_password_version;

    IF matched THEN
      IF credential.locked_until IS NOT NULL AND credential.locked_until > now_at THEN
        next_count := credential.failed_login_count;
        next_lock := credential.locked_until;
        next_failure_window_started_at := credential.failure_window_started_at;
      ELSE
        IF credential.failure_window_started_at IS NULL
          OR credential.failure_window_started_at <= now_at - interval '1 hour' THEN
          next_count := 1;
          next_failure_window_started_at := now_at;
        ELSE
          next_count := least(
            credential.failed_login_count + 1,
            100
          )::smallint;
          next_failure_window_started_at := credential.failure_window_started_at;
        END IF;
        next_lock := CASE
          WHEN next_count >= 8 THEN now_at + interval '1 hour'
          WHEN next_count = 7 THEN now_at + interval '30 minutes'
          WHEN next_count >= 5 THEN now_at + interval '15 minutes'
          ELSE NULL
        END;
      END IF;

      UPDATE pixbrik.staff_credential stored
      SET
        failed_login_count = next_count,
        failure_window_started_at = next_failure_window_started_at,
        locked_until = next_lock,
        last_failed_at = now_at
      WHERE stored.user_id = p_user_id;
    END IF;
  END IF;

  INSERT INTO pixbrik.audit_event (
    action,
    target_type,
    target_id,
    request_id,
    ip_hash,
    user_agent,
    reason,
    after_state,
    metadata
  ) VALUES (
    'auth.login_failed',
    'staff_credential',
    CASE WHEN matched THEN p_user_id::text ELSE NULL END,
    p_request_id::text,
    p_ip_hash,
    pg_catalog.left(p_user_agent, 1000),
    'Local staff sign-in was rejected',
    pg_catalog.jsonb_build_object(
      'credential_matched', matched,
      'failed_login_count', CASE WHEN matched THEN next_count ELSE NULL END,
      'locked_until', CASE WHEN matched THEN next_lock ELSE NULL END,
      'ip_failed_login_count', next_ip_count,
      'ip_locked_until', next_ip_lock
    ),
    pg_catalog.jsonb_build_object('identity_provider', 'local')
  );

  failed_login_count := CASE WHEN matched THEN next_count ELSE 0 END;
  locked_until := CASE WHEN matched THEN next_lock ELSE NULL END;
  RETURN NEXT;
END;
$function$;

CREATE FUNCTION local_auth_create_session(
  p_user_id uuid,
  p_expected_password_version bigint,
  p_token_digest text,
  p_token_key_version integer,
  p_request_id uuid,
  p_ip_hash text,
  p_user_agent text
) RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  email text,
  display_name text,
  must_change_password boolean,
  expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  account pixbrik.app_user%ROWTYPE;
  credential pixbrik.staff_credential%ROWTYPE;
  created_session pixbrik.staff_session%ROWTYPE;
  now_at timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM pixbrik.local_assert_identity_caller();
  PERFORM pixbrik.local_assert_request_id(p_request_id);
  PERFORM pixbrik.local_assert_token_digest(p_token_digest, p_token_key_version);

  PERFORM pixbrik.local_assert_token_digest(p_ip_hash, NULL);

  IF EXISTS (
    SELECT 1
    FROM pixbrik.staff_login_throttle throttle
    WHERE throttle.ip_digest = p_ip_hash
      AND throttle.locked_until > now_at
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'local staff sign-in rejected';
  END IF;

  SELECT stored.*
  INTO credential
  FROM pixbrik.staff_credential stored
  WHERE stored.user_id = p_user_id
  FOR UPDATE;

  SELECT stored.*
  INTO account
  FROM pixbrik.app_user stored
  WHERE stored.id = p_user_id
  FOR UPDATE;

  IF credential.user_id IS NULL
    OR account.id IS NULL
    OR account.kind <> 'staff'
    OR account.status <> 'active'
    OR account.deleted_at IS NOT NULL
    OR credential.credential_status <> 'active'
    OR credential.password_hash IS NULL
    OR credential.password_version <> p_expected_password_version
    OR (credential.locked_until IS NOT NULL AND credential.locked_until > now_at)
    OR (
      credential.must_change_password
      AND credential.temporary_password_expires_at <= now_at
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'local staff sign-in rejected';
  END IF;

  INSERT INTO pixbrik.staff_session (
    user_id,
    token_digest,
    token_key_version,
    password_version,
    session_generation,
    authenticated_at,
    reauthenticated_at,
    last_seen_at,
    idle_expires_at,
    expires_at,
    created_ip_hash,
    user_agent
  ) VALUES (
    account.id,
    p_token_digest,
    p_token_key_version,
    credential.password_version,
    credential.session_generation,
    now_at,
    NULL,
    now_at,
    now_at + interval '30 minutes',
    now_at + interval '12 hours',
    p_ip_hash,
    pg_catalog.left(p_user_agent, 1000)
  )
  RETURNING * INTO created_session;

  UPDATE pixbrik.staff_credential stored
  SET
    failed_login_count = 0,
    failure_window_started_at = NULL,
    locked_until = NULL,
    last_failed_at = NULL,
    last_authenticated_at = now_at
  WHERE stored.user_id = account.id;

  UPDATE pixbrik.app_user stored
  SET last_signed_in_at = now_at
  WHERE stored.id = account.id;

  INSERT INTO pixbrik.audit_event (
    actor_user_id,
    actor_subject,
    action,
    target_type,
    target_id,
    request_id,
    ip_hash,
    user_agent,
    after_state,
    metadata
  ) VALUES (
    account.id,
    'local:' || account.id::text,
    'auth.login_succeeded',
    'staff_session',
    created_session.id::text,
    p_request_id::text,
    p_ip_hash,
    pg_catalog.left(p_user_agent, 1000),
    pg_catalog.jsonb_build_object(
      'must_change_password', credential.must_change_password,
      'expires_at', created_session.expires_at
    ),
    pg_catalog.jsonb_build_object(
      'identity_provider', 'local',
      'token_key_version', p_token_key_version,
      'password_version', credential.password_version
    )
  );

  session_id := created_session.id;
  user_id := account.id;
  email := account.email;
  display_name := account.display_name;
  must_change_password := credential.must_change_password;
  expires_at := created_session.expires_at;
  RETURN NEXT;
END;
$function$;

CREATE FUNCTION local_auth_upgrade_password_pepper(
  p_user_id uuid,
  p_expected_password_version bigint,
  p_new_password_hash text,
  p_new_password_pepper_version integer,
  p_request_id uuid
) RETURNS TABLE (password_version bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  account pixbrik.app_user%ROWTYPE;
  credential pixbrik.staff_credential%ROWTYPE;
  next_password_version bigint;
  preserved_session_count bigint;
BEGIN
  PERFORM pixbrik.local_assert_identity_caller();
  PERFORM pixbrik.local_assert_request_id(p_request_id);
  PERFORM pixbrik.local_assert_password_hash(
    p_new_password_hash,
    p_new_password_pepper_version
  );

  SELECT stored.*
  INTO credential
  FROM pixbrik.staff_credential stored
  WHERE stored.user_id = p_user_id
  FOR UPDATE;

  SELECT stored.*
  INTO account
  FROM pixbrik.app_user stored
  WHERE stored.id = p_user_id
  FOR UPDATE;

  IF credential.user_id IS NULL
    OR account.id IS NULL
    OR account.kind <> 'staff'
    OR account.status <> 'active'
    OR account.deleted_at IS NOT NULL
    OR credential.credential_status <> 'active'
    OR credential.password_hash IS NULL
    OR credential.password_pepper_version IS NULL
    OR credential.password_version <> p_expected_password_version
    OR p_new_password_pepper_version <= credential.password_pepper_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'password pepper upgrade rejected';
  END IF;

  next_password_version := credential.password_version + 1;

  UPDATE pixbrik.staff_credential stored
  SET
    password_hash = p_new_password_hash,
    password_pepper_version = p_new_password_pepper_version,
    password_version = next_password_version,
    updated_by = account.id
  WHERE stored.user_id = account.id
    AND stored.password_version = p_expected_password_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'password pepper changed concurrently';
  END IF;

  -- Rehashing the same verified password is not a credential reset. Advance
  -- matching session snapshots atomically so existing sessions remain usable.
  UPDATE pixbrik.staff_session session
  SET password_version = next_password_version
  WHERE session.user_id = account.id
    AND session.password_version = p_expected_password_version
    AND session.session_generation = credential.session_generation
    AND session.revoked_at IS NULL;
  GET DIAGNOSTICS preserved_session_count = ROW_COUNT;

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
    account.id,
    'local:' || account.id::text,
    'auth.password_pepper_upgraded',
    'staff_credential',
    account.id::text,
    p_request_id::text,
    'Password verifier upgraded after successful authentication',
    pg_catalog.jsonb_build_object(
      'password_version', credential.password_version,
      'password_pepper_version', credential.password_pepper_version
    ),
    pg_catalog.jsonb_build_object(
      'password_version', next_password_version,
      'password_pepper_version', p_new_password_pepper_version,
      'preserved_session_count', preserved_session_count
    ),
    pg_catalog.jsonb_build_object(
      'identity_provider', 'local',
      'upgrade_type', 'verified_password_rehash'
    )
  );

  password_version := next_password_version;
  RETURN NEXT;
END;
$function$;

CREATE FUNCTION local_auth_resolve_session(
  p_token_digest text,
  p_touch boolean
) RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  email text,
  display_name text,
  must_change_password boolean,
  roles text[],
  permissions text[],
  reauthenticated_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  matched record;
  now_at timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM pixbrik.local_assert_identity_caller();
  PERFORM pixbrik.local_assert_token_digest(p_token_digest, NULL);

  SELECT
    session.id AS session_id,
    session.user_id,
    session.last_seen_at,
    session.idle_expires_at,
    session.expires_at,
    session.reauthenticated_at,
    account.email,
    account.display_name,
    credential.must_change_password
  INTO matched
  FROM pixbrik.staff_session session
  JOIN pixbrik.staff_credential credential ON credential.user_id = session.user_id
  JOIN pixbrik.app_user account ON account.id = session.user_id
  WHERE session.token_digest = p_token_digest
    AND session.revoked_at IS NULL
    AND session.expires_at > now_at
    AND session.idle_expires_at > now_at
    AND session.password_version = credential.password_version
    AND session.session_generation = credential.session_generation
    AND credential.credential_status = 'active'
    AND credential.password_hash IS NOT NULL
    AND (
      NOT credential.must_change_password
      OR credential.temporary_password_expires_at > now_at
    )
    AND account.kind = 'staff'
    AND account.status = 'active'
    AND account.deleted_at IS NULL
  FOR UPDATE OF session;

  IF NOT FOUND THEN RETURN; END IF;

  IF p_touch AND matched.last_seen_at <= now_at - interval '5 minutes' THEN
    UPDATE pixbrik.staff_session active_session
    SET
      last_seen_at = now_at,
      idle_expires_at = least(now_at + interval '30 minutes', active_session.expires_at)
    WHERE active_session.id = matched.session_id
    RETURNING active_session.idle_expires_at INTO matched.idle_expires_at;
  END IF;

  session_id := matched.session_id;
  user_id := matched.user_id;
  email := matched.email;
  display_name := matched.display_name;
  must_change_password := matched.must_change_password;
  reauthenticated_at := matched.reauthenticated_at;
  expires_at := matched.expires_at;

  IF matched.must_change_password THEN
    roles := '{}'::text[];
    permissions := '{}'::text[];
  ELSE
    SELECT
      COALESCE(pg_catalog.array_agg(DISTINCT assigned_role.key ORDER BY assigned_role.key)
        FILTER (WHERE assigned_role.key IS NOT NULL), '{}'::text[]),
      COALESCE(pg_catalog.array_agg(DISTINCT granted_permission.key ORDER BY granted_permission.key)
        FILTER (WHERE granted_permission.key IS NOT NULL), '{}'::text[])
    INTO roles, permissions
    FROM pixbrik.user_role assignment
    JOIN pixbrik.role assigned_role ON assigned_role.id = assignment.role_id
      AND (assignment.expires_at IS NULL OR assignment.expires_at > now_at)
    LEFT JOIN pixbrik.role_permission role_grant ON role_grant.role_id = assigned_role.id
    LEFT JOIN pixbrik.permission granted_permission ON granted_permission.id = role_grant.permission_id
    WHERE assignment.user_id = matched.user_id;
  END IF;

  RETURN NEXT;
END;
$function$;

CREATE FUNCTION local_auth_logout(
  p_token_digest text,
  p_request_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  active_session pixbrik.staff_session%ROWTYPE;
  now_at timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM pixbrik.local_assert_identity_caller();
  PERFORM pixbrik.local_assert_request_id(p_request_id);
  PERFORM pixbrik.local_assert_token_digest(p_token_digest, NULL);

  SELECT session.*
  INTO active_session
  FROM pixbrik.staff_session session
  WHERE session.token_digest = p_token_digest
  FOR UPDATE;

  IF NOT FOUND OR active_session.revoked_at IS NOT NULL THEN RETURN false; END IF;

  UPDATE pixbrik.staff_session session
  SET
    revoked_at = now_at,
    revoked_by = active_session.user_id,
    revoke_reason = 'logout'
  WHERE session.id = active_session.id;

  INSERT INTO pixbrik.audit_event (
    actor_user_id,
    actor_subject,
    action,
    target_type,
    target_id,
    request_id,
    after_state,
    metadata
  ) VALUES (
    active_session.user_id,
    'local:' || active_session.user_id::text,
    'auth.logout',
    'staff_session',
    active_session.id::text,
    p_request_id::text,
    pg_catalog.jsonb_build_object('revoked_at', now_at),
    pg_catalog.jsonb_build_object('identity_provider', 'local')
  );

  RETURN true;
END;
$function$;

CREATE FUNCTION local_auth_read_current_password(p_token_digest text)
RETURNS TABLE (
  user_id uuid,
  password_hash text,
  password_pepper_version integer,
  password_version bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor
  FROM pixbrik.local_require_session(p_token_digest, NULL, true, false);

  RETURN QUERY
  SELECT
    credential.user_id,
    credential.password_hash,
    credential.password_pepper_version,
    credential.password_version
  FROM pixbrik.staff_credential credential
  WHERE credential.user_id = actor.actor_user_id;
END;
$function$;

CREATE FUNCTION local_auth_record_reauth_failure(
  p_token_digest text,
  p_request_id uuid
) RETURNS TABLE (
  failed_count smallint,
  session_revoked boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  actor record;
  active_session pixbrik.staff_session%ROWTYPE;
  now_at timestamptz;
  next_failed_count smallint;
BEGIN
  PERFORM pixbrik.local_assert_request_id(p_request_id);

  SELECT * INTO actor
  FROM pixbrik.local_require_session(p_token_digest, NULL, false, false);

  SELECT session.*
  INTO active_session
  FROM pixbrik.staff_session session
  WHERE session.id = actor.actor_session_id
  FOR UPDATE;

  IF NOT FOUND OR active_session.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'staff reauthentication rejected';
  END IF;

  now_at := pg_catalog.clock_timestamp();
  next_failed_count := least(
    active_session.reauthentication_failed_count + 1,
    5
  )::smallint;

  UPDATE pixbrik.staff_session session
  SET
    reauthentication_failed_count = next_failed_count,
    last_reauthentication_failed_at = now_at,
    revoked_at = CASE
      WHEN next_failed_count >= 5 THEN now_at
      ELSE session.revoked_at
    END,
    revoked_by = CASE
      WHEN next_failed_count >= 5 THEN actor.actor_user_id
      ELSE session.revoked_by
    END,
    revoke_reason = CASE
      WHEN next_failed_count >= 5 THEN 'reauthentication_failures'
      ELSE session.revoke_reason
    END
  WHERE session.id = actor.actor_session_id
    AND session.revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'staff reauthentication changed concurrently';
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
    actor.actor_user_id,
    'local:' || actor.actor_user_id::text,
    'auth.reauthentication_failed',
    'staff_session',
    actor.actor_session_id::text,
    p_request_id::text,
    CASE
      WHEN next_failed_count >= 5
        THEN 'Session revoked after repeated failed password reauthentication'
      ELSE 'Password reauthentication failed'
    END,
    pg_catalog.jsonb_build_object(
      'failed_count', active_session.reauthentication_failed_count,
      'session_revoked', false
    ),
    pg_catalog.jsonb_build_object(
      'failed_count', next_failed_count,
      'session_revoked', next_failed_count >= 5
    ),
    pg_catalog.jsonb_build_object(
      'identity_provider', 'local',
      'failure_limit', 5
    )
  );

  failed_count := next_failed_count;
  session_revoked := next_failed_count >= 5;
  RETURN NEXT;
END;
$function$;

CREATE FUNCTION local_auth_mark_reauthenticated(
  p_token_digest text,
  p_expected_password_version bigint,
  p_request_id uuid
) RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  reauthenticated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  actor record;
  now_at timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM pixbrik.local_assert_request_id(p_request_id);
  SELECT * INTO actor
  FROM pixbrik.local_require_session(p_token_digest, NULL, false, false);

  IF actor.actor_password_version <> p_expected_password_version THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'staff reauthentication rejected';
  END IF;

  UPDATE pixbrik.staff_session session
  SET
    reauthenticated_at = now_at,
    reauthentication_failed_count = 0,
    last_reauthentication_failed_at = NULL
  WHERE session.id = actor.actor_session_id
    AND session.password_version = p_expected_password_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'staff reauthentication changed concurrently';
  END IF;

  INSERT INTO pixbrik.audit_event (
    actor_user_id,
    actor_subject,
    action,
    target_type,
    target_id,
    request_id,
    after_state,
    metadata
  ) VALUES (
    actor.actor_user_id,
    'local:' || actor.actor_user_id::text,
    'auth.session_reauthenticated',
    'staff_session',
    actor.actor_session_id::text,
    p_request_id::text,
    pg_catalog.jsonb_build_object('reauthenticated_at', now_at),
    pg_catalog.jsonb_build_object(
      'identity_provider', 'local',
      'password_version', p_expected_password_version
    )
  );

  session_id := actor.actor_session_id;
  user_id := actor.actor_user_id;
  reauthenticated_at := now_at;
  RETURN NEXT;
END;
$function$;

CREATE FUNCTION local_auth_change_password(
  p_token_digest text,
  p_expected_password_version bigint,
  p_new_password_hash text,
  p_new_password_pepper_version integer,
  p_new_token_digest text,
  p_new_token_key_version integer,
  p_request_id uuid
) RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  email text,
  display_name text,
  must_change_password boolean,
  expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  actor record;
  account pixbrik.app_user%ROWTYPE;
  credential pixbrik.staff_credential%ROWTYPE;
  rotated_session pixbrik.staff_session%ROWTYPE;
  now_at timestamptz := pg_catalog.clock_timestamp();
  next_password_version bigint;
  next_session_generation bigint;
BEGIN
  PERFORM pixbrik.local_assert_request_id(p_request_id);
  PERFORM pixbrik.local_assert_password_hash(
    p_new_password_hash,
    p_new_password_pepper_version
  );
  PERFORM pixbrik.local_assert_token_digest(
    p_new_token_digest,
    p_new_token_key_version
  );

  SELECT * INTO actor
  FROM pixbrik.local_require_session(p_token_digest, NULL, true, false);

  SELECT stored.* INTO credential
  FROM pixbrik.staff_credential stored
  WHERE stored.user_id = actor.actor_user_id
  FOR UPDATE;

  SELECT stored.* INTO account
  FROM pixbrik.app_user stored
  WHERE stored.id = actor.actor_user_id
  FOR UPDATE;

  IF credential.password_version <> p_expected_password_version
    OR credential.password_version <> actor.actor_password_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'password changed concurrently';
  END IF;

  next_password_version := credential.password_version + 1;
  next_session_generation := credential.session_generation + 1;

  UPDATE pixbrik.staff_credential stored
  SET
    credential_status = 'active',
    password_hash = p_new_password_hash,
    password_pepper_version = p_new_password_pepper_version,
    password_version = next_password_version,
    session_generation = next_session_generation,
    must_change_password = false,
    temporary_password_expires_at = NULL,
    failed_login_count = 0,
    failure_window_started_at = NULL,
    locked_until = NULL,
    last_failed_at = NULL,
    last_authenticated_at = now_at,
    updated_by = account.id
  WHERE stored.user_id = account.id;

  UPDATE pixbrik.staff_session session
  SET
    revoked_at = now_at,
    revoked_by = account.id,
    revoke_reason = 'password_changed'
  WHERE session.user_id = account.id
    AND session.revoked_at IS NULL;

  INSERT INTO pixbrik.staff_session (
    user_id,
    token_digest,
    token_key_version,
    password_version,
    session_generation,
    authenticated_at,
    reauthenticated_at,
    last_seen_at,
    idle_expires_at,
    expires_at,
    created_ip_hash,
    user_agent
  )
  SELECT
    account.id,
    p_new_token_digest,
    p_new_token_key_version,
    next_password_version,
    next_session_generation,
    now_at,
    now_at,
    now_at,
    now_at + interval '30 minutes',
    now_at + interval '12 hours',
    previous.created_ip_hash,
    previous.user_agent
  FROM pixbrik.staff_session previous
  WHERE previous.id = actor.actor_session_id
  RETURNING * INTO rotated_session;

  IF rotated_session.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'password session rotation failed';
  END IF;

  INSERT INTO pixbrik.audit_event (
    actor_user_id,
    actor_subject,
    action,
    target_type,
    target_id,
    request_id,
    before_state,
    after_state,
    metadata
  ) VALUES (
    account.id,
    'local:' || account.id::text,
    'auth.password_changed',
    'staff_credential',
    account.id::text,
    p_request_id::text,
    pg_catalog.jsonb_build_object(
      'password_version', credential.password_version,
      'must_change_password', credential.must_change_password
    ),
    pg_catalog.jsonb_build_object(
      'password_version', next_password_version,
      'must_change_password', false,
      'rotated_session_id', rotated_session.id
    ),
    pg_catalog.jsonb_build_object(
      'identity_provider', 'local',
      'password_pepper_version', p_new_password_pepper_version,
      'token_key_version', p_new_token_key_version
    )
  );

  session_id := rotated_session.id;
  user_id := account.id;
  email := account.email;
  display_name := account.display_name;
  must_change_password := false;
  expires_at := rotated_session.expires_at;
  RETURN NEXT;
END;
$function$;

CREATE FUNCTION local_staff_list(p_actor_token_digest text)
RETURNS TABLE (
  user_id uuid,
  email text,
  display_name text,
  user_status user_status,
  credential_status staff_credential_status,
  must_change_password boolean,
  temporary_password_expires_at timestamptz,
  failed_login_count smallint,
  locked_until timestamptz,
  last_signed_in_at timestamptz,
  password_version bigint,
  is_primary_owner boolean,
  roles text[],
  active_session_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor
  FROM pixbrik.local_require_session(
    p_actor_token_digest,
    'staff.manage',
    false,
    false
  );

  RETURN QUERY
  SELECT
    account.id,
    account.email,
    account.display_name,
    account.status,
    credential.credential_status,
    COALESCE(credential.must_change_password, false),
    credential.temporary_password_expires_at,
    COALESCE(credential.failed_login_count, 0)::smallint,
    credential.locked_until,
    account.last_signed_in_at,
    COALESCE(credential.password_version, 0),
    COALESCE(credential.is_primary_owner, false),
    COALESCE(role_list.roles, '{}'::text[]),
    COALESCE(session_count.active_sessions, 0)
  FROM pixbrik.app_user account
  LEFT JOIN pixbrik.staff_credential credential ON credential.user_id = account.id
  LEFT JOIN LATERAL (
    SELECT pg_catalog.array_agg(assigned_role.key ORDER BY assigned_role.key) AS roles
    FROM pixbrik.user_role assignment
    JOIN pixbrik.role assigned_role ON assigned_role.id = assignment.role_id
    WHERE assignment.user_id = account.id
      AND (assignment.expires_at IS NULL OR assignment.expires_at > pg_catalog.now())
  ) role_list ON true
  LEFT JOIN LATERAL (
    SELECT pg_catalog.count(*) AS active_sessions
    FROM pixbrik.staff_session session
    WHERE session.user_id = account.id
      AND session.revoked_at IS NULL
      AND session.expires_at > pg_catalog.now()
      AND session.idle_expires_at > pg_catalog.now()
      AND account.kind = 'staff'
      AND account.status = 'active'
      AND account.deleted_at IS NULL
      AND credential.credential_status = 'active'
      AND credential.password_hash IS NOT NULL
      AND (
        NOT credential.must_change_password
        OR credential.temporary_password_expires_at > pg_catalog.now()
      )
      AND session.password_version = credential.password_version
      AND session.session_generation = credential.session_generation
  ) session_count ON true
  WHERE account.kind = 'staff'
  ORDER BY COALESCE(credential.is_primary_owner, false) DESC, account.email;
END;
$function$;

CREATE FUNCTION local_staff_create(
  p_actor_token_digest text,
  p_email text,
  p_display_name text,
  p_password_hash text,
  p_password_pepper_version integer,
  p_role_keys text[],
  p_request_id uuid
) RETURNS TABLE (
  user_id uuid,
  email text,
  temporary_password_expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  actor record;
  normalized_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  normalized_display_name text := NULLIF(pg_catalog.btrim(p_display_name), '');
  normalized_roles text[];
  created_user_id uuid;
  expiry timestamptz;
BEGIN
  PERFORM pixbrik.local_assert_request_id(p_request_id);
  PERFORM pixbrik.local_assert_password_hash(
    p_password_hash,
    p_password_pepper_version
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pixbrik-local-staff-owners', 0)
  );
  SELECT * INTO actor
  FROM pixbrik.local_require_session(
    p_actor_token_digest,
    'staff.manage',
    false,
    true
  );

  IF normalized_email IS NULL
    OR pg_catalog.length(normalized_email) > 320
    OR pg_catalog.strpos(normalized_email, '@') <= 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid staff email';
  END IF;
  IF normalized_display_name IS NOT NULL
    AND pg_catalog.length(normalized_display_name) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid staff display name';
  END IF;
  IF p_role_keys IS NULL OR pg_catalog.cardinality(p_role_keys) < 1
    OR pg_catalog.array_position(p_role_keys, NULL) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'at least one staff role is required';
  END IF;

  SELECT pg_catalog.array_agg(DISTINCT assigned_role.key ORDER BY assigned_role.key)
  INTO normalized_roles
  FROM pixbrik.role assigned_role
  WHERE assigned_role.key = ANY (p_role_keys);

  IF normalized_roles IS NULL
    OR pg_catalog.cardinality(normalized_roles) <>
      (SELECT pg_catalog.count(DISTINCT role_key)::integer
       FROM pg_catalog.unnest(p_role_keys) AS requested(role_key))
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unknown staff role';
  END IF;

  IF 'owner' = ANY (normalized_roles) AND NOT actor.actor_is_primary_owner THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'only the primary owner may grant owner access';
  END IF;

  -- Recheck the bearer session and ten-minute step-up window with wall-clock
  -- time immediately before the first authority mutation.
  SELECT * INTO actor
  FROM pixbrik.local_require_session(
    p_actor_token_digest,
    'staff.manage',
    false,
    true
  );
  expiry := pg_catalog.clock_timestamp() + interval '24 hours';

  BEGIN
    INSERT INTO pixbrik.app_user (
      email,
      kind,
      status,
      display_name,
      preferred_locale,
      preferred_currency
    ) VALUES (
      normalized_email,
      'staff',
      'active',
      normalized_display_name,
      'en',
      'EUR'
    )
    RETURNING id INTO created_user_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'staff account already exists';
  END;

  INSERT INTO pixbrik.staff_credential (
    user_id,
    credential_status,
    password_hash,
    password_pepper_version,
    password_version,
    session_generation,
    must_change_password,
    temporary_password_expires_at,
    is_primary_owner,
    created_by,
    updated_by
  ) VALUES (
    created_user_id,
    'active',
    p_password_hash,
    p_password_pepper_version,
    1,
    1,
    true,
    expiry,
    false,
    actor.actor_user_id,
    actor.actor_user_id
  );

  INSERT INTO pixbrik.user_role (user_id, role_id, granted_by)
  SELECT created_user_id, assigned_role.id, actor.actor_user_id
  FROM pixbrik.role assigned_role
  WHERE assigned_role.key = ANY (normalized_roles);

  INSERT INTO pixbrik.audit_event (
    actor_user_id,
    actor_subject,
    action,
    target_type,
    target_id,
    request_id,
    reason,
    after_state,
    metadata
  ) VALUES (
    actor.actor_user_id,
    'local:' || actor.actor_user_id::text,
    'staff.created',
    'app_user',
    created_user_id::text,
    p_request_id::text,
    'Staff account created with a one-time temporary credential',
    pg_catalog.jsonb_build_object(
      'email', normalized_email,
      'user_status', 'active',
      'roles', pg_catalog.to_jsonb(normalized_roles),
      'must_change_password', true,
      'temporary_password_expires_at', expiry
    ),
    pg_catalog.jsonb_build_object(
      'identity_provider', 'local',
      'password_pepper_version', p_password_pepper_version
    )
  );

  IF pixbrik.local_usable_owner_count(NULL) < 1 THEN
    RAISE EXCEPTION 'at least one usable owner must remain';
  END IF;

  user_id := created_user_id;
  email := normalized_email;
  temporary_password_expires_at := expiry;
  RETURN NEXT;
END;
$function$;

CREATE FUNCTION local_staff_reset_password(
  p_actor_token_digest text,
  p_target_user_id uuid,
  p_expected_password_version bigint,
  p_new_password_hash text,
  p_new_password_pepper_version integer,
  p_request_id uuid
) RETURNS TABLE (
  temporary_password_expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  actor record;
  target_account pixbrik.app_user%ROWTYPE;
  target_credential pixbrik.staff_credential%ROWTYPE;
  expiry timestamptz;
  now_at timestamptz;
BEGIN
  PERFORM pixbrik.local_assert_request_id(p_request_id);
  PERFORM pixbrik.local_assert_password_hash(
    p_new_password_hash,
    p_new_password_pepper_version
  );
  IF p_expected_password_version IS NULL OR p_expected_password_version < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'expected password version is required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pixbrik-local-staff-owners', 0)
  );
  SELECT * INTO actor
  FROM pixbrik.local_require_session(
    p_actor_token_digest,
    'staff.manage',
    false,
    true
  );

  IF p_target_user_id = actor.actor_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'use change password for your own account';
  END IF;

  SELECT account.* INTO target_account
  FROM pixbrik.app_user account
  WHERE account.id = p_target_user_id
  FOR UPDATE;
  SELECT credential.* INTO target_credential
  FROM pixbrik.staff_credential credential
  WHERE credential.user_id = p_target_user_id
  FOR UPDATE;

  IF target_account.id IS NULL
    OR target_account.kind <> 'staff'
    OR target_account.status = 'deleted'
    OR target_account.deleted_at IS NOT NULL
    OR target_account.external_subject IS NOT NULL
    OR target_credential.user_id IS NULL
    OR target_credential.credential_status = 'retired'
    OR target_credential.is_primary_owner THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'staff password reset rejected';
  END IF;
  IF target_credential.password_version <> p_expected_password_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'staff password changed concurrently';
  END IF;

  IF pixbrik.local_user_is_owner(target_account.id)
    AND pixbrik.local_usable_owner_count(target_account.id) < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'at least one usable owner must remain';
  END IF;

  SELECT * INTO actor
  FROM pixbrik.local_require_session(
    p_actor_token_digest,
    'staff.manage',
    false,
    true
  );
  now_at := pg_catalog.clock_timestamp();
  expiry := now_at + interval '24 hours';

  UPDATE pixbrik.staff_credential credential
  SET
    credential_status = 'active',
    password_hash = p_new_password_hash,
    password_pepper_version = p_new_password_pepper_version,
    password_version = credential.password_version + 1,
    session_generation = credential.session_generation + 1,
    must_change_password = true,
    temporary_password_expires_at = expiry,
    failed_login_count = 0,
    failure_window_started_at = NULL,
    locked_until = NULL,
    last_failed_at = NULL,
    updated_by = actor.actor_user_id
  WHERE credential.user_id = target_account.id
    AND credential.password_version = p_expected_password_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'staff password changed concurrently';
  END IF;

  IF target_account.status = 'invited' THEN
    UPDATE pixbrik.app_user account
    SET status = 'active'
    WHERE account.id = target_account.id;
  END IF;

  UPDATE pixbrik.staff_session session
  SET
    revoked_at = now_at,
    revoked_by = actor.actor_user_id,
    revoke_reason = 'admin_password_reset'
  WHERE session.user_id = target_account.id
    AND session.revoked_at IS NULL;

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
    actor.actor_user_id,
    'local:' || actor.actor_user_id::text,
    'staff.password_reset',
    'staff_credential',
    target_account.id::text,
    p_request_id::text,
    'Staff password reset to a one-time temporary credential',
    pg_catalog.jsonb_build_object(
      'password_version', target_credential.password_version,
      'must_change_password', target_credential.must_change_password
    ),
    pg_catalog.jsonb_build_object(
      'password_version', target_credential.password_version + 1,
      'must_change_password', true,
      'temporary_password_expires_at', expiry,
      'sessions_revoked', true
    ),
    pg_catalog.jsonb_build_object(
      'identity_provider', 'local',
      'password_pepper_version', p_new_password_pepper_version
    )
  );

  temporary_password_expires_at := expiry;
  RETURN NEXT;
END;
$function$;

CREATE FUNCTION local_staff_suspend(
  p_actor_token_digest text,
  p_target_user_id uuid,
  p_reason text,
  p_request_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  actor record;
  target_account pixbrik.app_user%ROWTYPE;
  target_credential pixbrik.staff_credential%ROWTYPE;
  normalized_reason text := pg_catalog.btrim(p_reason);
  now_at timestamptz;
BEGIN
  PERFORM pixbrik.local_assert_request_id(p_request_id);
  IF normalized_reason IS NULL OR pg_catalog.length(normalized_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'a concise suspension reason is required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pixbrik-local-staff-owners', 0)
  );
  SELECT * INTO actor
  FROM pixbrik.local_require_session(
    p_actor_token_digest,
    'staff.manage',
    false,
    true
  );

  IF p_target_user_id = actor.actor_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'staff cannot suspend their own account';
  END IF;

  SELECT account.* INTO target_account
  FROM pixbrik.app_user account
  WHERE account.id = p_target_user_id
  FOR UPDATE;
  SELECT credential.* INTO target_credential
  FROM pixbrik.staff_credential credential
  WHERE credential.user_id = p_target_user_id
  FOR UPDATE;

  IF target_account.id IS NULL
    OR target_account.kind <> 'staff'
    OR target_account.status NOT IN ('active', 'invited')
    OR target_account.deleted_at IS NOT NULL
    OR target_credential.user_id IS NULL
    OR target_credential.is_primary_owner THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'staff suspension rejected';
  END IF;

  IF pixbrik.local_user_is_owner(target_account.id)
    AND pixbrik.local_usable_owner_count(target_account.id) < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'at least one usable owner must remain';
  END IF;

  SELECT * INTO actor
  FROM pixbrik.local_require_session(
    p_actor_token_digest,
    'staff.manage',
    false,
    true
  );
  now_at := pg_catalog.clock_timestamp();

  UPDATE pixbrik.app_user account
  SET status = 'suspended'
  WHERE account.id = target_account.id;

  UPDATE pixbrik.staff_credential credential
  SET
    session_generation = credential.session_generation + 1,
    updated_by = actor.actor_user_id
  WHERE credential.user_id = target_account.id;

  UPDATE pixbrik.staff_session session
  SET
    revoked_at = now_at,
    revoked_by = actor.actor_user_id,
    revoke_reason = 'staff_suspended'
  WHERE session.user_id = target_account.id
    AND session.revoked_at IS NULL;

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
    actor.actor_user_id,
    'local:' || actor.actor_user_id::text,
    'staff.suspended',
    'app_user',
    target_account.id::text,
    p_request_id::text,
    normalized_reason,
    pg_catalog.jsonb_build_object('user_status', target_account.status),
    pg_catalog.jsonb_build_object('user_status', 'suspended', 'sessions_revoked', true),
    pg_catalog.jsonb_build_object('identity_provider', 'local')
  );

  RETURN true;
END;
$function$;

CREATE FUNCTION local_staff_restore(
  p_actor_token_digest text,
  p_target_user_id uuid,
  p_request_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  actor record;
  target_account pixbrik.app_user%ROWTYPE;
  target_credential pixbrik.staff_credential%ROWTYPE;
  now_at timestamptz;
BEGIN
  PERFORM pixbrik.local_assert_request_id(p_request_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pixbrik-local-staff-owners', 0)
  );
  SELECT * INTO actor
  FROM pixbrik.local_require_session(
    p_actor_token_digest,
    'staff.manage',
    false,
    true
  );

  IF p_target_user_id = actor.actor_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'staff cannot restore their own account';
  END IF;

  SELECT account.* INTO target_account
  FROM pixbrik.app_user account
  WHERE account.id = p_target_user_id
  FOR UPDATE;
  SELECT credential.* INTO target_credential
  FROM pixbrik.staff_credential credential
  WHERE credential.user_id = p_target_user_id
  FOR UPDATE;

  IF target_account.id IS NULL
    OR target_account.kind <> 'staff'
    OR target_account.status <> 'suspended'
    OR target_account.deleted_at IS NOT NULL
    OR target_credential.user_id IS NULL
    OR target_credential.credential_status <> 'active'
    OR target_credential.password_hash IS NULL
    OR target_credential.is_primary_owner THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'staff restoration rejected';
  END IF;

  SELECT * INTO actor
  FROM pixbrik.local_require_session(
    p_actor_token_digest,
    'staff.manage',
    false,
    true
  );
  now_at := pg_catalog.clock_timestamp();

  UPDATE pixbrik.app_user account
  SET status = 'active'
  WHERE account.id = target_account.id;

  UPDATE pixbrik.staff_credential credential
  SET
    session_generation = credential.session_generation + 1,
    updated_by = actor.actor_user_id
  WHERE credential.user_id = target_account.id;

  UPDATE pixbrik.staff_session session
  SET
    revoked_at = now_at,
    revoked_by = actor.actor_user_id,
    revoke_reason = 'staff_restored_generation_rotated'
  WHERE session.user_id = target_account.id
    AND session.revoked_at IS NULL;

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
    actor.actor_user_id,
    'local:' || actor.actor_user_id::text,
    'staff.restored',
    'app_user',
    target_account.id::text,
    p_request_id::text,
    'Suspended local staff access restored',
    pg_catalog.jsonb_build_object('user_status', target_account.status),
    pg_catalog.jsonb_build_object(
      'user_status', 'active',
      'session_generation', target_credential.session_generation + 1,
      'sessions_revoked', true
    ),
    pg_catalog.jsonb_build_object('identity_provider', 'local')
  );

  IF pixbrik.local_usable_owner_count(NULL) < 1 THEN
    RAISE EXCEPTION 'at least one usable owner must remain';
  END IF;

  RETURN true;
END;
$function$;

CREATE FUNCTION local_staff_soft_remove(
  p_actor_token_digest text,
  p_target_user_id uuid,
  p_reason text,
  p_request_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  actor record;
  target_account pixbrik.app_user%ROWTYPE;
  target_credential pixbrik.staff_credential%ROWTYPE;
  roles_before text[];
  normalized_reason text := pg_catalog.btrim(p_reason);
  now_at timestamptz;
BEGIN
  PERFORM pixbrik.local_assert_request_id(p_request_id);
  IF normalized_reason IS NULL OR pg_catalog.length(normalized_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'a concise removal reason is required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pixbrik-local-staff-owners', 0)
  );
  SELECT * INTO actor
  FROM pixbrik.local_require_session(
    p_actor_token_digest,
    'staff.manage',
    false,
    true
  );

  IF p_target_user_id = actor.actor_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'staff cannot remove their own account';
  END IF;

  SELECT account.* INTO target_account
  FROM pixbrik.app_user account
  WHERE account.id = p_target_user_id
  FOR UPDATE;
  SELECT credential.* INTO target_credential
  FROM pixbrik.staff_credential credential
  WHERE credential.user_id = p_target_user_id
  FOR UPDATE;

  IF target_account.id IS NULL
    OR target_account.kind <> 'staff'
    OR target_account.status = 'deleted'
    OR target_account.deleted_at IS NOT NULL
    OR target_credential.user_id IS NULL
    OR target_credential.is_primary_owner THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'staff removal rejected';
  END IF;

  IF pixbrik.local_user_is_owner(target_account.id)
    AND pixbrik.local_usable_owner_count(target_account.id) < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'at least one usable owner must remain';
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(assigned_role.key ORDER BY assigned_role.key), '{}'::text[])
  INTO roles_before
  FROM pixbrik.user_role assignment
  JOIN pixbrik.role assigned_role ON assigned_role.id = assignment.role_id
  WHERE assignment.user_id = target_account.id
    AND (
      assignment.expires_at IS NULL
      OR assignment.expires_at > pg_catalog.clock_timestamp()
    );

  SELECT * INTO actor
  FROM pixbrik.local_require_session(
    p_actor_token_digest,
    'staff.manage',
    false,
    true
  );
  now_at := pg_catalog.clock_timestamp();

  UPDATE pixbrik.app_user account
  SET
    status = 'deleted',
    deleted_at = now_at
  WHERE account.id = target_account.id;

  UPDATE pixbrik.staff_credential credential
  SET
    credential_status = 'retired',
    password_hash = NULL,
    password_pepper_version = NULL,
    password_version = credential.password_version + 1,
    session_generation = credential.session_generation + 1,
    must_change_password = false,
    temporary_password_expires_at = NULL,
    failed_login_count = 0,
    failure_window_started_at = NULL,
    locked_until = NULL,
    last_failed_at = NULL,
    updated_by = actor.actor_user_id
  WHERE credential.user_id = target_account.id;

  UPDATE pixbrik.user_role assignment
  SET expires_at = now_at
  WHERE assignment.user_id = target_account.id
    AND (assignment.expires_at IS NULL OR assignment.expires_at > now_at);

  UPDATE pixbrik.staff_session session
  SET
    revoked_at = now_at,
    revoked_by = actor.actor_user_id,
    revoke_reason = 'staff_removed'
  WHERE session.user_id = target_account.id
    AND session.revoked_at IS NULL;

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
    actor.actor_user_id,
    'local:' || actor.actor_user_id::text,
    'staff.removed',
    'app_user',
    target_account.id::text,
    p_request_id::text,
    normalized_reason,
    pg_catalog.jsonb_build_object(
      'user_status', target_account.status,
      'credential_status', target_credential.credential_status,
      'roles', pg_catalog.to_jsonb(roles_before)
    ),
    pg_catalog.jsonb_build_object(
      'user_status', 'deleted',
      'credential_status', 'retired',
      'roles', '[]'::jsonb,
      'sessions_revoked', true
    ),
    pg_catalog.jsonb_build_object('identity_provider', 'local')
  );

  IF pixbrik.local_usable_owner_count(NULL) < 1 THEN
    RAISE EXCEPTION 'at least one usable owner must remain';
  END IF;

  RETURN true;
END;
$function$;

CREATE FUNCTION local_staff_set_roles(
  p_actor_token_digest text,
  p_target_user_id uuid,
  p_role_keys text[],
  p_request_id uuid
) RETURNS TABLE (roles text[])
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pixbrik, pg_temp
AS $function$
DECLARE
  actor record;
  target_account pixbrik.app_user%ROWTYPE;
  target_credential pixbrik.staff_credential%ROWTYPE;
  normalized_roles text[];
  roles_before text[];
  target_was_owner boolean;
  now_at timestamptz;
BEGIN
  PERFORM pixbrik.local_assert_request_id(p_request_id);
  IF p_role_keys IS NULL OR pg_catalog.cardinality(p_role_keys) < 1
    OR pg_catalog.array_position(p_role_keys, NULL) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'at least one staff role is required';
  END IF;

  SELECT pg_catalog.array_agg(DISTINCT assigned_role.key ORDER BY assigned_role.key)
  INTO normalized_roles
  FROM pixbrik.role assigned_role
  WHERE assigned_role.key = ANY (p_role_keys);

  IF normalized_roles IS NULL
    OR pg_catalog.cardinality(normalized_roles) <>
      (SELECT pg_catalog.count(DISTINCT role_key)::integer
       FROM pg_catalog.unnest(p_role_keys) AS requested(role_key))
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unknown staff role';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pixbrik-local-staff-owners', 0)
  );
  SELECT * INTO actor
  FROM pixbrik.local_require_session(
    p_actor_token_digest,
    'staff.manage',
    false,
    true
  );

  IF p_target_user_id = actor.actor_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'staff cannot change their own roles';
  END IF;

  SELECT account.* INTO target_account
  FROM pixbrik.app_user account
  WHERE account.id = p_target_user_id
  FOR UPDATE;
  SELECT credential.* INTO target_credential
  FROM pixbrik.staff_credential credential
  WHERE credential.user_id = p_target_user_id
  FOR UPDATE;

  IF target_account.id IS NULL
    OR target_account.kind <> 'staff'
    OR target_account.status = 'deleted'
    OR target_account.deleted_at IS NOT NULL
    OR target_credential.user_id IS NULL
    OR target_credential.is_primary_owner THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'staff role change rejected';
  END IF;

  target_was_owner := pixbrik.local_user_is_owner(target_account.id);
  IF 'owner' = ANY (normalized_roles)
    AND NOT target_was_owner
    AND NOT actor.actor_is_primary_owner THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'only the primary owner may grant owner access';
  END IF;
  IF target_was_owner
    AND NOT ('owner' = ANY (normalized_roles))
    AND target_account.status = 'active'
    AND pixbrik.local_usable_owner_count(target_account.id) < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'at least one usable owner must remain';
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(assigned_role.key ORDER BY assigned_role.key), '{}'::text[])
  INTO roles_before
  FROM pixbrik.user_role assignment
  JOIN pixbrik.role assigned_role ON assigned_role.id = assignment.role_id
  WHERE assignment.user_id = target_account.id
    AND (
      assignment.expires_at IS NULL
      OR assignment.expires_at > pg_catalog.clock_timestamp()
    );

  SELECT * INTO actor
  FROM pixbrik.local_require_session(
    p_actor_token_digest,
    'staff.manage',
    false,
    true
  );
  now_at := pg_catalog.clock_timestamp();

  UPDATE pixbrik.user_role assignment
  SET expires_at = now_at
  FROM pixbrik.role assigned_role
  WHERE assignment.role_id = assigned_role.id
    AND assignment.user_id = target_account.id
    AND (assignment.expires_at IS NULL OR assignment.expires_at > now_at)
    AND NOT (assigned_role.key = ANY (normalized_roles));

  INSERT INTO pixbrik.user_role (
    user_id,
    role_id,
    granted_by,
    granted_at,
    expires_at
  )
  SELECT
    target_account.id,
    assigned_role.id,
    actor.actor_user_id,
    now_at,
    NULL
  FROM pixbrik.role assigned_role
  WHERE assigned_role.key = ANY (normalized_roles)
  ON CONFLICT (user_id, role_id) DO UPDATE
  SET
    granted_by = EXCLUDED.granted_by,
    granted_at = EXCLUDED.granted_at,
    expires_at = NULL;

  IF pixbrik.local_usable_owner_count(NULL) < 1 THEN
    RAISE EXCEPTION 'at least one usable owner must remain';
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
    actor.actor_user_id,
    'local:' || actor.actor_user_id::text,
    'staff.roles_changed',
    'app_user',
    target_account.id::text,
    p_request_id::text,
    'Staff role assignments changed',
    pg_catalog.jsonb_build_object('roles', pg_catalog.to_jsonb(roles_before)),
    pg_catalog.jsonb_build_object('roles', pg_catalog.to_jsonb(normalized_roles)),
    pg_catalog.jsonb_build_object('identity_provider', 'local')
  );

  roles := normalized_roles;
  RETURN NEXT;
END;
$function$;

-- Pin ownership explicitly and expose only the intended execute-only API.
ALTER FUNCTION local_assert_identity_caller() OWNER TO pixbrik_migrator;
ALTER FUNCTION local_assert_request_id(uuid) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_assert_password_hash(text, integer) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_assert_token_digest(text, integer) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_user_is_owner(uuid) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_usable_owner_count(uuid) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_require_session(text, text, boolean, boolean) OWNER TO pixbrik_migrator;
ALTER FUNCTION guard_primary_staff_credential() OWNER TO pixbrik_migrator;
ALTER FUNCTION guard_primary_staff_user() OWNER TO pixbrik_migrator;
ALTER FUNCTION guard_staff_owner_role() OWNER TO pixbrik_migrator;

ALTER FUNCTION bootstrap_seeded_local_owner(text, integer, uuid) OWNER TO pixbrik_migrator;
ALTER FUNCTION recover_seeded_local_owner(text, integer, uuid, text) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_auth_lookup_credential(text) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_auth_check_throttle(text) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_auth_record_failure(uuid, bigint, uuid, text, text) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_auth_create_session(uuid, bigint, text, integer, uuid, text, text) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_auth_upgrade_password_pepper(uuid, bigint, text, integer, uuid) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_auth_resolve_session(text, boolean) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_auth_logout(text, uuid) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_auth_read_current_password(text) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_auth_record_reauth_failure(text, uuid) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_auth_mark_reauthenticated(text, bigint, uuid) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_auth_change_password(text, bigint, text, integer, text, integer, uuid) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_staff_list(text) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_staff_create(text, text, text, text, integer, text[], uuid) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_staff_reset_password(text, uuid, bigint, text, integer, uuid) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_staff_suspend(text, uuid, text, uuid) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_staff_restore(text, uuid, uuid) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_staff_soft_remove(text, uuid, text, uuid) OWNER TO pixbrik_migrator;
ALTER FUNCTION local_staff_set_roles(text, uuid, text[], uuid) OWNER TO pixbrik_migrator;

REVOKE ALL PRIVILEGES ON staff_credential, staff_session, staff_login_throttle
  FROM PUBLIC, pixbrik_identity_runtime, pixbrik_admin_runtime,
    pixbrik_customer_runtime, pixbrik_service_runtime;

REVOKE ALL ON FUNCTION local_assert_identity_caller()
  FROM PUBLIC, pixbrik_identity_runtime, pixbrik_admin_runtime,
    pixbrik_customer_runtime, pixbrik_service_runtime;
REVOKE ALL ON FUNCTION local_assert_request_id(uuid)
  FROM PUBLIC, pixbrik_identity_runtime, pixbrik_admin_runtime,
    pixbrik_customer_runtime, pixbrik_service_runtime;
REVOKE ALL ON FUNCTION local_assert_password_hash(text, integer)
  FROM PUBLIC, pixbrik_identity_runtime, pixbrik_admin_runtime,
    pixbrik_customer_runtime, pixbrik_service_runtime;
REVOKE ALL ON FUNCTION local_assert_token_digest(text, integer)
  FROM PUBLIC, pixbrik_identity_runtime, pixbrik_admin_runtime,
    pixbrik_customer_runtime, pixbrik_service_runtime;
REVOKE ALL ON FUNCTION local_user_is_owner(uuid)
  FROM PUBLIC, pixbrik_identity_runtime, pixbrik_admin_runtime,
    pixbrik_customer_runtime, pixbrik_service_runtime;
REVOKE ALL ON FUNCTION local_usable_owner_count(uuid)
  FROM PUBLIC, pixbrik_identity_runtime, pixbrik_admin_runtime,
    pixbrik_customer_runtime, pixbrik_service_runtime;
REVOKE ALL ON FUNCTION local_require_session(text, text, boolean, boolean)
  FROM PUBLIC, pixbrik_identity_runtime, pixbrik_admin_runtime,
    pixbrik_customer_runtime, pixbrik_service_runtime;
REVOKE ALL ON FUNCTION guard_primary_staff_credential(), guard_primary_staff_user(),
  guard_staff_owner_role()
  FROM PUBLIC, pixbrik_identity_runtime, pixbrik_admin_runtime,
    pixbrik_customer_runtime, pixbrik_service_runtime;

REVOKE ALL ON FUNCTION recover_seeded_local_owner(text, integer, uuid, text)
  FROM PUBLIC, pixbrik_identity_runtime, pixbrik_admin_runtime,
    pixbrik_customer_runtime, pixbrik_service_runtime;

REVOKE ALL ON FUNCTION
  bootstrap_seeded_local_owner(text, integer, uuid),
  local_auth_lookup_credential(text),
  local_auth_check_throttle(text),
  local_auth_record_failure(uuid, bigint, uuid, text, text),
  local_auth_create_session(uuid, bigint, text, integer, uuid, text, text),
  local_auth_upgrade_password_pepper(uuid, bigint, text, integer, uuid),
  local_auth_resolve_session(text, boolean),
  local_auth_logout(text, uuid),
  local_auth_read_current_password(text),
  local_auth_record_reauth_failure(text, uuid),
  local_auth_mark_reauthenticated(text, bigint, uuid),
  local_auth_change_password(text, bigint, text, integer, text, integer, uuid),
  local_staff_list(text),
  local_staff_create(text, text, text, text, integer, text[], uuid),
  local_staff_reset_password(text, uuid, bigint, text, integer, uuid),
  local_staff_suspend(text, uuid, text, uuid),
  local_staff_restore(text, uuid, uuid),
  local_staff_soft_remove(text, uuid, text, uuid),
  local_staff_set_roles(text, uuid, text[], uuid)
  FROM PUBLIC, pixbrik_admin_runtime, pixbrik_customer_runtime,
    pixbrik_service_runtime;

GRANT EXECUTE ON FUNCTION
  bootstrap_seeded_local_owner(text, integer, uuid),
  local_auth_lookup_credential(text),
  local_auth_check_throttle(text),
  local_auth_record_failure(uuid, bigint, uuid, text, text),
  local_auth_create_session(uuid, bigint, text, integer, uuid, text, text),
  local_auth_upgrade_password_pepper(uuid, bigint, text, integer, uuid),
  local_auth_resolve_session(text, boolean),
  local_auth_logout(text, uuid),
  local_auth_read_current_password(text),
  local_auth_record_reauth_failure(text, uuid),
  local_auth_mark_reauthenticated(text, bigint, uuid),
  local_auth_change_password(text, bigint, text, integer, text, integer, uuid),
  local_staff_list(text),
  local_staff_create(text, text, text, text, integer, text[], uuid),
  local_staff_reset_password(text, uuid, bigint, text, integer, uuid),
  local_staff_suspend(text, uuid, text, uuid),
  local_staff_restore(text, uuid, uuid),
  local_staff_soft_remove(text, uuid, text, uuid),
  local_staff_set_roles(text, uuid, text[], uuid)
  TO pixbrik_identity_runtime;

COMMENT ON TABLE staff_credential IS
  'Server-only local staff password verifiers and revocation state; no runtime role has direct table access.';
COMMENT ON TABLE staff_session IS
  'Opaque local staff sessions. Only a versioned HMAC digest is stored; raw browser tokens are never persisted.';
COMMENT ON TABLE staff_login_throttle IS
  'Persistent anonymous sign-in throttling keyed only by a private HMAC digest of the client network address.';
COMMENT ON FUNCTION bootstrap_seeded_local_owner(text, integer, uuid) IS
  'One-time activation of the exact seeded PixBrik owner with a forced-change temporary Argon2id verifier.';
COMMENT ON FUNCTION recover_seeded_local_owner(text, integer, uuid, text) IS
  'Deployment-only, reason-required emergency reset of the immutable seeded primary owner; never granted to a runtime role.';
COMMENT ON FUNCTION local_staff_soft_remove(text, uuid, text, uuid) IS
  'Audited soft removal; authority, credentials, and sessions are revoked without deleting historical identity records.';
