import type { VoxelModel } from './voxelFox';
import type { RenderFace } from './voxelRender';

/**
 * Head-on mosaic view of a relief PANEL: one flat square per front-most cell.
 * The generic isometric projection views panels from behind — nearly every
 * visible face is the grey backing, and every style looks like the same
 * slab. A panel hangs on a wall; render it the way it will be seen.
 */
export function panelMosaicFaces(
  model: VoxelModel,
  width: number,
  height: number,
  fill = 0.92,
): RenderFace[] {
  const front = new Map<string, { i: number; j: number; k: number; colorHex?: string }>();
  let maxI = 0;
  let maxJ = 0;
  for (const cell of model.cells) {
    maxI = Math.max(maxI, cell.i);
    maxJ = Math.max(maxJ, cell.j);
    const key = `${cell.i},${cell.j}`;
    const current = front.get(key);
    if (!current || cell.k < current.k) front.set(key, cell);
  }
  if (!front.size) return [];
  const scale = Math.min((width * fill) / (maxI + 1), (height * fill) / (maxJ + 1));
  const offsetX = (width - (maxI + 1) * scale) / 2;
  const offsetY = (height - (maxJ + 1) * scale) / 2;
  const faces: RenderFace[] = [];
  for (const cell of front.values()) {
    const x = offsetX + cell.i * scale;
    const y = offsetY + (maxJ - cell.j) * scale;
    const s = scale * 0.96;
    faces.push({
      depth: 0,
      fill: cell.colorHex ?? '#9BA19D',
      id: `m${cell.i}-${cell.j}`,
      points: `${x.toFixed(1)},${y.toFixed(1)} ${(x + s).toFixed(1)},${y.toFixed(1)} ${(x + s).toFixed(1)},${(y + s).toFixed(1)} ${x.toFixed(1)},${(y + s).toFixed(1)}`,
    });
  }
  return faces;
}

/**
 * Scale and centre projected voxel faces into a target viewBox, so a model
 * rendered with a neutral unit projection fills any preview box.
 */
export function fitFacesToBox(
  faces: RenderFace[],
  width: number,
  height: number,
  fill = 0.86,
): RenderFace[] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const face of faces) {
    for (const pair of face.points.split(' ')) {
      const [x, y] = pair.split(',').map(Number);
      if (x === undefined || y === undefined) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return faces;
  const scale = Math.min(
    (width * fill) / Math.max(1e-6, maxX - minX),
    (height * fill) / Math.max(1e-6, maxY - minY),
  );
  const offsetX = width / 2 - ((minX + maxX) / 2) * scale;
  const offsetY = height / 2 - ((minY + maxY) / 2) * scale;
  return faces.map((face) => ({
    ...face,
    points: face.points
      .split(' ')
      .map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return `${(x! * scale + offsetX).toFixed(1)},${(y! * scale + offsetY).toFixed(1)}`;
      })
      .join(' '),
  }));
}

/**
 * Rasterize projected faces to a PNG data URL (web only). For previews that
 * stay mounted in lists, one <img> beats thousands of live SVG polygon nodes.
 */
export function facesToPngDataUrl(
  faces: RenderFace[],
  width: number,
  height: number,
  pixelScale = 2,
): string | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width * pixelScale;
  canvas.height = height * pixelScale;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#17130A';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.lineJoin = 'round';
  context.lineWidth = 0.3 * pixelScale;
  context.strokeStyle = '#0A0C12';
  for (const face of faces) {
    const points = face.points.split(' ').map((pair) => pair.split(',').map(Number));
    if (!points.length) continue;
    context.beginPath();
    points.forEach(([x, y], index) => {
      if (x === undefined || y === undefined) return;
      if (index === 0) context.moveTo(x * pixelScale, y * pixelScale);
      else context.lineTo(x * pixelScale, y * pixelScale);
    });
    context.closePath();
    context.fillStyle = face.fill;
    context.fill();
    context.stroke();
  }
  return canvas.toDataURL('image/png');
}
