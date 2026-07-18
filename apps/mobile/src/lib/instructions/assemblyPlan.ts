import type { BillOfMaterials, BomLine, BrickPlacement } from '../brickify';

/** Increment when the deterministic placement ordering or support rules change. */
export const ASSEMBLY_PLAN_VERSION = 2 as const;

export type SupportStatus = 'base' | 'full' | 'partial' | 'underside' | 'unsupported';

export type AssemblyWarningCode =
  | 'invalid-footprint'
  | 'missing-part-line'
  | 'overlapping-placement'
  | 'partial-support'
  | 'part-count-mismatch'
  | 'underside-attachment'
  | 'unsupported-placement';

export interface AssemblyWarning {
  code: AssemblyWarningCode;
  message: string;
  severity: 'warning' | 'error';
  /** Present when the warning belongs to one numbered assembly action. */
  stepId?: string;
}

export interface AssemblySupport {
  status: SupportStatus;
  /** Stud positions covered by the catalog piece's footprint. */
  footprintStuds: number;
  /** Unique footprint studs connected to an earlier piece above or below. */
  supportedStuds: number;
  /** `supportedStuds / footprintStuds`; a base piece reports 1. */
  ratio: number;
  /** Earlier numbered steps that this piece locks onto. */
  supportingStepIds: string[];
}

export interface AssemblyStep {
  id: string;
  /** Zero-based index used by interactive previous/next controls. */
  index: number;
  /** One-based number shown to the builder. */
  number: number;
  /** Exact grid layer containing this action. */
  layer: number;
  /** Exact object from the frozen `bom.placements` array. */
  placement: BrickPlacement;
  /** Index of `placement` in the frozen BOM before assembly ordering. */
  sourcePlacementIndex: number;
  /** Stable join key for catalog part and colour metadata. */
  partKey: string;
  /** Exact matching frozen BOM line, or null with an explicit warning. */
  partLine: BomLine | null;
  chapterId: string;
  chapterNumber: number;
  chapterLabel: string;
  bagNumber: number;
  /** Number of catalog pieces visible after completing this action. */
  cumulativePlacementCount: number;
  support: AssemblySupport;
  warnings: AssemblyWarning[];
}

export interface AssemblyChapter {
  id: string;
  number: number;
  /** Alias used by kit-packing and child-facing UI. */
  bagNumber: number;
  label: string;
  startStepNumber: number;
  endStepNumber: number;
  stepCount: number;
  /** Grid layers touched by this bag, in ascending order. */
  layers: number[];
  firstLayer: number;
  lastLayer: number;
  warningCount: number;
}

export interface AssemblySupportSummary {
  base: number;
  full: number;
  partial: number;
  underside: number;
  unsupported: number;
}

export interface AssemblyPlan {
  version: typeof ASSEMBLY_PLAN_VERSION;
  /** Original BOM indices in the exact numbered build order. */
  placementOrder: number[];
  steps: AssemblyStep[];
  chapters: AssemblyChapter[];
  warnings: AssemblyWarning[];
  supportSummary: AssemblySupportSummary;
  totalSteps: number;
  totalPlacements: number;
  declaredParts: number;
}

export interface AssemblyPlanOptions {
  /** Printed bags/chapters remain navigable even for very large models. */
  maxStepsPerChapter?: number;
  /** Frozen original BOM indices, used when reopening a published guide. */
  placementOrder?: readonly number[];
}

interface PlacementRecord {
  placement: BrickPlacement;
  sourcePlacementIndex: number;
  signature: string;
  footprint: string[];
  footprintIsValid: boolean;
  overlapCount: number;
  status: SupportStatus;
  supportedStuds: number;
  supportingRecords: Set<PlacementRecord>;
  upperRecords: Set<PlacementRecord>;
}

const DEFAULT_STEPS_PER_CHAPTER = 60;

export function partColorKey(part: string, colorId: number): string {
  return `${part}|${colorId}`;
}

function placementSignature(placement: BrickPlacement): string {
  return [
    placement.j,
    placement.k,
    placement.i,
    placement.shape,
    placement.spanK,
    placement.spanI,
    placement.part,
    placement.colorId,
    placement.facing ?? 0,
  ].join('|');
}

