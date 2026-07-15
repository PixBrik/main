/**
 * POST /api/tripo/submit — body { image: dataUrl }.
 * Uploads the image to Tripo and creates an image_to_model task.
 * Returns { taskId }. The API key never leaves the server.
 */

import { TRIPO_BASE, authHeaders } from '../_tripo';

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }

  try {
    const image: unknown = req.body?.image;
    if (typeof image !== 'string') {
      res.status(400).json({ error: 'Body must be { image: <base64 data URL> }' });
      return;
    }

    const match = image.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
    if (!match) {
      res.status(400).json({ error: 'image must be a base64 data URL (png/jpg/webp)' });
      return;
    }
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const mime = `image/${match[1]}`;
    const buffer = Buffer.from(match[2]!, 'base64');

    // 1. Upload the image → image_token.
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime }), `photo.${ext}`);
    const upRes = await fetch(`${TRIPO_BASE}/upload`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    });
    const upJson = (await upRes.json()) as { code: number; message?: string; data?: { image_token?: string } };
    if (upJson.code !== 0 || !upJson.data?.image_token) {
      res.status(502).json({ error: upJson.message || 'Tripo upload failed', code: upJson.code });
      return;
    }

    // 2. Create the image_to_model task.
    // Cheaper model by default — the mesh gets voxelized into bricks, so
    // high-end mesh fidelity is wasted. Override with TRIPO_MODEL_VERSION
    // (e.g. "v1.4-20240625" = cheapest, "v2.5-20250123" = default/better).
    const modelVersion = process.env.TRIPO_MODEL_VERSION || 'v2.0-20240919';
    const taskRes = await fetch(`${TRIPO_BASE}/task`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'image_to_model',
        model_version: modelVersion,
        // Keep the colour texture (needed for the brick recolour) but skip PBR
        // maps and HD texture — we only sample base colour, so those are wasted
        // credits. geometry_quality standard is already the cheap default.
        texture: true,
        pbr: false,
        file: { type: ext, file_token: upJson.data.image_token },
      }),
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
