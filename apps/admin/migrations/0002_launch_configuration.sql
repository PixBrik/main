SET LOCAL search_path TO pixbrik, public;

INSERT INTO locale (code, label, direction) VALUES
  ('en', 'English', 'ltr'),
  ('fr', 'Français', 'ltr'),
  ('es', 'Español', 'ltr'),
  ('it', 'Italiano', 'ltr'),
  ('ar', 'العربية', 'rtl');

INSERT INTO currency (code, label, fraction_digits, is_base) VALUES
  ('EUR', 'Euro', 2, true),
  ('GBP', 'Pound sterling', 2, false),
  ('USD', 'US dollar', 2, false),
  ('CAD', 'Canadian dollar', 2, false),
  ('AUD', 'Australian dollar', 2, false);

INSERT INTO market (code, name, default_locale, default_currency) VALUES
  ('eu', 'European Union', 'en', 'EUR'),
  ('uk', 'United Kingdom', 'en', 'GBP'),
  ('us', 'United States', 'en', 'USD'),
  ('ca', 'Canada', 'en', 'CAD'),
  ('au', 'Australia', 'en', 'AUD'),
  ('middle-east', 'Middle East', 'ar', 'USD');

INSERT INTO market_country (market_id, country_code)
SELECT market.id, countries.country_code
FROM market
JOIN (
  VALUES
    ('eu', 'AT'), ('eu', 'BE'), ('eu', 'BG'), ('eu', 'HR'), ('eu', 'CY'), ('eu', 'CZ'),
    ('eu', 'DK'), ('eu', 'EE'), ('eu', 'FI'), ('eu', 'FR'), ('eu', 'DE'), ('eu', 'GR'),
    ('eu', 'HU'), ('eu', 'IE'), ('eu', 'IT'), ('eu', 'LV'), ('eu', 'LT'), ('eu', 'LU'),
    ('eu', 'MT'), ('eu', 'NL'), ('eu', 'PL'), ('eu', 'PT'), ('eu', 'RO'), ('eu', 'SK'),
    ('eu', 'SI'), ('eu', 'ES'), ('eu', 'SE'),
    ('uk', 'GB'), ('us', 'US'), ('ca', 'CA'), ('au', 'AU'),
    ('middle-east', 'SA'), ('middle-east', 'AE'), ('middle-east', 'BH'), ('middle-east', 'OM')
) AS countries(market_code, country_code) ON countries.market_code = market.code;

INSERT INTO market_locale (market_id, locale_code)
SELECT market.id, locale.code FROM market CROSS JOIN locale;

INSERT INTO market_currency (market_id, currency_code)
SELECT market.id, currency.code FROM market CROSS JOIN currency;

INSERT INTO shipping_zone (code, name, priority) VALUES
  ('eu', 'European Union', 10),
  ('uk', 'United Kingdom', 20),
  ('north-america', 'North America', 30),
  ('australia', 'Australia', 40),
  ('middle-east', 'Middle East', 50);

INSERT INTO shipping_zone_country (zone_id, country_code)
SELECT shipping_zone.id, countries.country_code
FROM shipping_zone
JOIN (
  VALUES
    ('eu', 'AT'), ('eu', 'BE'), ('eu', 'BG'), ('eu', 'HR'), ('eu', 'CY'), ('eu', 'CZ'),
    ('eu', 'DK'), ('eu', 'EE'), ('eu', 'FI'), ('eu', 'FR'), ('eu', 'DE'), ('eu', 'GR'),
    ('eu', 'HU'), ('eu', 'IE'), ('eu', 'IT'), ('eu', 'LV'), ('eu', 'LT'), ('eu', 'LU'),
    ('eu', 'MT'), ('eu', 'NL'), ('eu', 'PL'), ('eu', 'PT'), ('eu', 'RO'), ('eu', 'SK'),
    ('eu', 'SI'), ('eu', 'ES'), ('eu', 'SE'),
    ('uk', 'GB'),
    ('north-america', 'US'), ('north-america', 'CA'),
    ('australia', 'AU'),
    ('middle-east', 'SA'), ('middle-east', 'AE'), ('middle-east', 'BH'), ('middle-east', 'OM')
) AS countries(zone_code, country_code) ON countries.zone_code = shipping_zone.code;

