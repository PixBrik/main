SET LOCAL search_path TO pixbrik, pg_catalog;

DO $$
BEGIN
  IF current_user::text <> 'pixbrik_migrator'
    OR session_user::text <> 'pixbrik_migrator' THEN
    RAISE EXCEPTION 'migration 0009 must run directly as pixbrik_migrator';
  END IF;
END;
$$;

INSERT INTO permission (key, description) VALUES
  ('marketing.read', 'View marketing contacts, templates, campaigns, automations and delivery history'),
  ('marketing.manage', 'Create drafts and configure customer communications'),
  ('marketing.send', 'Schedule campaigns, enable automations and control queued communications')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT role.id, permission.id
FROM role
CROSS JOIN permission
WHERE role.key = 'owner'
  AND permission.key IN ('marketing.read', 'marketing.manage', 'marketing.send')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT role.id, permission.id
FROM role
CROSS JOIN permission
WHERE role.key = 'marketing'
  AND permission.key IN ('marketing.read', 'marketing.manage', 'marketing.send')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT role.id, permission.id
FROM role
CROSS JOIN permission
WHERE role.key IN ('operations', 'support', 'analyst')
  AND permission.key = 'marketing.read'
ON CONFLICT DO NOTHING;

CREATE TABLE marketing_contact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE
    CHECK (email = lower(email) AND length(email) <= 254 AND position('@' IN email) > 1),
  customer_user_id uuid UNIQUE REFERENCES app_user(id) ON DELETE RESTRICT,
  display_name text,
  locale_code text NOT NULL DEFAULT 'en' REFERENCES locale(code),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'subscribed', 'unsubscribed', 'suppressed')),
  consent_at timestamptz,
  consent_source text,
  consent_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  unsubscribed_at timestamptz,
  suppression_reason text,
  unsubscribe_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    status <> 'subscribed'
    OR (consent_at IS NOT NULL AND nullif(btrim(consent_source), '') IS NOT NULL)
  ),
  CHECK (status <> 'unsubscribed' OR unsubscribed_at IS NOT NULL),
  CHECK (status <> 'suppressed' OR nullif(btrim(suppression_reason), '') IS NOT NULL)
);

CREATE INDEX marketing_contact_status_locale_idx
  ON marketing_contact(status, locale_code, created_at DESC);
CREATE INDEX marketing_contact_customer_idx
  ON marketing_contact(customer_user_id) WHERE customer_user_id IS NOT NULL;

CREATE TABLE marketing_consent_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  marketing_contact_id uuid NOT NULL REFERENCES marketing_contact(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('subscribe', 'unsubscribe', 'suppress', 'release')),
  source text NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  policy_version text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX marketing_consent_event_contact_idx
  ON marketing_consent_event(marketing_contact_id, occurred_at DESC);

CREATE TABLE email_suppression (
  email text PRIMARY KEY
    CHECK (email = lower(email) AND length(email) <= 254 AND position('@' IN email) > 1),
  reason text NOT NULL
    CHECK (reason IN ('hard_bounce', 'complaint', 'provider_suppressed', 'manual', 'invalid')),
  source text NOT NULL,
  provider_event_id text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  released_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  CHECK (released_at IS NULL OR released_at >= created_at)
);

CREATE TABLE email_campaign (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  template_key text NOT NULL CHECK (template_key ~ '^[a-z0-9._-]+$'),
  audience_key text NOT NULL
    CHECK (audience_key IN ('all_subscribers', 'registered_customers', 'past_buyers', 'no_orders')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'scheduled', 'processing', 'completed',
      'completed_with_errors', 'cancelled', 'failed'
    )),
  scheduled_at timestamptz,
  recipient_cap integer CHECK (recipient_cap IS NULL OR recipient_cap > 0),
  template_version integer NOT NULL DEFAULT 1 CHECK (template_version > 0),
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'scheduled' OR (scheduled_at IS NOT NULL AND recipient_cap IS NOT NULL)),
  CHECK (completed_at IS NULL OR started_at IS NOT NULL)
);

CREATE INDEX email_campaign_queue_idx
  ON email_campaign(status, scheduled_at) WHERE status = 'scheduled';

CREATE TABLE email_automation_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL UNIQUE CHECK (rule_key ~ '^[a-z0-9._-]+$'),
  name text NOT NULL,
  source_event text NOT NULL
    CHECK (source_event IN (
      'customer.created', 'checkout.abandoned', 'order.placed',
      'payment.failed', 'order.shipped', 'order.delivered'
    )),
  template_key text NOT NULL CHECK (template_key ~ '^[a-z0-9._-]+$'),
  template_version integer NOT NULL DEFAULT 1 CHECK (template_version > 0),
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  delay_minutes integer NOT NULL DEFAULT 0 CHECK (delay_minutes BETWEEN 0 AND 525600),
  requires_marketing_consent boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (enabled = (enabled_at IS NOT NULL))
);

ALTER TABLE outbound_message
  ADD COLUMN message_kind text NOT NULL DEFAULT 'transactional'
    CHECK (message_kind IN ('transactional', 'marketing')),
  ADD COLUMN customer_user_id uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  ADD COLUMN marketing_contact_id uuid REFERENCES marketing_contact(id) ON DELETE RESTRICT,
  ADD COLUMN order_id uuid REFERENCES commerce_order(id) ON DELETE RESTRICT,
  ADD COLUMN payment_transaction_id uuid REFERENCES payment_transaction(id) ON DELETE RESTRICT,
  ADD COLUMN recovery_id uuid REFERENCES checkout_recovery(id) ON DELETE RESTRICT,
  ADD COLUMN campaign_id uuid REFERENCES email_campaign(id) ON DELETE RESTRICT,
  ADD COLUMN automation_rule_id uuid REFERENCES email_automation_rule(id) ON DELETE RESTRICT,
  ADD COLUMN subject_snapshot text,
  ADD COLUMN content_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN sender_snapshot text,
  ADD COLUMN reply_to_snapshot text,
  ADD COLUMN rendered_html_snapshot text,
  ADD COLUMN rendered_text_snapshot text,
  ADD COLUMN headers_snapshot jsonb,
  ADD COLUMN provider_tags_snapshot jsonb,
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN last_attempt_at timestamptz,
  ADD COLUMN first_attempt_at timestamptz,
  ADD COLUMN locked_at timestamptz,
  ADD COLUMN locked_by text,
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN last_provider_event_at timestamptz,
  ADD COLUMN envelope_sha256 text GENERATED ALWAYS AS (
    encode(public.digest(
      recipient || E'\n' || template_id::text || E'\n' || locale_code || E'\n'
      || coalesce(subject_snapshot, '') || E'\n' || content_snapshot::text || E'\n'
      || coalesce(sender_snapshot, '') || E'\n' || coalesce(reply_to_snapshot, '') || E'\n'
      || coalesce(rendered_html_snapshot, '') || E'\n' || coalesce(rendered_text_snapshot, '') || E'\n'
      || coalesce(headers_snapshot::text, '') || E'\n' || coalesce(provider_tags_snapshot::text, '') || E'\n'
      || payload::text || E'\n' || idempotency_key,
      'sha256'
    ), 'hex')
  ) STORED;

