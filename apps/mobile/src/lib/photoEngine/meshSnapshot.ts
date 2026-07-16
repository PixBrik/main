/**
 * Native stub. Raw-mesh snapshots are web-only (three.js + WebGL canvas) —
 * see meshSnapshot.web.ts. The lab is a web tool; native callers get no
 * snapshots rather than an error.
 */

export async function snapshotGlb(_url: string): Promise<string[]> {
  return [];
}
