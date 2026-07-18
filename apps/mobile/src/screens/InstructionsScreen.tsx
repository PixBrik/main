import { useEffect, useMemo, useState } from 'react';
import { Image, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { BuildPreview } from '../components/BuildPreview';
import { DemoDock } from '../components/DemoDock';
import { InstructionStepDiagram } from '../components/InstructionStepDiagram';
import { ScreenFrame } from '../components/ScreenFrame';
import { ThreeBrickView, isRealisticViewSupported } from '../components/ThreeBrickView';
import { brickify, type BillOfMaterials, type BomLine } from '../lib/brickify';
import {
  createGuideShareDraft,
  publishGuide,
  readGuideShareId,
} from '../lib/guideShare';
import {
  createAssemblyPlan,
  partColorKey,
} from '../lib/instructions/assemblyPlan';
import {
  generateInstructionsPdf,
  type GuideExportAction,
  type GuidePaperSize,
} from '../lib/instructionsPdf';
import type { BuildProfile, VoxelModel } from '../lib/voxelFox';
import { colors, radius, spacing, type } from '../theme/tokens';
import type { DemoScreen } from '../types/navigation';

interface InstructionsScreenProps {
  onBack: () => void;
  onNavigate: (screen: DemoScreen) => void;
  onRestart: () => void;
  model: VoxelModel;
  accent: string;
  buildName: string;
  profile: BuildProfile;
  orderId?: string | null;
  bomOverride?: BillOfMaterials;
  /** Exact original BOM index order frozen into a published guide. */
  placementOrder?: readonly number[];
  /** Existing clean-browser URL when this guide was opened from a QR. */
  publishedGuideUrl?: string;
}

type ExportState = 'idle' | 'working' | 'done' | 'failed';
type ShareState = 'idle' | 'working' | 'done' | 'failed';

function progressKey(
  orderId: string | null,
  publishedGuideUrl: string | undefined,
  buildName: string,
  profile: BuildProfile,
): string {
  const guideId = publishedGuideUrl ? readGuideShareId(publishedGuideUrl) : null;
  const identity = orderId ?? guideId ?? `${buildName}-${profile}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return `pixbrik.guide.progress.v1.${identity}`;
}

function publicationCacheKey(draft: unknown): string {
  const serialized = JSON.stringify(draft);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index++) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `pixbrik.guide.published.v1.${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
}

function linesForPlacements(
  allLines: BomLine[],
  placements: BillOfMaterials['placements'],
): BomLine[] {
  const quantities = new Map<string, number>();
  for (const placement of placements) {
    const key = partColorKey(placement.part, placement.colorId);
    quantities.set(key, (quantities.get(key) ?? 0) + 1);
  }
  return allLines
    .filter((line) => quantities.has(partColorKey(line.part, line.colorId)))
    .map((line) => {
      const quantity = quantities.get(partColorKey(line.part, line.colorId)) ?? 0;
      return { ...line, lineTotalEur: Number((quantity * line.unitPriceEur).toFixed(2)), quantity };
    });
}

export function InstructionsScreen({
  onBack,
  onNavigate,
  onRestart,
  model,
  accent,
  buildName,
  profile,
  orderId = null,
  bomOverride,
  placementOrder,
  publishedGuideUrl,
}: InstructionsScreenProps) {
  const bom = useMemo(() => bomOverride ?? brickify(model, accent), [accent, bomOverride, model]);
  const plan = useMemo(
    () => createAssemblyPlan(bom, placementOrder ? { placementOrder } : {}),
    [bom, placementOrder],
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [paperSize, setPaperSize] = useState<GuidePaperSize>('a4');
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [exportNote, setExportNote] = useState('');
  const [exportError, setExportError] = useState('');
  const [shareState, setShareState] = useState<ShareState>('idle');
  const [shareUrl, setShareUrl] = useState(publishedGuideUrl ?? '');
  const [shareExpiry, setShareExpiry] = useState('');
  const [shareError, setShareError] = useState('');
  const [qrUri, setQrUri] = useState('');
  const [copied, setCopied] = useState(false);
  const step = plan.steps[stepIndex] ?? null;
  const stepsByLayer = useMemo(() => {
    const grouped = new Map<number, typeof plan.steps>();
    for (const candidate of plan.steps) {
      const layer = grouped.get(candidate.layer) ?? [];
      layer.push(candidate);
      grouped.set(candidate.layer, layer);
    }
    return grouped;
  }, [plan]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    try {
      const saved = Number(localStorage.getItem(progressKey(orderId, publishedGuideUrl, buildName, profile)));
      if (Number.isInteger(saved) && saved >= 0 && saved < plan.totalSteps) setStepIndex(saved);
    } catch {
      // Private browsing or storage disabled: the guide still works in-session.
    }
  }, [buildName, orderId, plan.totalSteps, profile, publishedGuideUrl]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    try {
      localStorage.setItem(progressKey(orderId, publishedGuideUrl, buildName, profile), String(stepIndex));
    } catch {
      // Progress persistence is optional.
    }
  }, [buildName, orderId, profile, publishedGuideUrl, stepIndex]);

  const atStart = stepIndex === 0;
  const atEnd = stepIndex >= plan.totalSteps - 1;
  // Keep the interactive 3D helper fast on a phone: it only needs the layer
  // being built and the support layer directly underneath it. The numbered
  // plan and PDFs still retain every frozen catalog placement.
  const previewPlacements = useMemo(
    () => step
      ? [
          ...(stepsByLayer.get(step.layer + (step.support.status === 'underside' ? 1 : -1)) ?? []),
          ...(stepsByLayer.get(step.layer) ?? []),
        ]
          .filter((candidate) =>
            candidate.number <= step.number,
          )
          .map((candidate) => candidate.placement)
      : [],
    [step, stepsByLayer],
  );
  const previewBom = useMemo<BillOfMaterials>(() => {
    const lines = linesForPlacements(bom.lines, previewPlacements);
    return {
      ...bom,
      colorCount: new Set(lines.map((line) => line.colorId)).size,
      lines,
      placements: previewPlacements,
      totalEur: Number(lines.reduce((sum, line) => sum + line.lineTotalEur, 0).toFixed(2)),
      totalParts: previewPlacements.length,
    };
  }, [bom, previewPlacements]);
  const visibleChapters = useMemo(() => {
    if (plan.chapters.length <= 7) return plan.chapters.map((chapter) => ({ chapter, gap: false }));
    const active = Math.max(0, (step?.chapterNumber ?? 1) - 1);
    const keep = new Set([0, plan.chapters.length - 1]);
    for (let index = active - 2; index <= active + 2; index++) {
      if (index >= 0 && index < plan.chapters.length) keep.add(index);
    }
    const ordered = [...keep].sort((a, b) => a - b);
    return ordered.flatMap((index, position) => {
      const chapter = plan.chapters[index]!;
      const previous = ordered[position - 1];
      return previous !== undefined && index - previous > 1
        ? [{ chapter: null, gap: true }, { chapter, gap: false }]
        : [{ chapter, gap: false }];
    });
  }, [plan.chapters, step?.chapterNumber]);

  const exportGuide = async (action: GuideExportAction) => {
    setExportError('');
    setExportNote('Preparing the exact parts plan');
    setExportState('working');
    const printWindow =
      action === 'print' && typeof window !== 'undefined'
        ? window.open('', '_blank')
        : null;
    if (printWindow) printWindow.opener = null;
    try {
      await generateInstructionsPdf({
        accent,
        action,
        bomOverride: bom,
        buildName,
        model,
        paperSize,
        printWindow,
        onProgress: (fraction, note) => {
          setExportNote(`${Math.round(fraction * 100)}% · ${note}`);
        },
      });
      setExportNote(action === 'print' ? 'Print copy opened' : 'PDF downloaded');
      setExportState('done');
    } catch (error) {
      printWindow?.close();
      setExportError(error instanceof Error ? error.message : 'Could not generate the build guide.');
      setExportState('failed');
    }
  };

  const renderQr = async (url: string) => {
    const QRCode = await import('qrcode');
    const svg = await QRCode.toString(url, {
      color: { dark: '#111315', light: '#FFFFFF' },
      errorCorrectionLevel: 'M',
      margin: 2,
      type: 'svg',
      width: 300,
    });
    setQrUri(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  };

  const openPhoneGuide = async () => {
    setShareError('');
    setCopied(false);
    setShareState('working');
    try {
      let url = shareUrl;
      if (!url) {
        const draft = createGuideShareDraft({
          accent,
          assemblyPlan: plan,
          bom,
          buildName,
          model,
          profile,
        });
        const cacheKey = publicationCacheKey(draft);
        if (Platform.OS === 'web') {
          try {
            const cached = JSON.parse(localStorage.getItem(cacheKey) ?? 'null') as {
              expiresAt?: unknown;
              url?: unknown;
            } | null;
            if (
              cached &&
              typeof cached.url === 'string' &&
              typeof cached.expiresAt === 'string' &&
              readGuideShareId(cached.url) &&
              Date.parse(cached.expiresAt) > Date.now() + 60_000
            ) {
              url = cached.url;
              setShareExpiry(cached.expiresAt);
              setShareUrl(url);
            }
          } catch {
            // A damaged or unavailable browser cache simply republishes once.
          }
        }
        const nativeOrigin = process.env.EXPO_PUBLIC_GUIDE_APP_URL?.replace(/\/$/, '');
        if (Platform.OS !== 'web' && !nativeOrigin) {
          throw new Error('Phone guide sharing needs EXPO_PUBLIC_GUIDE_APP_URL configured.');
        }
        if (!url) {
          const published = await publishGuide(
            draft,
            Platform.OS === 'web' ? {} : { endpoint: `${nativeOrigin}/api/guides/share` },
          );
          url = published.url;
          setShareExpiry(published.expiresAt);
          setShareUrl(url);
          if (Platform.OS === 'web') {
            try {
              localStorage.setItem(cacheKey, JSON.stringify({
                expiresAt: published.expiresAt,
                url: published.url,
              }));
            } catch {
              // Publication remains usable when browser storage is unavailable.
            }
          }
        }
      }
      if (Platform.OS === 'web') {
        await renderQr(url);
      } else {
        await Share.share({ message: `${buildName} PixBrik build guide: ${url}`, url });
      }
      setShareState('done');
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Could not create the phone guide.');
      setShareState('failed');
    }
  };

  const copyShareLink = async () => {
    if (!shareUrl || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const hardPlanError = plan.warnings.find((entry) => entry.severity === 'error');
  if (hardPlanError || plan.supportSummary.unsupported > 0) {
    return (
      <ScreenFrame
        accent="coral"
        eyebrow="Buildability check"
        footer={<DemoDock active="instructions" onNavigate={onNavigate} />}
        onBack={onBack}
        progress={0}
        subtitle="PixBrik found a catalog placement that cannot lock onto the assembled model. It will not publish unsafe instructions."
        title="This kit needs a safer parts plan."
      >
        <View accessibilityRole="alert" style={styles.warningCard}>
          <Text style={styles.warningTitle}>DO NOT START THIS VERSION</Text>
          <Text style={styles.warningText}>
            {hardPlanError?.message ?? 'One or more catalog pieces cannot lock onto the assembled model.'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.next, pressed && styles.pressed]}
        >
          <Text style={styles.nextText}>Return and regenerate â†’</Text>
        </Pressable>
      </ScreenFrame>
    );
  }

  if (!step) {
    return (
      <ScreenFrame
        accent="saffron"
        eyebrow="Build guide"
        footer={<DemoDock active="instructions" onNavigate={onNavigate} />}
        onBack={onBack}
        progress={0}
        subtitle="The frozen order does not contain any catalog placements."
        title="No build steps available."
      >
        <Text accessibilityRole="alert" style={styles.error}>Return to the order and regenerate its parts plan.</Text>
      </ScreenFrame>
    );
  }

  const supportMessage =
    step.support.status === 'base'
      ? 'Start on a flat table. Line up FRONT before pressing down.'
      : step.support.status === 'full'
        ? `All ${step.support.footprintStuds} studs lock onto the layer below.`
        : step.support.status === 'partial'
          ? `${step.support.supportedStuds} of ${step.support.footprintStuds} studs connect below. Press the connected side first.`
          : step.support.status === 'underside'
            ? `Turn the connected model over. Press this piece onto the ${step.support.supportedStuds} highlighted stud${step.support.supportedStuds === 1 ? '' : 's'} from underneath, then turn it upright again.`
            : 'STOP: this piece has no connection to the assembled model. Regenerate the kit before building.';

  return (
    <ScreenFrame
      accent="saffron"
      eyebrow={`${orderId ? `Order ${orderId} / ` : ''}${step.chapterLabel} / Step ${step.number} of ${plan.totalSteps}`}
      footer={
        <View style={styles.footerGap}>
          <View style={styles.controls}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: atStart }}
              disabled={atStart}
              onPress={() => setStepIndex((current) => Math.max(0, current - 1))}
              style={({ pressed }) => [styles.previous, atStart && styles.disabled, pressed && styles.pressed]}
            >
              <Text style={styles.previousText}>← Back</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (atEnd) {
                  if (orderId || publishedGuideUrl) onBack();
                  else onRestart();
                  return;
                }
                setStepIndex((current) => Math.min(plan.totalSteps - 1, current + 1));
              }}
              style={({ pressed }) => [styles.next, pressed && styles.pressed]}
            >
              <Text style={styles.nextText}>
                {atEnd ? (orderId || publishedGuideUrl ? 'Finish guide ✓' : 'Finish build ✓') : 'Next piece →'}
              </Text>
            </Pressable>
          </View>
          <DemoDock active="instructions" onNavigate={onNavigate} />
        </View>
      }
      onBack={onBack}
      progress={step.number / plan.totalSteps}
      scrollResetKey={step.id}
      subtitle={step.support.status === 'underside'
        ? 'One number adds exactly one catalog piece. This overhang locks on from underneath; the connected section above is shown pale.'
        : 'One number adds exactly one catalog piece. Match the colour, keep FRONT toward you, then press it fully down.'}
      title={`Add 1 ${step.partLine?.partName ?? 'catalog piece'}.`}
    >
      <View style={styles.bagNav}>
        {visibleChapters.map(({ chapter, gap }, index) => {
          if (gap || !chapter) {
            return <Text key={`stage-gap-${index}`} style={styles.bagGap}>…</Text>;
          }
          const active = chapter.id === step.chapterId;
          return (
            <Pressable
              accessibilityLabel={`Open ${chapter.label}, steps ${chapter.startStepNumber} to ${chapter.endStepNumber}`}
              accessibilityRole="button"
              key={chapter.id}
              onPress={() => setStepIndex(chapter.startStepNumber - 1)}
              style={[styles.bagChip, active && styles.bagChipActive]}
            >
              <Text style={[styles.bagChipText, active && styles.bagChipTextActive]}>{chapter.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.findCard}>
        <View style={styles.stepBadge}><Text style={styles.stepBadgeNumber}>{step.number}</Text></View>
        <View style={[styles.bigSwatch, { backgroundColor: step.partLine?.colorRgb ?? '#E96632' }]} />
        <View style={styles.findCopy}>
          <Text style={styles.findLabel}>1 · FIND THIS PIECE</Text>
          <Text style={styles.findTitle}>1 × {step.partLine?.partName ?? step.placement.part}</Text>
          <Text style={styles.findMeta}>
            {step.partLine?.colorName ?? 'Catalog colour'} · {step.placement.spanI} × {step.placement.spanK} studs
            {step.placement.shape === 'slope' ? ' · slope arrow shown' : ''}
          </Text>
        </View>
      </View>

      <InstructionStepDiagram plan={plan} step={step} />

      <View style={styles.checkCard}>
        <Text style={styles.checkTitle}>2 · PLACE IT, THEN PRESS</Text>
        <Text style={styles.checkText}>{supportMessage}</Text>
      </View>

      {isRealisticViewSupported ? (
        <ThreeBrickView
          accent={accent}
          highlightPlacement={step.placement}
          label={`${buildName}, layer ${step.layer + 1} context for step ${step.number}`}
          model={model}
          packedParts={previewBom.totalParts}
          packedPlan={previewBom}
        />
      ) : (
        <BuildPreview accent={accent} label={`STEP ${step.number}`} step={Math.min(4, step.chapterNumber)} />
      )}

      {step.warnings.length ? (
        <View accessibilityRole="alert" style={styles.warningCard}>
          <Text style={styles.warningTitle}>CHECK THIS CONNECTION</Text>
          <Text style={styles.warningText}>{supportMessage}</Text>
        </View>
      ) : null}

      <View style={styles.exportCard}>
        <Text style={styles.exportKicker}>TAKE THE GUIDE WITH YOU</Text>
        <Text style={styles.exportTitle}>Phone, print, or PDF.</Text>
        <Text style={styles.exportBody}>
          Phone mode remembers your step. Printed and downloaded copies use the same exact one-piece plan.
        </Text>

        {Platform.OS === 'web' ? (
          <View accessibilityRole="radiogroup" style={styles.paperChoices}>
            {(['a4', 'letter'] as const).map((paper) => {
              const selected = paperSize === paper;
              return (
                <Pressable
                  aria-checked={selected}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  key={paper}
                  onPress={() => setPaperSize(paper)}
                  style={[styles.paperChoice, selected && styles.paperChoiceActive]}
                >
                  <Text style={[styles.paperChoiceText, selected && styles.paperChoiceTextActive]}>
                    {paper === 'a4' ? 'A4' : 'US LETTER'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.exportActions}>
          <Pressable
            accessibilityRole="button"
            disabled={shareState === 'working'}
            onPress={() => void openPhoneGuide()}
            style={({ pressed }) => [styles.actionPrimary, pressed && styles.pressed]}
          >
            <Text style={styles.actionPrimaryText}>
              {shareState === 'working'
                ? 'CREATING PHONE LINK…'
                : Platform.OS === 'web'
                  ? qrUri ? 'SHOW PHONE QR' : 'OPEN ON PHONE · QR'
                  : 'SHARE GUIDE LINK'}
            </Text>
          </Pressable>
          {Platform.OS === 'web' ? (
            <View style={styles.secondaryActions}>
              <Pressable
                accessibilityRole="button"
                disabled={exportState === 'working'}
                onPress={() => void exportGuide('print')}
                style={({ pressed }) => [styles.actionSecondary, pressed && styles.pressed]}
              >
                <Text style={styles.actionSecondaryText}>PRINT {paperSize === 'a4' ? 'A4' : 'LETTER'}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={exportState === 'working'}
                onPress={() => void exportGuide('download')}
                style={({ pressed }) => [styles.actionSecondary, pressed && styles.pressed]}
              >
                <Text style={styles.actionSecondaryText}>DOWNLOAD PDF</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
        <Text style={styles.sharePrivacy}>
          The unlisted link contains the model and parts plan. Anyone with it can view the guide until it expires.
        </Text>

        {exportState === 'working' || exportState === 'done' ? (
          <Text accessibilityLiveRegion="polite" style={styles.statusText}>{exportNote}</Text>
        ) : null}
        {exportError ? <Text accessibilityRole="alert" style={styles.error}>{exportError}</Text> : null}
        {shareError ? <Text accessibilityRole="alert" style={styles.error}>{shareError}</Text> : null}

        {qrUri && shareUrl ? (
          <View style={styles.qrPanel}>
            <Image accessibilityLabel="QR code for this build guide" resizeMode="contain" source={{ uri: qrUri }} style={styles.qr} />
            <View style={styles.qrCopy}>
              <Text style={styles.qrTitle}>SCAN WITH YOUR PHONE CAMERA</Text>
              <Text selectable style={styles.qrUrl}>{shareUrl}</Text>
              {shareExpiry ? (
                <Text style={styles.qrExpiry}>Unlisted link expires {new Date(shareExpiry).toLocaleDateString()}.</Text>
              ) : null}
              <Pressable accessibilityRole="button" onPress={() => void copyShareLink()} style={styles.copyButton}>
                <Text style={styles.copyButtonText}>{copied ? 'LINK COPIED ✓' : 'COPY LINK'}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  footerGap: { gap: spacing.md },
  controls: { flexDirection: 'row', gap: spacing.sm },
  previous: {
    alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: radius.md,
    borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 51,
  },
  next: {
    alignItems: 'center', backgroundColor: colors.blue, borderColor: colors.blue, borderRadius: radius.md,
    borderWidth: 1, flex: 1.35, justifyContent: 'center', minHeight: 51,
  },
  previousText: { ...type.body, color: colors.ink, fontSize: 14, fontWeight: '900' },
  nextText: { ...type.body, color: colors.white, fontSize: 14, fontWeight: '900' },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.72 },
  bagNav: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  bagChip: {
    backgroundColor: colors.white, borderColor: colors.line, borderRadius: radius.pill,
    borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  bagChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  bagChipText: { ...type.micro, color: colors.inkSoft, fontSize: 9 },
  bagChipTextActive: { color: colors.saffron },
  bagGap: { ...type.heading, color: colors.inkSoft, fontSize: 14, paddingHorizontal: 2, paddingVertical: spacing.xs },
  findCard: {
    alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: radius.lg,
    borderWidth: 1, flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md, padding: spacing.lg,
  },
  stepBadge: {
    alignItems: 'center', backgroundColor: colors.saffron, borderColor: colors.ink, borderRadius: radius.sm,
    borderWidth: 2, height: 52, justifyContent: 'center', minWidth: 52, paddingHorizontal: spacing.xs,
  },
  stepBadgeNumber: { ...type.heading, color: colors.ink, fontSize: 16 },
  bigSwatch: { borderColor: colors.ink, borderRadius: radius.sm, borderWidth: 2, height: 52, width: 52 },
  findCopy: { flex: 1 },
  findLabel: { ...type.micro, color: colors.coral, fontSize: 9 },
  findTitle: { ...type.heading, color: colors.ink, fontSize: 18, marginTop: 2 },
  findMeta: { ...type.body, color: colors.inkSoft, fontSize: 11, lineHeight: 16, marginTop: 2 },
  checkCard: {
    backgroundColor: colors.mintSoft, borderColor: colors.mintDeep, borderRadius: radius.md,
    borderWidth: 1, marginBottom: spacing.md, marginTop: spacing.md, padding: spacing.lg,
  },
  checkTitle: { ...type.label, color: colors.ink, fontSize: 11 },
  checkText: { ...type.body, color: colors.ink, fontSize: 12, lineHeight: 18, marginTop: spacing.xs },
  warningCard: {
    backgroundColor: '#FFF0E9', borderColor: colors.coral, borderRadius: radius.md,
    borderWidth: 1, marginTop: spacing.md, padding: spacing.md,
  },
  warningTitle: { ...type.label, color: colors.coral, fontSize: 10 },
  warningText: { ...type.body, color: colors.ink, fontSize: 11, marginTop: 3 },
  exportCard: {
    backgroundColor: colors.white, borderColor: colors.ink, borderRadius: radius.lg,
    borderWidth: 2, marginTop: spacing.xl, padding: spacing.lg,
  },
  exportKicker: { ...type.micro, color: colors.blue, fontSize: 9 },
  exportTitle: { ...type.heading, color: colors.ink, marginTop: 2 },
  exportBody: { ...type.body, color: colors.inkSoft, fontSize: 12, lineHeight: 18, marginTop: spacing.xs },
  paperChoices: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  paperChoice: {
    alignItems: 'center', borderColor: colors.line, borderRadius: radius.pill, borderWidth: 1,
    flex: 1, justifyContent: 'center', minHeight: 42,
  },
  paperChoiceActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  paperChoiceText: { ...type.label, color: colors.ink, fontSize: 10 },
  paperChoiceTextActive: { color: colors.saffron },
  exportActions: { gap: spacing.sm, marginTop: spacing.md },
  actionPrimary: {
    alignItems: 'center', backgroundColor: colors.blue, borderRadius: radius.md,
    justifyContent: 'center', minHeight: 50,
  },
  actionPrimaryText: { ...type.label, color: colors.white, fontSize: 11 },
  secondaryActions: { flexDirection: 'row', gap: spacing.sm },
  actionSecondary: {
    alignItems: 'center', borderColor: colors.ink, borderRadius: radius.md, borderWidth: 2,
    flex: 1, justifyContent: 'center', minHeight: 48,
  },
  actionSecondaryText: { ...type.label, color: colors.ink, fontSize: 10 },
  statusText: { ...type.body, color: colors.mintDeep, fontSize: 11, marginTop: spacing.sm },
  sharePrivacy: { ...type.body, color: colors.inkSoft, fontSize: 9, lineHeight: 13, marginTop: spacing.sm },
  error: { ...type.body, color: colors.alarm, fontSize: 12, marginTop: spacing.md },
  qrPanel: {
    alignItems: 'center', backgroundColor: colors.mintSoft, borderColor: colors.line, borderRadius: radius.md,
    borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.lg, padding: spacing.md,
  },
  qr: { backgroundColor: colors.white, borderRadius: radius.sm, height: 138, width: 138 },
  qrCopy: { flexBasis: 160, flexGrow: 1, minWidth: 0 },
  qrTitle: { ...type.label, color: colors.ink, fontSize: 10 },
  qrUrl: { ...type.body, color: colors.blue, fontSize: 9, lineHeight: 13, marginTop: spacing.xs },
  qrExpiry: { ...type.body, color: colors.inkSoft, fontSize: 9, marginTop: spacing.xs },
  copyButton: {
    alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.ink, borderRadius: radius.pill,
    justifyContent: 'center', marginTop: spacing.sm, minHeight: 36, paddingHorizontal: spacing.md,
  },
  copyButtonText: { ...type.micro, color: colors.saffron, fontSize: 9 },
});
