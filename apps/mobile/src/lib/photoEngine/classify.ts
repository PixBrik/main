/**
 * Object-category classification on top of the detector labels: drives the
 * default build mode/style per category and gives the UI honest, human
 * language ("ANIMAL", "VEHICLE", …) instead of raw model classes.
 */

import type { PanelStyle, PhotoBuildMode } from './voxelizePhoto';

export type ObjectCategory =
  | 'portrait'
  | 'person'
  | 'animal'
  | 'vehicle'
  | 'building'
  | 'tool'
  | 'art'
  | 'food'
  | 'plant'
  | 'object';

export interface CategoryInfo {
  category: ObjectCategory;
  displayName: string;
  mode: PhotoBuildMode;
  style: PanelStyle;
  /** Preserve facial features (eyes, nose, mouth, ears). */
  faces: boolean;
}

const ANIMALS = new Set(['bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'teddy bear']);
const VEHICLES = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'boat', 'airplane', 'train']);
const TOOLS = new Set(['scissors', 'knife', 'spoon', 'fork', 'hair drier', 'toothbrush', 'remote', 'keyboard', 'mouse', 'laptop', 'cell phone', 'tv', 'clock', 'umbrella', 'suitcase', 'backpack', 'handbag']);
const ART = new Set(['vase', 'kite', 'sports ball', 'frisbee']);
const FOOD = new Set(['banana', 'apple', 'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'wine glass', 'cup', 'bowl', 'bottle']);
const PLANTS = new Set(['potted plant']);
const FURNITURE = new Set(['chair', 'couch', 'bed', 'dining table', 'toilet', 'bench', 'sink', 'refrigerator', 'oven', 'microwave', 'toaster', 'book']);

/** Canonical CategoryInfo for a known category key. */
export function infoForCategory(category: ObjectCategory, boxShare = 0): CategoryInfo {
  switch (category) {
    case 'portrait':
    case 'person': {
      const portrait = category === 'portrait' || boxShare > 0.4;
      return {
        category: portrait ? 'portrait' : 'person',
        displayName: portrait ? 'PORTRAIT' : 'PERSON',
        faces: true,
        mode: 'relief',
        style: 'classic',
      };
    }
    case 'animal':
      return { category, displayName: 'ANIMAL', faces: true, mode: 'volume', style: 'natural' };
    case 'vehicle':
      return { category, displayName: 'VEHICLE', faces: false, mode: 'volume', style: 'natural' };
    case 'building':
      return { category, displayName: 'BUILDING', faces: false, mode: 'volume', style: 'natural' };
    case 'tool':
      return { category, displayName: 'TOOL', faces: false, mode: 'volume', style: 'natural' };
    case 'art':
      return { category, displayName: 'ART', faces: false, mode: 'relief', style: 'natural' };
    case 'food':
      return { category, displayName: 'FOOD', faces: false, mode: 'volume', style: 'natural' };
    case 'plant':
      return { category, displayName: 'PLANT', faces: false, mode: 'volume', style: 'natural' };
    default:
      return { category: 'object', displayName: 'OBJECT', faces: false, mode: 'volume', style: 'natural' };
  }
}

/**
 * @param label detector class (or 'object' for whole-photo builds)
 * @param boxShare fraction of the photo the selection covers (0..1)
 */
export function categorize(label: string, boxShare = 0): CategoryInfo {
  const normalized = label.toLowerCase().trim();

  if (normalized === 'person') return infoForCategory('person', boxShare);
  if (ANIMALS.has(normalized)) return infoForCategory('animal');
  if (VEHICLES.has(normalized)) return infoForCategory('vehicle');
  if (TOOLS.has(normalized)) return infoForCategory('tool');
  if (ART.has(normalized)) return infoForCategory('art');
  if (FOOD.has(normalized)) return infoForCategory('food');
  if (PLANTS.has(normalized)) return infoForCategory('plant');
  if (FURNITURE.has(normalized)) return infoForCategory('object');
  // Whole-photo fallback: wide scenes read as buildings/scenery.
  if (normalized === 'object' && boxShare > 0.85) return infoForCategory('building');
  return infoForCategory('object');
}
