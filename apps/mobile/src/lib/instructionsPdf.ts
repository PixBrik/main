/**
 * FotoBrik instruction guide (web): a step-by-step, layer-by-layer build
 * guide exported as a branded PDF — cover, parts manifest, then one page per
 * step with a top-down diagram (new bricks solid, previous layers dimmed)
 * and the exact parts added in that step.
 *
 * FotoBrik branding only: neutral "compatible parts" wording, no third-party
 * toy branding or instruction trade dress.
 */

import { brickify, type BillOfMaterials, type BomLine, type BrickPlacement } from './brickify';
import type { VoxelCell, VoxelModel } from './voxelFox';

interface GuideOptions {
  model: VoxelModel;
  accent: string;
  buildName: string;
  heroImage?: string | null;
  /** Frozen order packing; avoids re-packing against a changed catalog. */
  bomOverride?: BillOfMaterials;
}

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 16;

const SIGNALS = ['#FF6B57', '#4F46E5', '#A9F4DE', '#C8F04B'];

function drawBrand(doc: import('jspdf').jsPDF, y: number) {
  doc.setFillColor('#111315');
  doc.rect(MARGIN, y, 9, 9, 'F');
  doc.setFillColor('#4F46E5');
  doc.rect(MARGIN + 2.2, y + 2.2, 4.6, 4.6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor('#111315');
  doc.text('PIX', MARGIN + 12, y + 7);
  doc.setTextColor('#4F46E5');
  doc.text('BRIK', MARGIN + 24, y + 7);
  SIGNALS.forEach((color, index) => {
    doc.setFillColor(color);
    doc.rect(MARGIN + 12 + index * 8.4, y + 9.4, 8.4, 1.2, 'F');
  });
}

function footer(doc: import('jspdf').jsPDF, page: number, pages: number) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor('#5B625E');
  doc.text(
    'PixBrik build guide — independent build-planning tool using compatible parts. Not affiliated with any brick manufacturer.',
    MARGIN,
    PAGE_H - 8,
  );
  doc.text(`${page} / ${pages}`, PAGE_W - MARGIN, PAGE_H - 8, { align: 'right' });
}

/** Top-down diagram of the build up to (and including) the given layers. */
function layerDiagram(
  cells: VoxelCell[],
  placements: BrickPlacement[],
  lines: BomLine[],
  upTo: number,
  fresh: Set<number>,
  sizePx: number,
): string {
  let minI = Infinity, maxI = -Infinity, minK = Infinity, maxK = -Infinity;
  for (const cell of cells) {
    minI = Math.min(minI, cell.i);
    maxI = Math.max(maxI, cell.i);
    minK = Math.min(minK, cell.k);
    maxK = Math.max(maxK, cell.k);
  }
  const cols = maxI - minI + 1;
  const rows = maxK - minK + 1;
  const cellPx = Math.max(4, Math.floor(sizePx / Math.max(cols, rows)));

  const canvas = document.createElement('canvas');
  canvas.width = cols * cellPx + 2;
  canvas.height = rows * cellPx + 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#F3F1EA';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const colors = new Map(lines.map((line) => [`${line.part}|${line.colorId}`, line.colorRgb]));
  // Draw the exact catalog pieces, older layers first. Piece boundaries,
  // footprints and slope direction now match the frozen order plan.
  const sorted = [...placements]
    .filter((placement) => placement.j <= upTo)
    .sort((a, b) => a.j - b.j || a.k - b.k || a.i - b.i);
  for (const placement of sorted) {
    const x = (placement.i - minI) * cellPx + 1;
    const y = (placement.k - minK) * cellPx + 1;
    const width = placement.spanI * cellPx;
    const height = placement.spanK * cellPx;
    const isFresh = fresh.has(placement.j);
    ctx.globalAlpha = isFresh ? 1 : 0.28;
    ctx.fillStyle = colors.get(`${placement.part}|${placement.colorId}`) ?? '#E96632';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = 'rgba(17,19,21,0.78)';
    ctx.lineWidth = Math.max(1, cellPx * 0.08);
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    if (isFresh) {
      if (placement.shape === 'slope') {
        const direction = placement.facing ?? 1;
        const dx = direction === 3 ? 1 : direction === 4 ? -1 : 0;
        const dy = direction === 1 ? 1 : direction === 2 ? -1 : 0;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = Math.max(1.5, cellPx * 0.16);
        ctx.beginPath();
        ctx.moveTo(x + width / 2 - dx * width * 0.3, y + height / 2 - dy * height * 0.3);
        ctx.lineTo(x + width / 2 + dx * width * 0.3, y + height / 2 + dy * height * 0.3);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        for (let di = 0; di < placement.spanI; di++) {
          for (let dk = 0; dk < placement.spanK; dk++) {
            ctx.beginPath();
            ctx.arc(
              x + (di + 0.5) * cellPx,
              y + (dk + 0.5) * cellPx,
              cellPx * 0.22,
              0,
              Math.PI * 2,
            );
            ctx.fill();
          }
        }
      }
    }
  }
  ctx.globalAlpha = 1;
  return canvas.toDataURL('image/png');
}

