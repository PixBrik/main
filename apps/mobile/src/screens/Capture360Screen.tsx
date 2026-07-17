import { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { InkLoader } from '../components/InkLoader';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { save360Capture } from '../lib/capture360Store';
import { pickPhoto } from '../lib/pickPhoto';
import {
  buildFromMeshUrlAllProfiles,
  generateMeshFromMultiview,
  isLive3DConfigured,
  toCompactDataUrl,
  type MultiviewShots,
} from '../lib/photoEngine/imageTo3D';
import type { PhotoModels } from '../lib/photoEngine/voxelizePhoto';
import { colors, fonts, inkAlpha, radius, spacing, type } from '../theme/tokens';

interface Capture360ScreenProps {
  onBack: () => void;
  /** Called with the finished build and the front view (for the source thumb). */
  onGenerated: (models: PhotoModels, frontUri: string) => void;
}

type ViewId = keyof MultiviewShots;
type GenerationState = 'idle' | 'generating' | 'preview' | 'preview-failed' | 'converting' | 'failed';

const VIEWS: ReadonlyArray<{ id: ViewId; label: string; hint: string; glyph: string }> = [
  { glyph: '●', hint: 'Face it straight on', id: 'front', label: 'FRONT' },
  { glyph: '◐', hint: 'Quarter-turn to its left side', id: 'left', label: 'LEFT' },
  { glyph: '○', hint: 'All the way behind it', id: 'back', label: 'BACK' },
  { glyph: '◑', hint: 'Quarter-turn to its right side', id: 'right', label: 'RIGHT' },
];
const MESH_APPROVAL_VIEWS = ['FRONT', 'RIGHT', 'BACK', 'LEFT'] as const;

/**
 * 360° capture: four photos around the object → Tripo multiview → bricks.
 * Real geometry from real photos on every side — the single-photo path has
 * to hallucinate whatever the camera didn't see; this one doesn't.
 */
export function Capture360Screen({ onBack, onGenerated }: Capture360ScreenProps) {
  const live = isLive3DConfigured();
  const [shots, setShots] = useState<Partial<MultiviewShots>>({});
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [genState, setGenState] = useState<GenerationState>('idle');
  const [progressNote, setProgressNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingMeshUrl, setPendingMeshUrl] = useState<string | null>(null);
  const [meshStills, setMeshStills] = useState<string[]>([]);
  const submitLock = useRef(false);
  const conversionLock = useRef(false);

  const shotCount = VIEWS.filter((view) => shots[view.id]).length;
  const allViewsReady = VIEWS.every((view) => !!shots[view.id]);
  const busy = genState === 'generating' || genState === 'converting';
  const canGenerate = live && allViewsReady && rightsConfirmed && !busy && !pendingMeshUrl;

  const takeShot = async (id: ViewId) => {
    if (busy || pendingMeshUrl) return;
    const uri = await pickPhoto();
    if (!uri) return;
    // Compact immediately: keeps the request body small, the persisted set
    // within localStorage quota, and the slot thumbnails cheap.
    const compact = await toCompactDataUrl(uri).catch(() => uri);
    setShots((current) => {
      const next = { ...current, [id]: compact };
      if (next.front) save360Capture(next as MultiviewShots);
      return next;
    });
  };

  const renderMeshPreview = async (meshUrl: string) => {
    setProgressNote('Rendering the raw 3D preview');
    try {
      const { snapshotGlb } = await import('../lib/photoEngine/meshSnapshot');
      const stills = await snapshotGlb(meshUrl);
      if (!stills.length) {
        throw new Error('The raw 3D preview returned no images.');
      }
      setMeshStills(stills);
      setError(null);
      setGenState('preview');
    } catch (previewError) {
      setMeshStills([]);
      setError(
        `${previewError instanceof Error ? previewError.message : 'Could not render the raw 3D preview.'} Retry the preview below; it will not start or charge for another generation.`,
      );
      setGenState('preview-failed');
    }
  };

  const generate = async () => {
    if (!canGenerate || submitLock.current) return;
    // React state updates after the event returns; this ref closes the small
    // double-tap window before a paid provider task receives its task ID.
    submitLock.current = true;
    setGenState('generating');
    setError(null);
    setProgressNote('Starting');
    try {
      const meshUrl = await generateMeshFromMultiview(shots as MultiviewShots, {
        onProgress: (fraction, note) => setProgressNote(`${Math.round(fraction * 100)}% · ${note}`),
      });
      setPendingMeshUrl(meshUrl);
      await renderMeshPreview(meshUrl);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'generation failed');
      setGenState('failed');
    } finally {
      submitLock.current = false;
    }
  };

  const approveMesh = async () => {
    if (!pendingMeshUrl || !meshStills.length || conversionLock.current || !shots.front) return;
    conversionLock.current = true;
    setGenState('converting');
    setError(null);
    setProgressNote('Converting the approved mesh into three distinct build sizes');
    try {
      const models = await buildFromMeshUrlAllProfiles(
        pendingMeshUrl,
        'your object',
        (fraction, note) => setProgressNote(`${Math.round(fraction * 100)}% · ${note}`),
      );
      onGenerated(models, shots.front);
    } catch (conversionError) {
      setError(conversionError instanceof Error ? conversionError.message : 'brick conversion failed');
      setGenState('preview');
    } finally {
      conversionLock.current = false;
    }
  };

  const discardMesh = () => {
    if (busy) return;
    setPendingMeshUrl(null);
    setMeshStills([]);
    setError(null);
    setProgressNote('');
    setGenState('idle');
  };

  const footerAction =
    genState === 'preview'
      ? approveMesh
      : genState === 'preview-failed' && pendingMeshUrl
        ? () => renderMeshPreview(pendingMeshUrl)
        : generate;
  const footerDisabled =
    busy ||
    (genState === 'preview'
      ? !meshStills.length
      : genState === 'preview-failed'
        ? !pendingMeshUrl
        : !canGenerate);
  const footerLabel =
    genState === 'generating'
      ? 'Generating the raw 3D mesh…'
      : genState === 'converting'
        ? 'Building three distinct sizes…'
        : genState === 'preview'
          ? 'Approve this mesh — build all 3 sizes'
          : genState === 'preview-failed'
            ? 'Retry raw preview — no new generation'
            : !live
              ? '3D generation unavailable on this build'
              : !shots.front
                ? 'Front view required'
                : !allViewsReady
                  ? `Add ${VIEWS.length - shotCount} remaining view${VIEWS.length - shotCount === 1 ? '' : 's'}`
                  : !rightsConfirmed
                    ? 'Confirm you own the photos'
                    : 'Use 1 paid run — generate raw 3D';

  return (
    <ScreenFrame
      accent="coral"
      eyebrow="2 / 360° capture"
      footer={
        <PrimaryButton
          disabled={footerDisabled}
          label={footerLabel}
          onPress={footerAction}
        />
      }
      onBack={onBack}
      progress={0.25}
      subtitle="Walk around the subject and shoot four real sides. For people, these views prevent the AI from inventing or mirroring a face onto the unseen head surfaces."
      title="Circle the object."
    >
      <View style={styles.grid}>
        {VIEWS.map((view) => {
          const shot = shots[view.id];
          return (
            <Pressable
              accessibilityLabel={
                shot ? `Retake the ${view.label.toLowerCase()} view` : `Shoot the ${view.label.toLowerCase()} view`
              }
              accessibilityRole="button"
              disabled={busy || !!pendingMeshUrl}
              key={view.id}
              onPress={() => takeShot(view.id)}
              style={({ pressed }) => [styles.slot, shot && styles.slotFilled, pressed && styles.pressed]}
            >
              {shot ? (
                <>
                  <Image
                    accessibilityLabel={`${view.label} view photo`}
                    resizeMode="cover"
                    source={{ uri: shot }}
                    style={styles.slotPhoto}
                  />
                  <View style={styles.slotDone}>
                    <Text style={styles.slotDoneText}>{view.label} ✓ · RETAKE</Text>
                  </View>
                </>
              ) : (
                <View style={styles.slotEmpty}>
                  <Text style={styles.slotGlyph}>{view.glyph}</Text>
                  <Text style={styles.slotLabel}>
                    {view.label}
                    {view.id === 'front' ? ' *' : ''}
                  </Text>
                  <Text style={styles.slotHint}>{view.hint}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.gridNote}>
        All four views are required. Move the camera around the subject; keep the subject still,
        at the same height and under the same lighting.
      </Text>

      {busy ? (
        <View style={styles.progress}>
          <InkLoader size={26} stage={progressNote || 'Generating'} />
          <Text style={styles.progressHint}>
            {genState === 'generating'
              ? 'The generator reads all four views at once — this takes a minute or two.'
              : 'Only the approved provider mesh is being converted; no depth or relief shortcut is used.'}
          </Text>
        </View>
      ) : null}

      {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>✕ {error}</Text> : null}

      {pendingMeshUrl ? (
        <View style={styles.previewCard}>
          <Text style={styles.previewEyebrow}>RAW 3D FROM ALL FOUR PHOTOS</Text>
          <Text style={styles.previewTitle}>Approve the shape before any bricks are built.</Text>
          <Text style={styles.previewHint}>
            Inspect FRONT, RIGHT, BACK and LEFT—especially the rear surface—before approving.
          </Text>
          {meshStills.length ? (
            <View style={styles.previewShots}>
              {meshStills.map((still, index) => {
                const view = MESH_APPROVAL_VIEWS[index] ?? `VIEW ${index + 1}`;
                return (
                  <View key={view} style={styles.previewShotWrap}>
                    <Image
                      accessibilityLabel={`Generated multiview mesh, ${view.toLowerCase()} view`}
                      resizeMode="contain"
                      source={{ uri: still }}
                      style={styles.previewShot}
                    />
                    <Text style={styles.previewShotLabel}>{view}</Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.previewHint}>
              The paid mesh is preserved. Retry its preview without starting another provider task.
            </Text>
          )}
          {meshStills.length ? (
            <Text style={styles.previewHint}>
              The button below is explicit approval. It converts this exact mesh independently at
              efficient, balanced and detailed resolutions.
            </Text>
          ) : null}
          {!busy ? (
            <Pressable
              accessibilityRole="button"
              onPress={discardMesh}
              style={({ pressed }) => [styles.discard, pressed && styles.pressed]}
            >
              <Text style={styles.discardText}>
                Discard this mesh — generating another one spends another provider run
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {!live ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            360° generation runs on the live site (the generator key lives server-side) — on this
            build the generate step will fail fast.
          </Text>
        </View>
      ) : null}

      <Pressable
        aria-checked={rightsConfirmed}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: rightsConfirmed }}
        disabled={busy || !!pendingMeshUrl}
        onPress={() => setRightsConfirmed((current) => !current)}
        style={({ pressed }) => [styles.rights, pressed && styles.pressed]}
      >
        <View style={[styles.rightsBox, rightsConfirmed && styles.rightsBoxChecked]}>
          {rightsConfirmed ? <Text style={styles.rightsCheck}>✓</Text> : null}
        </View>
        <Text style={styles.rightsText}>
          I own or have the rights to use these photos, and they don’t infringe anyone’s rights.
        </Text>
      </Pressable>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  slot: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderStyle: 'dashed',
    borderWidth: 2,
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 148,
    overflow: 'hidden',
  },
  slotFilled: {
    borderColor: colors.ink,
    borderStyle: 'solid',
  },
  pressed: {
    opacity: 0.75,
  },
  slotEmpty: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  slotGlyph: {
    color: colors.ink,
    fontSize: 22,
    lineHeight: 26,
  },
  slotLabel: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 14,
    letterSpacing: 0.4,
    marginTop: spacing.sm,
  },
  slotHint: {
    ...type.micro,
    color: inkAlpha(0.5),
    marginTop: 2,
    textAlign: 'center',
    textTransform: 'none',
  },
  slotPhoto: {
    flex: 1,
    minHeight: 118,
    width: '100%',
  },
  slotDone: {
    backgroundColor: colors.ink,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  slotDoneText: {
    color: colors.saffron,
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  gridNote: {
    ...type.body,
    color: inkAlpha(0.6),
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.md,
  },
  progress: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  progressHint: {
    ...type.body,
    color: inkAlpha(0.6),
    fontSize: 12,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  error: {
    ...type.body,
    color: colors.alarm,
    fontSize: 13,
    marginTop: spacing.md,
  },
  previewCard: {
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  previewEyebrow: {
    color: colors.saffron,
    fontFamily: fonts.extrabold,
    fontSize: 9,
    letterSpacing: 1.1,
  },
  previewTitle: {
    color: colors.white,
    fontFamily: fonts.display,
    fontSize: 17,
    lineHeight: 21,
    marginTop: spacing.xs,
  },
  previewShots: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  previewShotWrap: {
    flexBasis: '45%',
    flexGrow: 1,
  },
  previewShot: {
    aspectRatio: 1,
    borderColor: '#384158',
    borderRadius: radius.sm,
    borderWidth: 1,
    width: '100%',
  },
  previewShotLabel: {
    ...type.micro,
    color: colors.saffron,
    fontSize: 8,
    marginTop: 4,
    textAlign: 'center',
  },
  previewHint: {
    ...type.body,
    color: '#C6CDDE',
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.md,
  },
  discard: {
    borderColor: colors.saffron,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginTop: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  discardText: {
    color: colors.saffron,
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  notice: {
    backgroundColor: inkAlpha(0.08),
    borderRadius: radius.md,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  noticeText: {
    ...type.body,
    color: inkAlpha(0.72),
    fontSize: 12,
    lineHeight: 17,
  },
  rights: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    minHeight: 44,
  },
  rightsBox: {
    alignItems: 'center',
    borderColor: colors.ink,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  rightsBoxChecked: {
    backgroundColor: colors.mintDeep,
    borderColor: colors.mintDeep,
  },
  rightsCheck: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '900',
  },
  rightsText: {
    ...type.body,
    color: inkAlpha(0.66),
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
});
