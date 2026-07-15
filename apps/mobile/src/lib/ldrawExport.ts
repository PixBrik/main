/**
 * LDraw (.ldr) export: turns a packed build into the standard MOC file
 * format understood by BrickLink Studio, LDView — and GoBricks' Upload Tool,
 * which prices and sells the physical parts for an uploaded model. This is
 * the bridge from "generated build" to "box of real bricks at the door".
 *
 * LDraw conventions: 1 stud = 20 LDU, brick height = 24 LDU, Y points down.
 */

import catalog from '../data/brickCatalog.json';
import type { BillOfMaterials } from './brickify';

/** Canonical LDraw part files for the packing sizes (LEGO design ids). */
const LDRAW_PART_BY_DESIGN: Record<string, string> = {
  '2456': '2456.dat',
  '3001': '3001.dat',
  '3002': '3002.dat',
  '3003': '3003.dat',
  '3004': '3004.dat',
  '3005': '3005.dat',
  '3007': '3007.dat',
  '3008': '3008.dat',
  '3009': '3009.dat',
  '3010': '3010.dat',
  '3622': '3622.dat',
};

interface CatalogColorWithLdraw {
  id: number;
  ldraw?: number | null;
}

const ldrawColorById = new Map<number, number>();
for (const color of catalog.colors as CatalogColorWithLdraw[]) {
  if (color.ldraw !== undefined && color.ldraw !== null) {
    ldrawColorById.set(color.id, color.ldraw);
  }
}

export function toLdraw(bom: BillOfMaterials, buildName: string): string {
  const lines: string[] = [
    `0 ${buildName}`,
    '0 Name: pixbrik-build.ldr',
    '0 Author: PixBrik generator',
    '0 !LICENSE For personal building use',
  ];

  for (const placement of bom.placements) {
    const designId = placement.part.replace(/[^0-9a-z]/gi, '');
    const partFile = LDRAW_PART_BY_DESIGN[designId] ?? `${designId}.dat`;
    const ldrawColor = ldrawColorById.get(placement.colorId) ?? 7;

    // Our packer's long axis is i; LDraw bricks are modelled length-along-x.
    // A brick spanning more cells in k than i is the rotated orientation.
    const rotated = placement.spanK > placement.spanI;
    const centerX = (placement.i + placement.spanI / 2) * 20;
    const centerZ = (placement.k + placement.spanK / 2) * 20;
    const y = -placement.j * 24;
    const matrix = rotated ? '0 0 -1 0 1 0 1 0 0' : '1 0 0 0 1 0 0 0 1';

    lines.push(
      `1 ${ldrawColor} ${centerX.toFixed(1)} ${y.toFixed(1)} ${centerZ.toFixed(1)} ${matrix} ${partFile}`,
    );
  }

  return lines.join('\n') + '\n';
}

/** Trigger a browser download of the .ldr file (web only). */
export function downloadLdraw(bom: BillOfMaterials, buildName: string) {
  const content = toLdraw(bom, buildName);
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `pixbrik-${buildName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ldr`;
  anchor.click();
  URL.revokeObjectURL(url);
  return bom.placements.length;
}