export async function generateInstructionsPdf({
  model,
  accent,
  buildName,
  heroImage = null,
  bomOverride,
}: GuideOptions) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ compress: true, format: 'a4', unit: 'mm' });

  const bom = bomOverride ?? brickify(model, accent);
  const layers = [...new Set(model.cells.map((cell) => cell.j))].sort((a, b) => a - b);
  const stepCount = Math.min(9, layers.length);
  const perStep = Math.ceil(layers.length / stepCount);
  const steps: number[][] = [];
  for (let index = 0; index < layers.length; index += perStep) {
    steps.push(layers.slice(index, index + perStep));
  }
  const pages = 2 + steps.length;

  // ---- Cover ----
  drawBrand(doc, MARGIN);
  doc.setFillColor('#171A21');
  doc.roundedRect(MARGIN, 44, PAGE_W - MARGIN * 2, 120, 4, 4, 'F');
  if (heroImage) {
    try {
      doc.addImage(heroImage, 'PNG', MARGIN + 14, 50, PAGE_W - MARGIN * 2 - 28, 108);
    } catch {
      // Hero snapshot optional.
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  doc.setTextColor('#111315');
  doc.text(buildName.toUpperCase(), MARGIN, 182);
  doc.setFontSize(11);
  doc.setTextColor('#4F46E5');
  doc.text('BUILD GUIDE', MARGIN, 190);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor('#5B625E');
  doc.text(
    [
      `${bom.totalParts} parts · ${bom.colorCount} colours · ${steps.length} build steps`,
      `Estimated parts retail €${bom.totalEur.toFixed(2)} (estimate)`,
    ],
    MARGIN,
    200,
  );
  footer(doc, 1, pages);

  // ---- Parts manifest ----
  doc.addPage();
  drawBrand(doc, MARGIN);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor('#111315');
  doc.text('Parts manifest', MARGIN, 40);
  let y = 50;
  doc.setFontSize(8);
  for (const line of bom.lines) {
    if (y > PAGE_H - 24) break;
    doc.setFillColor(line.colorRgb);
    doc.rect(MARGIN, y - 3.4, 6, 4.4, 'F');
    doc.setDrawColor('#111315');
    doc.rect(MARGIN, y - 3.4, 6, 4.4, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor('#111315');
    doc.text(`${line.quantity} ×`, MARGIN + 9, y);
    doc.text(line.partName, MARGIN + 21, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor('#5B625E');
    doc.text(
      `${line.colorName} · ref ${line.part}${line.elementId ? ` · element ${line.elementId}` : ''} · €${line.unitPriceEur.toFixed(2)} est.`,
      MARGIN + 66,
      y,
    );
    y += 6.2;
  }
  footer(doc, 2, pages);

  // ---- Steps ----
  steps.forEach((stepLayers, index) => {
    doc.addPage();
    drawBrand(doc, MARGIN);

    doc.setFillColor(SIGNALS[index % SIGNALS.length]!);
    doc.roundedRect(MARGIN, 36, 20, 12, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor('#111315');
    doc.text(`${index + 1}`.padStart(2, '0'), MARGIN + 10, 44.2, { align: 'center' });
    doc.setFontSize(15);
    doc.text(
      `Step ${index + 1} — layers ${stepLayers[0]! + 1}–${stepLayers[stepLayers.length - 1]! + 1}`,
      MARGIN + 26,
      44.5,
    );

    const fresh = new Set(stepLayers);
    const diagram = layerDiagram(
      model.cells,
      bom.placements,
      bom.lines,
      stepLayers[stepLayers.length - 1]!,
      fresh,
      560,
    );
    const box = PAGE_W - MARGIN * 2;
    doc.setFillColor('#FFFFFF');
    doc.setDrawColor('#D7D9D2');
    doc.roundedRect(MARGIN, 52, box, 130, 3, 3, 'FD');
    try {
      doc.addImage(diagram, 'PNG', MARGIN + 10, 58, box - 20, 118);
    } catch {
      // Canvas unavailable — text-only step.
    }

    // Parts added in this step.
    const stepPlacements = bom.placements.filter((placement) => fresh.has(placement.j));
    const lineByKey = new Map(bom.lines.map((line) => [`${line.part}|${line.colorId}`, line]));
    const stepCounts = new Map<string, number>();
    for (const placement of stepPlacements) {
      const key = `${placement.part}|${placement.colorId}`;
      stepCounts.set(key, (stepCounts.get(key) ?? 0) + 1);
    }
    const stepLines = [...stepCounts]
      .map(([key, quantity]) => ({ line: lineByKey.get(key), quantity }))
      .filter((entry): entry is { line: BomLine; quantity: number } => !!entry.line)
      .sort((a, b) => b.quantity - a.quantity);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor('#111315');
    doc.text('Add in this step:', MARGIN, 192);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    let sy = 199;
    for (const { line, quantity } of stepLines.slice(0, 10)) {
      doc.setFillColor(line.colorRgb);
      doc.rect(MARGIN, sy - 3, 4.6, 3.6, 'F');
      doc.setDrawColor('#111315');
      doc.rect(MARGIN, sy - 3, 4.6, 3.6, 'S');
      doc.setTextColor('#111315');
      doc.text(`${quantity} × ${line.partName} — ${line.colorName}`, MARGIN + 8, sy);
      sy += 5.4;
    }
    doc.setTextColor('#5B625E');
    doc.text('Top-down view: solid bricks are new in this step, dimmed bricks are layers already placed.', MARGIN, sy + 4);
    doc.text('Check every brick is pressed fully down before starting the next step.', MARGIN, sy + 9);

    footer(doc, 3 + index, pages);
  });

  // Test/e2e escape hatch: capture the document instead of only saving it.
  const hooks = globalThis as { __FOTOBRIK_PDF_CAPTURE__?: boolean; __FOTOBRIK_PDF_LAST__?: string };
  if (hooks.__FOTOBRIK_PDF_CAPTURE__) {
    hooks.__FOTOBRIK_PDF_LAST__ = doc.output('datauristring');
  }

  doc.save(`pixbrik-${buildName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-guide.pdf`);
  return { pages, steps: steps.length, totalParts: bom.totalParts };
}

export type { BillOfMaterials };
