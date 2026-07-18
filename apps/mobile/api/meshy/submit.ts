/**
 * POST /api/meshy/submit — body { image } or { views: { front, left, back, right } }.
 * Accepts either one image or four guided views and creates the corresponding
 * Meshy-6 image-to-3d task. Returns { taskId }.
 * The API key never leaves the server.
 */

import { MESHY_BASE, meshyHeaders } from '../_meshy';
import {
  GenerationSecurityError,
  guardPaidGeneration,
  sendGenerationSecurityError,
} from '../_generationSecurity';

const DATA_URL_PATTERN = /^data:image\/(png|jpe?g);base64,[a-z0-9+/]+={0,2}$/i;
const MAX_REQUEST_JSON_CHARS = 3_600_000;
const VIEW_ORDER = ['front', 'left', 'back', 'right'] as const;
type MeshyView = (typeof VIEW_ORDER)[number];

const LIKENESS_FIRST_SETTINGS = {
  ai_model: 'meshy-6',
  hd_texture: true,
  // Preserve the supplied person's/object's appearance instead of asking
  // Meshy to creatively enhance the references before reconstruction.
  image_enhancement: false,
  // Flatten photographed highlights/shadows before catalog colour sampling.
  remove_lighting: true,
  // Meshy documents `false` as its highest-precision triangular output.
  // Brick voxelization performs the deliberate simplification later, so an
  // early remesh would only throw away shape before catalog conversion.
  should_remesh: false,
  should_texture: true,
  target_formats: ['glb'],
} as const;

/** Meshy-6 settings for likeness-first brick conversion. */
export function buildMeshyRequestBody(image: string) {
  return {
    ...LIKENESS_FIRST_SETTINGS,
    image_url: image,
  } as const;
}

/** Preserve the app's semantic orbit order when sending four guided views. */
export function buildMeshyMultiviewRequestBody(views: Record<MeshyView, string>) {
  return {
    ...LIKENESS_FIRST_SETTINGS,
    image_urls: VIEW_ORDER.map((name) => views[name]),
  } as const;
}

function isSupportedDataUrl(value: unknown): value is string {
  return typeof value === 'string' && DATA_URL_PATTERN.test(value);
}

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }

  try {
    if (JSON.stringify(req.body ?? {}).length > MAX_REQUEST_JSON_CHARS) {
      res.status(413).json({ error: 'Prepared photos are too large; crop closer and try again' });
      return;
    }

    const image: unknown = req.body?.image;
    const views: unknown = req.body?.views;
    const isMultiview = !!views && typeof views === 'object' && !Array.isArray(views);
    // Meshy accepts base64 data URIs directly (jpg/jpeg/png only — no webp).
    let taskPath: 'image-to-3d' | 'multi-image-to-3d';
    let taskBody:
      | ReturnType<typeof buildMeshyRequestBody>
      | ReturnType<typeof buildMeshyMultiviewRequestBody>;
    if (isMultiview) {
      const viewMap = views as Record<string, unknown>;
      const invalid = VIEW_ORDER.filter((name) => !isSupportedDataUrl(viewMap[name]));
      if (invalid.length) {
        res.status(400).json({
          error: `Meshy multiview needs base64 png/jpg data URLs for front, left, back and right; invalid ${invalid.join(', ')}`,
        });
        return;
      }
      const orderedViews = Object.fromEntries(
        VIEW_ORDER.map((name) => [name, viewMap[name] as string]),
      ) as Record<MeshyView, string>;
      taskPath = 'multi-image-to-3d';
      taskBody = buildMeshyMultiviewRequestBody(orderedViews);
    } else {
      if (!isSupportedDataUrl(image)) {
        res.status(400).json({
          error: 'Body must be { image: <base64 data URL (png/jpg)> } or four views',
        });
        return;
      }
      taskPath = 'image-to-3d';
      taskBody = buildMeshyRequestBody(image);
    }

    // Consume the safety quota only after the complete request has passed
    // validation, immediately before the call that can spend credits.
    guardPaidGeneration(req);

    // Meshy-6 keeps its full source geometry here. Catalog-aware voxelization
    // is the single controlled simplification step after buyer approval.
    const taskRes = await fetch(`${MESHY_BASE}/${taskPath}`, {
      method: 'POST',
      headers: { ...meshyHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(taskBody),
    });
    const body = (await taskRes.json().catch(() => null)) as { result?: string; message?: string } | null;
    if (!taskRes.ok || !body?.result) {
      // 402 = out of Meshy credits — surface it so the client can explain.
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
    res.status(500).json({ error: err?.message || 'submit failed' });
  }
}
