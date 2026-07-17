import { useEffect, useMemo, useState } from 'react';
import { Image, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { G, Polygon, Rect } from 'react-native-svg';

import { BuildNameField } from '../components/BuildNameField';
import { DemoDock } from '../components/DemoDock';
import { PrimaryButton } from '../components/PrimaryButton';
import { RotatableBuildPreview } from '../components/RotatableBuildPreview';
import { ScreenFrame } from '../components/ScreenFrame';
import { isRealisticViewSupported, ThreeBrickView } from '../components/ThreeBrickView';
import { demoProject, variants } from '../data/mockData';
import { estimateBuild } from '../lib/brickify';
import { facesToPngDataUrl, fitFacesToBox, panelMosaicFaces } from '../lib/fitFaces';
import type { PhotoModels } from '../lib/photoEngine/voxelizePhoto';
import { getVoxelModel, type VoxelModel } from '../lib/voxelFox';
import { buildRenderFaces } from '../lib/voxelRender';
import { colors, fonts, radius, shadow, spacing, type } from '../theme/tokens';
import type { DemoScreen } from '../types/navigation';

interface ResultScreenProps {
  selectedVariant: string;
  onSelectVariant: (id: string) => void;
  onBack: () => void;
  onNavigate: (screen: DemoScreen) => void;
  photoUri?: string | null;
  photoBuild?: PhotoModels | null;
  onGuided3D?: () => void;
  onTrue3D?: () => Promise<void>;
  /** Raw stills of the generated 3D model awaiting the buyer's approval. */
  pending3DStills?: string[] | null;
  onApprove3D?: () => Promise<void>;
  onDiscard3D?: () => void;
  true3DState?: 'idle' | 'working' | 'done' | 'failed';
  true3DNote?: string;
  onToggleDimension?: () => Promise<void>;
  canToggleDimension?: boolean;
  dimensionMode?: 'relief' | 'volume';
  dimensionWorking?: boolean;
}

function buildTimeForParts(parts: number): string {
  const minutes = Math.max(30, Math.round(parts * 0.28));
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} h ${(minutes % 60).toString().padStart(2, '0')} min`
    : `${minutes} min`;
}

function describeModel(model: VoxelModel, packedParts?: number) {
  let minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity, minK = Infinity, maxK = -Infinity;
  for (const voxel of model.shell) {
    minI = Math.min(minI, voxel.i); maxI = Math.max(maxI, voxel.i);
    minJ = Math.min(minJ, voxel.j); maxJ = Math.max(maxJ, voxel.j);
    minK = Math.min(minK, voxel.k); maxK = Math.max(maxK, voxel.k);
  }
  if (!model.shell.length) {
    return { dimensions: '—', pieces: 0, time: '—' };
  }
  const width = Math.round((maxI - minI + 1) * 0.8);
  const depth = Math.round((maxK - minK + 1) * 0.8);
  const height = Math.round((maxJ - minJ + 1) * 0.96);
  const pieces = packedParts ?? model.brickCount;
  return {
    dimensions: `${width} × ${depth} × ${height} cm`,
    pieces,
    time: buildTimeForParts(pieces),
  };
}

const accentByName: Readonly<Record<string, string>> = {
  blue: colors.blue,
  mint: colors.mintDeep,
  coral: colors.coral,
};

const modelProfileById = {
  balanced: 'balanced',
  easy: 'efficient',
  detail: 'detailed',
} as const;

/** Square viewBox for the per-profile outcome thumbnails on the tickets. */
const TICKET_VIEW = 76;
const LIKENESS_VIEW_WIDTH = 720;
const LIKENESS_VIEW_HEIGHT = 620;

interface ProfileCard {
  png: string | null;
  pieces: number;
  priceEur: number | null;
}

type PreviewMode = 'likeness' | 'angle';

export function ResultScreen({
  selectedVariant,
  onSelectVariant,
  onBack,
  onNavigate,
  photoUri = null,
  photoBuild = null,
  onGuided3D,
  onTrue3D,
  pending3DStills = null,
  onApprove3D,
  onDiscard3D,
  true3DState = 'idle',
  true3DNote,
  onToggleDimension,
  canToggleDimension = false,
  dimensionMode,
  dimensionWorking = false,
}: ResultScreenProps) {
  const [previewMode, setPreviewMode] = useState<PreviewMode>('likeness');
  const [pdfState, setPdfState] = useState<'idle' | 'working' | 'done' | 'failed'>('idle');
  const [profileCards, setProfileCards] = useState<Record<string, ProfileCard>>({});

  // Each profile ticket previews ITS OWN outcome with real numbers, so the
  // choice is visual instead of a leap of faith. Rasterized to one PNG per
  // ticket (a detailed model as live SVG would be thousands of nodes).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, ProfileCard> = {};
      for (const variant of variants) {
        const profile = modelProfileById[variant.id as keyof typeof modelProfileById] ?? 'balanced';
        const model = photoBuild ? photoBuild.models[profile] : getVoxelModel(profile);
        const variantAccent = accentByName[variant.accent] ?? colors.blue;
        // Panels get the head-on mosaic view — the isometric projection sees
        // them from behind (grey backing only).
        const faces =
          photoBuild?.mode === 'relief'
            ? panelMosaicFaces(model, TICKET_VIEW, TICKET_VIEW, 0.9)
            : fitFacesToBox(
                buildRenderFaces(0.5, variantAccent, model, { baseY: 0, centerX: 0, scale: 1 }),
                TICKET_VIEW,
                TICKET_VIEW,
                0.9,
              );
        // Price the STANDARD kit (hollow): identical from outside, and the
        // number a buyer can actually afford — a solid detailed build prices
        // in four digits and belongs behind the collector option, not here.
        let parts: number | null = null;
        let priceEur: number | null = null;
        try {
          const estimate = estimateBuild(model, variantAccent).hollow;
          parts = estimate.parts;
          priceEur = estimate.bundleEur;
        } catch {
          priceEur = null;
        }
        next[variant.id] = {
          pieces: parts ?? model.brickCount,
          png: facesToPngDataUrl(faces, TICKET_VIEW, TICKET_VIEW, 3),
          priceEur,
        };
        // Yield between profiles so first paint isn't blocked.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (cancelled) return;
      }
      if (!cancelled) setProfileCards(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [photoBuild]);
  const selected = variants.find((variant) => variant.id === selectedVariant) ?? variants[0];
  const accent = selected ? accentByName[selected.accent] ?? colors.blue : colors.blue;
  const modelProfile = modelProfileById[selected?.id as keyof typeof modelProfileById] ?? 'balanced';
  const photoModel = photoBuild ? photoBuild.models[modelProfile] : null;
  const previewModel = photoModel ?? getVoxelModel(modelProfile);
  const likenessFaces = useMemo(
    () => panelMosaicFaces(previewModel, LIKENESS_VIEW_WIDTH, LIKENESS_VIEW_HEIGHT, 0.94),
    [previewModel],
  );
  const [likenessPng, setLikenessPng] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLikenessPng(null);
    const timer = setTimeout(() => {
      const png = facesToPngDataUrl(
        likenessFaces,
        LIKENESS_VIEW_WIDTH,
        LIKENESS_VIEW_HEIGHT,
        2,
      );
      if (!cancelled) setLikenessPng(png);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [likenessFaces]);
  const selectedCard = selected ? profileCards[selected.id] : null;
  const photoStats = photoModel ? describeModel(photoModel, selectedCard?.pieces) : null;
  const buildName = photoBuild
    ? photoBuild.label.charAt(0).toUpperCase() + photoBuild.label.slice(1)
    : demoProject.name;

  return (
    <ScreenFrame
      eyebrow="Build 01 / Generated"
      footer={
        <View style={styles.footerGap}>
          <PrimaryButton label="Get this kit" onPress={() => onNavigate('bom')} />
          <DemoDock active="result" onNavigate={onNavigate} />
        </View>
      }
      onBack={onBack}
      progress={0.62}
      subtitle={
        photoBuild
          ? photoBuild.mode === 'relief'
            ? 'Judge likeness in the head-on panel first. The angled view is optional and naturally looks less like the source photo.'
            : 'Start with the front reference, then use the angled view to inspect the generated depth and shape.'
          : 'Start with the front reference, then inspect the optional angled view before sourcing.'
      }
      title={`${buildName} / Your brick preview`}
    >
      <BuildNameField enabled={!!photoBuild} />
      <View accessibilityLabel="Preview mode" accessibilityRole="tablist" style={styles.previewTabs}>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: previewMode === 'likeness' }}
          onPress={() => setPreviewMode('likeness')}
          style={[styles.previewTab, previewMode === 'likeness' && styles.previewTabSelected]}
        >
          <Text style={[styles.previewTabText, previewMode === 'likeness' && styles.previewTabTextSelected]}>
            CLOSEST LIKENESS
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: previewMode === 'angle' }}
          onPress={() => setPreviewMode('angle')}
          style={[styles.previewTab, previewMode === 'angle' && styles.previewTabSelected]}
        >
          <Text style={[styles.previewTabText, previewMode === 'angle' && styles.previewTabTextSelected]}>
            ANGLED / 3D
          </Text>
        </Pressable>
      </View>
      <View style={[styles.previewGuide, previewMode === 'angle' && styles.previewGuideAngle]}>
        <Text style={[styles.previewGuideTag, previewMode === 'angle' && styles.previewGuideTagAngle]}>
          {previewMode === 'likeness' ? 'BEST VIEW FOR LIKENESS' : 'OPTIONAL DEPTH VIEW'}
        </Text>
        <Text style={styles.previewGuideText}>
          {previewMode === 'likeness'
            ? 'A straight-on build map: use this view to judge the face, colours and framing.'
            : 'This view reveals studs and depth. Perspective and lighting can make it look less like the photo.'}
        </Text>
      </View>
      {previewMode === 'likeness' ? (
        <View
          accessibilityLabel={`${buildName} closest-likeness, head-on brick panel`}
          accessibilityRole="image"
          style={styles.likenessShell}
        >
          <View style={styles.likenessHeader}>
            <Text style={styles.likenessHeaderLabel}>HEAD-ON PANEL // BUILD MAP</Text>
            <Text style={styles.likenessHeaderCount}>
              {likenessFaces.length.toLocaleString('en-US')} VISIBLE COLOUR CELLS
            </Text>
          </View>
          <View style={styles.likenessStage}>
            {likenessPng ? (
              <Image resizeMode="contain" source={{ uri: likenessPng }} style={styles.likenessImage} />
            ) : Platform.OS !== 'web' ? (
              <Svg
                height="100%"
                viewBox={`0 0 ${LIKENESS_VIEW_WIDTH} ${LIKENESS_VIEW_HEIGHT}`}
                width="100%"
              >
                <Rect fill="#17130A" height={LIKENESS_VIEW_HEIGHT} width={LIKENESS_VIEW_WIDTH} />
                <G stroke="#0A0C12" strokeLinejoin="round" strokeWidth={0.5}>
                  {likenessFaces.map((face) => (
                    <Polygon fill={face.fill} key={face.id} points={face.points} />
                  ))}
                </G>
              </Svg>
            ) : (
              <View style={styles.likenessLoading}>
                <Text style={styles.likenessLoadingText}>RENDERING BUILD MAP…</Text>
              </View>
            )}
            {photoUri ? (
              <View pointerEvents="none" style={styles.sourceChip}>
                <Image resizeMode="cover" source={{ uri: photoUri }} style={styles.sourceImage} />
                <Text style={styles.sourceLabel}>SOURCE PHOTO</Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : isRealisticViewSupported ? (
        <ThreeBrickView
          accent={accent}
          label={`${buildName} optional angled 3D preview`}
          model={previewModel}
          packedParts={selectedCard?.pieces}
        />
      ) : (
        <RotatableBuildPreview
          accent={accent}
          label={`${buildName} optional angled build`}
          modelOverride={previewModel}
          profile={modelProfile}
          sourceUri={photoUri}
        />
      )}
      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{photoStats?.pieces ?? selected?.pieces ?? demoProject.pieceCount}</Text>
          <Text style={[styles.statLabel, { color: colors.coral }]}>PIECES</Text>
        </View>
        <View style={styles.statSlant} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>{photoStats?.dimensions ?? selected?.dimensions ?? demoProject.dimensions}</Text>
          <Text style={[styles.statLabel, { color: colors.mint }]}>FINISHED SIZE</Text>
        </View>
        <View style={styles.statSlant} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>{photoStats?.time ?? selected?.estimatedTime ?? demoProject.estimatedTime}</Text>
          <Text style={[styles.statLabel, { color: colors.saffron }]}>BUILD TIME</Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>CHOOSE A BUILD PROFILE — PREVIEWED</Text>
      <View accessibilityRole="radiogroup" style={styles.ticketGroup}>
        {variants.map((variant, index) => {
          const isSelected = variant.id === selectedVariant;
          const variantAccent = accentByName[variant.accent] ?? colors.blue;
          const card = profileCards[variant.id];
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              key={variant.id}
              onPress={() => onSelectVariant(variant.id)}
              style={({ pressed }) => [
                styles.ticket,
                isSelected && styles.ticketSelected,
                pressed && styles.ticketPressed,
              ]}
            >
              {card?.png ? (
                <Image
                  accessibilityLabel={`${variant.name} profile preview`}
                  resizeMode="cover"
                  source={{ uri: card.png }}
                  style={styles.ticketPreview}
                />
              ) : (
                <View style={[styles.ticketNumber, { backgroundColor: variantAccent }]}>
                  <Text style={styles.ticketNumberText}>0{index + 1}</Text>
                </View>
              )}
              <View style={styles.ticketCopy}>
                <Text style={styles.ticketTitle}>{variant.name}</Text>
                <Text style={styles.ticketNote}>
                  {variant.note} · {card ? card.pieces.toLocaleString('en-US') : variant.pieces}{' '}
                  parts
                </Text>
              </View>
              <View style={styles.ticketPrice}>
                <Text style={styles.ticketPriceValue}>
                  €{card?.priceEur ? card.priceEur.toFixed(0) : variant.price.toFixed(0)}
                </Text>
                <Text style={styles.ticketPriceLabel}>standard kit</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {canToggleDimension && onToggleDimension ? (
        <Pressable
          accessibilityRole="button"
          disabled={dimensionWorking}
          onPress={async () => {
            const nextPreview = dimensionMode === 'relief' ? 'angle' : 'likeness';
            await onToggleDimension();
            setPreviewMode(nextPreview);
          }}
          style={({ pressed }) => [styles.dimension, pressed && styles.pdfPressed]}
        >
          <Text style={styles.dimensionIcon}>{dimensionMode === 'relief' ? '◑' : '▭'}</Text>
          <Text style={styles.dimensionText}>
            {dimensionWorking
              ? 'Estimating relief depth from this photo…'
              : dimensionMode === 'relief'
                ? 'Preview estimated relief depth — one-photo guess'
                : 'Switch back to the closest-likeness panel'}
          </Text>
        </Pressable>
      ) : null}

      {Platform.OS === 'web' && photoUri && onGuided3D ? (
        <Pressable
          accessibilityRole="button"
          onPress={onGuided3D}
          style={({ pressed }) => [styles.guided3d, pressed && styles.pdfPressed]}
        >
          <View style={styles.guided3dNumber}>
            <Text style={styles.guided3dNumberText}>4</Text>
          </View>
          <View style={styles.guided3dCopy}>
            <Text style={styles.guided3dTitle}>BEST FULL 3D: CAPTURE 4 GUIDED PHOTOS</Text>
            <Text style={styles.guided3dText}>
              Front, left, back and right give the sculpture real shape instead of guessed hidden sides.
            </Text>
          </View>
          <Text style={styles.guided3dArrow}>→</Text>
        </Pressable>
      ) : null}

      {Platform.OS === 'web' && onTrue3D ? (
        <Pressable
          accessibilityRole="button"
          disabled={true3DState === 'working'}
          onPress={onTrue3D}
          style={({ pressed }) => [styles.true3d, pressed && styles.pdfPressed]}
        >
          <Text style={styles.true3dIcon}>◆</Text>
          <Text style={styles.true3dText}>
            {true3DState === 'working'
              ? true3DNote
                ? `Building a real 3D model… ${true3DNote}`
                : 'Building a real 3D model…'
              : true3DState === 'done'
                ? 'Full 3D sculpture ready ✓'
                : true3DState === 'failed'
                  ? '3D generation failed — try again'
                  : 'Try a one-photo 3D sculpture — sides and back are estimated; you approve it first'}
          </Text>
        </Pressable>
      ) : null}

      {Platform.OS === 'web' && photoUri ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onNavigate('lab')}
          style={({ pressed }) => [styles.labLink, pressed && styles.pdfPressed]}
        >
          <Text style={styles.labLinkText}>Compare 3D engines side by side (lab) →</Text>
        </Pressable>
      ) : null}

      {/* Approve-first: the generated 3D model gets a yes/no BEFORE bricks. */}
      {pending3DStills && onApprove3D && onDiscard3D ? (
        <Modal animationType="fade" onRequestClose={onDiscard3D} transparent visible>
          <View style={styles.approveBackdrop}>
            <View style={styles.approveCard}>
              <Text style={styles.approveTitle}>YOUR 3D MODEL IS READY</Text>
              <Text style={styles.approveBody}>
                This is the exact 3D shape your bricks will be built from. Happy with it? We’ll
                brick it in three sizes with real prices.
              </Text>
              {pending3DStills.length ? (
                <View style={styles.approveShots}>
                  {pending3DStills.map((still, index) => (
                    <Image
                      accessibilityLabel={`Generated 3D model, view ${index + 1}`}
                      key={index}
                      resizeMode="cover"
                      source={{ uri: still }}
                      style={styles.approveShot}
                    />
                  ))}
                </View>
              ) : (
                <Text style={styles.approveNoShots}>
                  (Preview images could not be rendered — the model itself is fine.)
                </Text>
              )}
              <PrimaryButton label="Looks right — brick it" onPress={onApprove3D} />
              <Pressable
                accessibilityRole="button"
                onPress={onDiscard3D}
                style={({ pressed }) => [styles.approveDiscard, pressed && styles.pdfPressed]}
              >
                <Text style={styles.approveDiscardText}>
                  Not quite — discard (generating again costs another run)
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}

      {Platform.OS === 'web' ? (
        <Pressable
          accessibilityRole="button"
          disabled={pdfState === 'working'}
          onPress={async () => {
            setPdfState('working');
            try {
              const { generateInstructionsPdf } = await import('../lib/instructionsPdf');
              await generateInstructionsPdf({
                accent,
                buildName,
                // The guide should always use the exact head-on build map,
                // regardless of which optional preview tab is currently open.
                heroImage:
                  likenessPng ??
                  facesToPngDataUrl(
                    likenessFaces,
                    LIKENESS_VIEW_WIDTH,
                    LIKENESS_VIEW_HEIGHT,
                    2,
                  ),
                model: previewModel,
              });
              setPdfState('done');
            } catch {
              setPdfState('failed');
            }
          }}
          style={({ pressed }) => [styles.pdfButton, pressed && styles.pdfPressed]}
        >
          <Text style={styles.pdfIcon}>▤</Text>
          <Text style={styles.pdfText}>
            {pdfState === 'working'
              ? 'Building your guide…'
              : pdfState === 'done'
                ? 'Guide downloaded ✓ — export again'
                : pdfState === 'failed'
                  ? 'Export failed — try again'
                  : 'Export PixBrik build guide (PDF)'}
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.inspectMeta}>
        <View style={styles.inspectMetaRow}>
          <View>
            <Text style={styles.inspectMetaLabel}>DIFFICULTY</Text>
            <Text style={styles.inspectMetaValue}>{selected?.difficulty ?? 'Intermediate'}</Text>
          </View>
          <View style={styles.inspectMetaRight}>
            <Text style={styles.inspectMetaLabel}>CATALOG</Text>
            <Text style={styles.inspectMetaValue}>{demoProject.catalogVersion}</Text>
          </View>
        </View>
        <Text style={styles.assumption}>ASSUMPTION / {demoProject.assumption}</Text>
      </View>

    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  footerGap: {
    gap: spacing.md,
  },
  previewTabs: {
    backgroundColor: colors.paperDeep,
    borderRadius: radius.md,
    flexDirection: 'row',
    marginBottom: spacing.md,
    padding: 3,
    width: '100%',
  },
  previewTab: {
    alignItems: 'center',
    borderRadius: radius.sm,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  previewTabSelected: {
    backgroundColor: colors.blue,
  },
  previewTabText: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 9,
    letterSpacing: 1.1,
    textAlign: 'center',
  },
  previewTabTextSelected: {
    color: colors.white,
  },
  previewGuide: {
    backgroundColor: colors.saffron,
    borderLeftColor: colors.ink,
    borderLeftWidth: 5,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  previewGuideAngle: {
    backgroundColor: colors.blueSoft,
    borderLeftColor: colors.blue,
  },
  previewGuideTag: {
    ...type.micro,
    color: colors.ink,
    fontSize: 9,
    letterSpacing: 1.2,
  },
  previewGuideTagAngle: {
    color: colors.blue,
  },
  previewGuideText: {
    ...type.body,
    color: colors.ink,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    marginTop: 2,
  },
  likenessShell: {
    backgroundColor: '#10131D',
    borderColor: '#31384D',
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
  },
  likenessHeader: {
    alignItems: 'center',
    borderBottomColor: '#282E40',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  likenessHeaderLabel: {
    color: '#D9FFF8',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  likenessHeaderCount: {
    color: colors.saffron,
    fontSize: 9,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  likenessStage: {
    aspectRatio: LIKENESS_VIEW_WIDTH / LIKENESS_VIEW_HEIGHT,
    backgroundColor: colors.ink,
    position: 'relative',
    width: '100%',
  },
  likenessImage: {
    height: '100%',
    width: '100%',
  },
  likenessLoading: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  likenessLoadingText: {
    color: colors.saffron,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  sourceChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(11, 14, 22, 0.88)',
    borderColor: '#384158',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 4,
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
  },
  sourceImage: {
    borderRadius: radius.sm,
    height: 58,
    width: 58,
  },
  sourceLabel: {
    color: '#C6CDDE',
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 0.9,
    marginTop: 3,
  },
  stats: {
    alignItems: 'stretch',
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    flexDirection: 'row',
    marginBottom: spacing.xl,
    marginTop: spacing.md,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
  },
  stat: {
    flex: 1,
    justifyContent: 'center',
  },
  statValue: {
    ...type.body,
    color: colors.white,
    fontSize: 14,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  statLabel: {
    ...type.micro,
    fontSize: 9,
    letterSpacing: 0.7,
    marginTop: 2,
    textAlign: 'center',
  },
  statSlant: {
    backgroundColor: colors.inkSoft,
    marginHorizontal: spacing.sm,
    transform: [{ rotate: '8deg' }],
    width: 1,
  },
  dimension: {
    alignItems: 'center',
    backgroundColor: colors.coral,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  dimensionIcon: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '900',
  },
  dimensionText: {
    ...type.body,
    color: colors.white,
    fontSize: 14,
    fontWeight: '800',
  },
  labLink: {
    justifyContent: 'center',
    marginBottom: spacing.md,
    minHeight: 44,
  },
  approveBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(23, 19, 10, 0.88)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  approveCard: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    maxWidth: 460,
    padding: spacing.lg,
    width: '100%',
  },
  approveTitle: {
    ...type.label,
    color: colors.ink,
    fontSize: 16,
  },
  approveBody: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  approveShots: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  approveShot: {
    aspectRatio: 460 / 400,
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    flex: 1,
  },
  approveNoShots: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 12,
    marginBottom: spacing.lg,
  },
  approveDiscard: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 44,
  },
  approveDiscardText: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 12,
    fontWeight: '800',
  },
  labLinkText: {
    ...type.body,
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  guided3d: {
    ...shadow.card,
    alignItems: 'center',
    backgroundColor: colors.mintSoft,
    borderColor: colors.ink,
    borderRadius: radius.md,
    borderWidth: 2,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
    minHeight: 74,
    padding: spacing.md,
  },
  guided3dNumber: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  guided3dNumberText: {
    color: colors.saffron,
    fontFamily: fonts.display,
    fontSize: 19,
  },
  guided3dCopy: {
    flex: 1,
  },
  guided3dTitle: {
    color: colors.ink,
    fontFamily: fonts.extrabold,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  guided3dText: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  guided3dArrow: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 20,
  },
  true3d: {
    alignItems: 'center',
    backgroundColor: colors.blue,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  true3dIcon: {
    color: colors.saffron,
    fontSize: 16,
    fontWeight: '900',
  },
  true3dText: {
    ...type.body,
    color: colors.white,
    fontSize: 14,
    fontWeight: '800',
  },
  pdfButton: {
    alignItems: 'center',
    backgroundColor: colors.panelDark,
    borderLeftColor: colors.saffron,
    borderLeftWidth: 5,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  pdfPressed: {
    opacity: 0.8,
  },
  pdfIcon: {
    color: colors.saffron,
    fontSize: 18,
    fontWeight: '900',
  },
  pdfText: {
    ...type.body,
    color: colors.white,
    fontSize: 14,
    fontWeight: '800',
  },
  inspectMeta: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.xl,
    padding: spacing.md,
  },
  inspectMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  inspectMetaRight: {
    alignItems: 'flex-end',
  },
  inspectMetaLabel: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 9,
    letterSpacing: 1,
  },
  inspectMetaValue: {
    ...type.body,
    color: colors.ink,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  assumption: {
    ...type.body,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    color: colors.inkSoft,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  sectionLabel: {
    ...type.label,
    color: colors.inkSoft,
    marginBottom: spacing.md,
  },
  ticketGroup: {
    marginBottom: spacing.xl,
  },
  ticket: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: spacing.md,
    minHeight: 78,
    overflow: 'hidden',
    paddingRight: spacing.md,
  },
  ticketPreview: {
    alignSelf: 'stretch',
    backgroundColor: '#17130A',
    borderRightColor: colors.ink,
    borderRightWidth: 2,
    minHeight: 76,
    width: 76,
  },
  ticketSelected: {
    backgroundColor: colors.blueSoft,
    borderColor: colors.blue,
    borderWidth: 1.5,
  },
  ticketPressed: {
    opacity: 0.75,
  },
  ticketNumber: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderRightColor: colors.ink,
    borderRightWidth: 2,
    justifyContent: 'center',
    width: 58,
  },
  ticketNumberText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '900',
  },
  ticketCopy: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  ticketTitle: {
    ...type.body,
    color: colors.ink,
    fontWeight: '900',
  },
  ticketNote: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 12,
    lineHeight: 17,
  },
  ticketPrice: {
    alignItems: 'flex-end',
  },
  ticketPriceValue: {
    ...type.body,
    color: colors.ink,
    fontWeight: '900',
  },
  ticketPriceLabel: {
    ...type.micro,
    color: colors.mintDeep,
    fontSize: 9,
  },
});
