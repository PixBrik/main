/**
 * GET /api/tripo/model?taskId=... — streams the finished GLB back to the
 * browser (same-origin, so the voxelizer's fetch avoids any CORS issue and
 * the Tripo CDN URL is never exposed to the client).
 */

import { fetchTask, pickModelUrl } from '../_tripo';
import {
  ModelStreamError,
  modelResponseStarted,
  streamProviderModel,
} from '../_modelStream';

export default async function handler(req: any, res: any): Promise<void> {
  const taskId = req.query?.taskId;
  if (typeof taskId !== 'string' || !taskId) {
    res.status(400).json({ error: 'taskId query param required' });
    return;
  }

  try {
    const task = await fetchTask(taskId);
    if (task.code !== 0 || task.data?.status !== 'success') {
      res.status(409).json({ error: 'model not ready', status: task.data?.status });
      return;
    }
    const modelUrl = pickModelUrl(task.data?.output);
    if (!modelUrl) {
      res.status(404).json({ error: 'no model in task output' });
      return;
    }

    const modelRes = await fetch(modelUrl);
    await streamProviderModel(modelRes, res);
  } catch (err: any) {
    if (modelResponseStarted(res)) {
      if (!res.destroyed) res.destroy?.(err);
      return;
    }
    const status = err instanceof ModelStreamError ? err.status : 500;
    res.status(status).json({ error: err?.message || 'model proxy failed' });
  }
}
