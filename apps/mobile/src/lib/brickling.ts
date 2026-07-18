const BRICKLING_FACE_COLORS = ['#FFC800', '#E96632', '#91B8E8', '#9BC9A7', '#D6A7D8'] as const;
const BRICKLING_BACKGROUNDS = ['#17130A', '#2E2716', '#153A54', '#214535', '#4B284D'] as const;

export interface BricklingDesign {
  background: string;
  eyeGap: number;
  face: string;
  mouthOffset: number;
  mouthWidth: number;
  studCount: 2 | 3 | 4;
}
/** Stable FNV-1a hash so one Clerk identity always receives the same Brickling. */
export function bricklingHash(seed: string): number {
  let hash = 0x811c9dc5;
  const normalized = seed.trim().toLowerCase() || 'anonymous-brickling';
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function bricklingDesign(seed: string): BricklingDesign {
  const hash = bricklingHash(seed);
  return {
    background: BRICKLING_BACKGROUNDS[(hash >>> 5) % BRICKLING_BACKGROUNDS.length]!,
    eyeGap: 8 + ((hash >>> 11) % 3) * 2,
    face: BRICKLING_FACE_COLORS[hash % BRICKLING_FACE_COLORS.length]!,
    mouthOffset: ((hash >>> 17) % 3) - 1,
    mouthWidth: 9 + ((hash >>> 14) % 4),
    studCount: (2 + ((hash >>> 8) % 3)) as 2 | 3 | 4,
  };
}
