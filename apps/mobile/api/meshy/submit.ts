/**
 * POST /api/meshy/submit — body { image: dataUrl }.
 * Creates a Meshy image-to-3d task (Meshy-6). Returns { taskId }.
 * The API key never leaves the server.
 */

import { MESHY_BASE, meshyHeaders } from '../_meshy';

/** Meshy-6 settings for likeness-first brick conversion. */
export function buildMeshyRequestBody(image: string) {
  return {
    ai_model: 'meshy-6',
    // Preserve the supplied person's/object's appearance instead of asking
    // Meshy to creatively enhance the reference before reconstruction.
    image_enhancement: false,
    image_url: image,
    // Meshy applies target_polycount only when remeshing is enabled.
    should_remesh: true,
    should_texture: true,
    target_polycount: 10000,
    topology: 'triangle',
  } as const;
}

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }

  try {
    const image: unknown = req.body?.image;
    // Meshy accepts base64 data URIs directly (jpg/jpeg/png only — no webp).
    if (typeof image !== 'string' || !/^data:image\/(png|jpe?g);base64,/.test(image)) {
      res.status(400).json({ error: 'Body must be { image: <base64 data URL (png/jpg)> }' });
      return;
    }

    // Meshy-6 per the owner's manual tests — it produced the best busts.
    // Polycount capped like Tripo's face_limit: the mesh becomes a coarse
    // brick grid, so high poly fidelity is wasted spend + slow downloads.
    const taskRes = await fetch(`${MESHY_BASE}/image-to-3d`, {
      method: 'POST',
      headers: { ...meshyHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(buildMeshyRequestBody(image)),
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
    res.status(500).json({ error: err?.message || 'submit failed' });
  }
}