-- Existing rows predate immutable rendering snapshots and leases. Preserve
-- their audit history, but quarantine anything that has not already left the
-- system so a deployment can never send stale legacy content accidentally.
UPDATE outbound_message message
SET subject_snapshot = template.subject,
  content_snapshot = template.content_definition
FROM communication_template template
WHERE template.id = message.template_id;

UPDATE outbound_message
SET status = 'failed',
  failure_summary = 'Quarantined during lifecycle email migration; create a new message to send',
  next_attempt_at = NULL,
  locked_at = NULL,
  locked_by = NULL,
  lease_token = NULL,
  lease_expires_at = NULL
WHERE status IN ('queued', 'sending');

ALTER TABLE outbound_message ALTER COLUMN subject_snapshot SET NOT NULL;

ALTER TABLE outbound_message
  ADD CONSTRAINT outbound_message_marketing_campaign_check
  CHECK (
    message_kind <> 'marketing'
    OR campaign_id IS NOT NULL
    OR recovery_id IS NOT NULL
    OR automation_rule_id IS NOT NULL
  ),
  ADD CONSTRAINT outbound_message_marketing_contact_check
  CHECK (message_kind <> 'marketing' OR marketing_contact_id IS NOT NULL),
  ADD CONSTRAINT outbound_message_lease_check
  CHECK (
    (lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  ADD CONSTRAINT outbound_message_rendered_snapshot_check
  CHECK (
    (sender_snapshot IS NULL AND reply_to_snapshot IS NULL
      AND rendered_html_snapshot IS NULL AND rendered_text_snapshot IS NULL
      AND headers_snapshot IS NULL AND provider_tags_snapshot IS NULL)
    OR
    (sender_snapshot IS NOT NULL AND reply_to_snapshot IS NOT NULL
      AND rendered_html_snapshot IS NOT NULL AND rendered_text_snapshot IS NOT NULL
      AND headers_snapshot IS NOT NULL AND provider_tags_snapshot IS NOT NULL
      AND length(rendered_html_snapshot) <= 1000000
      AND length(rendered_text_snapshot) <= 100000)
  );

DROP INDEX outbound_message_queue_idx;
CREATE INDEX outbound_message_queue_idx
  ON outbound_message(status, coalesce(next_attempt_at, scheduled_at), created_at)
  WHERE status IN ('queued', 'sending', 'failed');
CREATE INDEX outbound_message_customer_idx
  ON outbound_message(customer_user_id, created_at DESC)
  WHERE customer_user_id IS NOT NULL;
CREATE INDEX outbound_message_provider_idx
  ON outbound_message(provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX outbound_message_recovery_automation_once
  ON outbound_message(recovery_id, automation_rule_id)
  WHERE recovery_id IS NOT NULL AND automation_rule_id IS NOT NULL;
CREATE UNIQUE INDEX outbound_message_order_automation_once
  ON outbound_message(order_id, automation_rule_id)
  WHERE order_id IS NOT NULL AND automation_rule_id IS NOT NULL
    AND payment_transaction_id IS NULL;
CREATE UNIQUE INDEX outbound_message_payment_automation_once
  ON outbound_message(payment_transaction_id, automation_rule_id)
  WHERE payment_transaction_id IS NOT NULL AND automation_rule_id IS NOT NULL;
CREATE UNIQUE INDEX outbound_message_customer_automation_once
  ON outbound_message(customer_user_id, automation_rule_id)
  WHERE customer_user_id IS NOT NULL AND automation_rule_id IS NOT NULL
    AND order_id IS NULL AND recovery_id IS NULL AND payment_transaction_id IS NULL;

CREATE TABLE email_campaign_recipient (
  campaign_id uuid NOT NULL REFERENCES email_campaign(id) ON DELETE RESTRICT,
  marketing_contact_id uuid NOT NULL REFERENCES marketing_contact(id) ON DELETE RESTRICT,
  outbound_message_id uuid NOT NULL UNIQUE REFERENCES outbound_message(id) ON DELETE RESTRICT,
  recipient_snapshot text NOT NULL,
  locale_code text NOT NULL REFERENCES locale(code),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, marketing_contact_id)
);

CREATE TABLE email_delivery_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  outbound_message_id uuid REFERENCES outbound_message(id) ON DELETE RESTRICT,
  webhook_event_id uuid NOT NULL UNIQUE REFERENCES provider_webhook_event(id) ON DELETE RESTRICT,
  provider_event_id text NOT NULL UNIQUE,
  provider_message_id text,
  event_type text NOT NULL,
  event_created_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_delivery_event_message_idx
  ON email_delivery_event(outbound_message_id, event_created_at DESC);

CREATE FUNCTION validate_email_campaign_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'email campaigns are retained for audit';
  END IF;
  IF OLD.status = 'completed' AND NEW.status = 'completed_with_errors' THEN
    IF NEW.name IS DISTINCT FROM OLD.name
      OR NEW.template_key IS DISTINCT FROM OLD.template_key
      OR NEW.template_version IS DISTINCT FROM OLD.template_version
      OR NEW.audience_key IS DISTINCT FROM OLD.audience_key
      OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
      OR NEW.recipient_cap IS DISTINCT FROM OLD.recipient_cap
      OR NEW.started_at IS DISTINCT FROM OLD.started_at
      OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'completed email campaign facts are immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('completed', 'completed_with_errors', 'cancelled') THEN
    RAISE EXCEPTION 'completed email campaigns are immutable';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'draft' AND NEW.status IN ('scheduled', 'cancelled'))
    OR (OLD.status = 'scheduled' AND NEW.status IN ('processing', 'cancelled', 'failed'))
    OR (OLD.status = 'processing' AND NEW.status IN ('completed', 'completed_with_errors', 'failed'))
    OR (OLD.status = 'failed' AND NEW.status = 'cancelled')
  ) THEN
    RAISE EXCEPTION 'invalid email campaign status transition';
  END IF;
  IF OLD.status <> 'draft' AND (
    NEW.name IS DISTINCT FROM OLD.name
    OR NEW.template_key IS DISTINCT FROM OLD.template_key
    OR NEW.template_version IS DISTINCT FROM OLD.template_version
    OR NEW.audience_key IS DISTINCT FROM OLD.audience_key
    OR NEW.recipient_cap IS DISTINCT FROM OLD.recipient_cap
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'scheduled email campaign content and audience are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION protect_outbound_message_envelope() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_temp
AS $$
BEGIN
  IF OLD.rendered_html_snapshot IS NOT NULL AND (
    NEW.sender_snapshot IS DISTINCT FROM OLD.sender_snapshot
    OR NEW.reply_to_snapshot IS DISTINCT FROM OLD.reply_to_snapshot
    OR NEW.rendered_html_snapshot IS DISTINCT FROM OLD.rendered_html_snapshot
    OR NEW.rendered_text_snapshot IS DISTINCT FROM OLD.rendered_text_snapshot
    OR NEW.headers_snapshot IS DISTINCT FROM OLD.headers_snapshot
    OR NEW.provider_tags_snapshot IS DISTINCT FROM OLD.provider_tags_snapshot
  ) THEN
    RAISE EXCEPTION 'rendered outbound provider envelope is immutable';
  END IF;
  IF OLD.rendered_html_snapshot IS NULL AND NEW.rendered_html_snapshot IS NOT NULL
    AND (NEW.status <> 'sending' OR NEW.lease_token IS NULL
      OR NEW.lease_token IS DISTINCT FROM OLD.lease_token) THEN
    RAISE EXCEPTION 'rendered outbound provider envelope requires an active fenced lease';
  END IF;
  IF OLD.attempt_count > 0 AND (
    NEW.recipient IS DISTINCT FROM OLD.recipient
    OR NEW.template_id IS DISTINCT FROM OLD.template_id
    OR NEW.locale_code IS DISTINCT FROM OLD.locale_code
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
    OR NEW.message_kind IS DISTINCT FROM OLD.message_kind
    OR NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id
    OR NEW.marketing_contact_id IS DISTINCT FROM OLD.marketing_contact_id
    OR NEW.order_id IS DISTINCT FROM OLD.order_id
    OR NEW.payment_transaction_id IS DISTINCT FROM OLD.payment_transaction_id
    OR NEW.recovery_id IS DISTINCT FROM OLD.recovery_id
    OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
    OR NEW.automation_rule_id IS DISTINCT FROM OLD.automation_rule_id
    OR NEW.subject_snapshot IS DISTINCT FROM OLD.subject_snapshot
    OR NEW.content_snapshot IS DISTINCT FROM OLD.content_snapshot
  ) THEN
    RAISE EXCEPTION 'attempted outbound message envelope is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_resend_delivery_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM provider_webhook_event evidence
    WHERE evidence.id = NEW.webhook_event_id
      AND evidence.provider = 'resend'
      AND evidence.signature_verified
      AND evidence.provider_event_id = NEW.provider_event_id
      AND evidence.event_type = NEW.event_type
  ) THEN
    RAISE EXCEPTION 'email delivery event requires verified Resend webhook evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION record_email_suppression(
  p_email text,
  p_reason text,
  p_source text,
  p_provider_event_id text,
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_catalog, pg_temp
AS $$
DECLARE
  normalized_email text := lower(btrim(p_email));
