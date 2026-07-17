import { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { InkLoader } from '../components/InkLoader';
import { PrimaryButton } from '../components/PrimaryButton';
import { RawMeshView, isInteractiveRawMeshViewSupported } from '../components/RawMeshView';
import { ScreenFrame } from '../components/ScreenFrame';
import { save360Capture } from '../lib/capture360Store';
import { pickPhoto } from '../lib/pickPhoto';
import {
  buildFromMeshUrlAllProfiles,
  generateBestMeshFromMultiview,
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
  { glyph: '◐', hint: 'Turn the subject to its left', id: 'left', label: 'LEFT' },
  { glyph: '○', hint: 'Photograph the back', id: 'back', label: 'BACK' },
  { glyph: '◑', hint: 'Turn the subject to its right', id: 'right', label: 'RIGHT' },
];
const MESH_APPROVAL_VIEWS = ['FRONT', 'RIGHT', 'BACK', 'LEFT'] as const;

function customerGenerationNote(note: string): string {
  if (/preparing/i.test(note)) return 'Preparing all four photos';
  if (/uploading/i.test(note)) return 'Uploading the four views securely';
  if (/resuming/i.test(note)) return 'Resuming your saved 3D model';
  if (/rejected|trying/i.test(note)) return 'Switching to the backup 3D engine';
  return note;
}

/**
 * True 3D capture: four photos → the best configured multiview provider → bricks.
 * Real geometry from real photos on every side — the single-photo path has
 * to hallucinate whatever the camera didn't see; this one doesn't.
 */
export function Capture360Screen({ onBack, onGenerated }: Capture360ScreenProps) {
  const live = isLive3DConfigured();
  const [shots, setShots] = useState<Partial<MultiviewShots>>({});
  const [activeViewId, setActiveViewId] = useState<ViewId>('front');
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [genState, setGenState] = useState<GenerationState>('idle');
  const [progressNote, setProgressNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingMeshUrl, setPendingMeshUrl] = useState<string | null>(null);
  const [meshStills, setMeshStills] = useState<string[]>([]);
  const [meshPreviewReady, setMeshPreviewReady] = useState(false);
  const shotsRef = useRef<Partial<MultiviewShots>>({});
  const photoPickerLock = useRef(false);
  const submitLock = useRef(false);
  const conversionLock = useRef(false);

  const shotCount = VIEWS.filter((view) => shots[view.id]).length;
  const allViewsReady = VIEWS.every((view) => !!shots[view.id]);
  const activeViewIndex = Math.max(0, VIEWS.findIndex((view) => view.id === activeViewId));
  const activeView = VIEWS[activeViewIndex]!;
  const activeShot = shots[activeView.id];
  const busy = genState === 'generating' || genState === 'converting';
  const canGenerate = live && allViewsReady && rightsConfirmed && !busy && !pendingMeshUrl;

  const takeShot = async (id: ViewId) => {
    if (busy || pendingMeshUrl || photoPickerLock.current) return;
    photoPickerLock.current = true;
    try {
      const uri = await pickPhoto();
      if (!uri) return;
      // Compact immediately: keeps the request body small, the persisted set
      // within localStorage quota, and the slot thumbnails cheap.
      const compact = await toCompactDataUrl(uri).catch(() => uri);
      const next = { ...shotsRef.current, [id]: compact };
      shotsRef.current = next;
      setShots(next);
      if (next.front) save360Capture(next as MultiviewShots);
      const nextMissing = VIEWS.find((view) => !next[view.id]);
      if (nextMissing) setActiveViewId(nextMissing.id);
    } finally {
      photoPickerLock.current = false;
    }
  };

  const renderMeshPreview = async (meshUrl: string) => {
    setProgressNote('Rendering the raw 3D preview');
    if (isInteractiveRawMeshViewSupported) {
      setError(null);
      setGenState('preview');
    }
    try {
      const { snapshotGlb } = await import('../lib/photoEngine/meshSnapshot');
      const stills = await snapshotGlb(meshUrl);
      if (!stills.length) {
        throw new Error('The raw 3D preview returned no images.');
      }
      setMeshStills(stills);
      setMeshPreviewReady(true);
      setError(null);
      if (!conversionLock.current) setGenState('preview');
    } catch (previewError) {
      setMeshStills([]);
      if (!isInteractiveRawMeshViewSupported) {
        setError(
          `${previewError instanceof Error ? previewError.message : 'Could not render the raw 3D preview.'} Retry the preview below; it will not start or charge for another generation.`,
        );
        if (!conversionLock.current) setGenState('preview-failed');
      }
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
      const meshUrl = await generateBestMeshFromMultiview(shots as MultiviewShots, {
        onProgress: (fraction, note) =>
          setProgressNote(`${Math.round(fraction * 100)}% · ${customerGenerationNote(note)}`),
      });
      setPendingMeshUrl(meshUrl);
      setMeshPreviewReady(false);
      void renderMeshPreview(meshUrl);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'generation failed');
      setGenState('failed');
    } finally {
      submitLock.current = false;
    }
  };

  const approveMesh = async () => {
    if (!pendingMeshUrl || !meshPreviewReady || conversionLock.current || !shots.front) return;
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
    setMeshPreviewReady(false);
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
      ? !meshPreviewReady
      : genState === 'preview-failed'
        ? !pendingMeshUrl
        : !canGenerate);
  const footerLabel =
    genState === 'generating'
      ? 'Generating the raw 3D mesh…'
      : genState === 'converting'
        ? 'Building three distinct sizes…'
        : genState === 'preview'
          ? meshPreviewReady
            ? 'Approve this 3D model — build all 3 sizes'
            : 'Opening your rotatable 3D model…'
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
      eyebrow="True 3D · guided capture"
      footer={
        <PrimaryButton
          disabled={footerDisabled}
          label={footerLabel}
          onPress={footerAction}
        />
      }
      onBack={onBack}
      progress={0.2 + shotCount * 0.075}
      subtitle="Add one clear photo from each side. Keep the subject centered and the distance unchanged; we combine the four views into one complete model."
      title="Show every side."
    >
      <View style={styles.captureCard}>
        <View style={styles.captureMeta}>
          <Text style={styles.captureStep}>ANGLE {activeViewIndex + 1} OF {VIEWS.length}</Text>
          <Text style={styles.captureCount}>{shotCount} / {VIEWS.length} READY</Text>
        </View>

        <View accessibilityLabel="Required photo angles" style={styles.angleTabs}>
          {VIEWS.map((view, index) => {
            const done = !!shots[view.id];
            const selected = view.id === activeViewId;
            return (
              <Pressable
                accessibilityLabel={`${view.label.toLowerCase()} view${done ? ', ready' : ', missing'}`}
                accessibilityRole="button"
                disabled={busy || !!pendingMeshUrl}
                key={view.id}
                onPress={() => setActiveViewId(view.id)}
                style={({ pressed }) => [
                  styles.angleTab,
                  selected && styles.angleTabActive,
                  done && !selected && styles.angleTabDone,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.angleNumber, selected && styles.angleNumberActive]}>
                  {done ? '✓' : index + 1}
                </Text>
                <Text style={[styles.angleLabel, selected && styles.angleLabelActive]}>{view.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityLabel={activeShot ? `Retake the ${activeView.label.toLowerCase()} view` : `Add the ${activeView.label.toLowerCase()} view`}
          accessibilityRole="button"
          disabled={busy || !!pendingMeshUrl}
          onPress={() => takeShot(activeView.id)}
          style={({ pressed }) => [styles.focusCapture, activeShot && styles.focusCaptureFilled, pressed && styles.pressed]}
        >
          {activeShot ? (
            <Image
              accessibilityLabel={`${activeView.label} view photo`}
              resizeMode="cover"
              source={{ uri: activeShot }}
              style={styles.focusPhoto}
            />
          ) : (
            <View style={styles.captureGuide}>
              <View style={styles.guideFrame}>
                <Text style={styles.guideGlyph}>{activeView.glyph}</Text>
                <View style={styles.guideCrosshair} />
              </View>
              <Text style={styles.guideAction}>ADD {activeView.label} PHOTO</Text>
              <Text style={styles.guideHint}>{activeView.hint}</Text>
            </View>
          )}
          {activeShot ? (
            <View style={styles.retakeBand}>
              <View>
                <Text style={styles.retakeTitle}>{activeView.label} READY</Text>
                <Text style={styles.retakeHint}>Tap the image to replace it</Text>
              </View>
              <Text style={styles.retakeAction}>RETAKE</Text>
            </View>
          ) : null}
        </Pressable>

        <Text style={styles.captureTip}>
          {activeView.id === 'back'
            ? 'The back photo is essential for people: include the hair and shoulders so the model never mirrors the face.'
            : 'Use the same framing, lighting and subject position in every view. Plain backgrounds work best.'}
        </Text>
      </View>

      {allViewsReady ? (
        <View style={styles.readyBanner}>
          <Text style={styles.readyTitle}>ALL FOUR SIDES CAPTURED</Text>
          <Text style={styles.readyText}>Review any angle above, confirm the photo rights, then create the 3D model.</Text>
        </View>
      ) : null}

      {busy ? (
        <View style={styles.progress}>
          <InkLoader size={26} stage={progressNote || 'Generating'} />
          <Text style={styles.progressHint}>
            {genState === 'generating'
              ? 'The generator reads all four views at once — this takes a minute or two.'
              : 'Only the 3D model you approved is being converted; no depth or relief shortcut is used.'}
          </Text>
        </View>
      ) : null}

      {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>✕ {error}</Text> : null}

      {pendingMeshUrl ? (
        <View style={styles.previewCard}>
          <Text style={styles.previewEyebrow}>YOUR GENERATED 3D MODEL</Text>
          <Text style={styles.previewTitle}>Turn it around before we build it.</Text>
          <Text style={styles.previewHint}>
            Drag the model to inspect every surface, especially the back. Approve only when its shape and appearance feel true to your photos.
          </Text>
          <View style={styles.interactivePreview}>
            <RawMeshView
              fallbackImageUri={meshStills[0]}
              label="Generated raw 3D model from four photos"
              modelUrl={pendingMeshUrl}
              onError={(message) => {
                if (conversionLock.current) return;
                if (meshStills.length) return;
                setMeshPreviewReady(false);
                setError(`${message} Retry this saved model below; no new generation will be started.`);
                setGenState('preview-failed');
              }}
              onReady={() => {
                setMeshPreviewReady(true);
                setError(null);
                if (!conversionLock.current) setGenState('preview');
              }}
            />
          </View>
          {meshStills.length ? (
            <View>
              <Text style={styles.stillLabel}>QUICK ANGLE CHECK</Text>
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
            </View>
          ) : (
            <Text style={styles.previewHint}>
              Opening your saved 3D model. This does not start another paid generation.
            </Text>
          )}
          {meshStills.length ? (
            <Text style={styles.previewHint}>
              Approval converts this exact model into efficient, balanced and detailed brick builds.
            </Text>
          ) : null}
          {!busy ? (
            <Pressable
              accessibilityRole="button"
              onPress={discardMesh}
              style={({ pressed }) => [styles.discard, pressed && styles.pressed]}
            >
              <Text style={styles.discardText}>
                Discard this model — generating another one spends another paid run
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
  captureCard: {
    backgroundColor: colors.white,
    borderColor: inkAlpha(0.12),
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  captureMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  captureStep: {
    ...type.micro,
    color: colors.ink,
  },
  captureCount: {
    ...type.micro,
    color: inkAlpha(0.48),
    fontVariant: ['tabular-nums'],
  },
  angleTabs: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  angleTab: {
    alignItems: 'center',
    backgroundColor: inkAlpha(0.06),
    borderColor: 'transparent',
    borderRadius: radius.sm,
    borderWidth: 1.5,
    flex: 1,
    minHeight: 58,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  angleTabActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  angleTabDone: {
    backgroundColor: colors.saffron,
    borderColor: colors.ink,
  },
  angleNumber: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 14,
    textAlign: 'center',
  },
  angleNumberActive: {
    color: colors.saffron,
  },
  angleLabel: {
    color: inkAlpha(0.58),
    fontFamily: fonts.extrabold,
    fontSize: 8,
    letterSpacing: 0.6,
    marginTop: 3,
  },
  angleLabelActive: {
    color: colors.white,
  },
  focusCapture: {
    backgroundColor: inkAlpha(0.04),
    borderColor: colors.ink,
    borderRadius: radius.md,
    borderStyle: 'dashed',
    borderWidth: 2,
    overflow: 'hidden',
  },
  focusCaptureFilled: {
    borderStyle: 'solid',
  },
  focusPhoto: {
    aspectRatio: 1,
    width: '100%',
  },
  captureGuide: {
    alignItems: 'center',
    aspectRatio: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    width: '100%',
  },
  guideFrame: {
    alignItems: 'center',
    aspectRatio: 0.82,
    borderColor: inkAlpha(0.28),
    borderRadius: radius.pill,
    borderStyle: 'dashed',
    borderWidth: 2,
    justifyContent: 'center',
    maxHeight: 190,
    width: '42%',
  },
  guideGlyph: {
    color: colors.ink,
    fontSize: 40,
    lineHeight: 44,
  },
  guideCrosshair: {
    borderColor: colors.alarm,
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 16,
    marginTop: spacing.sm,
    width: 16,
  },
  guideAction: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 16,
    marginTop: spacing.lg,
  },
  guideHint: {
    ...type.body,
    color: inkAlpha(0.55),
    fontSize: 12,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  retakeBand: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retakeTitle: {
    color: colors.saffron,
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  retakeHint: {
    color: 'rgba(255,255,255,0.62)',
    fontFamily: fonts.semibold,
    fontSize: 9,
    marginTop: 2,
  },
  retakeAction: {
    color: colors.white,
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  captureTip: {
    ...type.body,
    color: inkAlpha(0.6),
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.md,
  },
  readyBanner: {
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  readyTitle: {
    color: colors.saffron,
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 1,
  },
  readyText: {
    ...type.body,
    color: colors.white,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.xs,
  },
  pressed: {
    opacity: 0.75,
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
  interactivePreview: {
    marginTop: spacing.md,
  },
  stillLabel: {
    color: colors.saffron,
    fontFamily: fonts.extrabold,
    fontSize: 8,
    letterSpacing: 1,
    marginTop: spacing.md,
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
