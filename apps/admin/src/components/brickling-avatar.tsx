type BricklingAvatarProps = {
  seed: string;
  label: string;
};

const palettes = [
  ["#ffca05", "#e03d2f", "#15130f", "#fffdf7"],
  ["#7bc8f6", "#235ea8", "#15130f", "#fffdf7"],
  ["#8fe3b5", "#147a4b", "#15130f", "#fffdf7"],
  ["#f6a6c1", "#8d315a", "#15130f", "#fffdf7"]
] as const;

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function BricklingAvatar({ seed, label }: BricklingAvatarProps) {
  const hash = hashSeed(seed);
  const [primary, accent, ink, eye] = palettes[hash % palettes.length];
  const eyeOffset = hash % 2;
  const mouthWidth = 2 + (hash % 3);

  return (
    <svg
      className="brickling-avatar"
      viewBox="0 0 12 12"
      role="img"
      aria-label={`${label}'s Brickling avatar`}
      shapeRendering="crispEdges"
    >
      <rect width="12" height="12" fill={primary} />
      <rect x="2" y="1" width="8" height="2" fill={ink} />
      <rect x="1" y="3" width="10" height="7" fill={accent} />
      <rect x="2" y="3" width="8" height="6" fill={primary} />
      <rect x={3 + eyeOffset} y="5" width="2" height="2" fill={eye} />
      <rect x={7 - eyeOffset} y="5" width="2" height="2" fill={eye} />
      <rect x={6 - Math.floor(mouthWidth / 2)} y="8" width={mouthWidth} height="1" fill={ink} />
      <rect x="2" y="10" width="8" height="2" fill={ink} />
      <rect x="3" y="10" width="2" height="1" fill={accent} />
      <rect x="7" y="10" width="2" height="1" fill={accent} />
    </svg>
  );
}
