import type { VoxelModel } from '../lib/voxelFox';

/**
 * Native placeholder: the ultra-realistic WebGL stage is web-first
 * (see ThreeBrickView.web.tsx). Native builds keep the SVG viewer.
 */

interface ThreeBrickViewProps {
  model: VoxelModel;
  accent: string;
  label?: string;
  packedParts?: number;
}

export function ThreeBrickView(_props: ThreeBrickViewProps) {
  return null;
}

export const isRealisticViewSupported = false;
