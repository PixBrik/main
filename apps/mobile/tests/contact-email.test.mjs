import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import ts from 'typescript';

const clientSourceUrl = new URL('../src/lib/contactForm.ts', import.meta.url);
const emailSourceUrl = new URL('../api/_contactEmail.ts', import.meta.url);
const apiSourceUrl = new URL('../api/contact.ts', import.meta.url);
const NOW = Date.parse('2026-07-18T12:00:00.000Z');

async function loadTypeScriptModule(sourceUrl, { env = {}, globals = {}, stubs = {} } = {}) {
  const source = await readFile(sourceUrl, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({
    AbortController,
    Buffer,
    Date: globals.Date ?? Date,
    Headers,
    Response,
    TextDecoder,
    TextEncoder,
    URL,
    Uint8Array,
    clearTimeout,
    console,
    crypto: globals.crypto ?? webcrypto,
    exports: module.exports,
    fetch: globals.fetch ?? fetch,
    module,
    process: { env },
    require: (id) => stubs[id] ?? {},
    setTimeout,
  });
  new vm.Script(output, { filename: sourceUrl.pathname }).runInContext(context);
  return module.exports;
}

function rawSubmission(overrides = {}) {
  const formStartedAt = overrides.formStartedAt ?? NOW - 5_000;
  return {
    companyWebsite: '',
    email: 'Sam@example.com',
    formStartedAt,
    locale: 'en',
    message: 'I would like to know more about a custom PixBrik build.',
    name: 'Sam Example',
    orderReference: 'PB-2026-0001',
    privacyNoticePresentedAt: overrides.privacyNoticePresentedAt ?? formStartedAt,
    privacyNoticeVersion: 'contact-support-privacy-2026-07-18-v1',
    submissionId: 'd9428888-122b-4aef-a9f5-4f8f30c151bf',
    topic: 'order',
    ...overrides,
  };
}

async function loadContactModules({ env = {}, fetchImpl } = {}) {
  const client = await loadTypeScriptModule(clientSourceUrl);
  const email = await loadTypeScriptModule(emailSourceUrl, {
    env,
    globals: { fetch: fetchImpl },
    stubs: {
      '../src/lib/contactForm': client,
      'node:crypto': { createHash },
    },
  });
  return { client, email };
}

function responseRecorder() {
  return {
    body: undefined,
    headers: new Map(),
    statusCode: 0,
    json(body) {
      this.body = body;
      return this;
    },
    setHeader(name, value) {
      this.headers.set(String(name).toLowerCase(), value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}

test('client helper creates a UUID and preserves the retry id in the JSON contract', async () => {
  const { client } = await loadContactModules();
  const submissionId = client.createContactSubmissionId();
  assert.match(submissionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

  let request;
  const submission = rawSubmission({ submissionId });
  const result = await client.submitContactForm(submission, {
    endpoint: '/api/contact',
    fetchImpl: async (url, init) => {
      request = { init, url };
      return Response.json({ messageKey: 'contact.received', ok: true, submissionId }, { status: 202 });
    },
  });

  assert.equal(request.url, '/api/contact');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(request.init.body).submissionId, submissionId);
  assert.equal(result.submissionId, submissionId);

  assert.equal(
    client.resolveContactEndpoint({ appUrl: 'https://pixbrik.com', runtime: 'native' }),
    'https://pixbrik.com/api/contact',
  );
  assert.throws(
    () => client.resolveContactEndpoint({ runtime: 'native' }),
    (error) => error.code === 'contact_not_configured',
  );
  assert.equal(client.resolveContactEndpoint({ runtime: 'web' }), '/api/contact');
  await assert.rejects(
    () => client.submitContactForm(submission),
    (error) => error.code === 'contact_not_configured',
  );
});

test('validator and branded templates support EN, FR, ES, IT and RTL Arabic', async () => {
  const { email } = await loadContactModules();
  const localeCases = [
    ['en-US', 'en', 'New contact request'],
    ['fr-FR', 'fr', 'Nouvelle demande de contact'],
    ['es-ES', 'es', 'Nueva solicitud de contacto'],
    ['it-IT', 'it', 'Nuova richiesta di contatto'],
    ['ar-SA', 'ar', 'طلب تواصل جديد'],
  ];

  for (const [inputLocale, locale, title] of localeCases) {
    const parsed = email.parseContactSubmission(rawSubmission({
      locale: inputLocale,
      message: 'Please preserve <script>alert(1)</script> as plain customer text.',
      name: '<b>Sam</b>',
    }), NOW);
    const rendered = email.renderContactEmail(parsed);
    assert.equal(parsed.locale, locale);
    assert.match(rendered.subject, new RegExp(title));
    assert.match(rendered.html, new RegExp(`lang="${locale}"`));
    assert.doesNotMatch(rendered.html, /<script>alert/);
    assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(rendered.html, /&lt;b&gt;Sam&lt;\/b&gt;/);
    assert.match(rendered.text, /Sam@example\.com/i);
    assert.match(rendered.text, /contact-support-privacy-2026-07-18-v1/);
    assert.match(rendered.text, /2026-07-18T11:59:55\.000Z/);
    if (locale === 'ar') assert.match(rendered.html, /dir="rtl"/);
  }
});

test('validator rejects unsafe inputs and silently marks honeypot or implausibly fast forms', async () => {
  const { client, email } = await loadContactModules();
  assert.equal(client.isValidContactName('PixBrik\u202Egnikoops'), false);
  assert.equal(client.isValidContactOrderReference('PB-2026-0001'), true);
  assert.equal(client.isValidContactOrderReference('PB/2026/0001'), false);
  assert.throws(
    () => email.parseContactSubmission(rawSubmission({ email: 'victim@example.com\r\nBcc: attacker@example.com' }), NOW),
    (error) => error.field === 'email',
  );
  assert.throws(
    () => email.parseContactSubmission(rawSubmission({ privacyNoticeVersion: 'unknown-notice' }), NOW),
    (error) => error.field === 'privacyNoticeVersion',
  );
  assert.throws(
    () => email.parseContactSubmission(rawSubmission({ name: 'PixBrik\u202Egnikoops' }), NOW),
    (error) => error.field === 'name',
  );
  assert.throws(
    () => email.parseContactSubmission(rawSubmission({ topic: 'refund-now' }), NOW),
    (error) => error.field === 'topic',
  );
  assert.equal(email.parseContactSubmission(rawSubmission({ companyWebsite: 'https://spam.invalid' }), NOW).trapped, true);
  assert.equal(email.parseContactSubmission(rawSubmission({ formStartedAt: NOW - 200 }), NOW).trapped, true);
  assert.equal(email.parseContactSubmission(rawSubmission(), NOW).trapped, false);
  assert.throws(
    () => email.parseContactSubmission(rawSubmission({ formStartedAt: NOW - (23 * 60 * 60 * 1_000) - 1 }), NOW),
    (error) => error.field === 'formStartedAt',
  );
});

test('Resend request is server-only, reply-safe and idempotent for retries', async () => {
  const requests = [];
  const { email } = await loadContactModules({
    env: {
      CONTACT_RECIPIENT_EMAIL: 'hello@pixbrik.com',
      RESEND_API_KEY: 're_test_server_only',
      RESEND_FROM_EMAIL: 'PixBrik <hello@pixbrik.com>',
      VERCEL_ENV: 'production',
    },
    fetchImpl: async (url, init) => {
      requests.push({ init, url });
      return Response.json({ id: 'email_123' });
    },
  });
  const submission = email.parseContactSubmission(rawSubmission(), NOW);
  const key = email.contactIdempotencyKey(submission);
  assert.equal(key, email.contactIdempotencyKey(submission));
  assert.doesNotMatch(key, /example\.com|Sam Example/);

  await email.sendContactEmail(submission);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.resend.com/emails');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer re_test_server_only');
  assert.equal(requests[0].init.headers['Idempotency-Key'], key);
  const body = JSON.parse(requests[0].init.body);
  assert.deepEqual(Array.from(body.to), ['hello@pixbrik.com']);
  assert.equal(body.from, 'PixBrik <hello@pixbrik.com>');
  assert.equal(body.reply_to, 'sam@example.com');
  assert.match(body.html, /PIXBRIK/);
  assert.match(body.text, /PB-2026-0001/);

  assert.throws(
    () => email.resendContactConfig({}),
    (error) => error.status === 503 && error.code === 'contact_not_configured',
  );
  assert.throws(
    () => email.resendContactConfig({ RESEND_API_KEY: 're_preview', VERCEL_ENV: 'preview' }),
    (error) => error.status === 503 && error.code === 'contact_not_configured',
  );
  assert.throws(
    () => email.resendContactConfig({
      CONTACT_RECIPIENT_EMAIL: 'hello@pixbrik.com',
      RESEND_API_KEY: 're_preview',
      VERCEL_ENV: 'preview',
    }),
    (error) => error.status === 503 && error.code === 'contact_not_configured',
  );
  assert.equal(email.resendContactConfig({
    CONTACT_RECIPIENT_EMAIL: 'pixbrik-preview@example.net',
    RESEND_API_KEY: 're_preview',
    VERCEL_ENV: 'preview',
  }).recipient, 'pixbrik-preview@example.net');
  assert.equal(email.resendContactConfig({
    CONTACT_ALLOW_PRODUCTION_RECIPIENT_OUTSIDE_PRODUCTION: 'true',
    CONTACT_RECIPIENT_EMAIL: 'hello@pixbrik.com',
    RESEND_API_KEY: 're_preview',
    VERCEL_ENV: 'preview',
  }).recipient, 'hello@pixbrik.com');
});

test('API accepts real messages, hides honeypot detection, blocks foreign origins and rate limits bursts', async () => {
  const sent = [];
  const env = {
    NODE_ENV: 'production',
    RESEND_API_KEY: 're_test_server_only',
  };
  const { email } = await loadContactModules({
    env,
    fetchImpl: async (url, init) => {
      sent.push({ init, url });
      return Response.json({ id: `email_${sent.length}` });
    },
  });
  const api = await loadTypeScriptModule(apiSourceUrl, {
    env,
    stubs: {
      './_contactEmail': email,
      'node:crypto': { createHash },
    },
  });
  assert.equal(
    api.allowedContactOrigins({ NODE_ENV: 'production', VERCEL_URL: 'pixbrik-preview.vercel.app' })
      .has('https://pixbrik-preview.vercel.app'),
    true,
  );
  assert.equal(
    api.allowedContactOrigins({ CONTACT_ALLOWED_ORIGINS: 'http://pixbrik.invalid', NODE_ENV: 'production' })
      .has('http://pixbrik.invalid'),
    false,
  );

  const valid = responseRecorder();
  await api.default({
    body: rawSubmission({ formStartedAt: Date.now() - 5_000 }),
    headers: {
      'content-type': 'application/json',
      origin: 'https://pixbrik.com',
      'x-forwarded-for': '203.0.113.10',
    },
    method: 'POST',
  }, valid);
  assert.equal(valid.statusCode, 202);
  assert.equal(valid.body.ok, true);
  assert.equal(sent.length, 1);

  const originless = responseRecorder();
  await api.default({
    body: rawSubmission({ formStartedAt: Date.now() - 5_000 }),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.99' },
    method: 'POST',
  }, originless);
  assert.equal(originless.statusCode, 403);
  assert.equal(sent.length, 1);

  const trap = responseRecorder();
  await api.default({
    body: rawSubmission({
      companyWebsite: 'bot value',
      formStartedAt: Date.now() - 5_000,
      submissionId: '0d86cf68-3bd1-4d06-8551-4b760cf4b204',
    }),
    headers: { 'content-type': 'application/json', origin: 'https://pixbrik.com', 'x-forwarded-for': '203.0.113.11' },
    method: 'POST',
  }, trap);
  assert.equal(trap.statusCode, 202);
  assert.equal(sent.length, 1);

  const foreign = responseRecorder();
  await api.default({
    body: rawSubmission({ formStartedAt: Date.now() - 5_000 }),
    headers: { 'content-type': 'application/json', origin: 'https://attacker.invalid' },
    method: 'POST',
  }, foreign);
  assert.equal(foreign.statusCode, 403);
  assert.equal(sent.length, 1);

  const simpleFormPost = responseRecorder();
  await api.default({
    body: JSON.stringify(rawSubmission({ formStartedAt: Date.now() - 5_000 })),
    headers: { 'content-type': 'text/plain', origin: 'https://pixbrik.com', 'x-forwarded-for': '203.0.113.12' },
    method: 'POST',
  }, simpleFormPost);
  assert.equal(simpleFormPost.statusCode, 415);
  assert.equal(sent.length, 1);

  api.clearContactRateLimitsForTests();
  for (let index = 0; index < api.CONTACT_RATE_LIMIT_MAX; index += 1) {
    const response = responseRecorder();
    const suffix = String(index + 1).padStart(12, '0');
    await api.default({
      body: rawSubmission({
        formStartedAt: Date.now() - 5_000,
        submissionId: `11111111-1111-4111-8111-${suffix}`,
      }),
      headers: { 'content-type': 'application/json', origin: 'https://pixbrik.com', 'x-forwarded-for': '203.0.113.20' },
      method: 'POST',
    }, response);
    assert.equal(response.statusCode, 202);
  }
  const limited = responseRecorder();
  await api.default({
    body: rawSubmission({
      formStartedAt: Date.now() - 5_000,
      submissionId: '22222222-2222-4222-8222-222222222222',
    }),
    headers: { 'content-type': 'application/json', origin: 'https://pixbrik.com', 'x-forwarded-for': '203.0.113.20' },
    method: 'POST',
  }, limited);
  assert.equal(limited.statusCode, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});
