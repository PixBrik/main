import type { RenderFace } from './voxelRender';

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
