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

/** Meshy uses separate resources for one-photo, multi-photo and text tasks. */
export const MESHY_TASK_KINDS = ['image-to-3d', 'multi-image-to-3d', 'text-to-3d'] as const;
export type MeshyTaskKind = (typeof MESHY_TASK_KINDS)[number];

/** Text-to-3D lives under the v2 API; the image tasks stay on v1. */
export function meshyTaskUrl(kind: MeshyTaskKind, taskId?: string): string {
  const base =
    kind === 'text-to-3d'
      ? 'https://api.meshy.ai/openapi/v2/text-to-3d'
      : `${MESHY_BASE}/${kind}`;
  return taskId ? `${base}/${encodeURIComponent(taskId)}` : base;
}

/**
 * Keep the public proxy's task-kind input on a closed allow-list. The default
 * preserves URLs for existing one-photo jobs and saved pending tasks.
 */
export function parseMeshyTaskKind(value: unknown): MeshyTaskKind | null {
  if (value === undefined || value === null || value === '') return 'image-to-3d';
  return MESHY_TASK_KINDS.includes(value as MeshyTaskKind)
    ? (value as MeshyTaskKind)
    : null;
}

export interface MeshyTask {
  id?: string;
  status?: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  progress?: number;
  model_urls?: { glb?: string; obj?: string; fbx?: string };
  task_error?: { message?: string };
}

/** Fetch a Meshy task's current state (any kind). */
export async function fetchMeshyTask(
  taskId: string,
  kind: MeshyTaskKind = 'image-to-3d',
): Promise<{ ok: boolean; status: number; task: MeshyTask | null }> {
  const res = await fetch(meshyTaskUrl(kind, taskId), {
    headers: meshyHeaders(),
  });
  const task = (await res.json().catch(() => null)) as MeshyTask | null;
  return { ok: res.ok, status: res.status, task };
}
