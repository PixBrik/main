/**
 * Downscale a picked photo to a sane working size (web). Phone cameras hand
 * us 12-megapixel images; pushing those through detection, segmentation and
 * preview canvases is what kills mobile browser tabs (the tab reloads and
 * the buyer lands back on the homepage). Every downstream consumer samples
 * far below this cap — SAM ~1024, the segment grid ≤56 cells, generator
 * uploads 1024 — so nothing visible is lost.
 */
export async function downscalePhoto(uri: string, maxEdge = 1600): Promise<string> {
  if (typeof document === 'undefined') return uri;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new (globalThis as unknown as { Image: typeof HTMLImageElement }).Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not load photo'));
    img.src = uri;
  });
  if (Math.max(image.naturalWidth, image.naturalHeight) <= maxEdge) {
    return uri;
  }
  const scale = maxEdge / Math.max(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return uri;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  return blob ? URL.createObjectURL(blob) : uri;
}
