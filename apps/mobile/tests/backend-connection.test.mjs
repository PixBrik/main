import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BackendConfigurationError,
  BackendUnavailableError,
  backendReadinessUrl,
  fetchBackendReadiness,
} from '../api/_backend.ts';

const secret = 'abcdefghijklmnopqrstuvwxyzABCDEFGH0123456789_-';
const env = {
  NODE_ENV: 'production',
  PIXBRIK_APP_URL: 'https://www.pixbrik.com',
  PIXBRIK_BACKEND_SHARED_SECRET: secret,
  PIXBRIK_BACKEND_URL: 'https://pixbrik-backoffice.vercel.app',
};

test('backend URL is pinned to the private readiness contract', () => {
  assert.equal(
    backendReadinessUrl(env),
    'https://pixbrik-backoffice.vercel.app/backoffice/api/internal/readiness',
  );
  assert.throws(
    () => backendReadinessUrl({ ...env, PIXBRIK_BACKEND_URL: 'http://attacker.example' }),
    BackendConfigurationError,
  );
  assert.throws(
    () => backendReadinessUrl({ ...env, PIXBRIK_BACKEND_URL: 'https://example.com/redirect' }),
    BackendConfigurationError,
  );
});
test('main server authenticates to the backend without returning its secret', async () => {
  let request;
  const readiness = await fetchBackendReadiness({
    env,
    fetchImpl: async (url, init) => {
      request = { init, url };
      return new Response(JSON.stringify({
        contractVersion: 1,
        database: 'connected',
        service: 'pixbrik-backoffice',
        status: 'ready',
      }), { status: 200 });
    },
  });
  assert.equal(request.url, 'https://pixbrik-backoffice.vercel.app/backoffice/api/internal/readiness');
  assert.equal(request.init.headers.Authorization, `Bearer ${secret}`);
  assert.equal(request.init.headers['X-PixBrik-Customer-Origin'], 'https://www.pixbrik.com');
  assert.equal(readiness.status, 'ready');
  assert.equal(JSON.stringify(readiness).includes(secret), false);
});

test('main server rejects malformed or failed backend responses', async () => {
  await assert.rejects(
    () => fetchBackendReadiness({ env, fetchImpl: async () => new Response('{}', { status: 200 }) }),
    BackendUnavailableError,
  );
  await assert.rejects(
    () => fetchBackendReadiness({ env, fetchImpl: async () => new Response('{}', { status: 503 }) }),
    BackendUnavailableError,
  );
  await assert.rejects(
    () => fetchBackendReadiness({ env: { ...env, PIXBRIK_BACKEND_SHARED_SECRET: 'short' } }),
    BackendConfigurationError,
  );
});
