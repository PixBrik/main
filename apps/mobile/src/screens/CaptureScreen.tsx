import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { G, Polygon, Rect } from 'react-native-svg';

import { InkLoader } from '../components/InkLoader';
import { ObjectSculpture } from '../components/ObjectSculpture';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { saveLastCapture } from '../lib/captureStore';
import { downscalePhoto } from '../lib/downscalePhoto';
import { labelOverride } from '../lib/feedbackStore';
import { panelMosaicFaces } from '../lib/fitFaces';
import { pickPhoto } from '../lib/pickPhoto';
import {
  backgroundRemovalErrorMessage,
  isBackgroundRemovalEnabled,
  segmentFramedScene,
  smartIsolateRegion,
} from '../lib/photoEngine/backgroundRemoval';
import { categorize, infoForCategory } from '../lib/photoEngine/classify';
import { detectObjects, isDetectionSupported, type DetectedObject } from '../lib/photoEngine/detect';
import type { Segmentation } from '../lib/photoEngine/segment';
import {
  buildPhotoModels,
  voxelizeSegmentation,
  type PanelStyle,
  type PhotoModels,
} from '../lib/photoEngine/voxelizePhoto';
import type { RenderFace } from '../lib/voxelRender';
import { colors, radius, spacing, type } from '../theme/tokens';
import type { CaptureMode } from '../types/navigation';

/**
 * Capture, rebuilt from scratch around what a BUYER does — not what the
 * computer-vision stack wants:
 *
 *   1. Add a photo (one tap).
 *   2. Frame it: drag the photo under a fixed window, +/− to zoom. No corner
 *      handles, no detection chips, no jargon — the same gesture every
 *      avatar cropper uses.
 *   3. "See it in bricks": three REAL previews (classic B/W, sepia, colour)
 *      built from the framed photo. Smart isolate is the recommended first
 *      result when configured, with an explicit upload-labelled action.
 *   4. Continue to sizes and prices. The full-3D sculpture lives on the
 *      result screen as a premium AI-generated upgrade with its own
 *      approve-first step.
 *
 * Deliberately NOT in this flow: SAM, CLIP, face mapping, depth. They are
 * slow, fragile (they killed mobile tabs), and none of them is needed to
 * make a beautiful panel. Subject detection runs only to pre-centre the
 * frame, and silently gives up if it can't.
 */

interface CaptureScreenProps {
  mode: CaptureMode;
  captured: boolean;
  photoUri: string | null;
  photoBuild: PhotoModels | null;
  segmentation: Segmentation | null;
  rightsConfirmed: boolean;
  onPhotoChange: (uri: string) => void;
  onRightsConfirmedChange: (confirmed: boolean) => void;
  onSegmentation: (segmentation: Segmentation) => void;
  onObjectLocked: (models: PhotoModels) => void;
  onUseSample: () => void;
  onBack: () => void;
  onContinue: () => void;
}

type Stage = 'idle' | 'loading' | 'framing' | 'building' | 'ready' | 'failed';
type BackgroundMode = 'scene' | 'smart';

/** Frame aspect (height / width): portrait-ish, right for most gifts. */
const FRAME_ASPECT = 1.2;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

const PREVIEW_VIEW_W = 132;
const PREVIEW_VIEW_H = 110;
const LARGE_VIEW_W = 340;
const LARGE_VIEW_H = 300;

/** The three panel styles — previewed from the buyer's own photo. */
const STYLE_CHOICES: ReadonlyArray<{
  id: string;
  label: string;
  hint: string;
  style: PanelStyle;
}> = [
  { hint: 'closest to your photo', id: 'natural', label: 'FULL COLOUR', style: 'natural' },
  { hint: 'classic brick portrait', id: 'classic', label: 'CLASSIC · B/W', style: 'classic' },
  { hint: 'warm vintage tones', id: 'sepia', label: 'SEPIA', style: 'sepia' },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Natural pixel size of an image URI (web). */
function measurePhoto(uri: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (w, h) => resolve({ h, w }),
      () => reject(new Error('could not read photo')),
    );
  });
}

