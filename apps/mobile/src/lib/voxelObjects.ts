/**
 * Extra procedural demo objects for the home hero: the rotation cycles
 * through them so it is obvious Fotobrik is not a one-object trick —
 * an animal, a car, a house, and a portrait bust all voxelize the same way.
 */

import { voxelize, type VoxelModel, type VoxelZone } from './voxelFox';
import type { Projection } from './voxelRender';

function insideEllipsoid(
  x: number,
  y: number,
  z: number,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  const dz = (z - cz) / rz;
  return dx * dx + dy * dy + dz * dz <= 1;
}

export interface HeroObject {
  id: string;
  label: string;
  /** Honest provenance tag shown with the model. */
  tag: 'FROM A PHOTO' | 'DEMO MODEL';
  /** Accent colour applied to this object's accent-zone voxels. */
  accent: string;
  projection: Projection;
  model: VoxelModel;
}

/** Body-top profile of the sports car — every diagonal runs at 45° so the
 * slope pass converts windshield, rear glass, nose and tail into real ramps. */
function carTop(x: number): number {
  if (x > 2.3) return Math.max(0.7, 1.05 - (x - 2.3)); // nose ramp
  if (x > 0.6) return 1.05; // hood
  if (x > 0.0) return 1.05 + (0.6 - x); // windshield ramp → 1.65
  if (x > -0.9) return 1.65; // roof
  if (x > -1.4) return 1.65 + (x + 0.9); // rear glass ramp → 1.15
  if (x > -2.3) return 1.15; // trunk
  return Math.max(0.8, 1.15 + (x + 2.3)); // tail ramp
}

function classifyCar(x: number, y: number, z: number): VoxelZone | null {
  // Wheels: dark tyres with light hubs, sunk into arches.
  for (const wx of [-1.55, 1.55]) {
    const dx = x - wx;
    const dy = y - 0.5;
    const radial = dx * dx + dy * dy;
    if (Math.abs(z) >= 0.58 && Math.abs(z) <= 1.02 && y >= 0) {
      if (radial <= 0.24 * 0.24) return 'cream'; // hub
      if (radial <= 0.52 * 0.52) return 'dark'; // tyre
    }
    // Wheel arch: carve the body away around the tyre.
    if (radial <= 0.62 * 0.62 && Math.abs(z) >= 0.55) return null;
  }

  if (x < -2.6 || x > 2.6 || y < 0.3 || Math.abs(z) > 1.02) return null;
  const top = carTop(x);
  if (y > top) return null;

  // Cabin sits narrower than the fenders.
  const cabin = y > 1.18;
  if (cabin && Math.abs(z) > 0.8) return null;

  // Glass: windshield / rear-glass ramps and the side-window band.
  if (cabin) {
    const onWindshield = x > 0.0 && x <= 0.68;
    const onRearGlass = x <= -0.82 && x > -1.45;
    const sideWindow = x <= 0.05 && x > -0.88 && Math.abs(z) > 0.55 && y < 1.62;
    if (onWindshield || onRearGlass || sideWindow) return 'mint';
  }

  // Racing stripe along the centreline of every top surface.
  if (Math.abs(z) < 0.2 && y > top - 0.34) return 'accent';

  // Headlights and dark grille on the nose.
  if (x > 2.42 && y > 0.62 && y < 0.95) {
    if (Math.abs(z) > 0.42 && Math.abs(z) < 0.82) return 'mint';
    if (Math.abs(z) <= 0.42) return 'dark';
  }
  // Tail lights.
  if (x < -2.42 && y > 0.72 && y < 1.0 && Math.abs(z) > 0.38 && Math.abs(z) < 0.85) {
    return 'accent';
  }
  // Dark rocker panel under the doors.
  if (y < 0.5) return 'dark';

  return 'body';
}

/** Standing person: skin head, hair, accent shirt+sleeves, dark trousers/shoes. */
function classifyHuman(x: number, y: number, z: number): VoxelZone | null {
  // Head with hair cap and mint eyes.
  if (insideEllipsoid(x, y, z, 0, 5.25, 0, 0.6, 0.72, 0.6)) {
    for (const side of [-1, 1]) {
      const dx = x - side * 0.24;
      const dy = y - 5.35;
      const dz = z - 0.5;
      if (dx * dx + dy * dy + dz * dz <= 0.02) return 'mint';
    }
    if (y > 5.55 || z < -0.28) return 'dark'; // hair
    return 'cream';
  }
  // Neck.
  if (Math.abs(x) <= 0.22 && Math.abs(z) <= 0.22 && y >= 4.55 && y <= 4.9) return 'cream';
  // Torso — shirt takes the accent.
  if (insideEllipsoid(x, y, z, 0, 3.5, 0, 0.9, 1.15, 0.55)) return 'accent';
  // Arms: accent sleeves, cream hands.
  for (const side of [-1, 1]) {
    if (insideEllipsoid(x, y, z, side * 1.02, 3.5, 0, 0.3, 1.05, 0.3)) {
      return y < 2.9 ? 'cream' : 'accent';
    }
  }
  // Legs: dark trousers, dark shoes — spaced so the gap survives voxelization.
  for (const side of [-1, 1]) {
    if (Math.abs(x - side * 0.48) <= 0.28 && Math.abs(z) <= 0.36 && y >= 0 && y <= 2.55) {
      return 'dark'; // shoe + trousers
    }
  }
  return null;
}

