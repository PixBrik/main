# Background-removal production security

`POST /api/background/remove` sends a validated, cropped PNG to a paid
background-removal provider. Image bytes stay in function memory and are not
logged or persisted by the route.

## Fail-closed configuration

Production provider calls remain disabled unless all launch checks are complete
and `BACKGROUND_REMOVAL_API_ENABLED=1` is set in the mobile Vercel project's
server environment. `EXPO_PUBLIC_BACKGROUND_REMOVAL_ENABLED=1` only displays the
client UI; it never authorizes the server or contains a secret.

Configure these server values:

```dotenv
BACKGROUND_REMOVAL_API_ENABLED=0
BACKGROUND_REMOVAL_ALLOWED_ORIGINS=https://pixbrik.com,https://www.pixbrik.com
BACKGROUND_REMOVAL_IP_HOURLY_LIMIT=10
BACKGROUND_REMOVAL_DAILY_PROVIDER_LIMIT=200
BACKGROUND_REMOVAL_PROVIDER=photoroom
PHOTOROOM_API_KEY=your_photoroom_server_key_here
REMOVE_BG_API_KEY=your_remove_bg_server_key_here
```

Production requires a non-empty origin list. It accepts complete `https://`
origins only (plus HTTP localhost during development). Paths, credentials,
query strings, fragments, empty list entries and non-local HTTP origins are
rejected as configuration errors. A
browser request must match the configured list. Native clients normally have no
`Origin` header, so the route deliberately accepts a missing Origin after the
production flag and configuration checks; quotas and all image checks still
apply.

Invalid configured limits fail closed. Omitted limits use the conservative
defaults shown above. Provider keys must exist only in the server environment,
never in an `EXPO_PUBLIC_` variable or the app bundle.

## Required production launch gates

Do not enable the server flag until all of these are in place:

- Add a distributed per-IP Vercel Firewall rate-limit rule for
  `/api/background/remove`. The function's hashed-IP, warm-instance hourly map
  is defense in depth and cannot enforce a fleet-wide limit.
- Configure a durable daily provider-call budget/quota alert and hard stop
  outside the function. The in-memory all-provider daily breaker is local to a
  warm function and resets with instances.
- Set provider-side spend caps and low-credit alerts for every configured
  provider account. Choose the application limit at or below that provider cap.
- Verify `BACKGROUND_REMOVAL_ALLOWED_ORIGINS` in the production environment and
  test both browser and native uploads against the deployed endpoint.
- Keep both public and server flags at `0` in Preview unless that environment
  has isolated provider credentials, budget controls and explicit test origins.

## Request guarantees

The handler checks the production flag and browser origin, then validates the
multipart body, PNG signature and dimensions. Only after all those checks pass
does it consume local quota, select provider credentials and call the provider.
Errors are JSON with `Cache-Control: no-store`; they never include keys,
provider response bodies or raw upstream error details. Successful responses
are PNG bytes and also use `Cache-Control: no-store`.