BEGIN
  IF NOT (request_is_service_database_role() OR request_is_admin_database_role()) THEN
    RAISE EXCEPTION 'email suppression service role required' USING ERRCODE = '42501';
  END IF;
  IF normalized_email IS NULL OR length(normalized_email) > 254
    OR position('@' IN normalized_email) <= 1 THEN
    RAISE EXCEPTION 'invalid suppression email' USING ERRCODE = '22023';
  END IF;
  IF p_reason NOT IN ('hard_bounce', 'complaint', 'provider_suppressed', 'manual', 'invalid') THEN
    RAISE EXCEPTION 'invalid suppression reason' USING ERRCODE = '22023';
  END IF;
  INSERT INTO email_suppression (
    email, reason, source, provider_event_id, note
  ) VALUES (
    normalized_email, p_reason, left(p_source, 120), left(p_provider_event_id, 255), left(p_note, 500)
  )
  ON CONFLICT (email) DO UPDATE
  SET reason = EXCLUDED.reason,
    source = EXCLUDED.source,
    provider_event_id = EXCLUDED.provider_event_id,
    note = EXCLUDED.note,
    created_at = now(),
    released_at = NULL,
    released_by = NULL;

  UPDATE marketing_contact
  SET status = 'suppressed', suppression_reason = p_reason
  WHERE email = normalized_email AND status NOT IN ('suppressed', 'unsubscribed');

  INSERT INTO marketing_consent_event (
    marketing_contact_id, action, source, request_id, evidence
  )
  SELECT contact.id, 'suppress', left(p_source, 120), gen_random_uuid(),
    jsonb_build_object(
      'channel', 'email',
      'reason', p_reason,
      'providerEventId', left(p_provider_event_id, 255)
    )
  FROM marketing_contact contact
  WHERE contact.email = normalized_email;
END;
$$;

CREATE FUNCTION unsubscribe_marketing_contact(
  p_token uuid,
  p_source text,
  p_request_id uuid
) RETURNS TABLE(contact_id uuid, email text, status text)
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_catalog, pg_temp
AS $$
DECLARE
  contact marketing_contact%ROWTYPE;
BEGIN
  IF NOT request_is_service_database_role() THEN
    RAISE EXCEPTION 'marketing unsubscribe service role required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR nullif(btrim(p_source), '') IS NULL THEN
    RAISE EXCEPTION 'unsubscribe evidence is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO contact
  FROM marketing_contact candidate
  WHERE candidate.unsubscribe_token = p_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF contact.status IN ('pending', 'subscribed', 'suppressed') THEN
    UPDATE marketing_contact
    SET status = 'unsubscribed', unsubscribed_at = now(), suppression_reason = NULL
    WHERE id = contact.id;
    INSERT INTO marketing_consent_event (
      marketing_contact_id, action, source, request_id, evidence
    ) VALUES (
      contact.id, 'unsubscribe', left(p_source, 120), p_request_id,
      jsonb_build_object('channel', 'email')
    ) ON CONFLICT (request_id) DO NOTHING;
    contact.status := 'unsubscribed';
  END IF;
  contact_id := contact.id;
  email := contact.email;
  status := contact.status;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION record_marketing_subscription(
  p_email text,
  p_customer_user_id uuid,
  p_display_name text,
  p_locale_code text,
  p_source text,
  p_policy_version text,
  p_request_id uuid,
  p_evidence jsonb
) RETURNS TABLE(contact_id uuid, status text)
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_catalog, pg_temp
AS $$
DECLARE
  normalized_email text := lower(btrim(p_email));
  contact marketing_contact%ROWTYPE;
