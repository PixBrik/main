import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ObjectSculpture } from '../components/ObjectSculpture';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { categorize, infoForCategory } from '../lib/photoEngine/classify';
import { classifyMaskedObject, preloadOpenVocab } from '../lib/photoEngine/openVocab';
import { estimateDepthGrid, isDepthSupported } from '../lib/photoEngine/depth';
import { detectObjects, isDetectionSupported, type DetectedObject } from '../lib/photoEngine/detect';
import { detectFaceKeypoints } from '../lib/photoEngine/faceFeatures';
import { segmentRegion, type Segmentation } from '../lib/photoEngine/segment';
import { samSegmentRegion } from '../lib/photoEngine/segmentSam';
import {
  buildPhotoModels,
  type PanelStyle,
  type PhotoBuildMode,
  type PhotoModels,
} from '../lib/photoEngine/voxelizePhoto';
import { colors, radius, spacing, type } from '../theme/tokens';
import type { CaptureMode } from '../types/navigation';

interface CaptureScreenProps {
  mode: CaptureMode;
  captured: boolean;
  photoUri: string | null;
  photoBuild: PhotoModels | null;
  segmentation: Segmentation | null;
  onPhotoChange: (uri: string) => void;
  onSegmentation: (segmentation: Segmentation) => void;
  onObjectLocked: (models: PhotoModels) => void;
  onUseSample: () => void;
  onBack: () => void;
  onContinue: () => void;
}

type EngineState = 'idle' | 'detecting' | 'select' | 'segmenting' | 'depth' | 'locked' | 'failed';

async function pickPhoto(): Promise<string | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };

  if (Platform.OS !== 'web') {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (permission.granted) {
        const result = await ImagePicker.launchCameraAsync(options);
        if (!result.canceled && result.assets[0]) {
          return result.assets[0].uri;
        }
        if (!result.canceled) {
          return null;
        }
      }
    } catch {
      // Camera unavailable (simulator, denied hardware) — fall back to the library.
    }
  }

  const result = await ImagePicker.launchImageLibraryAsync(options);
  if (!result.canceled && result.assets[0]) {
    return result.assets[0].uri;
  }
  return null;
}

const WHOLE_PHOTO_REGION = { height: 0.94, width: 0.94, x: 0.03, y: 0.03 };

