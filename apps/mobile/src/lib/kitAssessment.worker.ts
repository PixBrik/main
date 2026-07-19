import { computeBuildAssessment } from './kitAssessmentCore';
import type { BuildAssessment } from './kitAssessmentCore';
import type { VoxelModel } from './voxelFox';

interface AssessmentRequest {
  accent: string;
  id: number;
  model: VoxelModel;
}

interface AssessmentResponse {
  assessment?: BuildAssessment;
  error?: string;
  id: number;
}

type AssessmentWorkerScope = typeof globalThis & {
  onmessage: ((event: MessageEvent<AssessmentRequest>) => void) | null;
  postMessage: (message: AssessmentResponse) => void;
};

const workerScope = globalThis as AssessmentWorkerScope;

workerScope.onmessage = (event) => {
  const { accent, id, model } = event.data;
  try {
    workerScope.postMessage({
      assessment: computeBuildAssessment(model, accent),
      id,
    });
  } catch (error) {
    workerScope.postMessage({
      error: error instanceof Error ? error.message : 'The catalog kit could not be assessed.',
      id,
    });
  }
};