BEGIN
  IF NOT request_is_service_database_role() THEN
    RAISE EXCEPTION 'marketing subscription service role required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR nullif(btrim(p_source), '') IS NULL
    OR nullif(btrim(p_policy_version), '') IS NULL
    OR jsonb_typeof(coalesce(p_evidence, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'subscription evidence is required' USING ERRCODE = '22023';
  END IF;
  IF normalized_email IS NULL OR length(normalized_email) > 254
    OR position('@' IN normalized_email) <= 1 THEN
    RAISE EXCEPTION 'invalid subscription email' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM locale WHERE code = p_locale_code AND active) THEN
    RAISE EXCEPTION 'invalid subscription locale' USING ERRCODE = '22023';
  END IF;

  SELECT candidate.* INTO contact
  FROM marketing_contact candidate
  JOIN marketing_consent_event event ON event.marketing_contact_id = candidate.id
  WHERE event.request_id = p_request_id;
  IF FOUND THEN
    contact_id := contact.id;
    status := contact.status;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_customer_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app_user account
    WHERE account.id = p_customer_user_id
      AND account.kind = 'customer'
      AND lower(account.email) = normalized_email
  ) THEN
    RAISE EXCEPTION 'subscription customer identity does not match email' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM email_suppression suppression
    WHERE suppression.email = normalized_email AND suppression.released_at IS NULL
  ) THEN
    RAISE EXCEPTION 'suppressed email cannot be subscribed' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO contact
  FROM marketing_contact candidate
  WHERE candidate.email = normalized_email
  FOR UPDATE;
  IF contact.id IS NOT NULL AND contact.customer_user_id IS NOT NULL
    AND contact.customer_user_id IS DISTINCT FROM p_customer_user_id THEN
    RAISE EXCEPTION 'subscription contact is linked to another customer' USING ERRCODE = '23514';
  END IF;

  IF contact.id IS NULL THEN
    INSERT INTO marketing_contact (
      email, customer_user_id, display_name, locale_code, status,
      consent_at, consent_source, consent_evidence
    ) VALUES (
      normalized_email, p_customer_user_id, nullif(btrim(p_display_name), ''),
      p_locale_code, 'subscribed', now(), left(p_source, 120), p_evidence
    ) RETURNING * INTO contact;
  ELSE
    UPDATE marketing_contact
    SET customer_user_id = coalesce(customer_user_id, p_customer_user_id),
      display_name = coalesce(nullif(btrim(p_display_name), ''), display_name),
      locale_code = p_locale_code, status = 'subscribed', consent_at = now(),
      consent_source = left(p_source, 120), consent_evidence = p_evidence,
      unsubscribed_at = NULL, suppression_reason = NULL
    WHERE id = contact.id
    RETURNING * INTO contact;
  END IF;

  INSERT INTO marketing_consent_event (
    marketing_contact_id, action, source, request_id, policy_version, evidence
  ) VALUES (
    contact.id, 'subscribe', left(p_source, 120), p_request_id,
    left(p_policy_version, 120), p_evidence
  );
  contact_id := contact.id;
  status := contact.status;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION protect_approved_communication_template() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('approved', 'retired') THEN
    RAISE EXCEPTION 'approved or retired communication templates are retained for audit';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('approved', 'retired') AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.template_key IS DISTINCT FROM OLD.template_key
    OR NEW.locale_code IS DISTINCT FROM OLD.locale_code
    OR NEW.version IS DISTINCT FROM OLD.version
    OR (OLD.status = 'approved' AND NEW.status NOT IN ('approved', 'retired'))
    OR (OLD.status = 'retired' AND NEW.status <> 'retired')
    OR NEW.subject IS DISTINCT FROM OLD.subject
    OR NEW.preview_text IS DISTINCT FROM OLD.preview_text
    OR NEW.content_definition IS DISTINCT FROM OLD.content_definition
    OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'approved communication template content is immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE FUNCTION validate_outbound_marketing_recipient() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pixbrik, pg_temp
AS $$
DECLARE
  contact_email text;
BEGIN
  IF NEW.message_kind = 'marketing' THEN
    SELECT email INTO contact_email
    FROM marketing_contact
    WHERE id = NEW.marketing_contact_id;
    IF contact_email IS NULL OR lower(contact_email) <> lower(NEW.recipient) THEN
      RAISE EXCEPTION 'marketing message recipient must match its consent-bearing contact';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER marketing_contact_touch_updated_at
  BEFORE UPDATE ON marketing_contact
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER email_campaign_touch_updated_at
  BEFORE UPDATE ON email_campaign
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER email_automation_rule_touch_updated_at
  BEFORE UPDATE ON email_automation_rule
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER email_campaign_transition_guard
  BEFORE UPDATE OR DELETE ON email_campaign
  FOR EACH ROW EXECUTE FUNCTION validate_email_campaign_transition();
CREATE TRIGGER communication_template_approved_guard
  BEFORE UPDATE OR DELETE ON communication_template
  FOR EACH ROW EXECUTE FUNCTION protect_approved_communication_template();
CREATE TRIGGER outbound_message_envelope_guard
  BEFORE UPDATE ON outbound_message
  FOR EACH ROW EXECUTE FUNCTION protect_outbound_message_envelope();
CREATE TRIGGER outbound_message_marketing_recipient_guard
  BEFORE INSERT OR UPDATE OF recipient, message_kind, marketing_contact_id ON outbound_message
  FOR EACH ROW EXECUTE FUNCTION validate_outbound_marketing_recipient();
CREATE TRIGGER email_delivery_event_no_mutation
  BEFORE UPDATE OR DELETE ON email_delivery_event
  FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
CREATE TRIGGER email_delivery_event_evidence_guard
  BEFORE INSERT ON email_delivery_event
  FOR EACH ROW EXECUTE FUNCTION validate_resend_delivery_evidence();
CREATE TRIGGER marketing_consent_event_no_mutation
  BEFORE UPDATE OR DELETE ON marketing_consent_event
  FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