/** Daisy: green stem + leaves, white petals radiating around a dark centre. */
function classifyFlower(x: number, y: number, z: number): VoxelZone | null {
  const bloomY = 3.4;
  // Petals: ring of ellipsoids around the centre.
  for (let p = 0; p < 8; p++) {
    const angle = (p / 8) * Math.PI * 2;
    const px = Math.cos(angle) * 0.95;
    const pz = Math.sin(angle) * 0.95;
    if (insideEllipsoid(x, y, z, px, bloomY, pz, 0.5, 0.28, 0.5)) return 'cream';
  }
  // Flower centre.
  if (insideEllipsoid(x, y, z, 0, bloomY, 0, 0.5, 0.4, 0.5)) return 'dark';
  // Stem.
  if (Math.abs(x) <= 0.16 && Math.abs(z) <= 0.16 && y >= 0 && y < bloomY - 0.3) return 'accent';
  // Two leaves.
  for (const side of [-1, 1]) {
    if (insideEllipsoid(x, y, z, side * 0.55, 1.6, 0, 0.55, 0.22, 0.3)) return 'accent';
  }
  return null;
}

/** Sitting cat: orange fur, cream chest, triangular ears, curled tail, mint eyes. */
function classifyCat(x: number, y: number, z: number): VoxelZone | null {
  // Ears: tapering triangular prisms on the head.
  if (y >= 3.5 && y <= 4.2) {
    const t = (y - 3.5) / 0.7;
    const half = 0.34 * (1 - t) + 0.06;
    for (const side of [-1, 1]) {
      if (Math.abs(x - side * 0.42) <= half && Math.abs(z - 0.2) <= half + 0.1) {
        return t > 0.55 ? 'dark' : 'body';
      }
    }
  }
  // Head with mint eyes and a dark nose.
  if (insideEllipsoid(x, y, z, 0, 3.05, 0.25, 0.72, 0.68, 0.7)) {
    for (const side of [-1, 1]) {
      const dx = x - side * 0.3;
      const dy = y - 3.15;
      const dz = z - 0.85;
      if (dx * dx + dy * dy + dz * dz <= 0.02) return 'mint';
    }
    if (x * x + (y - 2.85) * (y - 2.85) * 1.4 + (z - 0.95) * (z - 0.95) <= 0.02) return 'dark';
    return 'body';
  }
  // Chest column linking body to head (cream bib on the front).
  if (insideEllipsoid(x, y, z, 0, 2.0, 0.35, 0.62, 0.95, 0.6)) {
    return z > 0.55 && Math.abs(x) < 0.4 ? 'cream' : 'body';
  }
  // Haunches / seated body.
  if (insideEllipsoid(x, y, z, 0, 1.05, -0.1, 1.05, 0.95, 1.15)) return 'body';
  // Front paws.
  for (const side of [-1, 1]) {
    if (Math.abs(x - side * 0.4) <= 0.28 && z > 0.6 && z < 1.15 && y >= 0 && y <= 0.7) {
      return y < 0.2 ? 'cream' : 'body';
    }
  }
  // Curled tail sweeping up the right side.
  for (let t = 0; t <= 1.0001; t += 0.06) {
    const cx = 1.15 + 0.45 * Math.sin(t * Math.PI);
    const cy = 0.5 + 1.4 * t;
    const cz = -0.8 + 0.5 * t;
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    if (dx * dx + dy * dy + dz * dz <= 0.34 * 0.34) return t > 0.8 ? 'cream' : 'body';
  }
  return null;
}

let heroObjects: HeroObject[] | null = null;

export function getHeroObjects(): HeroObject[] {
  if (heroObjects) {
    return heroObjects;
  }

  heroObjects = [
    {
      accent: '#C2371E',
      id: 'car',
      label: 'SPORTS CAR',
      model: voxelize(classifyCar, 0.155, { minX: -2.7, maxX: 2.7, minY: 0, maxY: 2.0, minZ: -1.1, maxZ: 1.1 }),
      projection: { baseY: 172, centerX: 152, scale: 38 },
      tag: 'DEMO MODEL',
    },
    {
      accent: '#4F46E5',
      id: 'human',
      label: 'PERSON',
      model: voxelize(classifyHuman, 0.17, { minX: -1.6, maxX: 1.6, minY: 0, maxY: 6.1, minZ: -1, maxZ: 1 }),
      projection: { baseY: 190, centerX: 152, scale: 25 },
      tag: 'DEMO MODEL',
    },
    {
      accent: '#4B9F4A',
      id: 'flower',
      label: 'FLOWER',
      model: voxelize(classifyFlower, 0.15, { minX: -1.6, maxX: 1.6, minY: 0, maxY: 4.1, minZ: -1.6, maxZ: 1.6 }),
      projection: { baseY: 190, centerX: 152, scale: 30 },
      tag: 'DEMO MODEL',
    },
    {
      accent: '#E96632',
      id: 'cat',
      label: 'CAT',
      model: voxelize(classifyCat, 0.16, { minX: -2, maxX: 2, minY: 0, maxY: 4.3, minZ: -1.5, maxZ: 1.5 }),
      projection: { baseY: 188, centerX: 148, scale: 30 },
      tag: 'DEMO MODEL',
    },
  ];
  return heroObjects;
}