function footprintOf(placement: BrickPlacement): { keys: string[]; valid: boolean } {
  const valid =
    Number.isInteger(placement.i) &&
    Number.isInteger(placement.j) &&
    Number.isInteger(placement.k) &&
    Number.isInteger(placement.spanI) &&
    Number.isInteger(placement.spanK) &&
    placement.spanI > 0 &&
    placement.spanK > 0;
  if (!valid) return { keys: [], valid: false };

  const keys: string[] = [];
  for (let di = 0; di < placement.spanI; di++) {
    for (let dk = 0; dk < placement.spanK; dk++) {
      keys.push(`${placement.i + di}|${placement.k + dk}`);
    }
  }
  return { keys, valid: true };
}

function supportRank(status: SupportStatus): number {
  if (status === 'base' || status === 'full') return 0;
  if (status === 'partial') return 1;
  if (status === 'underside') return 2;
  return 3;
}

function compareRecords(a: PlacementRecord, b: PlacementRecord): number {
  return (
    a.placement.j - b.placement.j ||
    supportRank(a.status) - supportRank(b.status) ||
    a.placement.k - b.placement.k ||
    a.placement.i - b.placement.i ||
    b.footprint.length - a.footprint.length ||
    a.signature.localeCompare(b.signature) ||
    // Exact duplicate placements remain separate actions. Their source order
    // is the only meaningful deterministic tie-breaker.
    a.sourcePlacementIndex - b.sourcePlacementIndex
  );
}

function chapterSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_STEPS_PER_CHAPTER;
  return Math.max(1, Math.floor(value));
}

function warning(
  code: AssemblyWarningCode,
  message: string,
  severity: AssemblyWarning['severity'],
  stepId?: string,
): AssemblyWarning {
  return { code, message, severity, ...(stepId ? { stepId } : {}) };
}

/**
 * Turn a frozen catalog packing into a child-readable assembly order.
 *
 * Every numbered step owns exactly one original `BrickPlacement`. Nothing is
 * repaired, substituted, or omitted here: questionable geometry remains in
 * the plan with structured warnings so checkout, UI and PDF all stay honest.
 */