INSERT INTO permission (key, description) VALUES
  ('dashboard.read', 'View launch readiness and operational overview'),
  ('orders.read', 'View orders and order events'),
  ('orders.manage', 'Change order, production, billing and fulfilment state'),
  ('customers.read', 'View customer accounts and history'),
  ('customers.manage', 'Manage customer records and requests'),
  ('builds.read', 'View builds and build versions'),
  ('builds.review', 'Approve, reject and request retakes for builds'),
  ('models.read', 'View the managed model library'),
  ('models.publish', 'Publish, retire and roll back model versions'),
  ('inventory.read', 'View inventory and reservations'),
  ('inventory.manage', 'Change inventory and replenishment records'),
  ('markets.read', 'View markets, currencies, tax state and shipping'),
  ('markets.manage', 'Manage markets, origins, shipping and pricing rules'),
  ('discounts.read', 'View coupons, campaigns and usage'),
  ('discounts.manage', 'Create, disable and modify coupons and campaigns'),
  ('affiliates.read', 'View affiliate attribution and commissions'),
  ('affiliates.manage', 'Manage affiliates, holds and payout batches'),
  ('analytics.read', 'View commercial and product analytics'),
  ('exports.create', 'Create controlled data exports'),
  ('settings.read', 'View integrations and application settings'),
  ('settings.manage', 'Change application and integration settings'),
  ('staff.manage', 'Invite staff and manage role assignments'),
  ('audit.read', 'View the append-only audit trail');

INSERT INTO role (key, name, description, is_system) VALUES
  ('owner', 'Owner', 'Full administrative control; keep membership extremely limited.', true),
  ('operations', 'Operations', 'Order, customer, shipping and production coordination.', true),
  ('production', 'Production', 'Build review, model library and inventory work.', true),
  ('support', 'Support', 'Customer and order support with no financial configuration.', true),
  ('finance', 'Finance', 'Orders, invoices, payments, exports and commercial analytics.', true),
  ('marketing', 'Marketing', 'Discounts, affiliates, campaigns and analytics.', true),
  ('analyst', 'Analyst', 'Read-only analytics and operational reporting.', true);

INSERT INTO role_permission (role_id, permission_id)
SELECT role.id, permission.id FROM role CROSS JOIN permission WHERE role.key = 'owner';

INSERT INTO role_permission (role_id, permission_id)
SELECT role.id, permission.id
FROM role
JOIN (
  VALUES
    ('operations', 'dashboard.read'), ('operations', 'orders.read'), ('operations', 'orders.manage'),
    ('operations', 'customers.read'), ('operations', 'customers.manage'), ('operations', 'builds.read'),
    ('operations', 'inventory.read'), ('operations', 'markets.read'), ('operations', 'discounts.read'),
    ('production', 'dashboard.read'), ('production', 'orders.read'), ('production', 'builds.read'),
    ('production', 'builds.review'), ('production', 'models.read'), ('production', 'models.publish'),
    ('production', 'inventory.read'), ('production', 'inventory.manage'),
    ('support', 'dashboard.read'), ('support', 'orders.read'), ('support', 'customers.read'),
    ('support', 'customers.manage'), ('support', 'builds.read'),
    ('finance', 'dashboard.read'), ('finance', 'orders.read'), ('finance', 'orders.manage'),
    ('finance', 'customers.read'), ('finance', 'analytics.read'), ('finance', 'exports.create'),
    ('finance', 'audit.read'),
    ('marketing', 'dashboard.read'), ('marketing', 'discounts.read'), ('marketing', 'discounts.manage'),
    ('marketing', 'affiliates.read'), ('marketing', 'affiliates.manage'), ('marketing', 'analytics.read'),
    ('analyst', 'dashboard.read'), ('analyst', 'orders.read'), ('analyst', 'customers.read'),
    ('analyst', 'builds.read'), ('analyst', 'inventory.read'), ('analyst', 'analytics.read')
) AS grants(role_key, permission_key) ON grants.role_key = role.key
JOIN permission ON permission.key = grants.permission_key;

INSERT INTO app_user (
  email, kind, status, display_name, preferred_locale, preferred_currency
) VALUES (
  'sam@benisty.ca', 'staff', 'invited', 'PixBrik owner', 'en', 'EUR'
);

INSERT INTO user_role (user_id, role_id)
SELECT app_user.id, role.id
FROM app_user CROSS JOIN role
WHERE app_user.email = 'sam@benisty.ca' AND role.key = 'owner';

INSERT INTO app_setting (key, value, description) VALUES
  ('commerce.base_currency', '"EUR"'::jsonb, 'Authoritative catalog and reporting currency.'),
  ('commerce.presentment_currencies', '["EUR", "GBP", "USD", "CAD", "AUD"]'::jsonb, 'Customer-facing currencies enabled at launch.'),
  ('content.locales', '["en", "fr", "es", "it", "ar"]'::jsonb, 'Supported customer content and communication locales.'),
  ('email.default_sender', '"PixBrik <hello@pixbrik.com>"'::jsonb, 'Default transactional sender after domain verification.'),
  ('email.contact_recipient', '"hello@pixbrik.com"'::jsonb, 'Contact request destination.'),
  ('compliance.checkout_enabled', 'false'::jsonb, 'Remains false until tax, consumer, privacy and product-safety reviews are approved.'),
  ('shipping.origin_visibility_default', 'false'::jsonb, 'Operational shipping origins are not exposed by default.');

-- Shipping rates and origins are intentionally not guessed. Add reviewed effective-dated
-- records in the admin after carriers, fulfilment locations and service levels are confirmed.
-- Tax rates and legal documents are also deliberately absent until professional approval.
