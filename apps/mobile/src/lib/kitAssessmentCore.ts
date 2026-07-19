/**
 * Pure, deterministic build assessment shared by the UI thread and the web
 * worker. Keep browser/runtime orchestration out of this module so Metro can
 * bundle the exact same release gate into a worker without recursively
 * creating another worker.
 */

import {
  brickify,
  bundleQuote,
  type BillOfMaterials,
  type BuildEstimateSide,
} from './brickify';
import { createAssemblyPlan } from './instructions/assemblyPlan';
import type { VoxelModel } from './voxelFox';

export interface AssessedBuildSide extends BuildEstimateSide {
  /** True only when this exact frozen packing can become a safe guide. */
  buildable: boolean;
  /** Child-readable reason for withholding an unsafe option. */
  assemblyIssue: string | null;
}

export interface BuildAssessment {
  full: AssessedBuildSide;
  hollow: AssessedBuildSide;
  /** Fraction of parts saved by going hollow (0..1). */
  hollowSaving: number;
}

function assessSide(bom: BillOfMaterials): AssessedBuildSide {
  const quote = bundleQuote(bom);
  const plan = createAssemblyPlan(bom);
  const hardError = plan.warnings.find((warning) => warning.severity === 'error');
  const buildable = plan.supportSummary.unsupported === 0 && !hardError;
  return {
    assemblyIssue: buildable
      ? null
      : hardError?.message ?? 'One or more pieces cannot lock onto the assembled model.',
    buildable,
    bundleEur: quote.totalEur,
    colorCount: bom.colorCount,
    isEstimate: bom.isEstimate,
    parts: bom.totalParts,
    retailEur: bom.totalEur,
  };
}

/** Perform the exact full + reinforced-hollow release gate without caching. */
export function computeBuildAssessment(model: VoxelModel, accent: string): BuildAssessment {
  const full = assessSide(brickify(model, accent));
  const hollow = assessSide(brickify(model, accent, { hollow: true }));
  return {
    full,
    hollow,
    hollowSaving: full.parts > 0 ? Number((1 - hollow.parts / full.parts).toFixed(3)) : 0,
  };
}
