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

/**
 * Poly Haven photoreal scans (all CC0), packed to self-contained GLBs by
 * tools/library/pack-polyhaven.mjs and committed under
 * assets/library-masters/v1 (served via raw.githubusercontent.com, which is
 * on the publish allowlist). Sizes are the packed 1k-texture GLBs.
 */
const MASTERS = 'https://raw.githubusercontent.com/PixBrik/main/main/assets/library-masters/v1';

export const POLYHAVEN_MODEL_CATALOG: readonly FreeModelEntry[] = [
  { category: 'flower', description: 'Gazania flower in bloom — photoreal field scan', id: 'ph-flower-gazania', license: 'CC0', name: 'Gazania Flower', sizeKb: 2765, sourceUrl: `${MASTERS}/flower_gazania.glb` },
  { category: 'flower', description: 'Dandelion with seed head — delicate nature study', id: 'ph-dandelion', license: 'CC0', name: 'Dandelion', sizeKb: 3072, sourceUrl: `${MASTERS}/dandelion_01.glb` },
  { category: 'plant', description: 'Lush potted houseplant — photoreal scan', id: 'ph-potted-plant-1', license: 'CC0', name: 'Potted Plant', sizeKb: 6144, sourceUrl: `${MASTERS}/potted_plant_01.glb` },
  { category: 'plant', description: 'Small potted succulent-style plant', id: 'ph-potted-plant-4', license: 'CC0', name: 'Small Potted Plant', sizeKb: 2048, sourceUrl: `${MASTERS}/potted_plant_04.glb` },
  { category: 'object', description: 'Antique ceramic vase — future bouquet holder', id: 'ph-ceramic-vase', license: 'CC0', name: 'Antique Ceramic Vase', sizeKb: 512, sourceUrl: `${MASTERS}/antique_ceramic_vase_01.glb` },
  { category: 'object', description: 'Ornate brass vase — future bouquet holder', id: 'ph-brass-vase', license: 'CC0', name: 'Brass Vase', sizeKb: 819, sourceUrl: `${MASTERS}/brass_vase_01.glb` },
  { category: 'gift', description: 'Strawberry chocolate cake — celebration centrepiece', id: 'ph-strawberry-cake', license: 'CC0', name: 'Strawberry Chocolate Cake', sizeKb: 3277, sourceUrl: `${MASTERS}/strawberry_chocolate_cake.glb` },
  { category: 'gift', description: 'Frosted carrot cake — bakery scan', id: 'ph-carrot-cake', license: 'CC0', name: 'Carrot Cake', sizeKb: 3277, sourceUrl: `${MASTERS}/carrot_cake.glb` },
  { category: 'gift', description: 'Golden croissant — breakfast-lover gift', id: 'ph-croissant', license: 'CC0', name: 'Croissant', sizeKb: 2048, sourceUrl: `${MASTERS}/croissant.glb` },
  { category: 'object', description: 'Bunch of bananas — playful kitchen decor', id: 'ph-bananas', license: 'CC0', name: 'Bananas', sizeKb: 2458, sourceUrl: `${MASTERS}/bananas.glb` },
  { category: 'object', description: 'Fresh lemon — bright kitchen accent', id: 'ph-lemon', license: 'CC0', name: 'Lemon', sizeKb: 1843, sourceUrl: `${MASTERS}/lemon.glb` },
  { category: 'object', description: 'Ukulele — music-lover display piece', id: 'ph-ukulele', license: 'CC0', name: 'Ukulele', sizeKb: 819, sourceUrl: `${MASTERS}/Ukulele_01.glb` },
  { category: 'object', description: 'Vintage binoculars — explorer desk piece', id: 'ph-binoculars', license: 'CC0', name: 'Vintage Binoculars', sizeKb: 2662, sourceUrl: `${MASTERS}/vintage_binocular.glb` },
  { category: 'object', description: 'Vintage microscope — science desk piece', id: 'ph-microscope', license: 'CC0', name: 'Vintage Microscope', sizeKb: 2765, sourceUrl: `${MASTERS}/vintage_microscope.glb` },
  { category: 'object', description: 'Complete tea set — teapot with cups', id: 'ph-tea-set', license: 'CC0', name: 'Tea Set', sizeKb: 2252, sourceUrl: `${MASTERS}/tea_set_01.glb` },
  { category: 'object', description: 'Dutch tall ship — grand showpiece build', id: 'ph-tall-ship', license: 'CC0', name: 'Tall Ship', sizeKb: 8499, sourceUrl: `${MASTERS}/dutch_ship_medium.glb` },
] as const;

export const ALL_FREE_MODELS: readonly FreeModelEntry[] = [
  ...FREE_MODEL_CATALOG,
  ...POLYHAVEN_MODEL_CATALOG,
];

export const FREE_CATALOG_CATEGORIES: readonly LibraryCategory[] = [
  ...new Set(ALL_FREE_MODELS.map((entry) => entry.category)),
];
