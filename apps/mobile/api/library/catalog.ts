import { BackendConfigurationError, fetchBackendLibrary } from '../_backend';

const headers = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};

function sendJson(res: any, status: number, body: unknown): void {
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.status(status).json(body);
}

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendJson(res, 405, { code: 'method_not_allowed' });
    return;
  }
  try {
    sendJson(res, 200, { contractVersion: 1, entries: await fetchBackendLibrary() });
  } catch (error) {
    sendJson(res, 503, {
      code: error instanceof BackendConfigurationError ? 'catalog_not_configured' : 'catalog_unavailable',
      entries: [],
    });
  }
}
