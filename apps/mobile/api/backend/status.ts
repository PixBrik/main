import {
  BackendConfigurationError,
  fetchBackendReadiness,
} from '../_backend';

const responseHeaders = {
  'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=300',
  'Content-Type': 'application/json; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};

function sendJson(res: any, status: number, body: unknown): void {
  for (const [name, value] of Object.entries(responseHeaders)) res.setHeader(name, value);
  res.status(status).json(body);
}
export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendJson(res, 405, { code: 'method_not_allowed', connected: false });
    return;
  }

  try {
    const readiness = await fetchBackendReadiness();
    sendJson(res, 200, {
      checkedAt: new Date().toISOString(),
      connected: true,
      contractVersion: readiness.contractVersion,
      service: 'operations',
    });
  } catch (error) {
    sendJson(res, 503, {
      code: error instanceof BackendConfigurationError
        ? 'backend_not_configured'
        : 'backend_unavailable',
      connected: false,
    });
  }
}
