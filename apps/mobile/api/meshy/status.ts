/**
 * GET /api/meshy/status?taskId=... — returns { status, progress, hasModel }
 * in the SAME shape as /api/tripo/status, so the client's poll loop is
 * engine-agnostic.
 */

import { fetchMeshyTask } from '../_meshy';

export default async function handler(req: any, res: any): Promise<void> {
  const taskId = req.query?.taskId;
  if (typeof taskId !== 'string' || !taskId) {
    res.status(400).json({ error: 'taskId query param required' });
    return;
  }

  try {
    const { ok, status, task } = await fetchMeshyTask(taskId);
    if (!ok || !task) {
      res.status(502).json({ error: task?.task_error?.message || `status lookup failed (${status})` });
      return;
    }
    res.status(200).json({
      status:
        task.status === 'SUCCEEDED'
          ? 'success'
          : task.status === 'FAILED' || task.status === 'CANCELED'
            ? 'failed'
            : (task.status ?? 'unknown').toLowerCase(),
      progress: task.progress ?? 0,
      hasModel: !!task.model_urls?.glb,
      error: task.task_error?.message,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'status failed' });
  }
}
