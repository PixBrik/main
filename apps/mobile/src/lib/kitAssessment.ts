/**
 * Exact sellability assessment for the two physical fill options.
 *
 * A price is not an offer: the frozen catalog packing must also produce an
 * assembly plan with no floating, overlapping, or invalid placement. Keep
 * this boundary shared by Result, Purchase, and Checkout so a later screen
 * cannot re-enable an option rejected earlier in the journey.
 */

import {
  computeBuildAssessment,
  type BuildAssessment,
} from './kitAssessmentCore';
import type { VoxelModel } from './voxelFox';

export type { AssessedBuildSide, BuildAssessment } from './kitAssessmentCore';

interface AssessmentWorkerResponse {
  assessment?: BuildAssessment;
  error?: string;
  id: number;
}

interface PendingWorkerRequest {
  reject: (reason: Error) => void;
  resolve: (assessment: BuildAssessment) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const assessmentCache = new WeakMap<VoxelModel, Map<string, BuildAssessment>>();
const pendingAssessmentCache = new WeakMap<VoxelModel, Map<string, Promise<BuildAssessment>>>();
const workerRequests = new Map<number, PendingWorkerRequest>();
let assessmentWorker: Worker | null = null;
let nextWorkerRequestId = 1;
const ASSESSMENT_WORKER_TIMEOUT_MS = 30_000;

function cachedAssessment(model: VoxelModel, accent: string): BuildAssessment | null {
  return assessmentCache.get(model)?.get(accent) ?? null;
}

function cacheAssessment(model: VoxelModel, accent: string, assessment: BuildAssessment) {
  const byAccent = assessmentCache.get(model) ?? new Map<string, BuildAssessment>();
  byAccent.set(accent, assessment);
  assessmentCache.set(model, byAccent);
  return assessment;
}

function rejectWorkerRequests(reason: string) {
  const error = new Error(reason);
  for (const request of workerRequests.values()) {
    clearTimeout(request.timeout);
    request.reject(error);
  }
  workerRequests.clear();
}

function stopAssessmentWorker(reason: string) {
  rejectWorkerRequests(reason);
  assessmentWorker?.terminate();
  assessmentWorker = null;
}

function getAssessmentWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (assessmentWorker) return assessmentWorker;

  try {
    // Expo Metro turns this standard URL form into a separately bundled web
    // worker. Heavy catalog packing therefore never occupies the browser UI
    // thread, while native keeps the deferred fallback below.
    const worker = new Worker(new URL('./kitAssessment.worker.ts', import.meta.url));
    worker.onmessage = (event: MessageEvent<AssessmentWorkerResponse>) => {
      const response = event.data;
      const request = workerRequests.get(response.id);
      if (!request) return;
      workerRequests.delete(response.id);
      clearTimeout(request.timeout);
      if (response.assessment) request.resolve(response.assessment);
      else request.reject(new Error(response.error ?? 'The catalog kit could not be assessed.'));
    };
    worker.onerror = () => {
      stopAssessmentWorker('The catalog assessment worker stopped unexpectedly. Reload to retry the exact kit check.');
    };
    assessmentWorker = worker;
    return worker;
  } catch {
    return null;
  }
}

function assessInWorker(model: VoxelModel, accent: string): Promise<BuildAssessment> | null {
  const worker = getAssessmentWorker();
  if (!worker) return null;
  const id = nextWorkerRequestId++;
  return new Promise<BuildAssessment>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!workerRequests.has(id)) return;
      stopAssessmentWorker('Exact catalog validation took too long. Reload to retry, or choose another finished size.');
    }, ASSESSMENT_WORKER_TIMEOUT_MS);
    workerRequests.set(id, { reject, resolve, timeout });
    try {
      worker.postMessage({ accent, id, model });
    } catch (error) {
      workerRequests.delete(id);
      clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error('The model could not be sent for assessment.'));
    }
  });
}

function assessAfterPaint(model: VoxelModel, accent: string): Promise<BuildAssessment> {
  return new Promise((resolve, reject) => {
    // Worker is web-only. On native (and old browsers with Worker disabled),
    // defer until after the initial frame. The UI remains fail-closed while
    // the exact synchronous release gate runs.
    setTimeout(() => {
      try {
        resolve(computeBuildAssessment(model, accent));
      } catch (error) {
        reject(error);
      }
    }, 0);
  });
}

/** Quote and validate full and reinforced-hollow kits from the same model. */
export function assessBuild(model: VoxelModel, accent: string): BuildAssessment {
  const cached = cachedAssessment(model, accent);
  if (cached) return cached;
  return cacheAssessment(model, accent, computeBuildAssessment(model, accent));
}

/**
 * Non-blocking browser assessment used by proposal screens.
 *
 * Concurrent requests for the same model/accent share one exact computation,
 * and the result populates the synchronous cache used by Purchase/Checkout.
 */
export function assessBuildAsync(model: VoxelModel, accent: string): Promise<BuildAssessment> {
  const cached = cachedAssessment(model, accent);
  if (cached) return Promise.resolve(cached);

  const existing = pendingAssessmentCache.get(model)?.get(accent);
  if (existing) return existing;

  // The worker only exists to keep the UI thread smooth; the exact same pure
  // module runs inline. A worker failure (stale chunk 404 after a deploy, an
  // extension blocking workers, a crash) must never fail the buyer's build —
  // fall back to the in-thread computation instead.
  const viaWorker = assessInWorker(model, accent);
  const pending = (viaWorker ? viaWorker.catch(() => assessAfterPaint(model, accent)) : assessAfterPaint(model, accent))
    .then((assessment) => cacheAssessment(model, accent, assessment))
    .finally(() => {
      const byAccent = pendingAssessmentCache.get(model);
      byAccent?.delete(accent);
      if (byAccent?.size === 0) pendingAssessmentCache.delete(model);
    });
  const byAccent = pendingAssessmentCache.get(model) ?? new Map<string, Promise<BuildAssessment>>();
  byAccent.set(accent, pending);
  pendingAssessmentCache.set(model, byAccent);
  return pending;
}