export function CaptureScreen({
  mode,
  captured,
  photoUri,
  photoBuild,
  segmentation,
  rightsConfirmed,
  onPhotoChange,
  onRightsConfirmedChange,
  onSegmentation,
  onObjectLocked,
  onUseSample,
  onBack,
  onContinue,
}: CaptureScreenProps) {
  const [stage, setStage] = useState<Stage>(photoBuild ? 'ready' : 'idle');
  const needsRights = !!photoUri && !rightsConfirmed;
  const buildingRef = useRef(false);
  const restoredCropUri = useRef<string | null>(null);

  // Framing model: the photo pans/zooms under a fixed window.
  const [photoSize, setPhotoSize] = useState<{ w: number; h: number } | null>(null);
  const [frameW, setFrameW] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const dragStart = useRef({ x: 0, y: 0 });
  const [detectedLabel, setDetectedLabel] = useState<string>('photo');

  // Style previews + an honest scene/cutout choice. Smart mode is committed
  // only after the provider succeeds, so a failed request never loses a build.
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(
    segmentation?.backgroundMode === 'smart'
      ? 'smart'
      : segmentation?.backgroundMode === 'scene'
        ? 'scene'
      : Platform.OS === 'web' && isBackgroundRemovalEnabled()
        ? 'smart'
        : 'scene',
  );
  const [pendingBackgroundMode, setPendingBackgroundMode] = useState<BackgroundMode | null>(null);
  const [smartError, setSmartError] = useState<string | null>(null);
  const [stylePreviews, setStylePreviews] = useState<Array<{ id: string; faces: RenderFace[] }>>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [largeFaces, setLargeFaces] = useState<Record<string, RenderFace[]>>({});
  const buildRevisionRef = useRef(0);
  const currentPhotoUriRef = useRef(photoUri);
  currentPhotoUriRef.current = photoUri;

  // Clear one-off crop restoration state when the current photo is removed.
  useEffect(() => {
    if (!photoUri) restoredCropUri.current = null;
  }, [photoUri]);

  // Capture is unmounted while the buyer visits the next screen. Rehydrate
  // the image geometry when they come back so an existing photo never turns
  // into a blank frame or an "Add a photo first" dead end.
  useEffect(() => {
    if (!photoUri || photoSize) return;
    let cancelled = false;
    setStage('loading');
    void measurePhoto(photoUri)
      .then((natural) => {
        if (cancelled) return;
        setPhotoSize(natural);
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setStage(photoBuild ? 'ready' : 'framing');
      })
      .catch(() => {
        if (!cancelled) setStage('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [photoBuild, photoSize, photoUri]);

  const frameH = frameW * FRAME_ASPECT;
  const geometry = useMemo(() => {
    if (!photoSize || !frameW) return null;
    const cover = Math.max(frameW / photoSize.w, frameH / photoSize.h);
    const dW = photoSize.w * cover * zoom;
    const dH = photoSize.h * cover * zoom;
    return { cover, dH, dW };
  }, [photoSize, frameW, frameH, zoom]);

  const clampPan = (x: number, y: number, dW: number, dH: number) => ({
    x: clamp(x, frameW - dW, 0),
    y: clamp(y, frameH - dH, 0),
  });

  // A saved segmentation also records the exact crop that produced the
  // preview. Restore it once after remount so the photo shown to the buyer
  // still matches the brick build they approved.
  useEffect(() => {
    if (
      !photoUri ||
      !photoSize ||
      !frameW ||
      !segmentation ||
      restoredCropUri.current === photoUri
    ) {
      return;
    }
    const cover = Math.max(frameW / photoSize.w, frameH / photoSize.h);
    const restoredZoom = clamp(
      frameW / Math.max(1, photoSize.w * cover * segmentation.region.width),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    const dW = photoSize.w * cover * restoredZoom;
    const dH = photoSize.h * cover * restoredZoom;
    setZoom(restoredZoom);
    setPan(
      clampPan(
        -segmentation.region.x * dW,
        -segmentation.region.y * dH,
        dW,
        dH,
      ),
    );
    restoredCropUri.current = photoUri;
  }, [frameH, frameW, photoSize, photoUri, segmentation]);

  /** The framed crop, normalized to the photo (0..1). */
  const cropRegion = () => {
    if (!geometry) return { height: 1, width: 1, x: 0, y: 0 };
    return {
      height: frameH / geometry.dH,
      width: frameW / geometry.dW,
      x: -pan.x / geometry.dW,
      y: -pan.y / geometry.dH,
    };
  };

  const moveResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
        onPanResponderGrant: () => {
          dragStart.current = panRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          if (!geometry) return;
          setPan(
            clampPan(
              dragStart.current.x + gesture.dx,
              dragStart.current.y + gesture.dy,
              geometry.dW,
              geometry.dH,
            ),
          );
        },
      }),
    [geometry, frameW, frameH],
  );

  /** Zoom around the frame centre so the subject doesn't jump. */
  const zoomBy = (factor: number) => {
    if (!geometry || !photoSize) return;
    const next = clamp(zoomRef.current * factor, MIN_ZOOM, MAX_ZOOM);
    if (next === zoomRef.current) return;
    const centreFracX = (frameW / 2 - panRef.current.x) / geometry.dW;
    const centreFracY = (frameH / 2 - panRef.current.y) / geometry.dH;
    const dW2 = photoSize.w * geometry.cover * next;
    const dH2 = photoSize.h * geometry.cover * next;
    setZoom(next);
    setPan(clampPan(frameW / 2 - centreFracX * dW2, frameH / 2 - centreFracY * dH2, dW2, dH2));
  };

  /** Pre-centre the frame on the strongest detection — best effort only. */
  const seedFromDetection = async (uri: string, natural: { w: number; h: number }, fw: number) => {
    if (!isDetectionSupported()) return;
    try {
      const found = await Promise.race([
        detectObjects(uri),
        new Promise<DetectedObject[]>((resolve) => setTimeout(() => resolve([]), 8000)),
      ]);
      if (!found.length) return;
      const best = found.reduce((a, b) =>
        b.score * b.width * b.height > a.score * a.width * a.height ? b : a,
      );
      setDetectedLabel(best.label);
      const fh = fw * FRAME_ASPECT;
      const cover = Math.max(fw / natural.w, fh / natural.h);
      // Zoom so the frame roughly covers the detection plus padding.
      const targetRegionW = clamp(best.width * 1.5, 0.25, 1);
      const z = clamp(fw / (natural.w * cover * targetRegionW), MIN_ZOOM, MAX_ZOOM);
      const dW = natural.w * cover * z;
      const dH = natural.h * cover * z;
      const cx = best.x + best.width / 2;
      const cy = best.y + best.height / 2;
      setZoom(z);
      setPan({
        x: clamp(fw / 2 - cx * dW, fw - dW, 0),
        y: clamp(fh / 2 - cy * dH, fh - dH, 0),
      });
    } catch {
      // Framing starts centered; the buyer adjusts. Never block on detection.
    }
  };

  const capture = async () => {
    // Invalidate any cutout/panel request before opening the replacement picker.
    buildRevisionRef.current += 1;
    const picked = await pickPhoto();
    if (!picked) return;
    setStage('loading');
    try {
      const uri = Platform.OS === 'web' ? await downscalePhoto(picked).catch(() => picked) : picked;
      const natural = await measurePhoto(uri);
      setPhotoSize(natural);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setStylePreviews([]);
      setLargeFaces({});
      setDetectedLabel('photo');
      setBackgroundMode(
        Platform.OS === 'web' && isBackgroundRemovalEnabled() ? 'smart' : 'scene',
      );
      setPendingBackgroundMode(null);
      setSmartError(null);
      onPhotoChange(uri);
      setStage('framing');
      if (Platform.OS === 'web' && frameW) {
        void seedFromDetection(uri, natural, frameW);
      }
    } catch {
      setStage('failed');
    }
  };

  /** Build locally from the scene, or explicitly request a cached smart cutout. */
  const buildPanel = async (nextMode: BackgroundMode, style: PanelStyle = 'natural') => {
    if (!photoUri || buildingRef.current) return;
    const sourceUri = photoUri;
    const buildRevision = ++buildRevisionRef.current;
    const hadApprovedBuild = !!photoBuild && !!segmentation;
    buildingRef.current = true;
    setPendingBackgroundMode(nextMode);
    if (nextMode === 'smart') setSmartError(null);
    setStage('building');
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
      const region = cropRegion();
      const seg =
        nextMode === 'smart'
          ? await smartIsolateRegion(sourceUri, region)
          : await segmentFramedScene(sourceUri, region);
      if (
        buildRevisionRef.current !== buildRevision ||
        currentPhotoUriRef.current !== sourceUri
      ) {
        return;
      }
      const share = region.width * region.height;
      let info = categorize(detectedLabel, share);
      const taught = labelOverride(detectedLabel);
      if (taught) info = infoForCategory(taught, share);
      seg.categoryLabel = info.displayName;
      seg.preserveFeatures = false;
      seg.face = null;
      onSegmentation(seg);
      const models = buildPhotoModels(seg, detectedLabel, 'relief', style, {
        category: info.displayName,
      });
      onObjectLocked(models);
      setBackgroundMode(nextMode);
      setSmartError(null);
      setStage('ready');
      void saveLastCapture(photoUri, seg);
    } catch (error) {
      if (
        buildRevisionRef.current !== buildRevision ||
        currentPhotoUriRef.current !== sourceUri
      ) {
        return;
      }
      if (nextMode === 'smart') {
        setSmartError(backgroundRemovalErrorMessage(error));
        if (!hadApprovedBuild) setBackgroundMode('scene');
        setStage(hadApprovedBuild ? 'ready' : 'failed');
      } else {
        setStage('failed');
      }
    } finally {
      buildingRef.current = false;
      if (buildRevisionRef.current === buildRevision) setPendingBackgroundMode(null);
    }
  };

  /** Swap the panel style — previews already showed the buyer exactly this. */
  const chooseStyle = (style: PanelStyle) => {
    if (!photoBuild || !segmentation) return;
    if (photoBuild.style === style) return;
    onObjectLocked(
      buildPhotoModels(segmentation, photoBuild.label, 'relief', style, {
        category: segmentation.categoryLabel,
      }),
    );
  };

  const selectExpanded = () => {
    const choice = expandedIndex !== null ? STYLE_CHOICES[expandedIndex] : undefined;
    setExpandedIndex(null);
    if (choice) chooseStyle(choice.style);
  };

  // Mini previews for the three styles, rendered from the buyer's photo.
  useEffect(() => {
    setLargeFaces({});
    if (stage !== 'ready' || !segmentation) {
      setStylePreviews([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const previews: Array<{ id: string; faces: RenderFace[] }> = [];
      for (const choice of STYLE_CHOICES) {
        const model = voxelizeSegmentation(segmentation, 'efficient', 'relief', choice.style, null, false);
        previews.push({ faces: panelMosaicFaces(model, PREVIEW_VIEW_W, PREVIEW_VIEW_H), id: choice.id });
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (cancelled) return;
      }
      if (!cancelled) setStylePreviews(previews);
    })();
    return () => {
      cancelled = true;
    };
  }, [stage, segmentation]);

  // Large lightbox preview at 'balanced', built on demand and cached.
  useEffect(() => {
    if (expandedIndex === null || !segmentation) return;
    const choice = STYLE_CHOICES[expandedIndex];
    if (!choice || largeFaces[choice.id]) return;
    let cancelled = false;
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (cancelled) return;
      const model = voxelizeSegmentation(segmentation, 'balanced', 'relief', choice.style, null, false);
      if (!cancelled) {
        setLargeFaces((current) => ({
          ...current,
          [choice.id]: panelMosaicFaces(model, LARGE_VIEW_W, LARGE_VIEW_H),
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expandedIndex, segmentation, largeFaces]);

  const framingActive = stage === 'framing' || stage === 'ready';
  const webFlow = Platform.OS === 'web';
  const smartAvailable = webFlow && isBackgroundRemovalEnabled();

  return (
    <ScreenFrame
      accent="coral"
      eyebrow="2 / Your photo"
      footer={
        photoUri && !webFlow ? (
          <PrimaryButton disabled label="Use the sample object below" onPress={onContinue} />
        ) : photoUri && (stage === 'building' || stage === 'loading') ? (
          <PrimaryButton disabled label="Building your preview…" onPress={onContinue} />
        ) : photoUri && (stage === 'framing' || stage === 'failed') ? (
          <PrimaryButton
            label={
              backgroundMode === 'smart'
                ? stage === 'failed'
                  ? 'Retry crop upload & isolate'
                  : 'Upload crop · isolate & preview'
                : stage === 'failed'
                  ? 'Try the whole-frame preview again'
                  : 'Keep whole frame & see in bricks'
            }
            onPress={() => buildPanel(backgroundMode)}
          />
        ) : photoBuild || (!photoUri && captured) ? (
          <PrimaryButton
            disabled={needsRights}
            label={needsRights ? 'Confirm you own the photo' : 'Compare build sizes →'}
            onPress={onContinue}
          />
        ) : (
          <PrimaryButton disabled label="Add a photo first" onPress={onContinue} />
        )
      }
      onBack={onBack}
      progress={0.25}
      subtitle={
        mode === 'photo'
          ? 'One good photo is all it takes. Drag to position it, zoom with + and −, and see it in bricks.'
          : 'Hold steady and complete one controlled orbit around the object.'
      }
      title={stage === 'ready' ? 'Looking good.' : photoUri ? 'Frame it.' : 'Add your photo.'}
    >
      {/* ——— The photo in its frame (or the empty state) ——— */}
      {photoUri && webFlow ? (
        <View
          onLayout={(event) => setFrameW(event.nativeEvent.layout.width)}
          style={[styles.frame, { height: frameH || 300 }]}
          {...(framingActive ? moveResponder.panHandlers : {})}
        >
          {geometry ? (
            <Image
              accessibilityLabel="Your photo — drag to reposition"
              source={{ uri: photoUri }}
              style={{
                height: geometry.dH,
                left: pan.x,
                position: 'absolute',
                top: pan.y,
                width: geometry.dW,
              }}
            />
          ) : null}
          {stage === 'building' || stage === 'loading' ? (
            <View style={styles.busyOverlay}>
              <InkLoader
                size={28}
                stage={
                  stage === 'loading'
                    ? 'Reading photo'
                    : pendingBackgroundMode === 'smart'
                      ? 'Smart isolating'
                      : 'Building previews'
                }
              />
            </View>
          ) : null}
        </View>
      ) : photoUri && !webFlow ? (
        <View style={[styles.frame, { height: 300 }]}>
          <Image resizeMode="cover" source={{ uri: photoUri }} style={styles.nativePhoto} />
        </View>
      ) : (
        <ObjectSculpture scanLines={!captured} />
      )}

      {/* ——— Framing controls: one gesture + two big buttons ——— */}
      {photoUri && webFlow && framingActive ? (
        <View style={styles.controlsRow}>
          <View style={styles.zoomGroup}>
            <Pressable
              accessibilityLabel="Zoom out"
              accessibilityRole="button"
              onPress={() => zoomBy(1 / 1.3)}
              style={({ pressed }) => [styles.zoomButton, pressed && styles.pressed]}
            >
              <Text style={styles.zoomText}>−</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Zoom in"
              accessibilityRole="button"
              onPress={() => zoomBy(1.3)}
              style={({ pressed }) => [styles.zoomButton, pressed && styles.pressed]}
            >
              <Text style={styles.zoomText}>+</Text>
            </Pressable>
          </View>
          <Text style={styles.controlsHint}>Drag the photo · zoom with + −</Text>
          <Pressable
            accessibilityLabel="Replace the photo"
            accessibilityRole="button"
            onPress={capture}
            style={({ pressed }) => [styles.replaceLink, pressed && styles.pressed]}
          >
            <Text style={styles.replaceLinkText}>↺ Replace</Text>
          </Pressable>
        </View>
      ) : null}

      {/* ——— Style previews ——— */}
      {/* Choose the expected output before the first build. Smart isolate is
          selected by default when configured, while the labelled CTA remains
          the buyer's explicit consent to upload only the framed crop. */}
      {photoUri && webFlow && (stage === 'framing' || stage === 'failed') ? (
        <View style={styles.prebuildBackgroundChoice}>
          <Text style={styles.stepLabel}>REMOVE THE BACKGROUND?</Text>
          <View accessibilityRole="radiogroup" style={styles.bgOptionGrid}>
            <Pressable
              aria-checked={backgroundMode === 'smart'}
              accessibilityLabel={
                smartAvailable
                  ? 'Smart isolate, recommended: detect the subject contour and remove the background'
                  : 'Smart isolate is unavailable in this build'
              }
              accessibilityRole="radio"
              accessibilityState={{ checked: backgroundMode === 'smart', disabled: !smartAvailable }}
              disabled={!smartAvailable}
              onPress={() => {
                setSmartError(null);
                setBackgroundMode('smart');
              }}
              style={({ pressed }) => [
                styles.bgOption,
                backgroundMode === 'smart' && styles.bgOptionActive,
                !smartAvailable && styles.bgOptionDisabled,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.bgOptionHead}>
                <Text style={styles.bgOptionTitle}>SMART ISOLATE</Text>
                <Text style={styles.bgOptionBadge}>
                  {!smartAvailable
                    ? 'UNAVAILABLE'
                    : backgroundMode === 'smart'
                      ? 'BEST RESULT ✓'
                      : 'BEST RESULT'}
                </Text>
              </View>
              <Text style={styles.bgOptionText}>
                Detects the object contour and drops studio, white, or gradient backgrounds. Your
                framed crop is uploaded only after you tap the preview button.
              </Text>
            </Pressable>

            <Pressable
              aria-checked={backgroundMode === 'scene'}
              accessibilityLabel="Keep whole frame, including its background"
              accessibilityRole="radio"
              accessibilityState={{ checked: backgroundMode === 'scene' }}
              onPress={() => {
                setSmartError(null);
                setBackgroundMode('scene');
              }}
              style={({ pressed }) => [
                styles.bgOption,
                backgroundMode === 'scene' && styles.bgOptionActive,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.bgOptionHead}>
                <Text style={styles.bgOptionTitle}>KEEP WHOLE FRAME</Text>
                {backgroundMode === 'scene' ? <Text style={styles.bgOptionBadge}>SELECTED ✓</Text> : null}
              </View>
              <Text style={styles.bgOptionText}>Keeps the background and stays entirely on this device.</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {stage === 'ready' && photoBuild && segmentation ? (
        <>
          <Text style={styles.stepLabel}>PICK YOUR STYLE — TAP A PREVIEW TO SEE IT LARGER</Text>
          <View style={styles.styleGrid}>
            {STYLE_CHOICES.map((choice, index) => {
              const active = photoBuild.style === choice.style;
              const previewFaces = stylePreviews.find((entry) => entry.id === choice.id)?.faces;
              return (
                <Pressable
                  aria-pressed={active}
                  accessibilityHint="Opens a larger preview of this style"
                  accessibilityLabel={`${choice.label}: ${choice.hint}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={choice.id}
                  onPress={() => setExpandedIndex(index)}
                  style={[styles.styleCard, active && styles.styleCardActive]}
                >
                  <View style={styles.stylePreviewBox}>
                    {previewFaces ? (
                      <Svg height="100%" viewBox={`0 0 ${PREVIEW_VIEW_W} ${PREVIEW_VIEW_H}`} width="100%">
                        <Rect fill="#17130A" height={PREVIEW_VIEW_H} width={PREVIEW_VIEW_W} />
                        <G stroke="#0A0C12" strokeLinejoin="round" strokeWidth={0.3}>
                          {previewFaces.map((face) => (
                            <Polygon fill={face.fill} key={face.id} points={face.points} />
                          ))}
                        </G>
                      </Svg>
                    ) : (
                      <View style={styles.stylePreviewLoading} />
                    )}
                    <View pointerEvents="none" style={styles.expandBadge}>
                      <Text style={styles.expandBadgeText}>⤢</Text>
                    </View>
                  </View>
                  <Text style={styles.styleCardTitle}>{choice.label}</Text>
                  <Text style={styles.styleCardHint}>{choice.hint}</Text>
                  {active ? <Text style={styles.styleCardCheck}>SELECTED ✓</Text> : null}
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.stepLabel}>CHOOSE WHAT TO KEEP</Text>
          <View accessibilityRole="radiogroup" style={styles.bgOptionGrid}>
            <Pressable
              aria-checked={backgroundMode === 'scene'}
              accessibilityHint="Keeps everything inside your frame and does not upload for background removal"
              accessibilityLabel="Keep scene: use the whole framed photo"
              accessibilityRole="radio"
              accessibilityState={{ checked: backgroundMode === 'scene' }}
              onPress={() => {
                setSmartError(null);
                if (backgroundMode !== 'scene') void buildPanel('scene', photoBuild.style);
              }}
              style={({ pressed }) => [
                styles.bgOption,
                backgroundMode === 'scene' && styles.bgOptionActive,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.bgOptionHead}>
                <Text style={styles.bgOptionTitle}>KEEP SCENE</Text>
                {backgroundMode === 'scene' ? <Text style={styles.bgOptionBadge}>SELECTED ✓</Text> : null}
              </View>
              <Text style={styles.bgOptionText}>
                Use the whole frame. No background-removal upload.
              </Text>
            </Pressable>

            <Pressable
              aria-checked={backgroundMode === 'smart'}
              accessibilityHint="Uploads only this framed crop to the background-removal service"
              accessibilityLabel={
                smartAvailable
                  ? 'Smart isolate: upload this framed crop to isolate the subject'
                  : 'Smart isolate is unavailable in this build'
              }
              accessibilityRole="radio"
              accessibilityState={{ checked: backgroundMode === 'smart', disabled: !smartAvailable }}
              disabled={!smartAvailable}
              onPress={() => {
                if (backgroundMode !== 'smart' || smartError) {
                  void buildPanel('smart', photoBuild.style);
                }
              }}
              style={({ pressed }) => [
                styles.bgOption,
                backgroundMode === 'smart' && styles.bgOptionActive,
                !smartAvailable && styles.bgOptionDisabled,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.bgOptionHead}>
                <Text style={styles.bgOptionTitle}>SMART ISOLATE</Text>
                <Text style={styles.bgOptionBadge}>
                  {!smartAvailable
                    ? 'UNAVAILABLE'
                    : backgroundMode === 'smart'
                      ? 'SELECTED ✓'
                      : 'ONLINE'}
                </Text>
              </View>
              <Text style={styles.bgOptionText}>
                {smartAvailable
                  ? 'Uploads only this framed crop for processing. PixBrik does not store the upload.'
                  : 'Unavailable in this build. Keep scene still uses your full frame.'}
              </Text>
            </Pressable>
          </View>

          {smartError ? (
            <View accessibilityLiveRegion="polite" style={styles.smartError}>
              <Text style={styles.smartErrorText}>{smartError}</Text>
              <Text style={styles.smartErrorHint}>Your existing scene is unchanged. Tap Smart isolate to retry.</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setBackgroundMode('scene');
              setSmartError(null);
              setStage('framing');
            }}
            style={({ pressed }) => [styles.reframeLink, pressed && styles.pressed]}
          >
            <Text style={styles.reframeLinkText}>← Adjust the framing</Text>
          </Pressable>

          {/* Lightbox */}
          {expandedIndex !== null ? (
            <Modal animationType="fade" onRequestClose={() => setExpandedIndex(null)} transparent visible>
              {(() => {
                const choice = STYLE_CHOICES[expandedIndex]!;
                const active = photoBuild.style === choice.style;
                const faces = largeFaces[choice.id];
                return (
                  <View style={styles.viewerBackdrop}>
                    <View style={styles.viewerCard}>
                      <View style={styles.viewerHead}>
                        <Text style={styles.viewerCount}>
                          STYLE {expandedIndex + 1} / {STYLE_CHOICES.length}
                        </Text>
                        <Pressable
                          accessibilityLabel="Close the preview"
                          accessibilityRole="button"
                          onPress={() => setExpandedIndex(null)}
                          style={({ pressed }) => [styles.viewerClose, pressed && styles.pressed]}
                        >
                          <Text style={styles.viewerCloseText}>✕</Text>
                        </Pressable>
                      </View>
                      <View style={styles.viewerStage}>
                        {faces ? (
                          <Svg height="100%" viewBox={`0 0 ${LARGE_VIEW_W} ${LARGE_VIEW_H}`} width="100%">
                            <Rect fill="#17130A" height={LARGE_VIEW_H} width={LARGE_VIEW_W} />
                            <G stroke="#0A0C12" strokeLinejoin="round" strokeWidth={0.3}>
                              {faces.map((face) => (
                                <Polygon fill={face.fill} key={face.id} points={face.points} />
                              ))}
                            </G>
                          </Svg>
                        ) : (
                          <View style={styles.viewerLoading}>
                            <InkLoader size={26} stage="Building this preview" />
                          </View>
                        )}
                        <Pressable
                          accessibilityLabel="Previous style"
                          accessibilityRole="button"
                          onPress={() =>
                            setExpandedIndex((expandedIndex + STYLE_CHOICES.length - 1) % STYLE_CHOICES.length)
                          }
                          style={({ pressed }) => [styles.viewerArrow, styles.viewerArrowLeft, pressed && styles.pressed]}
                        >
                          <Text style={styles.viewerArrowText}>‹</Text>
                        </Pressable>
                        <Pressable
                          accessibilityLabel="Next style"
                          accessibilityRole="button"
                          onPress={() => setExpandedIndex((expandedIndex + 1) % STYLE_CHOICES.length)}
                          style={({ pressed }) => [styles.viewerArrow, styles.viewerArrowRight, pressed && styles.pressed]}
                        >
                          <Text style={styles.viewerArrowText}>›</Text>
                        </Pressable>
                      </View>
                      <View style={styles.viewerDots}>
                        {STYLE_CHOICES.map((entry, index) => (
                          <Pressable
                            accessibilityLabel={`Show ${entry.label}`}
                            accessibilityRole="button"
                            hitSlop={8}
                            key={entry.id}
                            onPress={() => setExpandedIndex(index)}
                            style={[styles.viewerDot, index === expandedIndex && styles.viewerDotActive]}
                          />
                        ))}
                      </View>
                      <Text style={styles.viewerTitle}>{choice.label}</Text>
                      <Text style={styles.viewerHint}>{choice.hint}</Text>
                      <PrimaryButton
                        label={active ? 'Keep this style ✓' : 'Select this style'}
                        onPress={selectExpanded}
                      />
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setExpandedIndex(null)}
                        style={({ pressed }) => [styles.viewerBack, pressed && styles.pressed]}
                      >
                        <Text style={styles.viewerBackText}>← Back to all styles</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })()}
            </Modal>
          ) : null}
        </>
      ) : null}

      {stage === 'failed' ? (
        <View style={styles.failNote}>
          <Text style={styles.failNoteText}>
            That photo could not be processed — try another one, or continue with the sample object.
          </Text>
        </View>
      ) : null}

      {/* ——— Photo entry / sample / rights ——— */}
      {!photoUri ? (
        <View style={styles.captureRow}>
          <View style={styles.hint}>
            <Text style={styles.hintTitle}>
              {Platform.OS === 'web' ? 'Use a real photo' : 'Shoot a real object'}
            </Text>
            <Text style={styles.hintBody}>
              Your photo stays on this device while you frame it. Smart isolate and 3D upload only
              after you choose those features.
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Add a photo"
            accessibilityRole="button"
            onPress={capture}
            style={({ pressed }) => [styles.shutterOuter, pressed && styles.shutterPressed]}
          >
            <View style={styles.shutterInner} />
          </Pressable>
        </View>
      ) : null}

      {photoUri && !webFlow ? (
        <Text style={styles.nativeNote}>
          Brick previews run in the web app for now — continue with the sample object below, or
          open pixbrik.com on this phone's browser.
        </Text>
      ) : null}

      {photoUri ? (
        <Pressable
          aria-checked={rightsConfirmed}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: rightsConfirmed }}
          onPress={() => onRightsConfirmedChange(!rightsConfirmed)}
          style={({ pressed }) => [styles.rights, pressed && styles.pressed]}
        >
          <View style={[styles.rightsBox, rightsConfirmed && styles.rightsBoxChecked]}>
            {rightsConfirmed ? <Text style={styles.rightsCheck}>✓</Text> : null}
          </View>
          <Text style={styles.rightsText}>
            I own or have the rights to use this photo, and it doesn’t infringe anyone’s rights.
          </Text>
        </Pressable>
      ) : null}

      {!photoBuild && (!photoUri || !webFlow) ? (
        <Pressable
          accessibilityHint="Continues with the built-in fox object instead of a photo"
          accessibilityRole="button"
          onPress={onUseSample}
          style={({ pressed }) => [styles.sampleLink, pressed && styles.pressed]}
        >
          <Text style={styles.sampleText}>
            {captured && !photoUri
              ? 'Sample object selected ✓'
              : photoUri
                ? 'Continue with the sample object →'
                : 'No photo handy? Use the sample object →'}
          </Text>
        </Pressable>
      ) : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: colors.panelDark,
    borderRadius: radius.lg,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  nativePhoto: {
    height: '100%',
    width: '100%',
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
  controlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  zoomGroup: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  zoomButton: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  zoomText: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 24,
  },
  controlsHint: {
    ...type.micro,
    color: colors.inkSoft,
    flex: 1,
    textTransform: 'none',
  },
  replaceLink: {
    justifyContent: 'center',
    minHeight: 44,
  },
  replaceLinkText: {
    ...type.body,
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.7,
  },
  stepLabel: {
    ...type.micro,
    color: colors.inkSoft,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  prebuildBackgroundChoice: {
    width: '100%',
  },
  styleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  styleCard: {
    backgroundColor: colors.white,
    borderColor: 'transparent',
    borderRadius: radius.lg,
    borderWidth: 2.5,
    flexBasis: '31%',
    flexGrow: 1,
    minWidth: 130,
    padding: spacing.sm,
  },
  styleCardActive: {
    borderColor: colors.ink,
  },
  stylePreviewBox: {
    aspectRatio: PREVIEW_VIEW_W / PREVIEW_VIEW_H,
    borderRadius: radius.sm,
    overflow: 'hidden',
    width: '100%',
  },
  stylePreviewLoading: {
    backgroundColor: '#17130A',
    flex: 1,
  },
  expandBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderRadius: radius.sm,
    height: 20,
    justifyContent: 'center',
    position: 'absolute',
    right: 4,
    top: 4,
    width: 20,
  },
  expandBadgeText: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 13,
  },
  styleCardTitle: {
    ...type.body,
    color: colors.ink,
    fontSize: 12,
    fontWeight: '900',
    marginTop: spacing.sm,
  },
  styleCardHint: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 8,
    marginTop: 1,
    textTransform: 'none',
  },
  styleCardCheck: {
    ...type.micro,
    color: colors.mintDeep,
    fontSize: 9,
    marginTop: spacing.xs,
  },
  bgOptionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  bgOption: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 2,
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 112,
    minWidth: 190,
    padding: spacing.md,
  },
  bgOptionActive: {
    borderColor: colors.mintDeep,
  },
  bgOptionDisabled: {
    opacity: 0.5,
  },
  bgOptionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  bgOptionTitle: {
    ...type.body,
    color: colors.ink,
    fontSize: 13,
    flexShrink: 1,
    fontWeight: '900',
  },
  bgOptionBadge: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 8,
    flexShrink: 1,
    letterSpacing: 0.8,
    textAlign: 'right',
  },
  bgOptionText: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  smartError: {
    backgroundColor: colors.coralSoft,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  smartErrorText: {
    ...type.body,
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  smartErrorHint: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  reframeLink: {
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 44,
  },
  reframeLinkText: {
    ...type.body,
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  viewerBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(23, 19, 10, 0.88)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  viewerCard: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    maxWidth: 460,
    padding: spacing.lg,
    width: '100%',
  },
  viewerHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  viewerCount: {
    ...type.micro,
    color: colors.inkSoft,
    letterSpacing: 1,
  },
  viewerClose: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  viewerCloseText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '900',
  },
  viewerStage: {
    aspectRatio: LARGE_VIEW_W / LARGE_VIEW_H,
    borderRadius: radius.md,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  viewerLoading: {
    alignItems: 'center',
    backgroundColor: '#17130A',
    flex: 1,
    justifyContent: 'center',
  },
  viewerArrow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: radius.pill,
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    top: '50%',
    transform: [{ translateY: -22 }],
    width: 44,
  },
  viewerArrowLeft: {
    left: spacing.sm,
  },
  viewerArrowRight: {
    right: spacing.sm,
  },
  viewerArrowText: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 26,
  },
  viewerDots: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  viewerDot: {
    backgroundColor: colors.line,
    borderRadius: radius.pill,
    height: 8,
    width: 8,
  },
  viewerDotActive: {
    backgroundColor: colors.ink,
    width: 22,
  },
  viewerTitle: {
    ...type.body,
    color: colors.ink,
    fontSize: 16,
    fontWeight: '900',
    marginTop: spacing.md,
  },
  viewerHint: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 12,
    marginBottom: spacing.md,
    marginTop: 2,
  },
  viewerBack: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 44,
  },
  viewerBackText: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 13,
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
    backgroundColor: colors.coralSoft,
    borderRadius: radius.md,
    flex: 1,
    padding: spacing.md,
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
  shutterPressed: {
    transform: [{ scale: 0.94 }],
  },
  nativeNote: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.md,
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
  sampleText: {
    ...type.body,
    color: colors.blue,
    fontSize: 14,
    fontWeight: '800',
  },
});
