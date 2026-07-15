import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { InkLoader } from '../components/InkLoader';
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

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

const WHOLE_PHOTO_REGION: Region = { height: 0.94, width: 0.94, x: 0.03, y: 0.03 };
const MIN_FRAME_SIZE = 0.12;
/** Preview-cutout resolution: cheap enough to re-run on every frame adjustment. */
const PREVIEW_GRID = 40;
const PREVIEW_DEBOUNCE_MS = 350;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Largest-by-area, most-confident detection — the natural default frame. */
function bestDetection(found: DetectedObject[]): DetectedObject | null {
  if (!found.length) return null;
  return found.reduce((best, candidate) =>
    candidate.score * candidate.width * candidate.height > best.score * best.width * best.height
      ? candidate
      : best,
  );
}

/** Fraction of the smaller box's area the two regions overlap. */
function overlapRatio(a: Region, b: Region): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller > 0 ? intersection / smaller : 0;
}

/** The detection label the current frame best matches, or a generic fallback. */
function labelForFrame(frame: Region, found: DetectedObject[]): string {
  let best: DetectedObject | null = null;
  let bestScore = 0.5; // require a reasonably confident overlap to trust the label
  for (const detection of found) {
    const score = overlapRatio(frame, detection);
    if (score > bestScore) {
      bestScore = score;
      best = detection;
    }
  }
  return best?.label ?? 'object';
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** Resize the frame from one corner, freeform aspect ratio, keeping the opposite corner fixed. */
function resizeFromCorner(start: Region, corner: Corner, dxFrac: number, dyFrac: number): Region {
  let { x, y, width, height } = start;
  if (corner === 'tl' || corner === 'bl') {
    const newX = clamp(start.x + dxFrac, 0, start.x + start.width - MIN_FRAME_SIZE);
    width = start.width + (start.x - newX);
    x = newX;
  } else {
    width = clamp(start.width + dxFrac, MIN_FRAME_SIZE, 1 - start.x);
  }
  if (corner === 'tl' || corner === 'tr') {
    const newY = clamp(start.y + dyFrac, 0, start.y + start.height - MIN_FRAME_SIZE);
    height = start.height + (start.y - newY);
    y = newY;
  } else {
    height = clamp(start.height + dyFrac, MIN_FRAME_SIZE, 1 - start.y);
  }
  return { height, width, x, y };
}

/** Row-run-length-encode the background cells of a mask, for a cheap dim overlay. */
function backgroundRuns(mask: boolean[], grid: number): Array<{ row: number; x0: number; x1: number }> {
  const runs: Array<{ row: number; x0: number; x1: number }> = [];
  for (let y = 0; y < grid; y++) {
    let runStart = -1;
    for (let x = 0; x <= grid; x++) {
      const isBackground = x < grid && !mask[y * grid + x];
      if (isBackground && runStart === -1) runStart = x;
      if (!isBackground && runStart !== -1) {
        runs.push({ row: y, x0: runStart, x1: x });
        runStart = -1;
      }
    }
  }
  return runs;
}

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
  // Guards re-entrant lock attempts: setEngineState('segmenting') isn't
  // synchronous, so a fast double-tap could otherwise stack two full
  // pipelines competing for the same thread.
  const lockingRef = useRef(false);

  // The user-adjustable crop: any aspect ratio, seeded from the strongest
  // detection (or the whole photo if nothing was detected) and freely
  // draggable/resizable from there.
  const [frame, setFrame] = useState<Region>(WHOLE_PHOTO_REGION);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const [layoutSize, setLayoutSize] = useState({ height: 0, width: 0 });
  // Fast classic cutout, auto-recomputed as the frame settles — the "AI
  // removed the background" live preview. SAM (slower, higher quality) still
  // runs once at lock time, same as before.
  const [preview, setPreview] = useState<Segmentation | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const previewToken = useRef(0);
  const dragStartFrame = useRef(frame);

  const analyze = async (uri: string) => {
    if (!isDetectionSupported()) {
      setEngineState('failed');
      return;
    }
    setEngineState('detecting');
    preloadOpenVocab(); // warm the category model while the user picks
    const found = await detectObjects(uri);
    setDetections(found);
    const seed = bestDetection(found);
    setFrame(seed ? { height: seed.height, width: seed.width, x: seed.x, y: seed.y } : WHOLE_PHOTO_REGION);
    setEngineState('select');
  };

  // Debounced auto background-removal preview: recompute the fast classic
  // cutout whenever the frame settles, so adjusting it always shows what
  // will actually be captured — without hammering the segmenter mid-drag.
  useEffect(() => {
    if (!photoUri || engineState !== 'select' || Platform.OS !== 'web') {
      return;
    }
    const token = ++previewToken.current;
    const timer = setTimeout(async () => {
      setPreviewBusy(true);
      try {
        const result = await segmentRegion(photoUri, frame, PREVIEW_GRID);
        if (previewToken.current === token) {
          setPreview(result);
        }
      } catch {
        // A failed preview isn't fatal — lock-time segmentation retries.
      } finally {
        if (previewToken.current === token) {
          setPreviewBusy(false);
        }
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [frame, photoUri, engineState]);

  const moveResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
        onPanResponderGrant: () => {
          dragStartFrame.current = frameRef.current;
          setDragging(true);
        },
        onPanResponderMove: (_event, gesture) => {
          if (!layoutSize.width || !layoutSize.height) return;
          const start = dragStartFrame.current;
          const dxFrac = gesture.dx / layoutSize.width;
          const dyFrac = gesture.dy / layoutSize.height;
          setFrame({
            ...start,
            x: clamp(start.x + dxFrac, 0, 1 - start.width),
            y: clamp(start.y + dyFrac, 0, 1 - start.height),
          });
        },
        onPanResponderRelease: () => setDragging(false),
        onPanResponderTerminate: () => setDragging(false),
      }),
    [layoutSize],
  );

  const cornerResponders = useMemo(
    () =>
      (['tl', 'tr', 'bl', 'br'] as const).map((corner) =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => true,
          onPanResponderGrant: () => {
            dragStartFrame.current = frameRef.current;
            setDragging(true);
          },
          onPanResponderMove: (_event, gesture) => {
            if (!layoutSize.width || !layoutSize.height) return;
            const dxFrac = gesture.dx / layoutSize.width;
            const dyFrac = gesture.dy / layoutSize.height;
            setFrame(resizeFromCorner(dragStartFrame.current, corner, dxFrac, dyFrac));
          },
          onPanResponderRelease: () => setDragging(false),
          onPanResponderTerminate: () => setDragging(false),
        }),
      ),
    [layoutSize],
  );

  const capture = async () => {
    const uri = await pickPhoto();
    if (uri) {
      setSelectedLabel(null);
      setDetections([]);
      setFrame(WHOLE_PHOTO_REGION);
      setPreview(null);
      onPhotoChange(uri);
      await analyze(uri);
    }
  };

  const lockObject = async (region: Region, label: string) => {
    if (!photoUri || lockingRef.current) {
      return;
    }
    lockingRef.current = true;
    setEngineState('segmenting');
    setSelectedLabel(label);
    // Let React commit the "segmenting" frame (loader visible) before the
    // heavy synchronous work below has a chance to start.
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      // SAM first (works on any background); classic border-colour fallback.
      // Watchdog: if SAM is still crunching after 90 s (cold model download +
      // slow device), fall back so the lock always completes.
      const samWithTimeout = Promise.race([
        samSegmentRegion(photoUri, region),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 90000)),
      ]);
      const result = (await samWithTimeout) ?? (await segmentRegion(photoUri, region));
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
        Promise.race([
          classifyMaskedObject(photoUri, result),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 45000)),
        ]),
        // Watchdog: face detection is a separate CDN-loaded WASM stack with
        // no timeout of its own — a stalled fetch or WASM alloc failure
        // (memory-constrained mobile) must not hang the lock forever.
        Promise.race([
          detectFaceKeypoints(photoUri, region),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 20000)),
        ]),
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
    } finally {
      lockingRef.current = false;
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
  const framing = engineState === 'select';

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
          : framing
            ? previewBusy
              ? 'REMOVING BACKGROUND…'
              : preview
                ? 'BACKGROUND REMOVED ✓'
                : 'DRAG TO FRAME'
            : 'READY TO SCAN';

  const previewRuns =
    !dragging && preview && !previewBusy ? backgroundRuns(preview.mask, PREVIEW_GRID) : [];
  const previewRegion = preview?.region ?? frame;
  const cellFracX = previewRegion.width / PREVIEW_GRID;
  const cellFracY = previewRegion.height / PREVIEW_GRID;

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
          ? 'Shoot any real object — drag the frame over exactly what you want. We remove the background automatically.'
          : 'Hold steady and complete one controlled orbit around the object.'
      }
      title={
        captured ? 'Scan locked.' : mode === 'photo' ? 'Frame the object.' : 'Complete the orbit.'
      }
    >
      <View style={styles.scanner}>
        <View pointerEvents="none" style={styles.cornerOne} />
        <View pointerEvents="none" style={styles.cornerTwo} />
        {photoUri ? (
          <View
            onLayout={(event) => setLayoutSize(event.nativeEvent.layout)}
            style={styles.photoFrame}
          >
            <Image
              accessibilityLabel="Your captured object photo"
              resizeMode="cover"
              source={{ uri: photoUri }}
              style={styles.photo}
            />
            {framing
              ? detections.map((detection, index) => (
                  <View
                    key={`${detection.label}-${index}`}
                    pointerEvents="none"
                    style={[
                      styles.detectionGhost,
                      {
                        height: `${detection.height * 100}%`,
                        left: `${detection.x * 100}%`,
                        top: `${detection.y * 100}%`,
                        width: `${detection.width * 100}%`,
                      },
                    ]}
                  />
                ))
              : null}
            {framing ? (
              <>
                {/* Dim everything outside the current frame. */}
                <View pointerEvents="none" style={[styles.dimBand, { height: `${frame.y * 100}%`, left: 0, right: 0, top: 0 }]} />
                <View
                  pointerEvents="none"
                  style={[styles.dimBand, { bottom: 0, left: 0, right: 0, top: `${(frame.y + frame.height) * 100}%` }]}
                />
                <View
                  pointerEvents="none"
                  style={[
                    styles.dimBand,
                    { height: `${frame.height * 100}%`, left: 0, top: `${frame.y * 100}%`, width: `${frame.x * 100}%` },
                  ]}
                />
                <View
                  pointerEvents="none"
                  style={[
                    styles.dimBand,
                    {
                      height: `${frame.height * 100}%`,
                      left: `${(frame.x + frame.width) * 100}%`,
                      right: 0,
                      top: `${frame.y * 100}%`,
                    },
                  ]}
                />

                {/* Smart-AI background removal preview, once the frame settles. */}
                {previewRuns.map((run, index) => (
                  <View
                    key={index}
                    pointerEvents="none"
                    style={[
                      styles.previewDim,
                      {
                        height: `${cellFracY * 100}%`,
                        left: `${(previewRegion.x + run.x0 * cellFracX) * 100}%`,
                        top: `${(previewRegion.y + run.row * cellFracY) * 100}%`,
                        width: `${(run.x1 - run.x0) * cellFracX * 100}%`,
                      },
                    ]}
                  />
                ))}

                {/* The frame itself: draggable to move, corner handles to resize freely. */}
                <View
                  style={[
                    styles.frameBox,
                    {
                      height: `${frame.height * 100}%`,
                      left: `${frame.x * 100}%`,
                      top: `${frame.y * 100}%`,
                      width: `${frame.width * 100}%`,
                    },
                  ]}
                  {...moveResponder.panHandlers}
                />
                {(['tl', 'tr', 'bl', 'br'] as const).map((corner, index) => {
                  const atRight = corner === 'tr' || corner === 'br';
                  const atBottom = corner === 'bl' || corner === 'br';
                  return (
                    <View
                      key={corner}
                      style={[
                        styles.cornerHandle,
                        {
                          left: `${(atRight ? frame.x + frame.width : frame.x) * 100}%`,
                          top: `${(atBottom ? frame.y + frame.height : frame.y) * 100}%`,
                        },
                      ]}
                      {...cornerResponders[index]!.panHandlers}
                    />
                  );
                })}
              </>
            ) : null}
            {busy ? (
              <View style={styles.busyOverlay}>
                <InkLoader
                  size={30}
                  stage={
                    engineState === 'detecting'
                      ? 'Finding objects'
                      : engineState === 'segmenting'
                        ? 'Identifying object'
                        : engineState === 'depth'
                          ? 'Measuring depth'
                          : 'Building 3D'
                  }
                />
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

      {framing && photoUri ? (
        <>
          {detections.length > 0 ? (
            <View style={styles.chipRow}>
              {detections.map((detection, index) => (
                <Pressable
                  accessibilityLabel={`Snap the frame to the ${detection.label}`}
                  accessibilityRole="button"
                  key={`${detection.label}-${index}`}
                  onPress={() =>
                    setFrame({
                      height: detection.height,
                      width: detection.width,
                      x: detection.x,
                      y: detection.y,
                    })
                  }
                  style={({ pressed }) => [styles.detectionChip, pressed && styles.samplePressed]}
                >
                  <Text style={styles.detectionChipText}>{detection.label.toUpperCase()}</Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityLabel="Reset the frame to the whole photo"
                accessibilityRole="button"
                onPress={() => setFrame(WHOLE_PHOTO_REGION)}
                style={({ pressed }) => [styles.detectionChip, pressed && styles.samplePressed]}
              >
                <Text style={styles.detectionChipText}>WHOLE PHOTO</Text>
              </Pressable>
            </View>
          ) : null}
          <PrimaryButton
            compact
            label="Lock this frame"
            onPress={() => lockObject(frame, labelForFrame(frame, detections))}
          />
        </>
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
  detectionGhost: {
    borderColor: 'rgba(141, 245, 229, 0.55)',
    borderRadius: 6,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    position: 'absolute',
  },
  dimBand: {
    backgroundColor: 'rgba(10, 12, 18, 0.62)',
    position: 'absolute',
  },
  previewDim: {
    backgroundColor: 'rgba(10, 12, 18, 0.55)',
    position: 'absolute',
  },
  frameBox: {
    borderColor: colors.saffron,
    borderRadius: 4,
    borderWidth: 2,
    position: 'absolute',
  },
  cornerHandle: {
    backgroundColor: colors.saffron,
    borderColor: colors.ink,
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 26,
    marginLeft: -13,
    marginTop: -13,
    position: 'absolute',
    width: 26,
    zIndex: 3,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  detectionChip: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  detectionChipText: {
    ...type.micro,
    color: colors.ink,
    fontSize: 9,
    letterSpacing: 0.8,
  },
  busyOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 200, 0, 0.88)',
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
