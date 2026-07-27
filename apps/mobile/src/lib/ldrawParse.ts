/**
 * Minimal LDraw MPD → triangle-soup parser.
 *
 * GoBricks publishes a self-contained MPD per catalogue part: every
 * sub-assembly and primitive it references is inlined as a `0 FILE` block, so
 * a model resolves with no network access and no parts library. We only need
 * solid geometry, so this reads sub-file references (type 1), triangles
 * (type 3) and quads (type 4) and ignores edges, conditional lines and meta
 * commands. Coordinates stay in LDU (1 stud = 20, 1 brick = 24, +Y is down).
 *
 * Using our own parser instead of three's LDrawLoader keeps part loading
 * synchronous, dependency-free and debuggable — the loader's promise pipeline
 * silently swallowed failures on these files.
 */

export interface LDrawGeometry {
  /** Flat XYZ triples, three vertices per triangle. */
  positions: Float32Array;
  triangleCount: number;
}

const MAX_DEPTH = 24;

function splitFiles(text: string): Map<string, string[]> {
  const files = new Map<string, string[]>();
  let current = '__main__';
  files.set(current, []);
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const fileMatch = /^0\s+FILE\s+(.+)$/i.exec(line);
    if (fileMatch) {
      current = fileMatch[1]!.trim().toLowerCase();
      if (!files.has(current)) files.set(current, []);
      continue;
    }
    files.get(current)!.push(line);
  }
  return files;
}

/** Row-major 3x4 transform: [a b c x; d e f y; g h i z]. */
type Matrix = readonly number[];

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

function multiply(parent: Matrix, child: Matrix): number[] {
  const out = new Array<number>(12);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 4 + col] =
        parent[row * 4]! * child[col]! +
        parent[row * 4 + 1]! * child[4 + col]! +
        parent[row * 4 + 2]! * child[8 + col]!;
    }
    out[row * 4 + 3] =
      parent[row * 4]! * child[3]! +
      parent[row * 4 + 1]! * child[7]! +
      parent[row * 4 + 2]! * child[11]! +
      parent[row * 4 + 3]!;
  }
  return out;
}

function apply(matrix: Matrix, x: number, y: number, z: number, out: number[]): void {
  out[0] = matrix[0]! * x + matrix[1]! * y + matrix[2]! * z + matrix[3]!;
  out[1] = matrix[4]! * x + matrix[5]! * y + matrix[6]! * z + matrix[7]!;
  out[2] = matrix[8]! * x + matrix[9]! * y + matrix[10]! * z + matrix[11]!;
}

/** Parse one self-contained MPD into a single transformed triangle soup. */
export function parseLDrawMpd(text: string): LDrawGeometry {
  const files = splitFiles(text);
  const positions: number[] = [];
  const point: number[] = [0, 0, 0];

  const emit = (matrix: Matrix, coords: number[], indices: number[]): void => {
    for (const index of indices) {
      apply(matrix, coords[index * 3]!, coords[index * 3 + 1]!, coords[index * 3 + 2]!, point);
      positions.push(point[0]!, point[1]!, point[2]!);
    }
  };

  const walk = (name: string, matrix: Matrix, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    const lines = files.get(name);
    if (!lines) return;
    for (const line of lines) {
      if (!line || line.startsWith('0')) continue;
      const parts = line.split(/\s+/);
      const type = parts[0];
      if (type === '1') {
        const numbers = parts.slice(2, 14).map(Number);
        if (numbers.length < 12 || numbers.some((value) => !Number.isFinite(value))) continue;
        const [x, y, z, a, b, c, d, e, f, g, h, i] = numbers as number[];
        const child: Matrix = [a!, b!, c!, x!, d!, e!, f!, y!, g!, h!, i!, z!];
        const target = parts.slice(14).join(' ').trim().toLowerCase();
        walk(target, multiply(matrix, child), depth + 1);
      } else if (type === '3') {
        const coords = parts.slice(2, 11).map(Number);
        if (coords.length === 9 && coords.every(Number.isFinite)) emit(matrix, coords, [0, 1, 2]);
      } else if (type === '4') {
        const coords = parts.slice(2, 14).map(Number);
        if (coords.length === 12 && coords.every(Number.isFinite)) emit(matrix, coords, [0, 1, 2, 0, 2, 3]);
      }
    }
  };

  // The main model is the leading unnamed block; some exports also name it.
  walk('__main__', IDENTITY, 0);
  if (!positions.length) {
    const first = [...files.keys()].find((key) => key !== '__main__');
    if (first) walk(first, IDENTITY, 0);
  }

  return { positions: new Float32Array(positions), triangleCount: positions.length / 9 };
}
