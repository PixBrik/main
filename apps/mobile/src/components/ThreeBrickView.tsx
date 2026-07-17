import type { BillOfMaterials } from '../lib/brickify';
import type { VoxelModel } from '../lib/voxelFox';

/**
 * Native placeholder: the ultra-realistic WebGL stage is web-first
 * (see ThreeBrickView.web.tsx). Native builds keep the SVG viewer.
 */

interface ThreeBrickViewProps {
  model: VoxelModel;
  accent: string;
  label?: string;
  hollow?: boolean;
  packedParts?: number;
  packedPlan?: BillOfMaterials;
}

export function ThreeBrickView(_props: ThreeBrickViewProps) {
  return null;
}

export const isRealisticViewSupported = false;
