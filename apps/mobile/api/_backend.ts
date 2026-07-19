const BACKEND_URL_ENV = 'PIXBRIK_BACKEND_URL';
const SHARED_SECRET_ENV = 'PIXBRIK_BACKEND_SHARED_SECRET';
const CUSTOMER_ORIGIN_ENV = 'PIXBRIK_APP_URL';
const MINIMUM_SECRET_BYTES = 32;
const READINESS_PATH = '/backoffice/api/internal/readiness';
const CATALOG_PATH = '/backoffice/api/internal/library/catalog';
const PUBLISH_PATH = '/backoffice/api/internal/library/publish';

export class BackendConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendConfigurationError';
  }
}
export class BackendUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendUnavailableError';
  }
}

function requiredEnvironmentValue(
  name: string,
  source: Record<string, string | undefined>,
): string {
  const value = source[name]?.trim();
  if (!value) throw new BackendConfigurationError(`Missing ${name}`);
  return value;
}

function safeCustomerOrigin(source: Record<string, string | undefined>): string {
  const configured = requiredEnvironmentValue(CUSTOMER_ORIGIN_ENV, source);
  try {
    const parsed = new URL(configured);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== '/' && parsed.pathname !== '')
    ) {
      throw new Error('unsafe customer origin');
    }
    return parsed.origin;
  } catch {
    throw new BackendConfigurationError(`${CUSTOMER_ORIGIN_ENV} must be an HTTPS origin`);
  }
}

function backendInternalUrl(
  path: string,
  source: Record<string, string | undefined> = process.env,
): string {
  const configured = requiredEnvironmentValue(BACKEND_URL_ENV, source);
  try {
    const parsed = new URL(configured);
    const developmentHttp =
      source.NODE_ENV !== 'production' &&
      parsed.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (
      (parsed.protocol !== 'https:' && !developmentHttp) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !['/', '/backoffice', ''].includes(parsed.pathname.replace(/\/$/, '') || '/')
    ) {
      throw new Error('unsafe backend URL');
    }
    return new URL(path, parsed.origin).toString();
  } catch (error) {
    if (error instanceof BackendConfigurationError) throw error;
    throw new BackendConfigurationError(
      `${BACKEND_URL_ENV} must be a credential-free HTTPS backend origin`,
    );
  }
}

export function backendReadinessUrl(
  source: Record<string, string | undefined> = process.env,
): string {
  return backendInternalUrl(READINESS_PATH, source);
}

function sharedSecret(source: Record<string, string | undefined>): string {
  const secret = requiredEnvironmentValue(SHARED_SECRET_ENV, source);
  if (Buffer.byteLength(secret, 'utf8') < MINIMUM_SECRET_BYTES) {
    throw new BackendConfigurationError(`${SHARED_SECRET_ENV} is too short`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(secret)) {
    throw new BackendConfigurationError(`${SHARED_SECRET_ENV} must be base64url`);
  }
  return secret;
}

function bridgeHeaders(source: Record<string, string | undefined>): Record<string, string> {
  return {
    Authorization: `Bearer ${sharedSecret(source)}`,
    'X-PixBrik-Customer-Origin': safeCustomerOrigin(source),
  };
}

export interface BackendReadiness {
  contractVersion: 1;
  database: 'connected';
  service: 'pixbrik-backoffice';
  status: 'ready';
}

function isBackendReadiness(value: unknown): value is BackendReadiness {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const readiness = value as Partial<BackendReadiness>;
  return readiness.contractVersion === 1
    && readiness.database === 'connected'
    && readiness.service === 'pixbrik-backoffice'
    && readiness.status === 'ready';
}

export async function fetchBackendReadiness(
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<BackendReadiness> {
  const env = options.env ?? process.env;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(backendReadinessUrl(env), {
      headers: {
        ...bridgeHeaders(env),
      },
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw new BackendUnavailableError('Backend readiness check was rejected');
    const readiness = await response.json().catch(() => null) as unknown;
    if (!isBackendReadiness(readiness)) {
      throw new BackendUnavailableError('Backend readiness response was invalid');
    }
    return readiness;
  } catch (error) {
    if (error instanceof BackendConfigurationError || error instanceof BackendUnavailableError) {
      throw error;
    }
    throw new BackendUnavailableError('Backend readiness check failed');
  } finally {
    clearTimeout(timeout);
  }
}

export interface BackendLibraryEntry {
  brickPreviews?: string[];
  category: string;
  defaultColor: string;
  id: string;
  meshUrl: string;
  name: string;
  seed: false;
  tags: string[];
  thumbnailUrl?: string;
}

function isLibraryEntry(value: unknown): value is BackendLibraryEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<BackendLibraryEntry>;
  return typeof entry.id === 'string'
    && typeof entry.name === 'string'
    && typeof entry.category === 'string'
    && typeof entry.defaultColor === 'string'
    && typeof entry.meshUrl === 'string'
    && Array.isArray(entry.tags)
    && entry.tags.every((tag) => typeof tag === 'string')
    && (entry.thumbnailUrl === undefined || typeof entry.thumbnailUrl === 'string')
    && (entry.brickPreviews === undefined
      || (Array.isArray(entry.brickPreviews) && entry.brickPreviews.every((frame) => typeof frame === 'string')));
}

export async function fetchBackendLibrary(
  options: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<BackendLibraryEntry[]> {
  const env = options.env ?? process.env;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(backendInternalUrl(CATALOG_PATH, env), {
      headers: bridgeHeaders(env),
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw new BackendUnavailableError('Backend library request was rejected');
    const body = await response.json().catch(() => null) as { contractVersion?: unknown; entries?: unknown } | null;
    if (body?.contractVersion !== 1 || !Array.isArray(body.entries) || !body.entries.every(isLibraryEntry)) {
      throw new BackendUnavailableError('Backend library response was invalid');
    }
    return body.entries;
  } catch (error) {
    if (error instanceof BackendConfigurationError || error instanceof BackendUnavailableError) throw error;
    throw new BackendUnavailableError('Backend library request failed');
  } finally {
    clearTimeout(timeout);
  }
}

export async function publishBackendLibraryMaster(
  body: unknown,
  studioSession: string,
  options: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<BackendLibraryEntry> {
  const env = options.env ?? process.env;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(backendInternalUrl(PUBLISH_PATH, env), {
      body: JSON.stringify(body),
      headers: {
        ...bridgeHeaders(env),
        'Content-Type': 'application/json',
        'X-PixBrik-Studio-Session': studioSession,
      },
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
    });
    const parsed = await response.json().catch(() => null) as { entry?: unknown; error?: unknown } | null;
    if (!response.ok || !isLibraryEntry(parsed?.entry)) {
      const message = typeof parsed?.error === 'string' ? parsed.error : 'Backoffice rejected the library master';
      throw new BackendUnavailableError(message);
    }
    return parsed.entry;
  } catch (error) {
    if (error instanceof BackendConfigurationError || error instanceof BackendUnavailableError) throw error;
    throw new BackendUnavailableError('Backoffice library publish failed');
  } finally {
    clearTimeout(timeout);
  }
}
