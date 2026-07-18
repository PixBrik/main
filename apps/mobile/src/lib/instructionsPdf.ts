/**
 * PixBrik assembly guide export.
 *
 * Phone and PDF use the same deterministic one-piece assembly plan. The PDF
 * paginates the complete inventory and prints four large numbered actions per
 * page, so no catalog placement or colour line can be silently truncated.
 */

import { brickify, type BillOfMaterials, type BrickPlacement } from './brickify';
import {
  createAssemblyPlan,
  type AssemblyPlan,
  type AssemblyStep,
} from './instructions/assemblyPlan';
import type { VoxelModel } from './voxelFox';

export type GuidePaperSize = 'a4' | 'letter';
export type GuideExportAction = 'download' | 'print' | 'capture';

interface GuideOptions {
  model: VoxelModel;
  accent: string;
  buildName: string;
  heroImage?: string | null;
  /** Frozen order packing; avoids re-packing against a changed catalog. */
  bomOverride?: BillOfMaterials;
  paperSize?: GuidePaperSize;
  action?: GuideExportAction;
  /** Open synchronously from a click before async PDF work to avoid popup blocking. */
  printWindow?: Window | null;
  onProgress?: (fraction: number, note: string) => void;
}

const SIGNALS = ['#FF6B57', '#4F46E5', '#A9F4DE', '#C8F04B'];
const INK = '#111315';
const SOFT_INK = '#5B625E';
const PAPER = '#F7F5EE';
const LINE = '#D7D9D2';
const MARGIN = 14;
const STEP_COLUMNS = 2;
const STEP_ROWS = 2;
const STEPS_PER_PAGE = STEP_COLUMNS * STEP_ROWS;

function pageSize(doc: import('jspdf').jsPDF) {
  return {
    height: doc.internal.pageSize.getHeight(),
    width: doc.internal.pageSize.getWidth(),
  };
}

function drawBrand(doc: import('jspdf').jsPDF, y: number) {
  doc.setFillColor(INK);
  doc.rect(MARGIN, y, 9, 9, 'F');
  doc.setFillColor('#4F46E5');
  doc.rect(MARGIN + 2.2, y + 2.2, 4.6, 4.6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(INK);
  doc.text('PIX', MARGIN + 12, y + 7);
  doc.setTextColor('#4F46E5');
  doc.text('BRIK', MARGIN + 24, y + 7);
  SIGNALS.forEach((color, index) => {
    doc.setFillColor(color);
    doc.rect(MARGIN + 12 + index * 8.4, y + 9.4, 8.4, 1.2, 'F');
  });
}

function drawPageTitle(doc: import('jspdf').jsPDF, title: string, subtitle?: string) {
  drawBrand(doc, MARGIN);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(INK);
  doc.text(title, MARGIN, 38);
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(SOFT_INK);
    doc.text(subtitle, MARGIN, 44);
  }
}

function footer(doc: import('jspdf').jsPDF, page: number, pages: number) {
  const { height, width } = pageSize(doc);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.6);
  doc.setTextColor(SOFT_INK);
  doc.text(
    'PixBrik build guide - compatible catalog parts. Keep small pieces away from children under 3.',
    MARGIN,
    height - 7,
  );
  doc.text(`${page} / ${pages}`, width - MARGIN, height - 7, { align: 'right' });
}

interface PlanBounds {
  cols: number;
  maxI: number;
  maxK: number;
  minI: number;
  minK: number;
  rows: number;
}

function planBounds(plan: AssemblyPlan): PlanBounds {
  let minI = Infinity;
  let maxI = -Infinity;
  let minK = Infinity;
  let maxK = -Infinity;
  for (const step of plan.steps) {
    const placement = step.placement;
    minI = Math.min(minI, placement.i);
    maxI = Math.max(maxI, placement.i + placement.spanI - 1);
    minK = Math.min(minK, placement.k);
    maxK = Math.max(maxK, placement.k + placement.spanK - 1);
  }
  if (!Number.isFinite(minI)) minI = maxI = minK = maxK = 0;
  return {
    cols: Math.max(1, maxI - minI + 1),
    maxI,
    maxK,
    minI,
    minK,
    rows: Math.max(1, maxK - minK + 1),
  };
}

