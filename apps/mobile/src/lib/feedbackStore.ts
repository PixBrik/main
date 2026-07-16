/**
 * Coach feedback loop. Structured feedback maps DETERMINISTICALLY onto real
 * pipeline parameters (no fake "AI learning" claims):
 *
 * - "kept too much background" / "removed part of the object" nudge the
 *   classic segmenter's threshold bias, applied on every future cutout.
 * - "wrong category → the right one" becomes a per-label override that the
 *   classifier consults before anything else on future locks.
 * - Free-text advice is logged with context and exportable as JSON — the
 *   input for the next round of engine fixes (the models themselves are
 *   frozen pretrained weights; they cannot be retrained on-device).
 *
 * Everything persists in localStorage on this device.
 */

import type { ObjectCategory } from './photoEngine/classify';

export interface FeedbackEntry {
  id: string;
  at: string;
  kind:
    | 'bg-kept-too-much'
    | 'bg-ate-object'
    | 'framing-odd'
    | 'wrong-category'
    | 'render-note'
    | 'advice';
  note?: string;
  /** For wrong-category: the label the detector produced. */
  label?: string;
  /** For wrong-category: the category the user says is correct. */
  correctedCategory?: ObjectCategory;
  /** What the app changed in response (human-readable). */
  applied: string;
}

export interface Tuning {
  /** Multiplier on the classic segmenter's background threshold. 1 = stock. */
  bgThresholdBias: number;
  /** Detector-label → user-corrected category, consulted before heuristics. */
  labelOverrides: Record<string, ObjectCategory>;
}

const FEEDBACK_KEY = 'pixbrik.coach.feedback.v1';
const TUNING_KEY = 'pixbrik.coach.tuning.v1';
const BIAS_MIN = 0.6;
const BIAS_MAX = 1.6;
const BIAS_STEP = 0.1;

function storage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // unavailable
  }
  return null;
}

function readJson<T>(key: string, fallback: T): T {
  const store = storage();
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // quota — feedback is best-effort
  }
}

export function getTuning(): Tuning {
  return readJson<Tuning>(TUNING_KEY, { bgThresholdBias: 1, labelOverrides: {} });
}

export function listFeedback(): FeedbackEntry[] {
  return readJson<FeedbackEntry[]>(FEEDBACK_KEY, []);
}

/** The label-override the classifier should honour, if the user taught one. */
export function labelOverride(label: string): ObjectCategory | null {
  const normalized = label.toLowerCase().trim();
  return getTuning().labelOverrides[normalized] ?? null;
}

/** Current segmenter threshold multiplier (1 = untouched). */
export function bgThresholdBias(): number {
  return getTuning().bgThresholdBias;
}

interface SubmitFeedback {
  kind: FeedbackEntry['kind'];
  note?: string;
  label?: string;
  correctedCategory?: ObjectCategory;
}

/**
 * Record feedback and apply its deterministic adjustment. Returns the entry
 * including a human-readable description of what actually changed.
 */
export function submitFeedback(input: SubmitFeedback): FeedbackEntry {
  const tuning = getTuning();
  let applied = 'Logged for the next engine improvement pass (no automatic knob for this).';

  if (input.kind === 'bg-kept-too-much') {
    const next = Math.min(BIAS_MAX, tuning.bgThresholdBias + BIAS_STEP);
    applied =
      next === tuning.bgThresholdBias
        ? 'Background threshold already at its maximum bias.'
        : `Background threshold bias raised ${tuning.bgThresholdBias.toFixed(1)} → ${next.toFixed(1)} — future cutouts treat borderline pixels as background more aggressively.`;
    tuning.bgThresholdBias = next;
  } else if (input.kind === 'bg-ate-object') {
    const next = Math.max(BIAS_MIN, tuning.bgThresholdBias - BIAS_STEP);
    applied =
      next === tuning.bgThresholdBias
        ? 'Background threshold already at its minimum bias.'
        : `Background threshold bias lowered ${tuning.bgThresholdBias.toFixed(1)} → ${next.toFixed(1)} — future cutouts keep borderline pixels as object more readily.`;
    tuning.bgThresholdBias = next;
  } else if (input.kind === 'wrong-category' && input.label && input.correctedCategory) {
    const normalized = input.label.toLowerCase().trim();
    tuning.labelOverrides[normalized] = input.correctedCategory;
    applied = `"${normalized}" now always builds as ${input.correctedCategory.toUpperCase()} on this device.`;
  }

  writeJson(TUNING_KEY, tuning);

  const entry: FeedbackEntry = {
    applied,
    at: new Date().toISOString(),
    correctedCategory: input.correctedCategory,
    id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    kind: input.kind,
    label: input.label,
    note: input.note?.trim() || undefined,
  };
  const entries = [entry, ...listFeedback()].slice(0, 200);
  writeJson(FEEDBACK_KEY, entries);
  return entry;
}

export function resetTuning(): void {
  writeJson(TUNING_KEY, { bgThresholdBias: 1, labelOverrides: {} });
}

/** Full export for analysis: feedback log + the tuning it produced. */
export function exportCoachData(): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), feedback: listFeedback(), tuning: getTuning() }, null, 2);
}
