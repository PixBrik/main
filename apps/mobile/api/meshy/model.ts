/**
 * GET /api/meshy/model?taskId=... — streams the finished GLB back to the
 * browser (same-origin, so the voxelizer's fetch avoids any CORS issue and
 * the Meshy CDN URL is never exposed to the client).
 */

import { fetchMeshyTask } from '../_meshy';

export default async function handler(req: any, res: any): Promise<void> {
  const taskId = req.query?.taskId;
  if (typeof taskId !== 'string' || !taskId) {
    res.status(400).json({ error: 'taskId query param required' });
    return;
  }

  try {
    const { task } = await fetchMeshyTask(taskId);
    if (task?.status !== 'SUCCEEDED') {
      res.status(409).json({ error: 'model not ready', status: task?.status });
      return;
    }
    const modelUrl = task.model_urls?.glb;
    if (!modelUrl) {
      res.status(404).json({ error: 'no glb in task output' });
      return;
    }

    const modelRes = await fetch(modelUrl);
    if (!modelRes.ok) {
      res.status(502).json({ error: `model download failed (${modelRes.status})` });
      return;
    }
    const buffer = Buffer.from(await modelRes.arrayBuffer());
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'model proxy failed' });
  }
}
