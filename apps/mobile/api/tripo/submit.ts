/**
 * POST /api/tripo/submit — two shapes:
 *   { image: dataUrl, modelVersion? }                          → image_to_model
 *   { views: { front, left?, back?, right? }, modelVersion? }  → multiview_to_model
 * Uploads the image(s) to Tripo and creates the task. Returns { taskId }.
 * The API key never leaves the server.
 */

import { TRIPO_BASE, authHeaders } from '../_tripo';

const DATA_URL_PATTERN = /^data:image\/(png|jpe?g|webp);base64,(.+)$/;

/** Multiview file order per the Tripo API: front, left, back, right. */
const VIEW_ORDER = ['front', 'left', 'back', 'right'] as const;

type UploadResult = { ext: string; token: string } | { error: string; code?: number };

async function uploadImage(dataUrl: string): Promise<UploadResult> {
  const match = dataUrl.match(DATA_URL_PATTERN);
  if (!match) {
    return { error: 'each image must be a base64 data URL (png/jpg/webp)' };
  }
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1]!;
  const mime = `image/${match[1]}`;
  const buffer = Buffer.from(match[2]!, 'base64');

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), `photo.${ext}`);
  const upRes = await fetch(`${TRIPO_BASE}/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  const upJson = (await upRes.json()) as { code: number; message?: string; data?: { image_token?: string } };
  if (upJson.code !== 0 || !upJson.data?.image_token) {
    return { code: upJson.code, error: upJson.message || 'Tripo upload failed' };
  }
  return { ext, token: upJson.data.image_token };
}

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }

  try {
    const image: unknown = req.body?.image;
    const views: unknown = req.body?.views;
    const isMultiview = !!views && typeof views === 'object';
    if (!isMultiview && typeof image !== 'string') {
      res.status(400).json({ error: 'Body must be { image } or { views: { front, … } }' });
      return;
    }

    // The client may request a specific version (the model-comparison lab),
    // but ONLY from this whitelist — this endpoint is public and each task
    // spends real credits, so arbitrary versions must not be accepted.
    // Multiview needs v2.0+, so v1.4 is excluded on that path.
    const ALLOWED_VERSIONS = new Set(['v1.4-20240625', 'v2.0-20240919', 'v2.5-20250123']);
    const MULTIVIEW_VERSIONS = new Set(['v2.0-20240919', 'v2.5-20250123']);
    const allowed = isMultiview ? MULTIVIEW_VERSIONS : ALLOWED_VERSIONS;
    const requested: unknown = req.body?.modelVersion;
    const envDefault = process.env.TRIPO_MODEL_VERSION;
    const modelVersion =
      (typeof requested === 'string' && allowed.has(requested) && requested) ||
      (envDefault && allowed.has(envDefault) && envDefault) ||
      'v2.0-20240919';
    // Cap mesh complexity so the browser can voxelize it without freezing. The
    // mesh is turned into a coarse brick grid, so a low face count loses nothing
    // and keeps the GLB small + the download fast. Override via TRIPO_FACE_LIMIT.
    const faceLimit = Number(process.env.TRIPO_FACE_LIMIT) || 10000;
    const shared = {
      model_version: modelVersion,
      face_limit: faceLimit,
      // Keep the colour texture (needed for the brick recolour) but skip PBR
      // maps and HD texture — we only sample base colour, so those are wasted
      // credits. geometry_quality standard is already the cheap default.
      texture: true,
      pbr: false,
    };

    let taskBody: Record<string, unknown>;
    if (isMultiview) {
      const viewMap = views as Record<string, unknown>;
      if (typeof viewMap.front !== 'string') {
        res.status(400).json({ error: 'views.front is required for multiview' });
        return;
      }
      const provided = VIEW_ORDER.filter((name) => typeof viewMap[name] === 'string');
      if (provided.length < 2) {
        res.status(400).json({ error: 'multiview needs the front plus at least one more view' });
        return;
      }
      const uploads: Record<string, { ext: string; token: string }> = {};
      for (const name of provided) {
        const result = await uploadImage(viewMap[name] as string);
        if ('error' in result) {
          res.status(502).json({ error: `${name} view: ${result.error}`, code: result.code });
          return;
        }
        uploads[name] = result;
      }
      taskBody = {
        type: 'multiview_to_model',
        ...shared,
        // Fixed order [front, left, back, right]; empty {} = view not provided.
        files: VIEW_ORDER.map((name) =>
          uploads[name] ? { type: uploads[name]!.ext, file_token: uploads[name]!.token } : {},
        ),
      };
    } else {
      const result = await uploadImage(image as string);
      if ('error' in result) {
        res.status(502).json({ error: result.error, code: result.code });
        return;
      }
      taskBody = {
        type: 'image_to_model',
        ...shared,
        file: { type: result.ext, file_token: result.token },
      };
    }

    const taskRes = await fetch(`${TRIPO_BASE}/task`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(taskBody),
    });
    const taskJson = (await taskRes.json()) as { code: number; message?: string; data?: { task_id?: string } };
    if (taskJson.code !== 0 || !taskJson.data?.task_id) {
      // 2010 = insufficient credit → surface as 402 so the client can explain it.
      const httpStatus = taskJson.code === 2010 ? 402 : 502;
      res.status(httpStatus).json({ error: taskJson.message || 'Tripo task create failed', code: taskJson.code });
      return;
    }

    res.status(200).json({ taskId: taskJson.data.task_id });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'submit failed' });
  }
}
