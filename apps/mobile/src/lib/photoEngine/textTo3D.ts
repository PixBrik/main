/**
 * Library Studio client: Meshy text-to-3D orchestration (owner tool).
 *
 * Two paid stages — preview (geometry) then refine (texture) — each polled
 * through our own /api/meshy proxies with taskKind=text-to-3d. Deliberately
 * self-contained: the buyer photo pipeline in imageTo3D.ts must not grow a
 * dependency on studio-only flows.
 */

export type TextProgressFn = (fraction: number, note: string) => void;

const TASK_KIND = 'text-to-3d';
const POLL_MS = 3000;
const MAX_POLLS = 200; // ~10 min across both stages' polling

async function submitText(body: Record<string, unknown>): Promise<string> {
  const res = await fetch('/api/meshy/text-submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => null)) as
    | { taskId?: string; error?: string }
    | null;
  if (!res.ok || !parsed?.taskId) {
    throw new Error(parsed?.error || `generation could not start (${res.status})`);
  }
  return parsed.taskId;
}

async function awaitTextTask(taskId: string, onStageProgress: (p: number) => void): Promise<void> {
  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const res = await fetch(
      `/api/meshy/status?taskId=${encodeURIComponent(taskId)}&taskKind=${TASK_KIND}`,
    );
    if (!res.ok) continue;
    const body = (await res.json()) as {
      status: string;
      progress?: number;
      hasModel?: boolean;
      error?: string;
    };
    if (body.status === 'success') return;
    if (body.status === 'failed') {
      throw new Error(body.error || 'generation failed');
    }
    onStageProgress((body.progress ?? 0) / 100);
  }
  throw new Error('generation timed out');
}

export interface TextTo3DResult {
  /** Same-origin streaming URL for the finished textured GLB. */
  meshUrl: string;
  /** The refine task backing meshUrl — needed to publish durably. */
  taskId: string;
  taskKind: typeof TASK_KIND;
}

/** prompt → textured mesh. Two Meshy credits spends; caller owns that choice. */
export async function generateMeshFromPrompt(
  prompt: string,
  onProgress?: TextProgressFn,
): Promise<TextTo3DResult> {
  onProgress?.(0.02, 'Sculpting the shape');
  const previewId = await submitText({ mode: 'preview', prompt });
  await awaitTextTask(previewId, (p) => onProgress?.(0.05 + p * 0.45, 'Sculpting the shape'));

  onProgress?.(0.5, 'Painting the texture');
  const refineId = await submitText({ mode: 'refine', previewTaskId: previewId });
  await awaitTextTask(refineId, (p) => onProgress?.(0.5 + p * 0.48, 'Painting the texture'));

  onProgress?.(1, 'Model ready');
  return {
    meshUrl: `/api/meshy/model?taskId=${encodeURIComponent(refineId)}&taskKind=${TASK_KIND}`,
    taskId: refineId,
    taskKind: TASK_KIND,
  };
}

export interface PublishSource {
  taskId?: string;
  taskKind?: string;
  /** Allowlisted public sample GLB — free pipeline checks. */
  sourceUrl?: string;
}

/** Persist an approved mesh to durable storage; returns its permanent URL. */
export async function publishLibraryMesh(source: PublishSource, name: string): Promise<string> {
  const res = await fetch('/api/library/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...source, name }),
  });
  const parsed = (await res.json().catch(() => null)) as
    | { meshUrl?: string; error?: string }
    | null;
  if (!res.ok || !parsed?.meshUrl) {
    throw new Error(parsed?.error || `publish failed (${res.status})`);
  }
  return parsed.meshUrl;
}