export function CaptureScreen({
  mode,
  captured,
  photoUri,
  photoBuild,
  segmentation,
  onPhotoChange,
  onSegmentation,
  onObjectLocked,
  onUseSample,
  onBack,
  onContinue,
}: CaptureScreenProps) {
  const [engineState, setEngineState] = useState<EngineState>(photoBuild ? 'locked' : 'idle');
  const [detections, setDetections] = useState<DetectedObject[]>([]);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(photoBuild?.label ?? null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  // Real photos need the rights attestation; the sample object does not.
  const needsRights = !!photoUri && !rightsConfirmed;

  const analyze = async (uri: string) => {
    if (!isDetectionSupported()) {
      setEngineState('failed');
      return;
    }
    setEngineState('detecting');
    preloadOpenVocab(); // warm the category model while the user picks
    const found = await detectObjects(uri);
    setDetections(found);
    setEngineState('select');
  };

  const capture = async () => {
    const uri = await pickPhoto();
    if (uri) {
      setSelectedLabel(null);
      setDetections([]);
      onPhotoChange(uri);
      await analyze(uri);
    }
  };

  const lockObject = async (region: { x: number; y: number; width: number; height: number }, label: string) => {
    if (!photoUri) {
      return;
    }
    setEngineState('segmenting');
    setSelectedLabel(label);
    try {
      // SAM first (works on any background); classic border-colour fallback.
      const result = (await samSegmentRegion(photoUri, region)) ?? (await segmentRegion(photoUri, region));
      if (result.coverage < 0.02) {
        setEngineState('failed');
        return;
      }

      // Categorise the object. The COCO label is only a hint; CLIP zero-shot
      // on the background-free cutout is far stronger and overrides it when
      // confident. An actual detected face is the strongest evidence of all.
      const share = region.width * region.height;
      let info = categorize(label, share);
      const [openVocab, face] = await Promise.all([
        classifyMaskedObject(photoUri, result),
        detectFaceKeypoints(photoUri, region),
      ]);
      if (openVocab && openVocab.confidence >= 0.35) {
        info = infoForCategory(openVocab.category, share);
      }
      result.face = face;
      if (face && !info.faces) {
        info = infoForCategory('portrait', share);
      }
      result.categoryLabel = info.displayName;
      result.preserveFeatures = info.faces;

      // Full-3D builds measure real depth; panels don't need it.
      if (info.mode === 'volume') {
        await ensureDepth(result);
      }
      onSegmentation(result);
      const models = buildPhotoModels(result, label, info.mode, info.style, {
        category: info.displayName,
        face: result.face ?? null,
        preserveFeatures: info.faces,
      });
      onObjectLocked(models);
      setEngineState('locked');
    } catch {
      setEngineState('failed');
    }
  };

  /** Attach measured depth to the segmentation (once per photo). */
  const ensureDepth = async (target: Segmentation) => {
    if (target.depth !== undefined || !photoUri || !isDepthSupported()) {
      if (target.depth === undefined) {
        target.depth = null;
      }
      return;
    }
    setEngineState('depth');
    target.depth = await estimateDepthGrid(photoUri, target.region, target.grid);
  };

  const rebuildOptions = (target: Segmentation) => ({
    category: target.categoryLabel,
    face: target.face ?? null,
    preserveFeatures: target.preserveFeatures ?? false,
  });

  const switchMode = async (nextMode: PhotoBuildMode) => {
    if (!photoBuild || !segmentation || photoBuild.mode === nextMode) {
      return;
    }
    if (nextMode === 'volume') {
      await ensureDepth(segmentation);
    }
    onObjectLocked(
      buildPhotoModels(segmentation, photoBuild.label, nextMode, undefined, rebuildOptions(segmentation)),
    );
    setEngineState('locked');
  };

  const switchStyle = (nextStyle: PanelStyle) => {
    if (!photoBuild || !segmentation || photoBuild.style === nextStyle) {
      return;
    }
    onObjectLocked(
      buildPhotoModels(segmentation, photoBuild.label, photoBuild.mode, nextStyle, rebuildOptions(segmentation)),
    );
  };

  const busy = engineState === 'detecting' || engineState === 'segmenting' || engineState === 'depth';
  const showBoxes = engineState === 'select' && detections.length > 0;

  const tagText =
    engineState === 'depth'
      ? 'MEASURING DEPTH…'
      : captured
        ? photoBuild
          ? `LOCKED / ${photoBuild.label.toUpperCase()}${
              photoBuild.category && photoBuild.category !== photoBuild.label.toUpperCase()
                ? ` · ${photoBuild.category}`
                : ''
            }${photoBuild.hasFace ? ' · FACE MAPPED' : ''}`
          : 'SAMPLE LOCKED'
        : busy
          ? engineState === 'detecting'
            ? 'FINDING OBJECTS…'
            : 'BUILDING 3D…'
          : engineState === 'select'
            ? 'TAP AN OBJECT'
            : 'READY TO SCAN';

  return (
    <ScreenFrame
      accent="coral"
      eyebrow="2 / Scan object"
      footer={
        captured ? (
          <PrimaryButton
            disabled={needsRights}
            label={needsRights ? 'Confirm you own the photo' : 'Use scan'}
            onPress={onContinue}
          />
        ) : (
          <PrimaryButton disabled label="Capture required" onPress={onContinue} />
        )
      }
      onBack={onBack}
      progress={0.25}
      subtitle={
        mode === 'photo'
          ? 'Shoot any real object — then tap it in the photo to lock it as the build target.'
          : 'Hold steady and complete one controlled orbit around the object.'
      }
      title={
        captured ? 'Scan locked.' : mode === 'photo' ? 'Frame the object.' : 'Complete the orbit.'
      }
    >
      <View style={styles.scanner}>
        <View style={styles.cornerOne} />
        <View style={styles.cornerTwo} />
        {photoUri ? (
          <View style={styles.photoFrame}>
            <Image
              accessibilityLabel="Your captured object photo"
              resizeMode="cover"
              source={{ uri: photoUri }}
              style={styles.photo}
            />
            {showBoxes
              ? detections.map((detection, index) => (
                  <Pressable
                    accessibilityLabel={`Select the ${detection.label}`}
                    accessibilityRole="button"
                    key={`${detection.label}-${index}`}
                    onPress={() =>
                      lockObject(
                        { height: detection.height, width: detection.width, x: detection.x, y: detection.y },
                        detection.label,
                      )
                    }
                    style={[
                      styles.detectionBox,
                      {
                        height: `${detection.height * 100}%`,
                        left: `${detection.x * 100}%`,
                        top: `${detection.y * 100}%`,
                        width: `${detection.width * 100}%`,
                      },
                    ]}
                  >
                    <View style={styles.detectionTag}>
                      <Text style={styles.detectionTagText}>{detection.label.toUpperCase()}</Text>
                    </View>
                  </Pressable>
                ))
              : null}
            {busy ? (
              <View style={styles.busyOverlay}>
                <ActivityIndicator color={colors.mint} size="large" />
              </View>
            ) : null}
          </View>
        ) : (
          <ObjectSculpture scanLines={!captured} />
        )}
        <View style={[styles.scanTag, captured && styles.scanTagLocked]}>
          <Text style={styles.scanTagText}>{tagText}</Text>
        </View>
      </View>

      {engineState === 'select' && photoUri ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => lockObject(WHOLE_PHOTO_REGION, detections.length ? 'object' : 'object')}
          style={({ pressed }) => [styles.wholePhoto, pressed && styles.samplePressed]}
        >
          <Text style={styles.wholePhotoText}>
            {detections.length ? 'None of these? Use the whole photo →' : 'Use the whole photo as the object →'}
          </Text>
        </Pressable>
      ) : null}
      {photoBuild && segmentation ? (
        <>
          <View accessibilityRole="radiogroup" style={styles.modeRow}>
            {(
              [
                { id: 'relief', label: 'Portrait panel' },
                { id: 'volume', label: 'Full 3D sculpture' },
              ] as const
            ).map((option) => {
              const active = photoBuild.mode === option.id;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  key={option.id}
                  onPress={() => switchMode(option.id)}
                  style={[styles.modeChip, active && styles.modeChipActive]}
                >
                  <Text style={[styles.modeChipText, active && styles.modeChipTextActive]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {photoBuild.mode === 'relief' ? (
            <View accessibilityRole="radiogroup" style={styles.modeRow}>
              {(
                [
                  { id: 'classic', label: 'Classic B/W' },
                  { id: 'sepia', label: 'Sepia' },
                  { id: 'natural', label: 'Natural colour' },
                ] as const
              ).map((option) => {
                const active = photoBuild.style === option.id;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    key={option.id}
                    onPress={() => switchStyle(option.id)}
                    style={[styles.styleChip, active && styles.modeChipActive]}
                  >
                    <Text style={[styles.styleChipText, active && styles.modeChipTextActive]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </>
      ) : null}

      {photoUri && !busy && (engineState === 'locked' || engineState === 'failed') ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => analyze(photoUri)}
          style={({ pressed }) => [styles.wholePhoto, pressed && styles.samplePressed]}
        >
          <Text style={styles.wholePhotoText}>Scan this photo again / pick a different object →</Text>
        </Pressable>
      ) : null}

      {engineState === 'failed' && photoUri ? (
        <View style={styles.failNote}>
          <Text style={styles.failNoteText}>
            {isDetectionSupported()
              ? 'Could not isolate an object — try a photo with a plainer background, or continue with the sample object.'
              : 'On-device analysis runs in the web demo; native uses the sample object for now.'}
          </Text>
        </View>
      ) : null}

      <View style={styles.captureRow}>
        <View style={[styles.hint, captured ? styles.hintCaptured : styles.hintScanning]}>
          <Text style={styles.hintTitle}>
            {captured
              ? photoBuild
                ? `${photoBuild.label} locked as build target`
                : 'Sample geometry ready'
              : Platform.OS === 'web'
                ? 'Use a real photo'
                : 'Shoot a real object'}
          </Text>
          <Text style={styles.hintBody}>
            {engineState === 'depth'
              ? 'Measuring true depth with an on-device model — the first run downloads ~26 MB, after that it is cached.'
              : engineState === 'segmenting'
                ? 'AI cutout in progress — works on any background. First run downloads ~35 MB, then it is cached.'
                : captured
                  ? 'Capture again to replace this scan.'
                  : 'Your photo stays on this device; AI cutout, detection, depth, and 3D run locally.'}
          </Text>
        </View>
        <Pressable
          accessibilityLabel={captured ? 'Replace the photo' : 'Capture a photo'}
          accessibilityRole="button"
          onPress={capture}
          style={({ pressed }) => [styles.shutterOuter, pressed && styles.shutterPressed]}
        >
          <View style={[styles.shutterInner, captured && styles.shutterCaptured]} />
        </Pressable>
      </View>

      {photoUri ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: rightsConfirmed }}
          onPress={() => setRightsConfirmed((current) => !current)}
          style={({ pressed }) => [styles.rights, pressed && styles.samplePressed]}
        >
          <View style={[styles.rightsBox, rightsConfirmed && styles.rightsBoxChecked]}>
            {rightsConfirmed ? <Text style={styles.rightsCheck}>✓</Text> : null}
          </View>
          <Text style={styles.rightsText}>
            I own or have the rights to use this photo, and it doesn’t infringe anyone’s rights.
          </Text>
        </Pressable>
      ) : null}

      {!photoBuild ? (
        <Pressable
          accessibilityHint="Continues with the built-in fox object instead of a photo"
          accessibilityRole="button"
          onPress={onUseSample}
          style={({ pressed }) => [styles.sampleLink, pressed && styles.samplePressed]}
        >
          <Text style={styles.sampleText}>
            {captured && !photoBuild ? 'Sample object selected ✓' : 'No object nearby? Use the sample object →'}
          </Text>
        </Pressable>
      ) : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  scanner: {
    position: 'relative',
  },
  cornerOne: {
    borderLeftColor: colors.blue,
    borderLeftWidth: 5,
    borderTopColor: colors.blue,
    borderTopLeftRadius: radius.lg,
    borderTopWidth: 5,
    height: 48,
    left: -7,
    position: 'absolute',
    top: -7,
    width: 48,
    zIndex: 2,
  },
  cornerTwo: {
    borderBottomColor: colors.coral,
    borderBottomRightRadius: radius.lg,
    borderBottomWidth: 5,
    borderRightColor: colors.coral,
    borderRightWidth: 5,
    bottom: -7,
    height: 48,
    position: 'absolute',
    right: -7,
    width: 48,
    zIndex: 2,
  },
  photoFrame: {
    aspectRatio: 1.35,
    backgroundColor: colors.panelDark,
    borderColor: '#31384D',
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  photo: {
    height: '100%',
    width: '100%',
  },
  detectionBox: {
    borderColor: colors.mint,
    borderRadius: 6,
    borderWidth: 2,
    minHeight: 44,
    minWidth: 44,
    position: 'absolute',
  },
  detectionTag: {
    alignSelf: 'flex-start',
    backgroundColor: colors.mintDeep,
    borderBottomRightRadius: 6,
    borderTopLeftRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  detectionTagText: {
    ...type.micro,
    color: colors.white,
    fontSize: 8,
    letterSpacing: 0.8,
  },
  busyOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(11, 14, 22, 0.45)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  scanTag: {
    backgroundColor: colors.coralDeep,
    borderRadius: radius.pill,
    bottom: spacing.md,
    left: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'absolute',
  },
  scanTagLocked: {
    backgroundColor: colors.mintDeep,
  },
  scanTagText: {
    ...type.micro,
    color: colors.white,
    letterSpacing: 1,
  },
  wholePhoto: {
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 44,
  },
  wholePhotoText: {
    ...type.body,
    color: colors.mintDeep,
    fontSize: 14,
    fontWeight: '800',
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  modeChip: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  modeChipActive: {
    backgroundColor: colors.blue,
    borderColor: colors.ink,
  },
  modeChipText: {
    ...type.body,
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  modeChipTextActive: {
    color: colors.white,
  },
  styleChip: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  styleChipText: {
    ...type.body,
    color: colors.ink,
    fontSize: 12,
    fontWeight: '800',
  },
  failNote: {
    backgroundColor: colors.coralSoft,
    borderRadius: radius.md,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  failNoteText: {
    ...type.body,
    color: colors.ink,
    fontSize: 13,
    lineHeight: 18,
  },
  captureRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.xl,
  },
  hint: {
    borderRadius: radius.md,
    flex: 1,
    padding: spacing.md,
  },
  hintScanning: {
    backgroundColor: colors.coralSoft,
  },
  hintCaptured: {
    backgroundColor: colors.mintSoft,
  },
  hintTitle: {
    ...type.body,
    color: colors.ink,
    fontWeight: '900',
    textTransform: 'capitalize',
  },
  hintBody: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  shutterOuter: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.ink,
    borderRadius: radius.pill,
    borderWidth: 3,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  shutterInner: {
    backgroundColor: colors.coral,
    borderRadius: radius.pill,
    height: 52,
    width: 52,
  },
  shutterCaptured: {
    backgroundColor: colors.mint,
    borderRadius: 14,
    height: 38,
    width: 38,
  },
  shutterPressed: {
    transform: [{ scale: 0.94 }],
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
    color: colors.inkSoft,
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  sampleLink: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: 44,
  },
  samplePressed: {
    opacity: 0.6,
  },
  sampleText: {
    ...type.body,
    color: colors.blue,
    fontSize: 14,
    fontWeight: '800',
  },
});
