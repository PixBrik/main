/**
 * GET /api/tripo/status?taskId=... — returns { status, progress, hasModel }.
 * The client polls this until status === "success".
 */

import { fetchTask, pickModelUrl } from '../_tripo';

export default async function handler(req: any, res: any): Promise<void> {
  const taskId = req.query?.taskId;
  if (typeof taskId !== 'string' || !taskId) {
    res.status(400).json({ error: 'taskId query param required' });
    return;
  }

  try {
    const task = await fetchTask(taskId);
    if (task.code !== 0) {
      res.status(502).json({ error: task.message || 'status lookup failed', code: task.code });
      return;
    }
    res.status(200).json({
      status: task.data?.status ?? 'unknown',
      progress: task.data?.progress ?? 0,
      hasModel: !!pickModelUrl(task.data?.output),
      error: task.message,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'status failed' });
  }
}
