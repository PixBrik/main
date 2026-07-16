import { useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { InkLoader } from '../components/InkLoader';
import { ScreenFrame } from '../components/ScreenFrame';
import { estimateBuild } from '../lib/brickify';
import { has360Capture, load360Capture } from '../lib/capture360Store';
import { hasLastCapture, loadLastCapture } from '../lib/captureStore';
import { isRealisticViewSupported, ThreeBrickView } from '../components/ThreeBrickView';
import {
  exportCoachData,
  getTuning,
  listFeedback,
  resetTuning,
  submitFeedback,
  type FeedbackEntry,
} from '../lib/feedbackStore';
import type { ObjectCategory } from '../lib/photoEngine/classify';
import {
  DEMO_MESHES,
  isLive3DConfigured,
  TRIPO_VERSIONS,
  type TripoVersionId,
} from '../lib/photoEngine/imageTo3D';
import type { Segmentation } from '../lib/photoEngine/segment';
import type { PhotoModels } from '../lib/photoEngine/voxelizePhoto';
import type { VoxelModel } from '../lib/voxelFox';
import { colors, fonts, inkAlpha, radius, saffronAlpha, spacing, type } from '../theme/tokens';

interface LabScreenProps {
  photoUri: string | null;
  segmentation: Segmentation | null;
  onBack: () => void;
  /** Rehydrate the last persisted capture into app state. */
  onRestore: (photoUri: string, segmentation: Segmentation) => void;
}

type CandidateId = 'depth' | TripoVersionId | 'meshy-6' | 'multiview' | 'demo';

/**
 * Generated meshes stay downloadable for a while after a run — persist their
 * URLs so conversion changes can be re-tested on the SAME mesh for free
 * instead of paying ~30 credits to regenerate it.
 */
const MESH_URL_KEY = 'pixbrik.lab.meshUrls.v1';

function readSavedMeshUrls(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(MESH_URL_KEY) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function persistMeshUrl(id: string, url: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(MESH_URL_KEY, JSON.stringify({ ...readSavedMeshUrls(), [id]: url }));
  } catch {
    // quota — re-convert just won't survive a reload
  }
}

interface Candidate {
  id: CandidateId;
  label: string;
  note: string;
  cost: string;
}

interface RunState {
  status: 'idle' | 'running' | 'done' | 'failed';
  progressNote?: string;
  model?: VoxelModel;
  bricks?: number;
  seconds?: number;
  error?: string;
  /** The engine's raw mesh (when the candidate produces one). */
  meshUrl?: string;
  /** Still renders of the raw mesh from three angles. */
  meshShots?: string[];
  /** What our catalog proposes for this result: parts, colours, price. */
  catalog?: { parts: number; colours: number; priceEur: number };
}

/**
 * Model lab: run the same locked photo through every available 3D engine
 * and judge the brick results side by side, with identical voxelization and
 * an identical viewer — the only variable is the generation model. Used to
 * decide which engine the product should ship with.
 */
export function LabScreen({ photoUri, segmentation, onBack, onRestore }: LabScreenProps) {
  const live = isLive3DConfigured();
  const hasPhoto = !!photoUri && !!segmentation;
  const [restorable] = useState(() => hasLastCapture());
  const [has360] = useState(() => has360Capture());
  const [savedMeshUrls, setSavedMeshUrls] = useState<Record<string, string>>(() => readSavedMeshUrls());

  const candidates: Candidate[] = [
    {
      id: 'depth',
      label: 'On-device depth',
      note: 'silhouette + measured depth · ships today',
      cost: 'FREE',
    },
    ...TRIPO_VERSIONS.map((version) => ({
      id: version.id,
      label: version.label,
      note: `image→3D mesh · ${version.note}`,
      cost: '≈30 CR',
    })),
    {
      id: 'meshy-6' as const,
      label: 'Meshy 6',
      note: 'image→3D mesh · your Meshy account',
      cost: 'MESHY CR',
    },
    {
      id: 'multiview' as const,
      label: 'Tripo 360° multiview',
      note: has360
        ? 'your last 360° capture · real geometry from 4 views'
        : 'needs a 360° set — Create a build → 360° capture',
      cost: '≈30 CR',
    },
    // Free pipeline check: a known-good mesh through the same conversion —
    // shows the raw-3D + brick-proposal comparison without spending credits.
    { id: 'demo' as const, label: 'Demo mesh', note: 'pipeline check · duck GLB · no photo needed', cost: 'FREE' },
  ];

  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [winner, setWinner] = useState<CandidateId | null>(null);

  const patchRun = (id: CandidateId, patch: Partial<RunState>) => {
    setRuns((current) => ({ ...current, [id]: { ...(current[id] ?? { status: 'idle' }), ...patch } }));
  };

  /** Render the raw mesh to stills in the background — never blocks the run. */
  const snapshotMesh = (id: CandidateId, meshUrl: string) => {
    patchRun(id, { meshUrl });
    persistMeshUrl(id, meshUrl);
    setSavedMeshUrls((current) => ({ ...current, [id]: meshUrl }));
    void import('../lib/photoEngine/meshSnapshot')
      .then(({ snapshotGlb }) => snapshotGlb(meshUrl))
      .then((shots) => {
        if (shots.length) patchRun(id, { meshShots: shots });
      })
      .catch(() => {
        // No raw view is not a failed run — the brick result still stands.
      });
  };

  /** Shared completion: judge at 'balanced' and price against the catalog. */
  const finishRun = (id: CandidateId, models: PhotoModels, startedAt: number) => {
    const model = models.models.balanced;
    let catalog: RunState['catalog'];
    try {
      // Hollow = the standard kit buyers are actually quoted.
      const estimate = estimateBuild(model, colors.alarm);
      catalog = {
        colours: estimate.hollow.colorCount,
        parts: estimate.hollow.parts,
        priceEur: estimate.hollow.bundleEur,
      };
    } catch {
      catalog = undefined;
    }
    patchRun(id, {
      bricks: model.brickCount,
      catalog,
      model,
      seconds: Math.round((Date.now() - startedAt) / 1000),
      status: 'done',
    });
  };

  /**
   * Free re-run of ONLY the mesh→brick conversion on the candidate's last
   * generated mesh — the loop for judging conversion improvements without
   * spending generation credits.
   */
  const reconvert = async (candidate: Candidate) => {
    const meshUrl = savedMeshUrls[candidate.id];
    if (!meshUrl) return;
    const startedAt = Date.now();
    patchRun(candidate.id, {
      catalog: undefined,
      error: undefined,
      meshShots: undefined,
      meshUrl: undefined,
      progressNote: 'Re-converting the saved mesh',
      status: 'running',
    });
    try {
      snapshotMesh(candidate.id, meshUrl);
      const { buildFromMeshUrlOne } = await import('../lib/photoEngine/imageTo3D');
      const models = await buildFromMeshUrlOne(meshUrl, 'your object', 'balanced');
      finishRun(candidate.id, models, startedAt);
    } catch (error) {
      patchRun(candidate.id, {
        error: `${error instanceof Error ? error.message : 'failed'} — the saved mesh may have expired; RUN regenerates it`,
        seconds: Math.round((Date.now() - startedAt) / 1000),
        status: 'failed',
      });
    }
  };

  const run = async (candidate: Candidate) => {
    const startedAt = Date.now();
    patchRun(candidate.id, {
      catalog: undefined,
      error: undefined,
      meshShots: undefined,
      meshUrl: undefined,
      progressNote: 'Starting',
      status: 'running',
    });
    try {
      let models: PhotoModels;
      if (candidate.id === 'depth') {
        if (!photoUri || !segmentation) throw new Error('Lock a photo first');
        if (segmentation.depth === undefined) {
          patchRun(candidate.id, { progressNote: 'Measuring depth' });
          const { estimateDepthGrid, isDepthSupported } = await import('../lib/photoEngine/depth');
          segmentation.depth = isDepthSupported()
            ? await estimateDepthGrid(photoUri, segmentation.region, segmentation.grid)
            : null;
        }
        patchRun(candidate.id, { progressNote: 'Building bricks' });
        const { buildPhotoModels } = await import('../lib/photoEngine/voxelizePhoto');
        models = buildPhotoModels(segmentation, 'lab depth', 'volume', 'natural', {
          category: segmentation.categoryLabel,
          face: segmentation.face ?? null,
          preserveFeatures: segmentation.preserveFeatures ?? false,
        });
      } else if (candidate.id === 'demo') {
        patchRun(candidate.id, { progressNote: 'Voxelizing demo mesh' });
        snapshotMesh(candidate.id, DEMO_MESHES[0].url);
        const { buildFromMeshUrlOne } = await import('../lib/photoEngine/imageTo3D');
        models = await buildFromMeshUrlOne(DEMO_MESHES[0].url, DEMO_MESHES[0].label, 'balanced');
      } else if (candidate.id === 'multiview') {
        const shots = load360Capture();
        if (!shots) throw new Error('Capture a 360° set first (Create a build → 360° capture)');
        const { buildFromMultiview } = await import('../lib/photoEngine/imageTo3D');
        models = await buildFromMultiview(shots, {
          onMeshUrl: (meshUrl) => snapshotMesh(candidate.id, meshUrl),
          onProgress: (fraction, note) =>
            patchRun(candidate.id, { progressNote: `${Math.round(fraction * 100)}% · ${note}` }),
        });
      } else {
        if (!photoUri) throw new Error('Lock a photo first');
        const { buildFromPhoto } = await import('../lib/photoEngine/imageTo3D');
        models = await buildFromPhoto(photoUri, segmentation, {
          ...(candidate.id === 'meshy-6'
            ? { engine: 'meshy' as const }
            : { modelVersion: candidate.id }),
          onMeshUrl: (meshUrl) => snapshotMesh(candidate.id, meshUrl),
          onProgress: (fraction, note) =>
            patchRun(candidate.id, { progressNote: `${Math.round(fraction * 100)}% · ${note}` }),
        });
      }
      finishRun(candidate.id, models, startedAt);
    } catch (error) {
      patchRun(candidate.id, {
        error: error instanceof Error ? error.message : 'failed',
        seconds: Math.round((Date.now() - startedAt) / 1000),
        status: 'failed',
      });
    }
  };

  return (
    <ScreenFrame
      eyebrow="Lab / 3D engine comparison"
      onBack={onBack}
      subtitle={
        hasPhoto
          ? 'Same locked photo, different 3D engines, identical brick conversion and viewer. Run the candidates and judge with your eyes.'
          : 'Lock a photo first (Create a build → scan), then come back — every engine runs on the same locked photo so the comparison is fair.'
      }
      title="Model lab."
    >
      {!hasPhoto && restorable ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            const saved = loadLastCapture();
            if (saved) onRestore(saved.photoUri, saved.segmentation);
          }}
          style={({ pressed }) => [styles.restore, pressed && styles.pressed]}
        >
          <Text style={styles.restoreTitle}>RESTORE LAST LOCKED PHOTO →</Text>
          <Text style={styles.restoreBody}>
            Your most recent locked capture is saved on this device — one tap brings it back so
            every engine can run on it.
          </Text>
        </Pressable>
      ) : null}

      {!live ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            Tripo engines run on the deployed site (the API key lives server-side) — on this build
            those cards will fail fast. The free candidates still run.
          </Text>
        </View>
      ) : null}

      {candidates.map((candidate) => {
        const state = runs[candidate.id] ?? { status: 'idle' as const };
        const isWinner = winner === candidate.id;
        return (
          <View key={candidate.id} style={[styles.card, isWinner && styles.cardWinner]}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleBlock}>
                <Text style={styles.cardTitle}>{candidate.label.toUpperCase()}</Text>
                <Text style={styles.cardNote}>{candidate.note}</Text>
              </View>
              <Text style={styles.cardCost}>{candidate.cost}</Text>
            </View>

            {state.status === 'done' && state.model && isRealisticViewSupported ? (
              <>
                {state.meshShots ? (
                  <>
                    <Text style={styles.sectionTag}>RAW 3D FROM THE ENGINE</Text>
                    <View style={styles.shotRow}>
                      {state.meshShots.map((shot, index) => (
                        <Image
                          accessibilityLabel={`${candidate.label} raw mesh, view ${index + 1}`}
                          key={index}
                          resizeMode="cover"
                          source={{ uri: shot }}
                          style={styles.shot}
                        />
                      ))}
                    </View>
                  </>
                ) : state.meshUrl ? (
                  <Text style={styles.sectionNote}>Rendering the raw 3D views…</Text>
                ) : (
                  <Text style={styles.sectionNote}>
                    This engine builds straight from the photo — no intermediate mesh to show.
                  </Text>
                )}

                <Text style={styles.sectionTag}>OUR BRICK PROPOSAL</Text>
                <ThreeBrickView
                  accent={colors.alarm}
                  label={`${candidate.label} brick result`}
                  model={state.model}
                />
                {state.catalog ? (
                  <Text style={styles.catalogRow}>
                    STANDARD KIT: {state.catalog.parts.toLocaleString('en-US')} PARTS ·{' '}
                    {state.catalog.colours} COLOURS · ≈€{state.catalog.priceEur.toFixed(0)}
                  </Text>
                ) : null}
                <View style={styles.statsRow}>
                  <Text style={styles.stat}>{state.bricks?.toLocaleString('en-US')} BRICKS</Text>
                  <Text style={styles.stat}>{state.seconds}s</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setWinner(candidate.id)}
                    style={({ pressed }) => [styles.winnerButton, isWinner && styles.winnerButtonActive, pressed && styles.pressed]}
                  >
                    <Text style={[styles.winnerText, isWinner && styles.winnerTextActive]}>
                      {isWinner ? 'WINNER ✓' : 'PICK AS WINNER'}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : state.status === 'running' ? (
              <View style={styles.running}>
                <InkLoader size={22} stage={state.progressNote ?? 'Working'} />
              </View>
            ) : state.status === 'failed' ? (
              <Text style={styles.error}>✕ {state.error}</Text>
            ) : null}

            {state.status !== 'running' ? (
              (() => {
                const blocked =
                  candidate.id === 'demo'
                    ? false
                    : candidate.id === 'multiview'
                      ? !has360
                      : !hasPhoto;
                const savedMesh = candidate.id !== 'depth' ? savedMeshUrls[candidate.id] : undefined;
                return (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      disabled={blocked}
                      onPress={() => run(candidate)}
                      style={({ pressed }) => [
                        styles.runButton,
                        blocked && styles.runDisabled,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.runText}>
                        {state.status === 'done' || state.status === 'failed' ? 'RUN AGAIN' : 'RUN'}
                      </Text>
                    </Pressable>
                    {savedMesh ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => reconvert(candidate)}
                        style={({ pressed }) => [styles.reconvertButton, pressed && styles.pressed]}
                      >
                        <Text style={styles.reconvertText}>
                          RE-CONVERT LAST MESH · FREE (no new generation)
                        </Text>
                      </Pressable>
                    ) : null}
                  </>
                );
              })()
            ) : null}
          </View>
        );
      })}

      {winner ? (
        <View style={styles.verdict}>
          <Text style={styles.verdictTitle}>SHIP IT</Text>
          <Text style={styles.verdictText}>
            {winner === 'depth'
              ? 'Winner is the free on-device pipeline — no server change needed; consider hiding the True-3D path.'
              : winner === 'multiview'
                ? 'Winner is 360° multiview — steer buyers to the 360° capture mode; no server change needed.'
                : winner === 'meshy-6'
                  ? 'Winner is Meshy 6 — the customer True-3D path already prefers Meshy when MESHY_API_KEY is set on the server; nothing else to change.'
                  : `Set TRIPO_MODEL_VERSION=${winner} in Vercel project settings, then redeploy (env vars only apply to new deploys).`}
          </Text>
        </View>
      ) : null}

      <Coach detectedLabel={segmentation?.categoryLabel ?? null} />
    </ScreenFrame>
  );
}

