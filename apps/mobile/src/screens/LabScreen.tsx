import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { InkLoader } from '../components/InkLoader';
import { ScreenFrame } from '../components/ScreenFrame';
import { isRealisticViewSupported, ThreeBrickView } from '../components/ThreeBrickView';
import {
  DEMO_MESHES,
  isLive3DConfigured,
  TRIPO_VERSIONS,
  type TripoVersionId,
} from '../lib/photoEngine/imageTo3D';
import type { Segmentation } from '../lib/photoEngine/segment';
import type { PhotoModels } from '../lib/photoEngine/voxelizePhoto';
import type { VoxelModel } from '../lib/voxelFox';
import { colors, fonts, inkAlpha, radius, spacing, type } from '../theme/tokens';

interface LabScreenProps {
  photoUri: string | null;
  segmentation: Segmentation | null;
  onBack: () => void;
}

type CandidateId = 'depth' | TripoVersionId | 'demo';

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
}

/**
 * Model lab: run the same locked photo through every available 3D engine
 * and judge the brick results side by side, with identical voxelization and
 * an identical viewer — the only variable is the generation model. Used to
 * decide which engine the product should ship with.
 */
export function LabScreen({ photoUri, segmentation, onBack }: LabScreenProps) {
  const live = isLive3DConfigured();
  const hasPhoto = !!photoUri && !!segmentation;

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
    // Local dev has no /api routes, so offer a free demo mesh to exercise
    // the lab end-to-end without a deployment or credits.
    ...(!live ? [{ id: 'demo' as const, label: 'Demo mesh', note: 'pipeline check · duck GLB', cost: 'FREE' }] : []),
  ];

  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [winner, setWinner] = useState<CandidateId | null>(null);

  const patchRun = (id: CandidateId, patch: Partial<RunState>) => {
    setRuns((current) => ({ ...current, [id]: { ...(current[id] ?? { status: 'idle' }), ...patch } }));
  };

  const run = async (candidate: Candidate) => {
    const startedAt = Date.now();
    patchRun(candidate.id, { error: undefined, progressNote: 'Starting', status: 'running' });
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
        const { buildFromMeshUrl } = await import('../lib/photoEngine/imageTo3D');
        models = await buildFromMeshUrl(DEMO_MESHES[0].url, DEMO_MESHES[0].label);
      } else {
        if (!photoUri) throw new Error('Lock a photo first');
        const { buildFromPhoto } = await import('../lib/photoEngine/imageTo3D');
        models = await buildFromPhoto(photoUri, segmentation, {
          modelVersion: candidate.id,
          onProgress: (fraction, note) =>
            patchRun(candidate.id, { progressNote: `${Math.round(fraction * 100)}% · ${note}` }),
        });
      }
      const model = models.models.efficient;
      patchRun(candidate.id, {
        bricks: model.brickCount,
        model,
        seconds: Math.round((Date.now() - startedAt) / 1000),
        status: 'done',
      });
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
                <ThreeBrickView
                  accent={colors.alarm}
                  label={`${candidate.label} brick result`}
                  model={state.model}
                />
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
              <Pressable
                accessibilityRole="button"
                disabled={!hasPhoto && candidate.id !== 'demo'}
                onPress={() => run(candidate)}
                style={({ pressed }) => [
                  styles.runButton,
                  (!hasPhoto && candidate.id !== 'demo') && styles.runDisabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.runText}>
                  {state.status === 'done' || state.status === 'failed' ? 'RUN AGAIN' : 'RUN'}
                </Text>
              </Pressable>
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
              : `Set TRIPO_MODEL_VERSION=${winner} in Vercel project settings, then redeploy (env vars only apply to new deploys).`}
          </Text>
        </View>
      ) : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
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
});
