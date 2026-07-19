import type { LibraryCategory } from './carLibrary';

/**
 * Curated FREE 3D masters for the Library Studio import lane.
 *
 * Inclusion policy (owner-approved constraints):
 * - CC0 / public-domain ONLY — commercial use with zero attribution burden.
 *   CC-BY and marked assets are deliberately excluded, as is anything that
 *   embeds a third-party logo or trade dress (e.g. Khronos' AntiqueCamera
 *   carries a UX3D mark).
 * - Self-contained binary GLB on an allowlisted host (the publish endpoint's
 *   SAMPLE_URL_HOSTS), verified reachable at curation time.
 *
 * Every entry was verified on 19 Jul 2026: HTTP 200, GLB present, license
 * read from the model's metadata.json in KhronosGroup/glTF-Sample-Assets.
 * Photoreal free ANIMALS and CARS are genuinely scarce under CC0 — those
 * categories are best filled with Meshy-6 generations in the studio.
 */

export interface FreeModelEntry {
  id: string;
  name: string;
  category: LibraryCategory;
  /** What the buyer would be buying — shown in the studio list. */
  description: string;
  license: 'CC0';
  sizeKb: number;
  sourceUrl: string;
}

const KHRONOS = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models';

export const FREE_MODEL_CATALOG: readonly FreeModelEntry[] = [
  {
    category: 'flower',
    description: 'Glass vase with a full flower arrangement — photoreal showcase scan',
    id: 'free-glass-vase-flowers',
    license: 'CC0',
    name: 'Vase of Flowers',
    sizeKb: 1777,
    sourceUrl: `${KHRONOS}/GlassVaseFlowers/glTF-Binary/GlassVaseFlowers.glb`,
  },
  {
    category: 'car',
    description: 'Highly detailed toy sports car — unbranded, catalogue-safe',
    id: 'free-toy-car',
    license: 'CC0',
    name: 'Toy Sports Car',
    sizeKb: 5295,
    sourceUrl: `${KHRONOS}/ToyCar/glTF-Binary/ToyCar.glb`,
  },
  {
    category: 'object',
    description: 'Retro boombox stereo — strong silhouette, iconic gift shape',
    id: 'free-boombox',
    license: 'CC0',
    name: 'Retro Boombox',
    sizeKb: 10365,
    sourceUrl: `${KHRONOS}/BoomBox/glTF-Binary/BoomBox.glb`,
  },
  {
    category: 'object',
    description: 'Classic hanging lantern — reads beautifully in bricks',
    id: 'free-lantern',
    license: 'CC0',
    name: 'Lantern',
    sizeKb: 9340,
    sourceUrl: `${KHRONOS}/Lantern/glTF-Binary/Lantern.glb`,
  },
  {
    category: 'object',
    description: 'Porcelain teacup — delicate homeware piece',
    id: 'free-teacup',
    license: 'CC0',
    name: 'Teacup',
    sizeKb: 4682,
    sourceUrl: `${KHRONOS}/DiffuseTransmissionTeacup/glTF-Binary/DiffuseTransmissionTeacup.glb`,
  },
  {
    category: 'object',
    description: 'Photoreal avocado half — playful kitchen decor subject',
    id: 'free-avocado',
    license: 'CC0',
    name: 'Avocado',
    sizeKb: 7919,
    sourceUrl: `${KHRONOS}/Avocado/glTF-Binary/Avocado.glb`,
  },
  {
    category: 'object',
    description: 'Barramundi fish dish — sculptural food scan',
    id: 'free-barramundi',
    license: 'CC0',
    name: 'Barramundi Fish',
    sizeKb: 12195,
    sourceUrl: `${KHRONOS}/BarramundiFish/glTF-Binary/BarramundiFish.glb`,
  },
  {
    category: 'object',
    description: 'Upholstered designer chair — furniture miniature',
    id: 'free-sheen-chair',
    license: 'CC0',
    name: 'Designer Chair',
    sizeKb: 4028,
    sourceUrl: `${KHRONOS}/SheenChair/glTF-Binary/SheenChair.glb`,
  },
  {
    category: 'object',
    description: 'Insulated water bottle — modern everyday object',
    id: 'free-water-bottle',
    license: 'CC0',
    name: 'Water Bottle',
    sizeKb: 8756,
    sourceUrl: `${KHRONOS}/WaterBottle/glTF-Binary/WaterBottle.glb`,
  },
  {
    category: 'object',
    description: 'Vintage corset — fashion display piece',
    id: 'free-corset',
    license: 'CC0',
    name: 'Vintage Corset',
    sizeKb: 13175,
    sourceUrl: `${KHRONOS}/Corset/glTF-Binary/Corset.glb`,
  },
] as const;

export const FREE_CATALOG_CATEGORIES: readonly LibraryCategory[] = [
  ...new Set(FREE_MODEL_CATALOG.map((entry) => entry.category)),
];
