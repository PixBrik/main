/**
 * Shared Meshy helpers for the serverless proxy. Files prefixed with "_" are
 * NOT exposed as routes by Vercel — internal glue only.
 *
 * The API key lives in process.env.MESHY_API_KEY (server-side env var, set in
 * Vercel). It is never sent to the browser.
 */

export const MESHY_BASE = 'https://api.meshy.ai/openapi/v1';

export function meshyKey(): string {
  const key = process.env.MESHY_API_KEY;
  if (!key) {
    throw new Error('MESHY_API_KEY is not configured on the server');
  }
  return key;
}

export function meshyHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${meshyKey()}` };
}

export interface MeshyTask {
  id?: string;
  status?: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  progress?: number;
  model_urls?: { glb?: string; obj?: string; fbx?: string };
  task_error?: { message?: string };
}

/** Fetch a Meshy image-to-3d task's current state. */
export async function fetchMeshyTask(taskId: string): Promise<{ ok: boolean; status: number; task: MeshyTask | null }> {
  const res = await fetch(`${MESHY_BASE}/image-to-3d/${encodeURIComponent(taskId)}`, {
    headers: meshyHeaders(),
  });
  const task = (await res.json().catch(() => null)) as MeshyTask | null;
  return { ok: res.ok, status: res.status, task };
}
