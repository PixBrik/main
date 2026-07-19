/**
 * POST /api/meshy/text-submit — the Library Studio's generator (owner tool).
 * Two-stage Meshy text-to-3d:
 *   { mode: 'preview', prompt }                         → untextured mesh
 *   { mode: 'refine', previewTaskId, texturePrompt? }   → textured mesh
 * Returns { taskId } (poll via /api/meshy/status?taskKind=text-to-3d).
 * The API key never leaves the server; every call spends real Meshy credits,
 * so it shares the paid-generation guard with the photo endpoints.
 */

import { meshyHeaders, meshyTaskUrl } from '../_meshy';
import {
  GenerationSecurityError,
  guardPaidGeneration,
  sendGenerationSecurityError,
} from '../_generationSecurity';

const MAX_PROMPT_CHARS = 600;
const TASK_ID_PATTERN = /^[a-zA-Z0-9-_]{8,64}$/;

function cleanPrompt(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Strip control characters without regex escapes (they mangle in transit).
  const cleaned = [...value]
    .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
    .join('')
    .trim();
  return cleaned.length > 0 && cleaned.length <= MAX_PROMPT_CHARS ? cleaned : null;
}

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }

  try {
    const mode: unknown = req.body?.mode;
    let taskBody: Record<string, unknown>;
    if (mode === 'preview') {
      const prompt = cleanPrompt(req.body?.prompt);
      if (!prompt) {
        res.status(400).json({ error: `prompt is required (1–${MAX_PROMPT_CHARS} characters)` });
        return;
      }
      taskBody = {
        ai_model: 'meshy-6',
        mode: 'preview',
        prompt,
        // Full geometry fidelity for library masters; brick voxelization is
        // the one deliberate simplification step downstream.
        should_remesh: false,
        topology: 'triangle',
      };
    } else if (mode === 'refine') {
      const previewTaskId: unknown = req.body?.previewTaskId;
      if (typeof previewTaskId !== 'string' || !TASK_ID_PATTERN.test(previewTaskId)) {
        res.status(400).json({ error: 'refine requires previewTaskId from a finished preview' });
        return;
      }
      const texturePrompt = cleanPrompt(req.body?.texturePrompt);
      taskBody = {
        enable_pbr: false,
        hd_texture: true,
        mode: 'refine',
        preview_task_id: previewTaskId,
        ...(texturePrompt ? { texture_prompt: texturePrompt } : {}),
      };
    } else {
      res.status(400).json({ error: "mode must be 'preview' or 'refine'" });
      return;
    }

    // Consume the safety quota only after validation, immediately before the
    // call that can spend credits.
    guardPaidGeneration(req);

    const taskRes = await fetch(meshyTaskUrl('text-to-3d'), {
      method: 'POST',
      headers: { ...meshyHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(taskBody),
    });
    const body = (await taskRes.json().catch(() => null)) as { result?: string; message?: string } | null;
    if (!taskRes.ok || !body?.result) {
      const httpStatus = taskRes.status === 402 ? 402 : 502;
      res.status(httpStatus).json({ error: body?.message || `Meshy task create failed (${taskRes.status})` });
      return;
    }

    res.status(200).json({ taskId: body.result });
  } catch (err: any) {
    if (err instanceof GenerationSecurityError) {
      sendGenerationSecurityError(res, err);
      return;
    }
    res.status(500).json({ error: err?.message || 'text submit failed' });
  }
}
