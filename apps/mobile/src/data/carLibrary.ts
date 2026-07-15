/**
 * Object library seed. Users pick a model + colour and the mesh voxelizer
 * generates the brick build — no photo upload needed.
 *
 * IMPORTANT: names are deliberately GENERIC and not affiliated with any
 * manufacturer. Production entries need their own licensed 3D meshes; the
 * seed points a few at a demo mesh so the flow is fully working, and leaves
 * the rest as "model coming soon" placeholders.
 */

export type LibraryCategory = 'car' | 'animal' | 'plant' | 'object';
export type LibraryEra = 'classic' | 'modern';

export interface LibraryEntry {
  id: string;
  name: string;
  category: LibraryCategory;
  era?: LibraryEra;
  tags: string[];
  /** GLB mesh to voxelize. null = placeholder, generation disabled. */
  meshUrl: string | null;
  defaultColor: string;
  /** True for built-in seed entries (protected from admin delete). */
  seed?: boolean;
}

/** Demo mesh used for generatable seed cars (Khronos ToyCar, CC0). */
const DEMO_CAR = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ToyCar/glTF-Binary/ToyCar.glb';

export const LIBRARY_SEED: LibraryEntry[] = [
  // Classic cars
  { id: 'beetle-compact', name: 'Classic Beetle Compact', category: 'car', era: 'classic', tags: ['round', 'iconic'], meshUrl: DEMO_CAR, defaultColor: '#3E7C4F', seed: true },
  { id: 'muscle-coupe', name: '60s Muscle Coupe', category: 'car', era: 'classic', tags: ['powerful'], meshUrl: DEMO_CAR, defaultColor: '#B4202A', seed: true },
  { id: 'vintage-roadster', name: 'Vintage Roadster', category: 'car', era: 'classic', tags: ['open-top'], meshUrl: DEMO_CAR, defaultColor: '#20558A', seed: true },
  { id: 'retro-microbus', name: 'Retro Microbus', category: 'car', era: 'classic', tags: ['van'], meshUrl: null, defaultColor: '#E08A2B', seed: true },
  { id: 'classic-pickup', name: 'Classic Pickup', category: 'car', era: 'classic', tags: ['utility'], meshUrl: null, defaultColor: '#6C6E68', seed: true },
  { id: 'grand-tourer', name: 'Vintage Grand Tourer', category: 'car', era: 'classic', tags: ['elegant'], meshUrl: null, defaultColor: '#1B1B1B', seed: true },
  // Modern cars
  { id: 'city-ev', name: 'Electric City Car', category: 'car', era: 'modern', tags: ['compact', 'ev'], meshUrl: DEMO_CAR, defaultColor: '#8DC63F', seed: true },
  { id: 'modern-hatch', name: 'Modern Hatchback', category: 'car', era: 'modern', tags: ['everyday'], meshUrl: null, defaultColor: '#2C6FB0', seed: true },
  { id: 'modern-suv', name: 'Modern SUV', category: 'car', era: 'modern', tags: ['family'], meshUrl: null, defaultColor: '#2A2A2A', seed: true },
  { id: 'sports-coupe', name: 'Sports Coupe', category: 'car', era: 'modern', tags: ['fast'], meshUrl: null, defaultColor: '#E4B000', seed: true },
  { id: 'modern-sedan', name: 'Modern Sedan', category: 'car', era: 'modern', tags: ['comfort'], meshUrl: null, defaultColor: '#C4C8CC', seed: true },
  { id: 'offroad-4x4', name: 'Off-road 4x4', category: 'car', era: 'modern', tags: ['rugged'], meshUrl: null, defaultColor: '#5B7500', seed: true },
  { id: 'supercar', name: 'Supercar', category: 'car', era: 'modern', tags: ['exotic'], meshUrl: null, defaultColor: '#C2371E', seed: true },
  // A couple of non-car entries to show the library isn't cars-only.
  { id: 'toy-duck', name: 'Rubber Duck', category: 'animal', tags: ['toy'], meshUrl: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb', defaultColor: '#F2C200', seed: true },
];

/** Preset colours offered when building a library model. */
export const LIBRARY_COLORS = [
  '#B4202A',
  '#20558A',
  '#3E7C4F',
  '#E4B000',
  '#1B1B1B',
  '#C4C8CC',
  '#E08A2B',
  '#7A3FA0',
];
