import { useEffect, useState } from 'react';
import { Image, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { BuildNameField } from '../components/BuildNameField';
import { BuildPreview } from '../components/BuildPreview';
import { DemoDock } from '../components/DemoDock';
import { PrimaryButton } from '../components/PrimaryButton';
import { RotatableBuildPreview } from '../components/RotatableBuildPreview';
import { ScreenFrame } from '../components/ScreenFrame';
import { isRealisticViewSupported, ThreeBrickView } from '../components/ThreeBrickView';
import { demoProject, variants } from '../data/mockData';
import { estimateBuild } from '../lib/brickify';
import { facesToPngDataUrl, fitFacesToBox } from '../lib/fitFaces';
import type { PhotoModels } from '../lib/photoEngine/voxelizePhoto';
import { getVoxelModel, type VoxelModel } from '../lib/voxelFox';
import { buildRenderFaces } from '../lib/voxelRender';
import { colors, radius, spacing, type } from '../theme/tokens';
import type { DemoScreen } from '../types/navigation';

interface ResultScreenProps {
  selectedVariant: string;
  onSelectVariant: (id: string) => void;
  onBack: () => void;
  onNavigate: (screen: DemoScreen) => void;
  photoUri?: string | null;
  photoBuild?: PhotoModels | null;
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

function describeModel(model: VoxelModel) {
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
  const minutes = Math.round(model.brickCount * 0.45);
  const time = minutes >= 60 ? `${Math.floor(minutes / 60)} h ${(minutes % 60).toString().padStart(2, '0')} min` : `${minutes} min`;
  return { dimensions: `${width} × ${depth} × ${height} cm`, pieces: model.brickCount, time };
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

interface ProfileCard {
  png: string | null;
  pieces: number;
  priceEur: number | null;
}

type PreviewMode = 'real' | 'model' | 'blueprint';

export function ResultScreen({
  selectedVariant,
  onSelectVariant,
  onBack,
  onNavigate,
  photoUri = null,
  photoBuild = null,
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
  const [previewMode, setPreviewMode] = useState<PreviewMode>(
    isRealisticViewSupported ? 'real' : 'model',
  );
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
        const faces = fitFacesToBox(
          buildRenderFaces(0.5, variantAccent, model, { baseY: 0, centerX: 0, scale: 1 }),
          TICKET_VIEW,
          TICKET_VIEW,
          0.9,
        );
        let priceEur: number | null = null;
        try {
          priceEur = estimateBuild(model, variantAccent).full.bundleEur;
        } catch {
          priceEur = null;
        }
        next[variant.id] = {
          pieces: model.brickCount,
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
  const photoStats = photoModel ? describeModel(photoModel) : null;
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
          ? photoBuild.hasDepth
            ? 'Depth-mapped 3D interpretation — the front surface follows measured depth from your photo.'
            : 'Interpretation of your photo — rotate it, compare build profiles, and inspect every part.'
          : 'Rotate the generated model, compare build profiles, and inspect every part before sourcing.'
      }
      title={`${buildName} / Ready to inspect`}
    >
      <BuildNameField enabled={!!photoBuild} />
      <View accessibilityLabel="Preview mode" accessibilityRole="tablist" style={styles.previewTabs}>
        {isRealisticViewSupported ? (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: previewMode === 'real' }}
            onPress={() => setPreviewMode('real')}
            style={[styles.previewTab, previewMode === 'real' && styles.previewTabSelected]}
          >
            <Text style={[styles.previewTabText, previewMode === 'real' && styles.previewTabTextSelected]}>REALISTIC</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: previewMode === 'model' }}
          onPress={() => setPreviewMode('model')}
          style={[styles.previewTab, previewMode === 'model' && styles.previewTabSelected]}
        >
          <Text style={[styles.previewTabText, previewMode === 'model' && styles.previewTabTextSelected]}>SCHEMATIC</Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: previewMode === 'blueprint' }}
          onPress={() => setPreviewMode('blueprint')}
          style={[styles.previewTab, previewMode === 'blueprint' && styles.previewTabSelected]}
        >
          <Text style={[styles.previewTabText, previewMode === 'blueprint' && styles.previewTabTextSelected]}>BUILD VIEW</Text>
        </Pressable>
      </View>
      {previewMode === 'real' && isRealisticViewSupported ? (
        <ThreeBrickView
          accent={accent}
          label={`${buildName} realistic 3D preview`}
          model={photoModel ?? getVoxelModel(modelProfile)}
        />
      ) : previewMode === 'model' ? (
        <RotatableBuildPreview
          accent={accent}
          label={`${buildName} ${selected?.name ?? 'Balanced'} build`}
          modelOverride={photoModel}
          profile={modelProfile}
          sourceUri={photoUri}
        />
      ) : (
        <BuildPreview accent={accent} label="Static assembly view" />
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
                  {variant.note} · {card ? card.pieces : variant.pieces} pieces
                </Text>
              </View>
              <View style={styles.ticketPrice}>
                <Text style={styles.ticketPriceValue}>
                  €{card?.priceEur ? card.priceEur.toFixed(0) : variant.price.toFixed(0)}
                </Text>
                <Text style={styles.ticketPriceLabel}>kit estimate</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {canToggleDimension && onToggleDimension ? (
        <Pressable
          accessibilityRole="button"
          disabled={dimensionWorking}
          onPress={onToggleDimension}
          style={({ pressed }) => [styles.dimension, pressed && styles.pdfPressed]}
        >
          <Text style={styles.dimensionIcon}>{dimensionMode === 'relief' ? '◑' : '▭'}</Text>
          <Text style={styles.dimensionText}>
            {dimensionWorking
              ? 'Rebuilding with AI depth…'
              : dimensionMode === 'relief'
                ? 'See the full 3D version — AI adds depth'
                : 'Switch back to the flat panel'}
          </Text>
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
                ? 'True-3D build ready ✓'
                : true3DState === 'failed'
                  ? 'True-3D failed — try again'
                  : 'Rebuild in true 3D (beta) — real geometry all around'}
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
              const canvas = typeof document !== 'undefined' ? document.querySelector('canvas') : null;
              await generateInstructionsPdf({
                accent,
                buildName,
                heroImage: canvas ? canvas.toDataURL('image/png') : null,
                model: photoModel ?? getVoxelModel(modelProfile),
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
    alignSelf: 'flex-start',
    backgroundColor: colors.paperDeep,
    borderRadius: radius.md,
    flexDirection: 'row',
    marginBottom: spacing.md,
    padding: 3,
  },
  previewTab: {
    alignItems: 'center',
    borderRadius: radius.sm,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  previewTabSelected: {
    backgroundColor: colors.blue,
  },
  previewTabText: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 9,
    letterSpacing: 1.1,
  },
  previewTabTextSelected: {
    color: colors.white,
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
