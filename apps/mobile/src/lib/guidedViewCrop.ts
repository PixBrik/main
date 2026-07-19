/** Deterministic square framing for the four real photos used by True 3D. */

export type GuidedCropKind = 'center' | 'object' | 'person';

export interface GuidedDetectionBox {
  height: number;
  label: string;
  score: number;
  width: number;
  x: number;
  y: number;
}
export interface GuidedSquareCrop {
  kind: GuidedCropKind;
  size: number;
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Prefer a detected person, otherwise the most visually substantial object. */
export function selectGuidedSubject(
  detections: GuidedDetectionBox[],
): GuidedDetectionBox | null {
  if (!detections.length) return null;
  const people = detections.filter((entry) => entry.label.trim().toLowerCase() === 'person');
  const candidates = people.length ? people : detections;
  return candidates.reduce((best, candidate) =>
    candidate.score * candidate.width * candidate.height >
    best.score * best.width * best.height
      ? candidate
      : best,
  );
}

/**
 * Return a physical-pixel square crop.
 *
 * A COCO person box commonly covers the whole body. True-3D gift portraits
 * need the upper portion instead, so the square is centred around the first
 * quarter of the person box and sized for the head and shoulders. Objects keep
 * their whole detected extent with 15% padding on every side.
 */
export function guidedSquareCrop(
  imageWidth: number,
  imageHeight: number,
  detection: GuidedDetectionBox | null,
): GuidedSquareCrop {
  const width = Math.max(1, imageWidth);
  const height = Math.max(1, imageHeight);
  const maximumSquare = Math.min(width, height);
  if (!detection) {
    return {
      kind: 'center',
      size: maximumSquare,
      x: (width - maximumSquare) / 2,
      y: (height - maximumSquare) / 2,
    };
  }

  const boxX = clamp(detection.x, 0, 1) * width;
  const boxY = clamp(detection.y, 0, 1) * height;
  const boxWidth = clamp(detection.width, 0, 1) * width;
  const boxHeight = clamp(detection.height, 0, 1) * height;
  const person = detection.label.trim().toLowerCase() === 'person';
  const centreX = boxX + boxWidth / 2;
  const centreY = person ? boxY + boxHeight * 0.25 : boxY + boxHeight / 2;
  const desired = person
    ? Math.max(boxWidth * 1.4, boxHeight * 0.48)
    : Math.max(boxWidth, boxHeight) * 1.3;
  const size = clamp(desired, maximumSquare * 0.22, maximumSquare);
  return {
    kind: person ? 'person' : 'object',
    size,
    x: clamp(centreX - size / 2, 0, width - size),
    y: clamp(centreY - size / 2, 0, height - size),
  };
}