WITH owner AS (
  SELECT id FROM app_user WHERE email = 'sam@benisty.ca' LIMIT 1
), template_seed(
  template_key, locale_code, purpose, subject, preview_text, heading, body, cta_label, cta_path
) AS (
  VALUES
    ('account.welcome', 'en', 'transactional', 'Welcome to PixBrik', 'Your PixBrik space is ready.', 'Welcome to PixBrik.', 'Your account keeps your builds, orders and instructions together. Start with a photo whenever inspiration strikes.', 'Create a build', '/create'),
    ('account.welcome', 'fr', 'transactional', 'Bienvenue chez PixBrik', 'Votre espace PixBrik est prêt.', 'Bienvenue chez PixBrik.', 'Votre compte réunit vos créations, commandes et instructions. Commencez avec une photo dès que l’inspiration arrive.', 'Créer un modèle', '/create'),
    ('account.welcome', 'es', 'transactional', 'Te damos la bienvenida a PixBrik', 'Tu espacio PixBrik está listo.', 'Te damos la bienvenida a PixBrik.', 'Tu cuenta reúne tus creaciones, pedidos e instrucciones. Empieza con una foto cuando llegue la inspiración.', 'Crear un modelo', '/create'),
    ('account.welcome', 'it', 'transactional', 'Benvenuto in PixBrik', 'Il tuo spazio PixBrik è pronto.', 'Benvenuto in PixBrik.', 'Il tuo account riunisce creazioni, ordini e istruzioni. Inizia da una foto quando arriva l’ispirazione.', 'Crea un modello', '/create'),
    ('account.welcome', 'ar', 'transactional', 'مرحباً بك في PixBrik', 'مساحتك في PixBrik جاهزة.', 'مرحباً بك في PixBrik.', 'يجمع حسابك التصاميم والطلبات وتعليمات البناء في مكان واحد. ابدأ بصورة عندما تأتيك الفكرة.', 'أنشئ تصميماً', '/create'),

    ('checkout.abandoned', 'en', 'marketing', 'Your PixBrik build is waiting', 'Continue exactly where you stopped.', 'Your build is still here.', 'We saved your selected model and options so you can continue without starting over.', 'Resume my build', '/account'),
    ('checkout.abandoned', 'fr', 'marketing', 'Votre création PixBrik vous attend', 'Reprenez exactement là où vous vous êtes arrêté.', 'Votre création est toujours là.', 'Nous avons conservé le modèle et les options choisis afin que vous puissiez reprendre sans recommencer.', 'Reprendre ma création', '/account'),
    ('checkout.abandoned', 'es', 'marketing', 'Tu creación PixBrik te espera', 'Continúa exactamente donde lo dejaste.', 'Tu creación sigue aquí.', 'Guardamos el modelo y las opciones elegidas para que puedas continuar sin empezar de nuevo.', 'Continuar mi creación', '/account'),
    ('checkout.abandoned', 'it', 'marketing', 'La tua creazione PixBrik ti aspetta', 'Riprendi esattamente da dove eri arrivato.', 'La tua creazione è ancora qui.', 'Abbiamo salvato il modello e le opzioni selezionate, così puoi continuare senza ricominciare.', 'Riprendi la creazione', '/account'),
    ('checkout.abandoned', 'ar', 'marketing', 'تصميم PixBrik الخاص بك بانتظارك', 'تابع من حيث توقفت تماماً.', 'تصميمك ما زال محفوظاً.', 'حفظنا النموذج والخيارات التي اخترتها لتتمكن من المتابعة دون البدء من جديد.', 'تابع تصميمي', '/account'),

    ('order.confirmed', 'en', 'transactional', 'We received your PixBrik order', 'Your order and build choices are safely recorded.', 'Your order is confirmed.', 'We have recorded your selected build, size, colours and construction options. You can follow every step from your account.', 'View my order', '/account'),
    ('order.confirmed', 'fr', 'transactional', 'Nous avons reçu votre commande PixBrik', 'Votre commande et vos choix sont bien enregistrés.', 'Votre commande est confirmée.', 'Votre création, sa taille, ses couleurs et ses options sont enregistrées. Suivez chaque étape depuis votre compte.', 'Voir ma commande', '/account'),
    ('order.confirmed', 'es', 'transactional', 'Hemos recibido tu pedido PixBrik', 'Tu pedido y tus opciones están guardados.', 'Tu pedido está confirmado.', 'Hemos guardado la creación, el tamaño, los colores y las opciones elegidas. Sigue cada etapa desde tu cuenta.', 'Ver mi pedido', '/account'),
    ('order.confirmed', 'it', 'transactional', 'Abbiamo ricevuto il tuo ordine PixBrik', 'Il tuo ordine e le scelte sono registrati.', 'Il tuo ordine è confermato.', 'Abbiamo registrato modello, dimensione, colori e opzioni. Segui ogni fase dal tuo account.', 'Vedi il mio ordine', '/account'),
    ('order.confirmed', 'ar', 'transactional', 'استلمنا طلب PixBrik الخاص بك', 'تم حفظ طلبك وخيارات التصميم.', 'تم تأكيد طلبك.', 'سجلنا التصميم والحجم والألوان وخيارات البناء التي اخترتها. تابع كل مرحلة من حسابك.', 'عرض طلبي', '/account'),

    ('payment.failed', 'en', 'transactional', 'Your PixBrik payment needs attention', 'Your build is safe; please review the payment.', 'We could not complete the payment.', 'Your build has not been lost. Return to your order to use another payment method or retry securely.', 'Review payment', '/account'),
    ('payment.failed', 'fr', 'transactional', 'Votre paiement PixBrik nécessite votre attention', 'Votre création est conservée ; vérifiez le paiement.', 'Le paiement n’a pas abouti.', 'Votre création est bien conservée. Revenez à la commande pour réessayer ou choisir un autre moyen de paiement.', 'Vérifier le paiement', '/account'),
    ('payment.failed', 'es', 'transactional', 'Tu pago de PixBrik requiere atención', 'Tu creación está segura; revisa el pago.', 'No pudimos completar el pago.', 'Tu creación sigue guardada. Vuelve al pedido para intentarlo de nuevo o usar otro método de pago.', 'Revisar el pago', '/account'),
    ('payment.failed', 'it', 'transactional', 'Il pagamento PixBrik richiede attenzione', 'La creazione è al sicuro; controlla il pagamento.', 'Non siamo riusciti a completare il pagamento.', 'La tua creazione è ancora salvata. Torna all’ordine per riprovare o usare un altro metodo di pagamento.', 'Controlla il pagamento', '/account'),
    ('payment.failed', 'ar', 'transactional', 'دفعة PixBrik تحتاج إلى مراجعة', 'تصميمك محفوظ؛ يرجى مراجعة الدفع.', 'تعذر إتمام عملية الدفع.', 'لم نفقد تصميمك. ارجع إلى طلبك للمحاولة مجدداً أو استخدام وسيلة دفع أخرى.', 'مراجعة الدفع', '/account'),

    ('order.shipped', 'en', 'transactional', 'Your PixBrik order is on its way', 'Follow the delivery from your account.', 'Your build has shipped.', 'Your box of bricks and step-by-step instructions are on the way. Tracking details are available in your order.', 'Track my order', '/account'),
    ('order.shipped', 'fr', 'transactional', 'Votre commande PixBrik est en route', 'Suivez la livraison depuis votre compte.', 'Votre création a été expédiée.', 'Votre boîte de briques et les instructions pas à pas sont en route. Le suivi est disponible dans votre commande.', 'Suivre ma commande', '/account'),
    ('order.shipped', 'es', 'transactional', 'Tu pedido PixBrik está en camino', 'Sigue la entrega desde tu cuenta.', 'Tu creación ha sido enviada.', 'La caja de piezas y las instrucciones paso a paso están en camino. Consulta el seguimiento en tu pedido.', 'Seguir mi pedido', '/account'),
    ('order.shipped', 'it', 'transactional', 'Il tuo ordine PixBrik è in viaggio', 'Segui la consegna dal tuo account.', 'La tua creazione è stata spedita.', 'La scatola di mattoncini e le istruzioni passo passo sono in viaggio. Trovi il tracking nel tuo ordine.', 'Segui il mio ordine', '/account'),
    ('order.shipped', 'ar', 'transactional', 'طلب PixBrik في طريقه إليك', 'تابع التسليم من حسابك.', 'تم شحن تصميمك.', 'صندوق القطع وتعليمات البناء خطوة بخطوة في الطريق. تفاصيل التتبع متاحة في طلبك.', 'تتبع طلبي', '/account'),

    ('review.request', 'en', 'marketing', 'How did your PixBrik build turn out?', 'Show us the finished build and help us improve.', 'You built something unique.', 'We would love to see the finished result. Your feedback helps us improve model accuracy, pieces and instructions.', 'Share feedback', '/contact'),
    ('review.request', 'fr', 'marketing', 'Comment s’est passée votre construction PixBrik ?', 'Montrez-nous le résultat et aidez-nous à progresser.', 'Vous avez construit quelque chose d’unique.', 'Nous aimerions voir le résultat final. Votre avis nous aide à améliorer la précision, les pièces et les instructions.', 'Donner mon avis', '/contact'),
    ('review.request', 'es', 'marketing', '¿Qué tal quedó tu creación PixBrik?', 'Enséñanos el resultado y ayúdanos a mejorar.', 'Has construido algo único.', 'Nos encantará ver el resultado final. Tu opinión nos ayuda a mejorar la precisión, las piezas y las instrucciones.', 'Compartir opinión', '/contact'),
    ('review.request', 'it', 'marketing', 'Com’è venuta la tua creazione PixBrik?', 'Mostraci il risultato e aiutaci a migliorare.', 'Hai costruito qualcosa di unico.', 'Ci piacerebbe vedere il risultato finale. Il tuo parere ci aiuta a migliorare precisione, pezzi e istruzioni.', 'Lascia un feedback', '/contact'),
    ('review.request', 'ar', 'marketing', 'كيف كانت نتيجة تصميم PixBrik؟', 'أرنا النتيجة وساعدنا على التحسن.', 'لقد بنيت شيئاً فريداً.', 'يسعدنا رؤية النتيجة النهائية. ملاحظاتك تساعدنا على تحسين الدقة والقطع والتعليمات.', 'شارك رأيك', '/contact'),

    ('newsletter.gift_ideas', 'en', 'marketing', 'A gift nobody else can give', 'Turn a favourite memory into a buildable PixBrik gift.', 'Make the memory buildable.', 'Choose a person, pet, object or artwork and turn it into a brick build made for one special person.', 'Explore gift ideas', '/'),
    ('newsletter.gift_ideas', 'fr', 'marketing', 'Un cadeau que personne d’autre ne peut offrir', 'Transformez un souvenir en cadeau PixBrik à construire.', 'Rendez le souvenir constructible.', 'Choisissez une personne, un animal, un objet ou une œuvre et transformez-le en création de briques unique.', 'Découvrir les idées', '/'),
    ('newsletter.gift_ideas', 'es', 'marketing', 'Un regalo que nadie más puede hacer', 'Convierte un recuerdo en un regalo PixBrik para construir.', 'Convierte el recuerdo en una creación.', 'Elige una persona, mascota, objeto u obra y transfórmalo en una creación de piezas para alguien especial.', 'Ver ideas de regalo', '/'),
    ('newsletter.gift_ideas', 'it', 'marketing', 'Un regalo che nessun altro può fare', 'Trasforma un ricordo in un regalo PixBrik da costruire.', 'Rendi costruibile il ricordo.', 'Scegli una persona, un animale, un oggetto o un’opera e trasformalo in una creazione di mattoncini unica.', 'Scopri le idee regalo', '/'),
    ('newsletter.gift_ideas', 'ar', 'marketing', 'هدية لا يستطيع غيرك تقديمها', 'حوّل ذكرى مفضلة إلى هدية PixBrik قابلة للبناء.', 'حوّل الذكرى إلى تصميم تبنيه.', 'اختر شخصاً أو حيواناً أليفاً أو غرضاً أو لوحة وحوّلها إلى تصميم من القطع لشخص مميز.', 'استكشف أفكار الهدايا', '/'),

    ('newsletter.new_builds', 'en', 'marketing', 'New ways to build your photos', 'See what is new in PixBrik flat panels and true 3D.', 'More detail. Better shapes. Your photo.', 'Explore the latest model sizes, natural colour palettes and hollow or full construction choices.', 'See what is new', '/'),
    ('newsletter.new_builds', 'fr', 'marketing', 'De nouvelles façons de construire vos photos', 'Découvrez les nouveautés PixBrik en panneau et en vraie 3D.', 'Plus de détail. De meilleures formes. Votre photo.', 'Découvrez les nouvelles tailles, les couleurs naturelles et les constructions creuses ou pleines.', 'Voir les nouveautés', '/'),
    ('newsletter.new_builds', 'es', 'marketing', 'Nuevas formas de construir tus fotos', 'Descubre las novedades de PixBrik en panel y 3D real.', 'Más detalle. Mejores formas. Tu foto.', 'Explora nuevos tamaños, colores naturales y opciones de construcción hueca o completa.', 'Ver novedades', '/'),
    ('newsletter.new_builds', 'it', 'marketing', 'Nuovi modi di costruire le tue foto', 'Scopri le novità PixBrik per pannelli e vero 3D.', 'Più dettaglio. Forme migliori. La tua foto.', 'Esplora nuove dimensioni, colori naturali e costruzioni cave o piene.', 'Scopri le novità', '/'),
    ('newsletter.new_builds', 'ar', 'marketing', 'طرق جديدة لبناء صورك', 'اكتشف الجديد في لوحات PixBrik والتصاميم ثلاثية الأبعاد.', 'تفاصيل أكثر. أشكال أدق. صورتك أنت.', 'اكتشف الأحجام الجديدة والألوان الطبيعية وخيارات البناء المجوف أو الكامل.', 'اكتشف الجديد', '/')
)
INSERT INTO communication_template (
  template_key, locale_code, version, status, subject, preview_text,
  content_definition, approved_by, approved_at
)
SELECT
  template_seed.template_key,
  template_seed.locale_code,
  1,
  'approved',
  template_seed.subject,
  template_seed.preview_text,
  jsonb_build_object(
    'purpose', template_seed.purpose,
    'heading', template_seed.heading,
    'body', template_seed.body,
    'previewText', template_seed.preview_text,
    'ctaLabel', template_seed.cta_label,
    'ctaPath', template_seed.cta_path,
    'themeVersion', 1
  ),
  owner.id,
  now()
