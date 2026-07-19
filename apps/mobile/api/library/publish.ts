/**
 * POST /api/library/publish — persist an approved Library Studio mesh to
 * durable storage (Vercel Blob) and return its public URL.
 *
 * Provider task URLs expire after days; a library entry must outlive them.
 * Sources accepted:
 *   { taskId, taskKind }  — a finished Meshy task (GLB fetched server-side)
 *   { sourceUrl }         — an allowlisted public sample GLB (free pipeline
 *                           checks without spending generation credits)
 *
 * Costs blob storage, not provider credits — guarded by the same origin
 * allowlist as the paid endpoints plus a size cap.
 */

import { put } from '@vercel/blob';

import { allowedGenerationOrigins } from '../_generationSecurity';
import { fetchMeshyTask, parseMeshyTaskKind } from '../_meshy';
import { MAX_PROVIDER_MODEL_BYTES } from '../_modelStream';

const SAMPLE_URL_HOSTS = new Set(['raw.githubusercontent.com']);
const TASK_ID_PATTERN = /^[a-zA-Z0-9-_]{8,64}$/;

function headerValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return typeof value === 'string' ? value : '';
}

function slugify(value: unknown): string {
  const base = typeof value === 'string' ? value : 'model';
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'model';
}

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }

  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      res.status(503).json({ error: 'Library storage is not configured (BLOB_READ_WRITE_TOKEN)' });
      return;
    }
    const origin = headerValue(req.headers?.origin).trim();
    if (origin && !allowedGenerationOrigins().has(origin)) {
      res.status(403).json({ error: 'This origin is not allowed to publish' });
      return;
    }
    if (process.env.NODE_ENV === 'production' && !origin) {
      res.status(403).json({ error: 'A verified PixBrik browser origin is required' });
      return;
    }

    // Resolve the source GLB URL.
    let sourceUrl: string;
    const rawSource: unknown = req.body?.sourceUrl;
    if (typeof rawSource === 'string' && rawSource) {
      let parsed: URL;
      try {
        parsed = new URL(rawSource);
      } catch {
        res.status(400).json({ error: 'sourceUrl is not a valid URL' });
        return;
      }
      if (parsed.protocol !== 'https:' || !SAMPLE_URL_HOSTS.has(parsed.hostname)) {
        res.status(400).json({ error: 'sourceUrl host is not allowlisted' });
        return;
      }
      sourceUrl = parsed.toString();
    } else {
      const taskId: unknown = req.body?.taskId;
      const taskKind = parseMeshyTaskKind(req.body?.taskKind);
      if (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId) || !taskKind) {
        res.status(400).json({ error: 'Body must be { taskId, taskKind } or { sourceUrl }' });
        return;
      }
      const { task } = await fetchMeshyTask(taskId, taskKind);
      if (task?.status !== 'SUCCEEDED' || !task.model_urls?.glb) {
        res.status(409).json({ error: 'task has no finished model', status: task?.status });
        return;
      }
      sourceUrl = task.model_urls.glb;
    }

    const download = await fetch(sourceUrl);
    if (!download.ok || !download.body) {
      res.status(502).json({ error: `model download failed (${download.status})` });
      return;
    }
    const declared = Number(download.headers.get('content-length') ?? '0');
    if (declared > MAX_PROVIDER_MODEL_BYTES) {
      res.status(502).json({ error: 'model is outside the supported size' });
      return;
    }

    const buffer = Buffer.from(await download.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_PROVIDER_MODEL_BYTES) {
      res.status(502).json({ error: 'model is outside the supported size' });
      return;
    }
    // GLB magic: 'glTF'.
    if (buffer.length < 4 || buffer.toString('latin1', 0, 4) !== 'glTF') {
      res.status(502).json({ error: 'downloaded file is not a GLB model' });
      return;
    }

    const blob = await put(
      `library/v1/${slugify(req.body?.name)}-${Date.now().toString(36)}.glb`,
      buffer,
      {
        access: 'public',
        addRandomSuffix: true,
        contentType: 'model/gltf-binary',
      },
    );

    res.status(200).json({ meshUrl: blob.url, bytes: buffer.byteLength });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'publish failed' });
  }
}