export function createAssemblyPlan(
  bom: BillOfMaterials,
  options: AssemblyPlanOptions = {},
): AssemblyPlan {
  const lineByKey = new Map<string, BomLine>();
  for (const line of bom.lines) {
    const key = partColorKey(line.part, line.colorId);
    if (!lineByKey.has(key)) lineByKey.set(key, line);
  }

  const records: PlacementRecord[] = bom.placements.map((placement, sourcePlacementIndex) => {
    const footprint = footprintOf(placement);
    return {
      footprint: footprint.keys,
      footprintIsValid: footprint.valid,
      overlapCount: 0,
      placement,
      signature: placementSignature(placement),
      sourcePlacementIndex,
      status: 'unsupported',
      supportedStuds: 0,
      supportingRecords: new Set<PlacementRecord>(),
      upperRecords: new Set<PlacementRecord>(),
    };
  });

  const coverageByLayer = new Map<number, Map<string, PlacementRecord[]>>();
  for (const record of records) {
    let layer = coverageByLayer.get(record.placement.j);
    if (!layer) {
      layer = new Map<string, PlacementRecord[]>();
      coverageByLayer.set(record.placement.j, layer);
    }
    for (const key of record.footprint) {
      const covering = layer.get(key) ?? [];
      covering.push(record);
      layer.set(key, covering);
    }
  }

  for (const layer of coverageByLayer.values()) {
    for (const covering of layer.values()) {
      if (covering.length < 2) continue;
      for (const record of covering) record.overlapCount += covering.length - 1;
    }
  }

  const finiteLayers = records
    .map((record) => record.placement.j)
    .filter((layer) => Number.isFinite(layer));
  const firstLayer = finiteLayers.length ? Math.min(...finiteLayers) : 0;

  for (const record of records) {
    if (!record.footprintIsValid) {
      record.status = 'unsupported';
      continue;
    }
    if (record.placement.j === firstLayer) {
      record.status = 'base';
      record.supportedStuds = record.footprint.length;
      continue;
    }

    const layerBelow = coverageByLayer.get(record.placement.j - 1);
    if (layerBelow) {
      for (const key of record.footprint) {
        const beneath = layerBelow.get(key);
        if (!beneath?.length) continue;
        record.supportedStuds += 1;
        for (const support of beneath) record.supportingRecords.add(support);
      }
    }
    record.status =
      record.supportedStuds === record.footprint.length
        ? 'full'
        : record.supportedStuds > 0
          ? 'partial'
          : 'unsupported';

    const layerAbove = coverageByLayer.get(record.placement.j + 1);
    if (layerAbove) {
      for (const key of record.footprint) {
        for (const upper of layerAbove.get(key) ?? []) record.upperRecords.add(upper);
      }
    }
  }

  if (options.placementOrder) {
    if (options.placementOrder.length !== records.length) {
      throw new Error('Frozen assembly order must contain every catalog placement.');
    }
    const seen = new Set<number>();
    const frozen = options.placementOrder.map((sourceIndex) => {
      if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= records.length || seen.has(sourceIndex)) {
        throw new Error('Frozen assembly order must be a permutation of catalog placement indices.');
      }
      seen.add(sourceIndex);
      return records[sourceIndex]!;
    });
    records.splice(0, records.length, ...frozen);
  } else {
    // A purely bottom-up sweep can strand a real overhang piece with nothing
    // below it. Build the placement-connection graph instead: start with every
    // piece resting on the lowest layer, prefer ordinary upward connections,
    // and only then add pieces that lock onto the underside of an already
    // connected bridge. This keeps the exact catalog packing while ensuring a
    // child never has to hold a floating piece waiting for a later step.
    const deterministic = [...records].sort(compareRecords);
    const ordered: PlacementRecord[] = [];
    const placed = new Set<PlacementRecord>();
    const append = (record: PlacementRecord) => {
      ordered.push(record);
      placed.add(record);
    };

    for (const record of deterministic) {
      if (record.placement.j === firstLayer) append(record);
    }

    while (ordered.length < records.length) {
      const candidates = deterministic
        .filter((record) => !placed.has(record))
        .filter((record) =>
          [...record.supportingRecords, ...record.upperRecords].some((adjacent) => placed.has(adjacent)),
        )
        .sort((a, b) => {
          const aConnectsBelow = [...a.supportingRecords].some((record) => placed.has(record));
          const bConnectsBelow = [...b.supportingRecords].some((record) => placed.has(record));
          return Number(bConnectsBelow) - Number(aConnectsBelow) || compareRecords(a, b);
        });

      if (candidates.length) {
        append(candidates[0]!);
        continue;
      }

      // A remaining component has no stud connection to the base component.
      // Preserve it deterministically so the guide can expose a hard error;
      // never silently omit or invent a purchased catalog piece.
      for (const record of deterministic) {
        if (!placed.has(record)) append(record);
      }
    }
    records.splice(0, records.length, ...ordered);
  }
  const stepIdByRecord = new Map<PlacementRecord, string>();
  records.forEach((record, index) => {
    stepIdByRecord.set(record, `step-${String(index + 1).padStart(6, '0')}`);
  });

  const allWarnings: AssemblyWarning[] = [];
  const earlierRecords = new Set<PlacementRecord>();
  const steps: AssemblyStep[] = records.map((record, index) => {
    const id = stepIdByRecord.get(record)!;
    const partKey = partColorKey(record.placement.part, record.placement.colorId);
    const partLine = lineByKey.get(partKey) ?? null;
    const stepWarnings: AssemblyWarning[] = [];
    const earlierBelow = [...record.supportingRecords].filter((support) => earlierRecords.has(support));
    const earlierAbove = [...record.upperRecords].filter((support) => earlierRecords.has(support));
    const connectionRecords = earlierBelow.length ? earlierBelow : earlierAbove;
    const connectionLayer = earlierBelow.length
      ? coverageByLayer.get(record.placement.j - 1)
      : earlierAbove.length
        ? coverageByLayer.get(record.placement.j + 1)
        : null;
    const connectedStuds = connectionLayer
      ? record.footprint.filter((key) =>
          connectionLayer.get(key)?.some((support) => connectionRecords.includes(support)),
        ).length
      : 0;
    const status: SupportStatus = !record.footprintIsValid
      ? 'unsupported'
      : record.placement.j === firstLayer
        ? 'base'
        : earlierBelow.length
          ? connectedStuds === record.footprint.length
            ? 'full'
            : 'partial'
          : earlierAbove.length
            ? 'underside'
            : 'unsupported';

    if (!record.footprintIsValid) {
      stepWarnings.push(warning(
        'invalid-footprint',
        'This catalog placement has invalid grid coordinates or dimensions.',
        'error',
        id,
      ));
    }
    if (!partLine) {
      stepWarnings.push(warning(
        'missing-part-line',
        `No frozen catalog line matches ${partKey}.`,
        'error',
        id,
      ));
    }
    if (record.overlapCount > 0) {
      stepWarnings.push(warning(
        'overlapping-placement',
        'This piece overlaps another catalog placement on the same layer.',
        'error',
        id,
      ));
    }
    if (status === 'partial') {
      stepWarnings.push(warning(
        'partial-support',
        `Only ${connectedStuds} of ${record.footprint.length} footprint studs connect to the layer below.`,
        'warning',
        id,
      ));
    } else if (status === 'underside') {
      stepWarnings.push(warning(
        'underside-attachment',
        'Turn the connected model over and lock this piece onto the shown studs from underneath.',
        'warning',
        id,
      ));
    } else if (status === 'unsupported') {
      stepWarnings.push(warning(
        'unsupported-placement',
        'This piece has no stud connection to the assembled model. Regenerate the kit before building.',
        'error',
        id,
      ));
    }

    allWarnings.push(...stepWarnings);
    const supportingStepIds = connectionRecords
      .map((support) => stepIdByRecord.get(support))
      .filter((stepId): stepId is string => !!stepId)
      .sort();
    const footprintStuds = record.footprint.length;
    const ratio = status === 'base'
      ? 1
      : footprintStuds > 0
        ? connectedStuds / footprintStuds
        : 0;

    const step: AssemblyStep = {
      bagNumber: 0,
      chapterId: '',
      chapterLabel: '',
      chapterNumber: 0,
      cumulativePlacementCount: index + 1,
      id,
      index,
      layer: record.placement.j,
      number: index + 1,
      partKey,
      partLine,
      placement: record.placement,
      sourcePlacementIndex: record.sourcePlacementIndex,
      support: {
        footprintStuds,
        ratio,
        status,
        supportedStuds: status === 'base' ? footprintStuds : connectedStuds,
        supportingStepIds,
      },
      warnings: stepWarnings,
    };
    earlierRecords.add(record);
    return step;
  });

  if (bom.totalParts !== records.length) {
    allWarnings.unshift(warning(
      'part-count-mismatch',
      `The frozen BOM declares ${bom.totalParts} parts but contains ${records.length} catalog placements.`,
      'error',
    ));
  }

  const chapters: AssemblyChapter[] = [];
  const perChapter = chapterSize(options.maxStepsPerChapter);
  for (let start = 0; start < steps.length; start += perChapter) {
    const chapterSteps = steps.slice(start, start + perChapter);
    const number = chapters.length + 1;
    const id = `stage-${String(number).padStart(2, '0')}`;
    const layers = [...new Set(chapterSteps.map((step) => step.placement.j))].sort((a, b) => a - b);
    for (const step of chapterSteps) {
      step.bagNumber = number;
      step.chapterId = id;
      step.chapterLabel = `Stage ${number}`;
      step.chapterNumber = number;
    }
    chapters.push({
      bagNumber: number,
      endStepNumber: chapterSteps[chapterSteps.length - 1]!.number,
      firstLayer: layers[0]!,
      id,
      label: `Stage ${number}`,
      lastLayer: layers[layers.length - 1]!,
      layers,
      number,
      startStepNumber: chapterSteps[0]!.number,
      stepCount: chapterSteps.length,
      warningCount: chapterSteps.reduce((sum, step) => sum + step.warnings.length, 0),
    });
  }

  const supportSummary: AssemblySupportSummary = {
    base: 0,
    full: 0,
    partial: 0,
    underside: 0,
    unsupported: 0,
  };
  for (const step of steps) supportSummary[step.support.status] += 1;

  return {
    chapters,
    declaredParts: bom.totalParts,
    placementOrder: steps.map((step) => step.sourcePlacementIndex),
    steps,
    supportSummary,
    totalPlacements: records.length,
    totalSteps: steps.length,
    version: ASSEMBLY_PLAN_VERSION,
    warnings: allWarnings,
  };
}

/**
 * Release boundary for anything that promises a buildable physical kit.
 *
 * Previewing an imperfect conversion is still useful, but checkout and guide
 * generation must fail closed whenever the exact frozen catalog packing has a
 * floating action or any other hard assembly-plan error.
 */
export function isAssemblyBuildable(
  bom: BillOfMaterials,
  options: AssemblyPlanOptions = {},
): boolean {
  const plan = createAssemblyPlan(bom, options);
  return (
    plan.supportSummary.unsupported === 0 &&
    !plan.steps.some((step) => step.support.status === 'unsupported') &&
    !plan.warnings.some((entry) => entry.severity === 'error')
  );
}

/** Exact catalog pieces visible after completing the zero-based step index. */
export function placementsThroughStep(
  plan: Pick<AssemblyPlan, 'steps'>,
  stepIndex: number,
): BrickPlacement[] {
  if (!Number.isFinite(stepIndex) || stepIndex < 0) return [];
  const count = Math.min(plan.steps.length, Math.floor(stepIndex) + 1);
  return plan.steps.slice(0, count).map((step) => step.placement);
}