const CATEGORY_CHOICES: ObjectCategory[] = ['portrait', 'person', 'animal', 'vehicle', 'building', 'plant', 'food', 'object'];

/**
 * Coach: structured feedback that adjusts real pipeline parameters
 * immediately, plus a free-advice log for the next engineering pass.
 */
function Coach({ detectedLabel }: { detectedLabel: string | null }) {
  const [entries, setEntries] = useState<FeedbackEntry[]>(() => listFeedback());
  const [lastApplied, setLastApplied] = useState<string | null>(null);
  const [advice, setAdvice] = useState('');
  const [wrongLabel, setWrongLabel] = useState('');
  const [pickingCategory, setPickingCategory] = useState(false);
  const tuning = getTuning();

  const record = (input: Parameters<typeof submitFeedback>[0]) => {
    const entry = submitFeedback(input);
    setEntries(listFeedback());
    setLastApplied(entry.applied);
  };

  const exportData = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const blob = new Blob([exportCoachData()], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'pixbrik-coach-feedback.json';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  return (
    <View style={styles.coach}>
      <Text style={styles.coachTitle}>COACH</Text>
      <Text style={styles.coachIntro}>
        Structured feedback changes the pipeline immediately on this device; written advice is
        logged with context and exported for the next engine improvement. The AI models themselves
        are frozen — honest limits.
      </Text>

      <Text style={styles.coachLabel}>BACKGROUND REMOVAL</Text>
      <View style={styles.coachRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => record({ kind: 'bg-kept-too-much' })}
          style={({ pressed }) => [styles.coachChip, pressed && styles.pressed]}
        >
          <Text style={styles.coachChipText}>KEPT TOO MUCH BACKGROUND</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => record({ kind: 'bg-ate-object' })}
          style={({ pressed }) => [styles.coachChip, pressed && styles.pressed]}
        >
          <Text style={styles.coachChipText}>REMOVED PART OF THE OBJECT</Text>
        </Pressable>
      </View>
      <Text style={styles.coachMeta}>
        Current threshold bias: {tuning.bgThresholdBias.toFixed(1)}× (1.0 = stock)
      </Text>

      <Text style={styles.coachLabel}>WRONG CATEGORY</Text>
      <TextInput
        accessibilityLabel="The label that was tagged wrong"
        onChangeText={setWrongLabel}
        placeholder={detectedLabel ? `Label to correct (e.g. ${detectedLabel.toLowerCase()})` : 'Label to correct (e.g. object)'}
        placeholderTextColor={inkAlpha(0.45)}
        style={styles.coachInput}
        value={wrongLabel}
      />
      {pickingCategory ? (
        <View style={styles.coachRowWrap}>
          {CATEGORY_CHOICES.map((category) => (
            <Pressable
              accessibilityRole="button"
              key={category}
              onPress={() => {
                record({ correctedCategory: category, kind: 'wrong-category', label: wrongLabel || detectedLabel || 'object' });
                setPickingCategory(false);
              }}
              style={({ pressed }) => [styles.coachChip, pressed && styles.pressed]}
            >
              <Text style={styles.coachChipText}>{category.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => setPickingCategory(true)}
          style={({ pressed }) => [styles.coachChip, pressed && styles.pressed]}
        >
          <Text style={styles.coachChipText}>IT SHOULD BE… →</Text>
        </Pressable>
      )}

      <Text style={styles.coachLabel}>ADVICE FOR THIS KIND OF PHOTO</Text>
      <TextInput
        accessibilityLabel="Free-form advice"
        multiline
        onChangeText={setAdvice}
        placeholder="e.g. This render beat the others because the face survived — always preserve eye contrast on portraits."
        placeholderTextColor={inkAlpha(0.45)}
        style={[styles.coachInput, styles.coachTextarea]}
        value={advice}
      />
      <Pressable
        accessibilityRole="button"
        disabled={!advice.trim()}
        onPress={() => {
          record({ kind: 'advice', note: advice });
          setAdvice('');
        }}
        style={({ pressed }) => [styles.coachSubmit, !advice.trim() && styles.coachDisabled, pressed && styles.pressed]}
      >
        <Text style={styles.coachSubmitText}>LOG ADVICE</Text>
      </Pressable>

      {lastApplied ? (
        <View style={styles.appliedNote}>
          <Text style={styles.appliedText}>→ {lastApplied}</Text>
        </View>
      ) : null}

      {entries.length ? (
        <>
          <Text style={styles.coachLabel}>HISTORY ({entries.length})</Text>
          {entries.slice(0, 6).map((entry) => (
            <View key={entry.id} style={styles.historyRow}>
              <Text style={styles.historyKind}>{entry.kind.replace(/-/g, ' ').toUpperCase()}</Text>
              <Text numberOfLines={2} style={styles.historyText}>
                {entry.note ?? entry.applied}
              </Text>
            </View>
          ))}
          <View style={styles.coachRow}>
            <Pressable accessibilityRole="button" onPress={exportData} style={({ pressed }) => [styles.coachChip, pressed && styles.pressed]}>
              <Text style={styles.coachChipText}>EXPORT JSON</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                resetTuning();
                setLastApplied('Tuning reset to stock (feedback history kept).');
              }}
              style={({ pressed }) => [styles.coachChip, pressed && styles.pressed]}
            >
              <Text style={styles.coachChipText}>RESET TUNING</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  restore: {
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    padding: spacing.lg,
  },
  restoreTitle: {
    color: colors.saffron,
    fontFamily: fonts.display,
    fontSize: 14,
    letterSpacing: 0.3,
  },
  restoreBody: {
    ...type.body,
    color: saffronAlpha(0.75),
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  notice: {
    backgroundColor: inkAlpha(0.08),
    borderRadius: radius.md,
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  noticeText: {
    ...type.body,
    color: inkAlpha(0.72),
    fontSize: 12,
    lineHeight: 17,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    padding: spacing.lg,
  },
  cardWinner: {
    borderColor: colors.ink,
    borderWidth: 3,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  cardTitleBlock: {
    flex: 1,
  },
  cardTitle: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 16,
    letterSpacing: -0.3,
  },
  cardNote: {
    ...type.micro,
    color: inkAlpha(0.55),
    marginTop: 2,
    textTransform: 'none',
  },
  cardCost: {
    color: colors.ink,
    fontFamily: fonts.extrabold,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  sectionTag: {
    ...type.micro,
    color: inkAlpha(0.5),
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  sectionNote: {
    ...type.body,
    color: inkAlpha(0.6),
    fontSize: 12,
    lineHeight: 17,
    marginBottom: spacing.sm,
  },
  shotRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  shot: {
    aspectRatio: 460 / 400,
    backgroundColor: '#17130A',
    borderRadius: radius.md,
    flex: 1,
  },
  catalogRow: {
    color: colors.ink,
    fontFamily: fonts.extrabold,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.6,
    marginTop: spacing.md,
  },
  statsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  stat: {
    color: colors.ink,
    fontFamily: fonts.extrabold,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.6,
  },
  winnerButton: {
    borderColor: colors.ink,
    borderRadius: radius.pill,
    borderWidth: 2,
    marginLeft: 'auto',
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  winnerButtonActive: {
    backgroundColor: colors.ink,
  },
  winnerText: {
    color: colors.ink,
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  winnerTextActive: {
    color: colors.saffron,
  },
  running: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  error: {
    ...type.body,
    color: colors.alarm,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  runButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 44,
  },
  runDisabled: {
    opacity: 0.35,
  },
  runText: {
    color: colors.saffron,
    fontFamily: fonts.display,
    fontSize: 13,
    letterSpacing: 0.4,
  },
  reconvertButton: {
    alignItems: 'center',
    borderColor: colors.ink,
    borderRadius: radius.md,
    borderWidth: 2,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 44,
  },
  reconvertText: {
    color: colors.ink,
    fontFamily: fonts.extrabold,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  pressed: {
    transform: [{ scale: 0.97 }],
  },
  verdict: {
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    marginBottom: spacing.xl,
    padding: spacing.lg,
  },
  verdictTitle: {
    color: colors.saffron,
    fontFamily: fonts.display,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  verdictText: {
    ...type.body,
    color: colors.white,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.sm,
  },
  coach: {
    borderTopColor: inkAlpha(0.2),
    borderTopWidth: 2,
    marginTop: spacing.md,
    paddingTop: spacing.xl,
  },
  coachTitle: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 18,
    letterSpacing: -0.3,
  },
  coachIntro: {
    ...type.body,
    color: inkAlpha(0.66),
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  coachLabel: {
    ...type.micro,
    color: inkAlpha(0.55),
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  coachRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  coachRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  coachChip: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  coachChipText: {
    color: colors.ink,
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  coachMeta: {
    ...type.micro,
    color: inkAlpha(0.45),
    marginTop: spacing.sm,
    textTransform: 'none',
  },
  coachInput: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 13,
    marginBottom: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  coachTextarea: {
    minHeight: 88,
    paddingTop: spacing.md,
    textAlignVertical: 'top',
  },
  coachSubmit: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    justifyContent: 'center',
    minHeight: 44,
  },
  coachDisabled: {
    opacity: 0.35,
  },
  coachSubmitText: {
    color: colors.saffron,
    fontFamily: fonts.display,
    fontSize: 12,
    letterSpacing: 0.4,
  },
  appliedNote: {
    backgroundColor: inkAlpha(0.08),
    borderRadius: radius.md,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  appliedText: {
    ...type.body,
    color: colors.ink,
    fontSize: 12,
    lineHeight: 17,
  },
  historyRow: {
    borderBottomColor: inkAlpha(0.1),
    borderBottomWidth: 1,
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
  },
  historyKind: {
    ...type.micro,
    color: inkAlpha(0.5),
    fontSize: 8,
  },
  historyText: {
    ...type.body,
    color: inkAlpha(0.8),
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
});