function placementColor(step: AssemblyStep): string {
  return step.partLine?.colorRgb ?? '#E96632';
}

/** Draw the connected layer faintly, the active layer grey, and this exact piece bright. */
function drawStepDiagram(
  doc: import('jspdf').jsPDF,
  plan: AssemblyPlan,
  bounds: PlanBounds,
  step: AssemblyStep,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  doc.setFillColor('#FAFAF6');
  doc.setDrawColor(LINE);
  doc.roundedRect(x, y, width, height, 2, 2, 'FD');
  const pad = 3;
  const labelH = 7;
  const stud = Math.max(0.7, Math.min((width - pad * 2) / bounds.cols, (height - pad * 2 - labelH) / bounds.rows));
  const gridW = bounds.cols * stud;
  const gridH = bounds.rows * stud;
  const ox = x + (width - gridW) / 2;
  const oy = y + pad + (height - pad * 2 - labelH - gridH) / 2;
  const supportLayer = plan.steps.filter(
    (candidate) =>
      candidate.layer === step.layer + (step.support.status === 'underside' ? 1 : -1) &&
      candidate.number < step.number,
  );
  for (const candidate of supportLayer) {
    const placement = candidate.placement;
    const px = ox + (placement.i - bounds.minI) * stud;
    const py = oy + (placement.k - bounds.minK) * stud;
    doc.setFillColor('#EEF0EC');
    doc.setDrawColor('#CDD1CB');
    doc.setLineWidth(0.18);
    doc.rect(px, py, placement.spanI * stud, placement.spanK * stud, 'FD');
  }
  const activeLayer = plan.steps.filter(
    (candidate) => candidate.layer === step.layer && candidate.number <= step.number,
  );
  for (const candidate of activeLayer) {
    const placement = candidate.placement;
    const fresh = candidate.id === step.id;
    const px = ox + (placement.i - bounds.minI) * stud;
    const py = oy + (placement.k - bounds.minK) * stud;
    const pw = placement.spanI * stud;
    const ph = placement.spanK * stud;
    doc.setFillColor(fresh ? placementColor(candidate) : '#D7DAD4');
    doc.setDrawColor(fresh ? INK : '#919690');
    doc.setLineWidth(fresh ? 0.65 : 0.22);
    doc.rect(px, py, pw, ph, 'FD');
    if (fresh && placement.shape === 'brick') {
      doc.setFillColor('#FFFFFF');
      doc.setDrawColor('#6C706C');
      for (let di = 0; di < placement.spanI; di++) {
        for (let dk = 0; dk < placement.spanK; dk++) {
          doc.circle(px + (di + 0.5) * stud, py + (dk + 0.5) * stud, Math.max(0.28, stud * 0.17), 'FD');
        }
      }
    }
    if (fresh && placement.shape === 'slope') {
      doc.setDrawColor('#FFFFFF');
      doc.setFillColor('#FFFFFF');
      doc.setLineWidth(Math.max(0.5, stud * 0.12));
      const direction = placement.facing ?? 1;
      const dx = direction === 3 ? 1 : direction === 4 ? -1 : 0;
      const dy = direction === 1 ? 1 : direction === 2 ? -1 : 0;
      const length = (dx ? pw : ph) * 0.3;
      const centerX = px + pw / 2;
      const centerY = py + ph / 2;
      const endX = centerX + dx * length;
      const endY = centerY + dy * length;
      const head = Math.max(1.1, stud * 0.35);
      const wing = Math.max(0.7, stud * 0.22);
      const backX = endX - dx * head;
      const backY = endY - dy * head;
      doc.line(centerX - dx * length, centerY - dy * length, endX, endY);
      doc.triangle(
        endX,
        endY,
        backX - dy * wing,
        backY + dx * wing,
        backX + dy * wing,
        backY - dx * wing,
        'F',
      );
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(SOFT_INK);
  doc.text(
    step.support.status === 'underside'
      ? `LAYER ${step.layer + 1} - ATTACH UNDER PALE LAYER`
      : `LAYER ${step.layer + 1} - FRONT`,
    x + width / 2,
    y + height - 2.4,
    { align: 'center' },
  );
}

function drawStepPanel(
  doc: import('jspdf').jsPDF,
  plan: AssemblyPlan,
  bounds: PlanBounds,
  step: AssemblyStep,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  doc.setFillColor('#FFFFFF');
  doc.setDrawColor(LINE);
  doc.roundedRect(x, y, width, height, 2.5, 2.5, 'FD');
  doc.setFillColor(SIGNALS[(step.bagNumber - 1) % SIGNALS.length]!);
  doc.roundedRect(x + 3, y + 3, 14, 10, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(INK);
  doc.text(String(step.number), x + 10, y + 9.8, { align: 'center' });
  doc.setFontSize(8.5);
  doc.text(`${step.chapterLabel.toUpperCase()}  /  ADD 1 PIECE`, x + 20, y + 7.2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.6);
  doc.setTextColor(SOFT_INK);
  const name = step.partLine?.partName ?? `Part ${step.placement.part}`;
  const colour = step.partLine?.colorName ?? 'Catalog colour';
  const partText = doc.splitTextToSize(`${name} - ${colour}`, Math.max(20, width - 23));
  doc.text(partText.slice(0, 2), x + 20, y + 10.6);
  const diagramY = y + 17;
  const warningSpace = ['partial', 'underside', 'unsupported'].includes(step.support.status) ? 6 : 0;
  drawStepDiagram(doc, plan, bounds, step, x + 3, diagramY, width - 6, height - 20 - warningSpace);
  if (warningSpace) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(step.support.status === 'unsupported' ? '#B53A2B' : SOFT_INK);
    doc.text(
      step.support.status === 'unsupported'
        ? 'STOP: regenerate this kit; this piece has no stud connection.'
        : step.support.status === 'underside'
          ? 'TURN OVER: press this piece onto the pale layer from underneath.'
          : 'CHECK: press every supported stud down firmly.',
      x + 3,
      y + height - 3,
    );
  }
}

function addCover(
  doc: import('jspdf').jsPDF,
  buildName: string,
  bom: BillOfMaterials,
  plan: AssemblyPlan,
  heroImage: string | null,
  paperSize: GuidePaperSize,
) {
  const { height, width } = pageSize(doc);
  drawBrand(doc, MARGIN);
  doc.setFillColor(INK);
  doc.roundedRect(MARGIN, 43, width - MARGIN * 2, Math.min(118, height * 0.4), 4, 4, 'F');
  if (heroImage) {
    try {
      doc.addImage(heroImage, 'PNG', MARGIN + 12, 49, width - MARGIN * 2 - 24, Math.min(106, height * 0.36));
    } catch {
      // The exact plan remains complete when an optional cover image cannot render.
    }
  } else {
    doc.setFillColor('#4F46E5');
    doc.roundedRect(width / 2 - 28, 70, 56, 42, 3, 3, 'F');
    doc.setFillColor('#A9F4DE');
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 6; col++) doc.circle(width / 2 - 23 + col * 9.2, 75 + row * 9.2, 2.3, 'F');
    }
  }
  const titleY = Math.min(184, height * 0.63);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(INK);
  const title = doc.splitTextToSize(buildName.toUpperCase(), width - MARGIN * 2);
  doc.text(title.slice(0, 2), MARGIN, titleY);
  const metaY = titleY + Math.min(30, title.length * 12 + 6);
  doc.setFontSize(11);
  doc.setTextColor('#4F46E5');
  doc.text('ONE-PIECE-AT-A-TIME BUILD GUIDE', MARGIN, metaY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(SOFT_INK);
  doc.text(
    [
      `${bom.totalParts.toLocaleString('en-US')} parts  |  ${bom.colorCount} colours  |  ${plan.totalSteps.toLocaleString('en-US')} numbered actions`,
      `${plan.chapters.length} easy stages  |  ${paperSize === 'a4' ? 'A4' : 'US Letter'} edition`,
      'Each number adds exactly one catalog piece. Bright colour = the new piece.',
    ],
    MARGIN,
    metaY + 10,
  );
}

function addQuickStart(doc: import('jspdf').jsPDF, plan: AssemblyPlan) {
  const { width } = pageSize(doc);
  doc.addPage();
  drawPageTitle(doc, 'Before you build', 'A simple rhythm for every number in this guide.');
  const cards = [
    ['1', 'FIND', 'Take the one piece named beside the picture. Match both shape and colour.'],
    ['2', 'PLACE', 'Keep FRONT toward you. Pale shapes show the connected layer. TURN OVER means the bright piece locks underneath it.'],
    ['3', 'PRESS', 'Press every stud down. If it rocks, go back one number and check the support.'],
  ] as const;
  cards.forEach(([number, title, body], index) => {
    const y = 56 + index * 48;
    doc.setFillColor(index === 0 ? '#FFF1A8' : index === 1 ? '#E5E2FF' : '#DDF8EE');
    doc.roundedRect(MARGIN, y, width - MARGIN * 2, 38, 3, 3, 'F');
    doc.setFillColor(SIGNALS[index]!);
    doc.circle(MARGIN + 15, y + 19, 9, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(INK);
    doc.text(number, MARGIN + 15, y + 23.5, { align: 'center' });
    doc.setFontSize(12);
    doc.text(title, MARGIN + 30, y + 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(SOFT_INK);
    doc.text(doc.splitTextToSize(body, width - MARGIN * 2 - 35), MARGIN + 30, y + 21);
  });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(INK);
  doc.text(`This build has ${plan.chapters.length} stage${plan.chapters.length === 1 ? '' : 's'}. Finish one stage before starting the next.`, MARGIN, 211);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(SOFT_INK);
  doc.text('Need a bigger picture? Scan the QR shown in your PixBrik order and continue on your phone.', MARGIN, 219);
}

function addManifestPages(doc: import('jspdf').jsPDF, bom: BillOfMaterials) {
  const { height, width } = pageSize(doc);
  const rowHeight = 7;
  const startY = 54;
  const rowsPerPage = Math.max(1, Math.floor((height - startY - 18) / rowHeight));
  const pageCount = Math.max(1, Math.ceil(bom.lines.length / rowsPerPage));
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    doc.addPage();
    drawPageTitle(
      doc,
      'Parts checklist',
      `Page ${pageIndex + 1} of ${pageCount} - sort parts by colour and shape before starting Stage 1.`,
    );
    const lines = bom.lines.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
    lines.forEach((line, row) => {
      const y = startY + row * rowHeight;
      if (row % 2 === 0) {
        doc.setFillColor(PAPER);
        doc.rect(MARGIN, y - 4.5, width - MARGIN * 2, rowHeight, 'F');
      }
      doc.setFillColor(line.colorRgb);
      doc.setDrawColor(INK);
      doc.rect(MARGIN + 2, y - 3.5, 6, 4.4, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(INK);
      doc.text(`${line.quantity} x`, MARGIN + 11, y);
      doc.text(line.partName, MARGIN + 25, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(SOFT_INK);
      const detail = `${line.colorName}  |  part ${line.part}${line.elementId ? `  |  element ${line.elementId}` : ''}`;
      doc.text(detail, width - MARGIN - 2, y, { align: 'right', maxWidth: Math.max(30, width * 0.46) });
    });
  }
}

function addStepPages(
  doc: import('jspdf').jsPDF,
  plan: AssemblyPlan,
  onProgress?: GuideOptions['onProgress'],
) {
  const { height, width } = pageSize(doc);
  const bounds = planBounds(plan);
  const pageCount = Math.ceil(plan.steps.length / STEPS_PER_PAGE);
  const gap = 4;
  const top = 50;
  const bottom = 16;
  const panelW = (width - MARGIN * 2 - gap) / STEP_COLUMNS;
  const panelH = (height - top - bottom - gap * (STEP_ROWS - 1)) / STEP_ROWS;
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    doc.addPage();
    const first = pageIndex * STEPS_PER_PAGE + 1;
    const last = Math.min(plan.steps.length, first + STEPS_PER_PAGE - 1);
    drawPageTitle(doc, `Build steps ${first}-${last}`, 'One bright catalog piece per number. Keep FRONT toward you.');
    const pageSteps = plan.steps.slice(pageIndex * STEPS_PER_PAGE, (pageIndex + 1) * STEPS_PER_PAGE);
    pageSteps.forEach((step, slot) => {
      const col = slot % STEP_COLUMNS;
      const row = Math.floor(slot / STEP_COLUMNS);
      drawStepPanel(
        doc,
        plan,
        bounds,
        step,
        MARGIN + col * (panelW + gap),
        top + row * (panelH + gap),
        panelW,
        panelH,
      );
    });
    onProgress?.((pageIndex + 1) / Math.max(1, pageCount), `Laying out steps ${first}-${last}`);
  }
}

function safeFileName(buildName: string): string {
  return buildName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'build';
}

export async function generateInstructionsPdf({
  model,
  accent,
  buildName,
  heroImage = null,
  bomOverride,
  paperSize = 'a4',
  action = 'download',
  printWindow = null,
  onProgress,
}: GuideOptions) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ compress: true, format: paperSize, unit: 'mm' });
  const bom = bomOverride ?? brickify(model, accent);
  const plan = createAssemblyPlan(bom);
  const hardPlanError = plan.warnings.find((entry) => entry.severity === 'error');
  if (hardPlanError || plan.supportSummary.unsupported > 0) {
    throw new Error(
      `This kit needs a safer parts plan: ${hardPlanError?.message ?? 'one or more catalog pieces are unsupported.'}`,
    );
  }

  onProgress?.(0, 'Preparing the cover');
  addCover(doc, buildName, bom, plan, heroImage, paperSize);
  addQuickStart(doc, plan);
  addManifestPages(doc, bom);
  addStepPages(doc, plan, onProgress);

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    footer(doc, page, pages);
  }

  const hooks = globalThis as {
    __FOTOBRIK_PDF_CAPTURE__?: boolean;
    __FOTOBRIK_PDF_LAST__?: string;
    __FOTOBRIK_PDF_META__?: Record<string, unknown>;
  };
  if (hooks.__FOTOBRIK_PDF_CAPTURE__ || action === 'capture') {
    hooks.__FOTOBRIK_PDF_LAST__ = doc.output('datauristring');
    const { height, width } = pageSize(doc);
    hooks.__FOTOBRIK_PDF_META__ = {
      heightMm: height,
      paperSize,
      pages,
      steps: plan.totalSteps,
      widthMm: width,
    };
  }

  const filename = `pixbrik-${safeFileName(buildName)}-guide-${paperSize}.pdf`;
  if (action === 'download') {
    doc.save(filename);
  } else if (action === 'print') {
    doc.autoPrint();
    const url = String(doc.output('bloburl'));
    if (printWindow && !printWindow.closed) printWindow.location.href = url;
    else if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
  }
  onProgress?.(1, 'Guide ready');
  return {
    filename,
    paperSize,
    pages,
    plan,
    steps: plan.totalSteps,
    totalParts: bom.totalParts,
  };
}

export type { BillOfMaterials };
