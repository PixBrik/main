import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { InkLoader } from '../components/InkLoader';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { save360Capture } from '../lib/capture360Store';
import { pickPhoto } from '../lib/pickPhoto';
import {
  buildFromMultiview,
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

const VIEWS: ReadonlyArray<{ id: ViewId; label: string; hint: string; glyph: string }> = [
  { glyph: '●', hint: 'Face it straight on', id: 'front', label: 'FRONT' },
  { glyph: '◐', hint: 'Quarter-turn to its left side', id: 'left', label: 'LEFT' },
  { glyph: '○', hint: 'All the way behind it', id: 'back', label: 'BACK' },
  { glyph: '◑', hint: 'Quarter-turn to its right side', id: 'right', label: 'RIGHT' },
];

/**
 * 360° capture: four photos around the object → Tripo multiview → bricks.
 * Real geometry from real photos on every side — the single-photo path has
 * to hallucinate whatever the camera didn't see; this one doesn't.
 */
export function Capture360Screen({ onBack, onGenerated }: Capture360ScreenProps) {
  const live = isLive3DConfigured();
  const [shots, setShots] = useState<Partial<MultiviewShots>>({});
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [genState, setGenState] = useState<'idle' | 'working' | 'failed'>('idle');
  const [progressNote, setProgressNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const shotCount = VIEWS.filter((view) => shots[view.id]).length;
  const canGenerate = !!shots.front && shotCount >= 2 && rightsConfirmed && genState !== 'working';

  const takeShot = async (id: ViewId) => {
    if (genState === 'working') return;
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

  const generate = async () => {
    if (!shots.front) return;
    setGenState('working');
    setError(null);
    setProgressNote('Starting');
    try {
      const models = await buildFromMultiview(shots as MultiviewShots, {
        onProgress: (fraction, note) => setProgressNote(`${Math.round(fraction * 100)}% · ${note}`),
      });
      onGenerated(models, shots.front);
      setGenState('idle');
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'generation failed');
      setGenState('failed');
    }
  };

  return (
    <ScreenFrame
      accent="coral"
      eyebrow="2 / 360° capture"
      footer={
        <PrimaryButton
          disabled={!canGenerate}
          label={
            genState === 'working'
              ? 'Generating…'
              : !shots.front
                ? 'Front view required'
                : shotCount < 2
                  ? 'Add at least one more view'
                  : !rightsConfirmed
                    ? 'Confirm you own the photos'
                    : 'Generate the 3D build'
          }
          onPress={generate}
        />
      }
      onBack={onBack}
      progress={0.25}
      subtitle="Walk around the object and shoot it from four sides. Keep the same distance and height; a plain background helps."
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
              disabled={genState === 'working'}
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
        * Front is required — every extra view makes the 3D shape more faithful. Move yourself
        around the object; don’t turn the object under a fixed light.
      </Text>

      {genState === 'working' ? (
        <View style={styles.progress}>
          <InkLoader size={26} stage={progressNote || 'Generating'} />
          <Text style={styles.progressHint}>
            The generator reads all your views at once — this takes a minute or two.
          </Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>✕ {error}</Text> : null}

      {!live ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            360° generation runs on the live site (the generator key lives server-side) — on this
            build the generate step will fail fast.
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: rightsConfirmed }}
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
