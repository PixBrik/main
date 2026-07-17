import { useEffect, useMemo, useState } from 'react';
import { Image, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { G, Polygon, Rect } from 'react-native-svg';

import { BuildNameField } from '../components/BuildNameField';
import { DemoDock } from '../components/DemoDock';
import { InkLoader } from '../components/InkLoader';
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
import type { BuildProduct, DemoScreen } from '../types/navigation';

interface ResultScreenProps {
  selectedVariant: string;
  onSelectVariant: (id: string) => void;
  onBack: () => void;
  onNavigate: (screen: DemoScreen) => void;
  photoUri?: string | null;
  photoBuild?: PhotoModels | null;
  panelBuild?: PhotoModels | null;
  sculptureBuild?: PhotoModels | null;
  activeProduct: BuildProduct;
  onSelectProduct: (product: BuildProduct) => void;
  onGuided3D?: () => void;
  onTrue3D?: () => Promise<void>;
  /** Raw stills of the generated 3D model awaiting the buyer's approval. */
  pending3DStills?: string[] | null;
  onApprove3D?: () => Promise<void>;
  onDiscard3D?: () => void;
  onRetry3DPreview?: () => Promise<void>;
  true3DState?: 'idle' | 'working' | 'done' | 'failed';
  true3DNote?: string;
  true3DError?: string;
  true3DAvailable?: boolean;
  /** Known portrait/person inputs must use real views instead of one-photo inference. */
  humanSubject?: boolean;
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
const MESH_APPROVAL_VIEWS = ['FRONT', 'RIGHT', 'BACK', 'LEFT'] as const;

export function ResultScreen({
  selectedVariant,
  onSelectVariant,
  onBack,
  onNavigate,
  photoUri = null,
  photoBuild = null,
  panelBuild = null,
  sculptureBuild = null,
  activeProduct,
  onSelectProduct,
  onGuided3D,
  onTrue3D,
  pending3DStills = null,
  onApprove3D,
  onDiscard3D,
  onRetry3DPreview,
  true3DState = 'idle',
  true3DNote,
  true3DError = '',
  true3DAvailable = false,
  humanSubject = false,
}: ResultScreenProps) {
  const [previewMode, setPreviewMode] = useState<PreviewMode>('likeness');
  const [confirm3D, setConfirm3D] = useState(false);
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
  const namingBuild = photoBuild ?? panelBuild;
  const buildName = namingBuild
    ? namingBuild.label.charAt(0).toUpperCase() + namingBuild.label.slice(1)
    : demoProject.name;
  const awaitingSculpture = activeProduct === 'sculpture' && !sculptureBuild;
  const generatedSculpture = activeProduct === 'sculpture' && !!sculptureBuild;

  return (
    <ScreenFrame
      eyebrow="Build 01 / Generated"
      footer={
        <View style={styles.footerGap}>
          <PrimaryButton
            disabled={awaitingSculpture}
            label={awaitingSculpture ? 'Generate and approve the 3D first' : 'Get this kit'}
            onPress={() => onNavigate('bom')}
          />
          <DemoDock
            active="result"
            downstreamDisabled={awaitingSculpture}
            onNavigate={onNavigate}
          />
        </View>
      }
      onBack={onBack}
      progress={0.62}
      subtitle={
        awaitingSculpture
          ? humanSubject
            ? 'People use four real views so the generator does not invent or mirror a face onto the unseen sides of a head.'
            : 'This option creates a textured Meshy or Tripo mesh first. One-photo AI guesses unseen sides; you approve the mesh before brick conversion.'
          : generatedSculpture
            ? 'This is the brick conversion of the API-generated 3D mesh you approved—not a relief or depth guess.'
            : 'The flat panel preserves the framed photo directly. Its angled view only shows panel thickness; it is not the 3D sculpture.'
      }
      title={`${buildName} / ${activeProduct === 'sculpture' ? 'True 3D sculpture' : 'Flat photo panel'}`}
    >
      <BuildNameField enabled={!!photoBuild} />
      {photoUri && panelBuild ? (
        <View accessibilityLabel="Build product" accessibilityRole="tablist" style={styles.productTabs}>
          <Pressable
            aria-selected={activeProduct === 'panel'}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeProduct === 'panel' }}
            onPress={() => {
              onSelectProduct('panel');
              setPreviewMode('likeness');
            }}
            style={[styles.productTab, activeProduct === 'panel' && styles.productTabSelected]}
          >
            <Text style={styles.productKicker}>READY NOW</Text>
            <Text style={styles.productTitle}>FLAT PHOTO PANEL</Text>
            <Text style={styles.productBody}>Best likeness · exact framed photo</Text>
          </Pressable>
          <Pressable
            aria-selected={activeProduct === 'sculpture'}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeProduct === 'sculpture' }}
            onPress={() => {
              onSelectProduct('sculpture');
              setPreviewMode('angle');
            }}
            style={[styles.productTab, activeProduct === 'sculpture' && styles.productTabSelected3D]}
          >
            <Text style={styles.productKicker}>
              {sculptureBuild
                ? 'MESH APPROVED'
                : pending3DStills
                  ? 'MESH READY'
                  : true3DState === 'working'
                    ? 'GENERATING'
                    : 'PREMIUM OPTION'}
            </Text>
            <Text style={styles.productTitle}>TRUE 3D SCULPTURE</Text>
            <Text style={styles.productBody}>
              {humanSubject ? '4 real views required for people' : '1 photo inference or 4-view accuracy'}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {awaitingSculpture ? (
        <View style={styles.generationCard}>
          <View style={styles.generationHero}>
            {photoUri ? (
              <Image
                accessibilityLabel="Photo selected for true 3D generation"
                resizeMode="cover"
                source={{ uri: photoUri }}
                style={styles.generationPhoto}
              />
            ) : null}
            <View style={styles.generationHeroCopy}>
              <Text style={styles.generationKicker}>
                {humanSubject ? 'PERSON DETECTED · REAL VIEWS REQUIRED' : 'REAL MESH FIRST'}
              </Text>
              <Text style={styles.generationTitle}>
                {humanSubject
                  ? 'CAPTURE EVERY SIDE OF THIS PERSON'
                  : 'TURN THIS OBJECT PHOTO INTO AN ALL-SIDED 3D MODEL'}
              </Text>
              <Text style={styles.generationBody}>
                {humanSubject
                  ? 'One portrait cannot show the sides or back of a head. Four guided photos stop the AI from using a guessed or mirrored face as hidden-surface evidence.'
                  : 'One-photo AI infers—and therefore guesses—the unseen sides of an object. You inspect the raw textured Meshy or Tripo model before brick conversion.'}
              </Text>
            </View>
          </View>

          <View accessibilityLabel="True 3D process" style={styles.pipeline}>
            <Text style={styles.pipelineStep}>{humanSubject ? '4 REAL VIEWS' : '1 OBJECT PHOTO'}</Text>
            <Text style={styles.pipelineArrow}>→</Text>
            <Text style={styles.pipelineStep}>MESHY / TRIPO</Text>
            <Text style={styles.pipelineArrow}>→</Text>
            <Text style={styles.pipelineStep}>APPROVE MESH</Text>
            <Text style={styles.pipelineArrow}>→</Text>
            <Text style={styles.pipelineStep}>CATALOG BRIKS</Text>
          </View>

          {true3DState === 'working' ? (
            <View style={styles.generationProgress}>
              <InkLoader size={26} stage={true3DNote || 'Generating the textured 3D mesh'} />
              <Text style={styles.generationProgressText}>
                Keep this tab open. The sculpture will not be converted to bricks until you approve it.
              </Text>
            </View>
          ) : null}

          {true3DError ? (
            <View accessibilityRole="alert" style={styles.generationError}>
              <Text style={styles.generationErrorTitle}>3D GENERATION STOPPED</Text>
              <Text style={styles.generationErrorText}>{true3DError}</Text>
            </View>
          ) : null}

          {humanSubject ? (
            <>
              <View style={styles.costNotice}>
                <Text style={styles.costNoticeTitle}>WHY ONE PHOTO IS BLOCKED</Text>
                <Text style={styles.costNoticeText}>
                  A portrait shows only one surface. PixBrik will not pay a provider to guess or mirror a person's unseen head and face surfaces.
                </Text>
              </View>
              <PrimaryButton
                disabled={!true3DAvailable || !onGuided3D || true3DState === 'working'}
                label={true3DAvailable ? 'Take 4 guided photos of this person' : 'True 3D is unavailable here'}
                onPress={() => onGuided3D?.()}
              />
            </>
          ) : (
            <>
              <PrimaryButton
                disabled={!true3DAvailable || !onTrue3D || true3DState === 'working'}
                label={
                  true3DState === 'working'
                    ? 'Generating real 3D…'
                    : true3DState === 'failed'
                      ? 'Review and retry 3D generation'
                      : '1 photo · AI guesses unseen sides'
                }
                onPress={() => setConfirm3D(true)}
              />
              <Text style={styles.generationDisclosure}>
                {true3DAvailable
                  ? 'For non-human objects only. This uploads the framed photo or approved smart cutout and uses one paid generation run; hidden sides are AI inference, not captured evidence.'
                  : 'True 3D is not enabled on this deployment yet. Configure the server provider before offering this paid option.'}
              </Text>
            </>
          )}

          {!humanSubject && Platform.OS === 'web' && photoUri && onGuided3D ? (
            <Pressable
              accessibilityRole="button"
              disabled={true3DState === 'working'}
              onPress={onGuided3D}
              style={({ pressed }) => [styles.guided3d, pressed && styles.pdfPressed]}
            >
              <View style={styles.guided3dNumber}>
                <Text style={styles.guided3dNumberText}>4</Text>
              </View>
              <View style={styles.guided3dCopy}>
                <Text style={styles.guided3dTitle}>HIGHER ACCURACY: USE 4 GUIDED PHOTOS</Text>
                <Text style={styles.guided3dText}>
                  Front, left, back and right replace hidden-side guesses with real visual evidence.
                </Text>
              </View>
              <Text style={styles.guided3dArrow}>→</Text>
            </Pressable>
          ) : null}

          <Text style={styles.noReliefNote}>
            No relief extrusion and no demo mesh: this route only completes when a real provider mesh is approved.
          </Text>
        </View>
      ) : (
        <>
      <View accessibilityLabel="Preview mode" accessibilityRole="tablist" style={styles.previewTabs}>
        <Pressable
          aria-selected={previewMode === 'likeness'}
          accessibilityRole="tab"
          accessibilityState={{ selected: previewMode === 'likeness' }}
          onPress={() => setPreviewMode('likeness')}
          style={[styles.previewTab, previewMode === 'likeness' && styles.previewTabSelected]}
        >
          <Text style={[styles.previewTabText, previewMode === 'likeness' && styles.previewTabTextSelected]}>
            {activeProduct === 'panel' ? 'FRONT / LIKENESS' : 'FRONT PROJECTION'}
          </Text>
        </Pressable>
        <Pressable
          aria-selected={previewMode === 'angle'}
          accessibilityRole="tab"
          accessibilityState={{ selected: previewMode === 'angle' }}
          onPress={() => setPreviewMode('angle')}
          style={[styles.previewTab, previewMode === 'angle' && styles.previewTabSelected]}
        >
          <Text style={[styles.previewTabText, previewMode === 'angle' && styles.previewTabTextSelected]}>
            {activeProduct === 'panel' ? 'PANEL ANGLE' : 'ROTATE 3D'}
          </Text>
        </Pressable>
      </View>
      <View style={[styles.previewGuide, previewMode === 'angle' && styles.previewGuideAngle]}>
        <Text style={[styles.previewGuideTag, previewMode === 'angle' && styles.previewGuideTagAngle]}>
          {previewMode === 'likeness'
            ? activeProduct === 'panel'
              ? 'BEST VIEW FOR LIKENESS'
              : 'FRONT OF APPROVED SCULPTURE'
            : activeProduct === 'panel'
              ? 'PANEL THICKNESS VIEW'
              : 'REAL ALL-SIDED GEOMETRY'}
        </Text>
        <Text style={styles.previewGuideText}>
          {previewMode === 'likeness'
            ? activeProduct === 'panel'
              ? 'A straight-on build map: use this view to judge the face, colours and framing.'
              : 'A front projection of the sculpture generated from the provider mesh you approved.'
            : activeProduct === 'panel'
              ? 'This camera only reveals the panel backing and stud depth. It does not turn the photo into a 3D sculpture.'
              : 'Rotate the catalog-brick sculpture to inspect the geometry inherited from the approved Meshy or Tripo mesh.'}
        </Text>
      </View>
      {previewMode === 'likeness' ? (
        <View
          accessibilityLabel={`${buildName} ${activeProduct === 'panel' ? 'head-on brick panel' : 'front sculpture projection'}`}
          accessibilityRole="image"
          style={styles.likenessShell}
        >
          <View style={styles.likenessHeader}>
            <Text style={styles.likenessHeaderLabel}>
              {activeProduct === 'panel' ? 'HEAD-ON PANEL // BUILD MAP' : 'SCULPTURE // FRONT PROJECTION'}
            </Text>
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
          label={`${buildName} ${activeProduct === 'panel' ? 'angled panel thickness view' : 'rotatable 3D sculpture'}`}
          model={previewModel}
          packedParts={selectedCard?.pieces}
        />
      ) : (
        <RotatableBuildPreview
          accent={accent}
          label={`${buildName} ${activeProduct === 'panel' ? 'angled panel thickness view' : 'rotatable 3D sculpture'}`}
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
              aria-checked={isSelected}
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
        </>
      )}

      {confirm3D && onTrue3D && !humanSubject ? (
        <Modal
          animationType="fade"
          onRequestClose={() => setConfirm3D(false)}
          transparent
          visible
        >
          <View style={styles.approveBackdrop}>
            <View style={styles.approveCard}>
              <Text style={styles.approveTitle}>GENERATE ONE-PHOTO 3D FOR THIS OBJECT?</Text>
              <Text style={styles.approveBody}>
                PixBrik will upload the framed photo or approved smart cutout to Meshy or Tripo.
                AI guesses the unseen sides because this photo cannot show them. Before conversion,
                inspect FRONT, RIGHT, BACK and LEFT—especially the rear surface. If the photo
                contains a person, do not continue with one-photo inference.
              </Text>
              <View style={styles.costNotice}>
                <Text style={styles.costNoticeTitle}>ONE PAID PROVIDER RUN</Text>
                <Text style={styles.costNoticeText}>
                  A retry creates another paid run. Closing this dialog costs nothing.
                </Text>
              </View>
              <PrimaryButton
                label="This is an object — generate one-photo mesh"
                onPress={() => {
                  setConfirm3D(false);
                  void onTrue3D();
                }}
              />
              {onGuided3D ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setConfirm3D(false);
                    onGuided3D();
                  }}
                  style={({ pressed }) => [styles.approveDiscard, pressed && styles.pdfPressed]}
                >
                  <Text style={styles.approveDiscardText}>Contains a person — use 4 real views instead</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => setConfirm3D(false)}
                style={({ pressed }) => [styles.approveDiscard, pressed && styles.pdfPressed]}
              >
                <Text style={styles.approveDiscardText}>Not now — no provider run</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}

      {/* Approve-first: the generated 3D model gets a yes/no BEFORE bricks. */}
      {pending3DStills && onApprove3D && onDiscard3D ? (
        <Modal animationType="fade" onRequestClose={onDiscard3D} transparent visible>
          <View style={styles.approveBackdrop}>
            <View style={styles.approveCard}>
              <Text style={styles.approveTitle}>YOUR 3D MODEL IS READY</Text>
              <Text style={styles.approveBody}>
                This is the exact 3D shape your bricks will be built from. Inspect FRONT, RIGHT,
                BACK and LEFT—especially the rear surface—before approving three build sizes.
              </Text>
              {true3DError ? (
                <View accessibilityRole="alert" style={styles.generationError}>
                  <Text style={styles.generationErrorText}>{true3DError}</Text>
                </View>
              ) : null}
              {pending3DStills.length ? (
                <View style={styles.approveShots}>
                  {pending3DStills.map((still, index) => {
                    const view = MESH_APPROVAL_VIEWS[index] ?? `VIEW ${index + 1}`;
                    return (
                      <View key={view} style={styles.approveShotWrap}>
                        <Image
                          accessibilityLabel={`Generated 3D model, ${view.toLowerCase()} view`}
                          resizeMode="contain"
                          source={{ uri: still }}
                          style={styles.approveShot}
                        />
                        <Text style={styles.approveShotLabel}>{view}</Text>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <View accessibilityRole="alert" style={styles.previewBlocked}>
                  <Text style={styles.previewBlockedTitle}>PREVIEW REQUIRED</Text>
                  <Text style={styles.approveNoShots}>
                    The approval images did not render, so PixBrik will not convert this mesh blindly.
                    Retrying the preview does not create another provider generation.
                  </Text>
                </View>
              )}
              {pending3DStills.length ? (
                <PrimaryButton label="Looks right — brick it" onPress={onApprove3D} />
              ) : onRetry3DPreview ? (
                <PrimaryButton
                  disabled={true3DState === 'working'}
                  label={true3DState === 'working' ? 'Rendering preview…' : 'Retry preview — no new generation'}
                  onPress={() => void onRetry3DPreview()}
                />
              ) : null}
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

      {Platform.OS === 'web' && !awaitingSculpture ? (
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

      {!awaitingSculpture ? (
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
      ) : null}

    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  footerGap: {
    gap: spacing.md,
  },
  productTabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
    width: '100%',
  },
  productTab: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 2,
    flex: 1,
    minHeight: 116,
    padding: spacing.md,
  },
  productTabSelected: {
    backgroundColor: colors.saffron,
    borderColor: colors.ink,
  },
  productTabSelected3D: {
    backgroundColor: colors.blueSoft,
    borderColor: colors.blue,
  },
  productKicker: {
    ...type.micro,
    color: colors.coral,
    fontSize: 8,
    letterSpacing: 1.1,
  },
  productTitle: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 14,
    lineHeight: 17,
    marginTop: 5,
  },
  productBody: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 4,
  },
  generationCard: {
    ...shadow.card,
    backgroundColor: colors.panelDark,
    borderColor: colors.ink,
    borderRadius: radius.lg,
    borderWidth: 2,
    gap: spacing.md,
    marginBottom: spacing.xl,
    padding: spacing.lg,
  },
  generationHero: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  generationPhoto: {
    aspectRatio: 0.82,
    backgroundColor: colors.ink,
    borderColor: colors.saffron,
    borderRadius: radius.md,
    borderWidth: 2,
    width: 108,
  },
  generationHeroCopy: {
    flex: 1,
  },
  generationKicker: {
    ...type.micro,
    color: colors.saffron,
    fontSize: 9,
    letterSpacing: 1.3,
  },
  generationTitle: {
    color: colors.white,
    fontFamily: fonts.display,
    fontSize: 19,
    lineHeight: 22,
    marginTop: 4,
  },
  generationBody: {
    ...type.body,
    color: '#C6CDDE',
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  pipeline: {
    alignItems: 'center',
    backgroundColor: '#10131D',
    borderRadius: radius.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    justifyContent: 'center',
    padding: spacing.md,
  },
  pipelineStep: {
    ...type.micro,
    color: colors.white,
    fontSize: 8,
    letterSpacing: 0.7,
  },
  pipelineArrow: {
    color: colors.saffron,
    fontSize: 13,
    fontWeight: '900',
  },
  generationProgress: {
    alignItems: 'center',
    backgroundColor: colors.saffron,
    borderRadius: radius.md,
    gap: spacing.sm,
    padding: spacing.md,
  },
  generationProgressText: {
    ...type.body,
    color: colors.ink,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 15,
    textAlign: 'center',
  },
  generationError: {
    backgroundColor: colors.coralSoft,
    borderLeftColor: colors.coral,
    borderLeftWidth: 5,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  generationErrorTitle: {
    ...type.micro,
    color: colors.coral,
    fontSize: 9,
  },
  generationErrorText: {
    ...type.body,
    color: colors.ink,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  generationDisclosure: {
    ...type.body,
    color: '#C6CDDE',
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'center',
  },
  noReliefNote: {
    ...type.body,
    color: colors.saffron,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 15,
    textAlign: 'center',
  },
  costNotice: {
    backgroundColor: colors.saffron,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  costNoticeTitle: {
    ...type.micro,
    color: colors.ink,
    fontSize: 9,
  },
  costNoticeText: {
    ...type.body,
    color: colors.ink,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  previewBlocked: {
    backgroundColor: colors.coralSoft,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  previewBlockedTitle: {
    ...type.micro,
    color: colors.coral,
    fontSize: 9,
    marginBottom: 3,
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
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  approveShotWrap: {
    flexBasis: '45%',
    flexGrow: 1,
  },
  approveShot: {
    aspectRatio: 460 / 400,
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    width: '100%',
  },
  approveShotLabel: {
    ...type.micro,
    color: colors.ink,
    fontSize: 8,
    marginTop: 4,
    textAlign: 'center',
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
    backgroundColor: colors.paper,
    borderColor: colors.saffron,
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
