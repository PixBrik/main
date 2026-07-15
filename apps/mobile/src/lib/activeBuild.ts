/**
 * Shared resolution of "which model is the user actually building" —
 * the photo-derived model when one is locked, else the built-in demo fox,
 * at the resolution of the selected build profile.
 */

import { colors } from '../theme/tokens';
import type { PhotoModels } from './photoEngine/voxelizePhoto';
import { getVoxelModel, type BuildProfile, type VoxelModel } from './voxelFox';

const PROFILE_BY_VARIANT: Record<string, BuildProfile> = {
  balanced: 'balanced',
  detail: 'detailed',
  easy: 'efficient',
};

const ACCENT_BY_VARIANT: Record<string, string> = {
  balanced: colors.blue,
  detail: colors.coral,
  easy: colors.mintDeep,
};

export function profileForVariant(variantId: string): BuildProfile {
  return PROFILE_BY_VARIANT[variantId] ?? 'balanced';
}

export function accentForVariant(variantId: string): string {
  return ACCENT_BY_VARIANT[variantId] ?? colors.blue;
}

export function resolveActiveModel(photoBuild: PhotoModels | null | undefined, variantId: string): VoxelModel {
  const profile = profileForVariant(variantId);
  return photoBuild ? photoBuild.models[profile] : getVoxelModel(profile);
}