FROM template_seed
CROSS JOIN owner
ON CONFLICT (template_key, locale_code, version) DO NOTHING;

WITH owner AS (
  SELECT id FROM app_user WHERE email = 'sam@benisty.ca' LIMIT 1
)
INSERT INTO email_automation_rule (
  rule_key, name, source_event, template_key, enabled, delay_minutes,
  requires_marketing_consent, created_by, updated_by
)
SELECT seed.rule_key, seed.name, seed.source_event, seed.template_key,
  seed.enabled, seed.delay_minutes, seed.requires_consent, owner.id, owner.id
FROM (
  VALUES
    ('welcome', 'Welcome new customers', 'customer.created', 'account.welcome', false, 0, false),
    ('abandoned-checkout', 'Recover an abandoned checkout', 'checkout.abandoned', 'checkout.abandoned', false, 60, true),
    ('order-confirmation', 'Confirm a placed order', 'order.placed', 'order.confirmed', false, 0, false),
    ('payment-failed', 'Help after a failed payment', 'payment.failed', 'payment.failed', false, 5, false),
    ('order-shipped', 'Send tracking after shipment', 'order.shipped', 'order.shipped', false, 0, false),
    ('delivery-review', 'Ask for feedback after delivery', 'order.delivered', 'review.request', false, 10080, true)
) AS seed(rule_key, name, source_event, template_key, enabled, delay_minutes, requires_consent)
CROSS JOIN owner
ON CONFLICT (rule_key) DO NOTHING;

