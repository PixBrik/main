/**
 * Shared Tripo helpers for the serverless proxy. Files prefixed with "_" are
 * NOT exposed as routes by Vercel — this is internal glue only.
 *
 * The API key lives in process.env.TRIPO_API_KEY (server-side env var, set in
 * Vercel + local .env.local). It is never sent to the browser.
 */

export const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi';

export function tripoKey(): string {
  const key = process.env.TRIPO_API_KEY;
  if (!key) {
    throw new Error('TRIPO_API_KEY is not configured on the server');
  }
  return key;
}

export function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${tripoKey()}` };
}

/** Fetch a Tripo task's current state. */
export async function fetchTask(taskId: string): Promise<{
  code: number;
  message?: string;
  data?: {
    status?: string;
    progress?: number;
    output?: { pbr_model?: string; model?: string; base_model?: string };
  };
}> {
  const res = await fetch(`${TRIPO_BASE}/task/${encodeURIComponent(taskId)}`, {
    headers: authHeaders(),
  });
  return (await res.json()) as never;
}

/** Pick the best available model URL from a task's output (prefer textured). */
export function pickModelUrl(output?: {
  pbr_model?: string;
  model?: string;
  base_model?: string;
}): string | null {
  return output?.pbr_model || output?.model || output?.base_model || null;
}