INSERT INTO marketing_contact (
  email, customer_user_id, display_name, locale_code, status,
  consent_at, consent_source, consent_evidence
)
SELECT
  account.email,
  account.id,
  account.display_name,
  account.preferred_locale,
  'subscribed',
  profile.marketing_consent_at,
  profile.marketing_consent_source,
  jsonb_build_object('migrated_from', 'customer_profile', 'migration', '0009')
FROM customer_profile profile
JOIN app_user account ON account.id = profile.user_id
WHERE profile.marketing_email_consent
  AND profile.marketing_consent_at IS NOT NULL
  AND nullif(btrim(profile.marketing_consent_source), '') IS NOT NULL
ON CONFLICT (email) DO NOTHING;

INSERT INTO marketing_consent_event (
  marketing_contact_id, action, source, request_id, actor_user_id, policy_version, evidence
)
SELECT
  contact.id,
  'subscribe',
  'legacy.customer_profile',
  gen_random_uuid(),
  NULL,
  NULL,
  jsonb_build_object('migration', '0009', 'original_source', contact.consent_source)
FROM marketing_contact contact
WHERE contact.status = 'subscribed'
  AND NOT EXISTS (
    SELECT 1 FROM marketing_consent_event existing
    WHERE existing.marketing_contact_id = contact.id
  );

ALTER TABLE marketing_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_contact FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_consent_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_consent_event FORCE ROW LEVEL SECURITY;
ALTER TABLE email_suppression ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_suppression FORCE ROW LEVEL SECURITY;
ALTER TABLE email_campaign ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaign FORCE ROW LEVEL SECURITY;
ALTER TABLE email_automation_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_automation_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE email_campaign_recipient ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaign_recipient FORCE ROW LEVEL SECURITY;
ALTER TABLE email_delivery_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_delivery_event FORCE ROW LEVEL SECURITY;

CREATE POLICY marketing_contact_admin_access ON marketing_contact FOR ALL
  USING (request_is_admin_database_role() OR request_is_migrator_database_role())
  WITH CHECK (request_is_admin_database_role() OR request_is_migrator_database_role());
CREATE POLICY marketing_consent_event_admin_access ON marketing_consent_event FOR ALL
  USING (request_is_admin_database_role() OR request_is_migrator_database_role())
  WITH CHECK (request_is_admin_database_role() OR request_is_migrator_database_role());
CREATE POLICY email_suppression_admin_access ON email_suppression FOR ALL
  USING (request_is_admin_database_role() OR request_is_migrator_database_role())
  WITH CHECK (request_is_admin_database_role() OR request_is_migrator_database_role());
CREATE POLICY email_campaign_admin_access ON email_campaign FOR ALL
  USING (request_is_admin_database_role() OR request_is_migrator_database_role())
  WITH CHECK (request_is_admin_database_role() OR request_is_migrator_database_role());
CREATE POLICY email_automation_rule_admin_access ON email_automation_rule FOR ALL
  USING (request_is_admin_database_role() OR request_is_migrator_database_role())
  WITH CHECK (request_is_admin_database_role() OR request_is_migrator_database_role());
CREATE POLICY email_campaign_recipient_admin_access ON email_campaign_recipient FOR ALL
  USING (request_is_admin_database_role() OR request_is_migrator_database_role())
  WITH CHECK (request_is_admin_database_role() OR request_is_migrator_database_role());
CREATE POLICY email_delivery_event_admin_access ON email_delivery_event FOR ALL
  USING (request_is_admin_database_role() OR request_is_migrator_database_role())
  WITH CHECK (request_is_admin_database_role() OR request_is_migrator_database_role());

CREATE POLICY marketing_contact_service_access ON marketing_contact FOR ALL
  USING (request_is_service_database_role())
  WITH CHECK (request_is_service_database_role());
CREATE POLICY marketing_consent_event_service_access ON marketing_consent_event FOR ALL
  USING (request_is_service_database_role())
  WITH CHECK (request_is_service_database_role());
CREATE POLICY email_suppression_service_access ON email_suppression FOR ALL
  USING (request_is_service_database_role())
  WITH CHECK (request_is_service_database_role());
CREATE POLICY email_campaign_service_access ON email_campaign FOR ALL
  USING (request_is_service_database_role())
  WITH CHECK (request_is_service_database_role());
CREATE POLICY email_automation_rule_service_access ON email_automation_rule FOR ALL
  USING (request_is_service_database_role())
  WITH CHECK (request_is_service_database_role());
CREATE POLICY email_campaign_recipient_service_access ON email_campaign_recipient FOR ALL
  USING (request_is_service_database_role())
  WITH CHECK (request_is_service_database_role());
CREATE POLICY email_delivery_event_service_access ON email_delivery_event FOR ALL
  USING (request_is_service_database_role())
  WITH CHECK (request_is_service_database_role());

CREATE POLICY marketing_contact_customer_select ON marketing_contact FOR SELECT
  USING (request_is_customer_database_role() AND customer_user_id = request_user_id());
CREATE POLICY marketing_contact_customer_update ON marketing_contact FOR UPDATE
  USING (request_is_customer_database_role() AND customer_user_id = request_user_id())
  WITH CHECK (request_is_customer_database_role() AND customer_user_id = request_user_id());
CREATE POLICY marketing_consent_event_customer_select ON marketing_consent_event FOR SELECT
  USING (
    request_is_customer_database_role()
    AND EXISTS (
      SELECT 1 FROM marketing_contact contact
      WHERE contact.id = marketing_contact_id
        AND contact.customer_user_id = request_user_id()
    )
  );

GRANT SELECT ON
  marketing_contact, marketing_consent_event, email_suppression, email_campaign, email_automation_rule,
  email_campaign_recipient, email_delivery_event
TO pixbrik_admin_runtime;
GRANT INSERT, UPDATE ON
  marketing_contact, email_suppression, email_campaign, email_automation_rule,
  email_campaign_recipient
TO pixbrik_admin_runtime;
GRANT INSERT ON marketing_consent_event, email_delivery_event TO pixbrik_admin_runtime;

GRANT SELECT ON
  marketing_contact, marketing_consent_event, email_suppression, email_campaign, email_automation_rule,
  email_campaign_recipient, email_delivery_event
TO pixbrik_service_runtime;
REVOKE INSERT, UPDATE ON outbound_message FROM pixbrik_service_runtime;
GRANT INSERT (
  channel, recipient, template_id, locale_code, payload, status, idempotency_key,
  scheduled_at, message_kind, customer_user_id, marketing_contact_id, order_id,
  payment_transaction_id, recovery_id, campaign_id, automation_rule_id,
  subject_snapshot, content_snapshot, next_attempt_at
) ON outbound_message TO pixbrik_service_runtime;
GRANT UPDATE (
  status, provider_message_id, sent_at, delivered_at, failure_summary,
  attempt_count, next_attempt_at, last_attempt_at, first_attempt_at,
  locked_at, locked_by, lease_token, lease_expires_at, last_provider_event_at,
  sender_snapshot, reply_to_snapshot, rendered_html_snapshot,
  rendered_text_snapshot, headers_snapshot, provider_tags_snapshot,
  updated_at
) ON outbound_message TO pixbrik_service_runtime;
GRANT INSERT (
  email, customer_user_id, display_name, locale_code, status, consent_at,
  consent_source, consent_evidence, unsubscribed_at, suppression_reason
) ON marketing_contact TO pixbrik_service_runtime;
GRANT UPDATE (
  customer_user_id, display_name, locale_code, status, consent_at,
  consent_source, consent_evidence, unsubscribed_at, suppression_reason
) ON marketing_contact TO pixbrik_service_runtime;
GRANT INSERT (
  email, reason, source, provider_event_id, note
) ON email_suppression TO pixbrik_service_runtime;
GRANT UPDATE (
  reason, source, provider_event_id, note, created_at, released_at, released_by
) ON email_suppression TO pixbrik_service_runtime;
GRANT UPDATE (
  status, started_at, completed_at, updated_by, updated_at
) ON email_campaign TO pixbrik_service_runtime;
GRANT INSERT ON email_campaign_recipient TO pixbrik_service_runtime;
GRANT INSERT ON marketing_consent_event, email_delivery_event TO pixbrik_service_runtime;
GRANT SELECT ON
  outbound_message, communication_template, payment_transaction, order_event, app_user
TO pixbrik_service_runtime;

GRANT SELECT (
  id, email, customer_user_id, display_name, locale_code, status,
  consent_at, consent_source, unsubscribed_at, suppression_reason,
  created_at, updated_at
) ON marketing_contact TO pixbrik_customer_runtime;
GRANT SELECT ON marketing_consent_event TO pixbrik_customer_runtime;
GRANT UPDATE (
  display_name, locale_code
) ON marketing_contact TO pixbrik_customer_runtime;

GRANT USAGE, SELECT ON SEQUENCE
  marketing_consent_event_id_seq, email_delivery_event_id_seq
TO pixbrik_admin_runtime, pixbrik_service_runtime;

REVOKE ALL ON FUNCTION record_email_suppression(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION unsubscribe_marketing_contact(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_marketing_subscription(text, uuid, text, text, text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_email_suppression(text, text, text, text, text)
TO pixbrik_service_runtime, pixbrik_admin_runtime;
GRANT EXECUTE ON FUNCTION unsubscribe_marketing_contact(uuid, text, uuid)
TO pixbrik_service_runtime;
GRANT EXECUTE ON FUNCTION record_marketing_subscription(text, uuid, text, text, text, text, uuid, jsonb)
TO pixbrik_service_runtime;

COMMENT ON TABLE marketing_contact IS
  'Consent-bearing email audience. Subscription is never inferred from account creation or purchase.';
COMMENT ON FUNCTION record_marketing_subscription(text, uuid, text, text, text, text, uuid, jsonb) IS
  'Idempotent evidence-required subscription command for authenticated buyer or checkout services; never expose directly to browsers.';
COMMENT ON TABLE marketing_consent_event IS
  'Append-only subscription, withdrawal and suppression evidence; current status is a projection.';
COMMENT ON TABLE email_suppression IS
  'Deliverability and complaint suppression checked immediately before every provider send.';
COMMENT ON TABLE email_campaign IS
  'Audited newsletter campaign using immutable localized communication template versions.';
COMMENT ON TABLE email_automation_rule IS
  'Idempotent lifecycle email rules; marketing rules require current recorded consent.';
COMMENT ON TABLE email_delivery_event IS
  'Append-only, signature-verified Resend delivery history keyed by Svix event identifier.';
