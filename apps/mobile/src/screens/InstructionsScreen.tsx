import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { BuildPreview } from '../components/BuildPreview';
import { DemoDock } from '../components/DemoDock';
import { ScreenFrame } from '../components/ScreenFrame';
import { ThreeBrickView, isRealisticViewSupported } from '../components/ThreeBrickView';
import { brickify, type BillOfMaterials } from '../lib/brickify';
import { generateInstructionsPdf } from '../lib/instructionsPdf';
import { buildModelFromCells, type BuildProfile, type VoxelModel } from '../lib/voxelFox';
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
}: InstructionsScreenProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const bom = useMemo(() => bomOverride ?? brickify(model, accent), [accent, bomOverride, model]);
  const steps = useMemo(() => {
    const layers = [...new Set(model.cells.map((cell) => cell.j))].sort((a, b) => a - b);
    const layersPerStep = Math.max(1, Math.ceil(layers.length / 8));
    const grouped: number[][] = [];
    for (let index = 0; index < layers.length; index += layersPerStep) {
      grouped.push(layers.slice(index, index + layersPerStep));
    }
    return grouped;
  }, [model]);
  const stepLayers = steps[stepIndex] ?? steps[0] ?? [0];
  const firstLayer = stepLayers[0] ?? 0;
  const lastLayer = stepLayers[stepLayers.length - 1] ?? firstLayer;
  const atStart = stepIndex === 0;
  const atEnd = stepIndex === steps.length - 1;
  const { stepLines, stepPlacements } = useMemo(() => {
    const placements = bom.placements.filter(
      (placement) => placement.j >= firstLayer && placement.j <= lastLayer,
    );
    const quantities = new Map<string, { label: string; color: string; quantity: number }>();
    for (const placement of placements) {
      const line = bom.lines.find(
        (candidate) => candidate.part === placement.part && candidate.colorId === placement.colorId,
      );
      const key = `${placement.part}|${placement.colorId}`;
      const current = quantities.get(key);
      if (current) current.quantity += 1;
      else {
        quantities.set(key, {
          color: line?.colorRgb ?? '#E96632',
          label: `${line?.partName ?? placement.part} · ${line?.colorName ?? 'Colour'}`,
          quantity: 1,
        });
      }
    }
    return {
      stepLines: [...quantities.values()].sort((a, b) => b.quantity - a.quantity),
      stepPlacements: placements,
    };
  }, [bom, firstLayer, lastLayer]);
  const progressModel = useMemo(
    () =>
      buildModelFromCells(
        model.cells.filter((cell) => cell.j <= lastLayer).map((cell) => ({ ...cell })),
        model.size,
        { layerHeight: model.layerHeight, preserveShapes: true },
      ),
    [lastLayer, model],
  );
  const progressBom = useMemo(() => {
    const placements = bom.placements.filter((placement) => placement.j <= lastLayer);
    const used = new Set(placements.map((placement) => `${placement.part}|${placement.colorId}`));
    const lines = bom.lines.filter((line) => used.has(`${line.part}|${line.colorId}`));
    return {
      ...bom,
      colorCount: new Set(lines.map((line) => line.colorId)).size,
      lines,
      placements,
      totalParts: placements.length,
    };
  }, [bom, lastLayer]);

  const downloadGuide = async () => {
    setExportError('');
    setExporting(true);
    try {
      await generateInstructionsPdf({ accent, bomOverride: bom, buildName, model });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Could not generate the PDF guide.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScreenFrame
      accent="saffron"
      eyebrow={`${orderId ? `Order ${orderId} / ` : ''}Step ${stepIndex + 1} of ${steps.length}`}
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
                  if (orderId) onBack();
                  else onRestart();
                  return;
                }
                setStepIndex((current) => Math.min(steps.length - 1, current + 1));
              }}
              style={({ pressed }) => [styles.next, pressed && styles.pressed]}
            >
              <Text style={styles.nextText}>
                {atEnd ? (orderId ? 'Back to order →' : 'Start new build ↻') : 'Next step →'}
              </Text>
            </Pressable>
          </View>
          <DemoDock active="instructions" onNavigate={onNavigate} />
        </View>
      }
      onBack={onBack}
      progress={steps.length ? (stepIndex + 1) / steps.length : 1}
      subtitle={`Generated from the exact ${profile} model${orderId ? ' saved with this order' : ''}. Add only the highlighted layer group before continuing.`}
      title={`${buildName} · Layers ${firstLayer + 1}–${lastLayer + 1}`}
    >
      {isRealisticViewSupported ? (
        <ThreeBrickView
          accent={accent}
          label={`${buildName}, complete through layer ${lastLayer + 1}`}
          model={progressModel}
          packedParts={progressBom.totalParts}
          packedPlan={progressBom}
        />
      ) : (
        <BuildPreview accent={accent} label={`LAYERS 1–${lastLayer + 1}`} step={Math.min(4, stepIndex + 1)} />
      )}

      <View style={styles.stepCard}>
        <View style={styles.stepTop}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeNumber}>{String(stepIndex + 1).padStart(2, '0')}</Text>
          </View>
          <View style={styles.stepCopy}>
            <Text style={styles.stepTitle}>ADD {stepPlacements.length} PIECES</Text>
            <Text style={styles.stepBody}>
              Build layers {firstLayer + 1} through {lastLayer + 1}. Rotate the model to check every side before moving on.
            </Text>
          </View>
        </View>
        <View style={styles.partsList}>
          {stepLines.slice(0, 8).map((line) => (
            <View key={`${line.label}-${line.color}`} style={styles.partRow}>
              <View style={[styles.swatch, { backgroundColor: line.color }]} />
              <Text style={styles.partQuantity}>{line.quantity} ×</Text>
              <Text numberOfLines={1} style={styles.partName}>{line.label}</Text>
            </View>
          ))}
          {stepLines.length > 8 ? (
            <Text style={styles.moreParts}>+ {stepLines.length - 8} more part/colour combinations in this step</Text>
          ) : null}
        </View>
      </View>

      <View style={styles.timeline}>
        {steps.map((layers, index) => {
          const active = index === stepIndex;
          const complete = index < stepIndex;
          return (
            <Pressable
              accessibilityLabel={`Go to step ${index + 1}, layers ${(layers[0] ?? 0) + 1} through ${(layers[layers.length - 1] ?? 0) + 1}`}
              accessibilityRole="button"
              key={`${layers[0]}-${layers[layers.length - 1]}`}
              onPress={() => setStepIndex(index)}
              style={[styles.timelineDot, complete && styles.timelineDotComplete, active && styles.timelineDotActive]}
            >
              <Text style={[styles.timelineText, (active || complete) && styles.timelineTextActive]}>{index + 1}</Text>
            </Pressable>
          );
        })}
      </View>

      {Platform.OS === 'web' ? (
        <Pressable
          accessibilityRole="button"
          disabled={exporting}
          onPress={downloadGuide}
          style={({ pressed }) => [styles.pdfButton, exporting && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.pdfButtonText}>{exporting ? 'GENERATING GUIDE…' : 'DOWNLOAD THIS BUILD GUIDE (PDF)'}</Text>
        </Pressable>
      ) : null}
      {exportError ? <Text accessibilityRole="alert" style={styles.error}>{exportError}</Text> : null}
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
  stepCard: {
    backgroundColor: colors.white, borderColor: colors.line, borderRadius: radius.lg, borderWidth: 1,
    marginTop: spacing.md, overflow: 'hidden',
  },
  stepTop: { alignItems: 'center', flexDirection: 'row', gap: spacing.lg, padding: spacing.lg },
  stepBadge: {
    alignItems: 'center', backgroundColor: colors.saffron, borderColor: colors.line, borderRadius: radius.sm,
    borderWidth: 1, height: 48, justifyContent: 'center', width: 48,
  },
  stepBadgeNumber: { ...type.heading, color: colors.ink },
  stepCopy: { flex: 1 },
  stepTitle: { ...type.label, color: colors.ink },
  stepBody: { ...type.body, color: colors.inkSoft, fontSize: 12, lineHeight: 17, marginTop: 3 },
  partsList: { backgroundColor: colors.mintSoft, borderTopColor: colors.line, borderTopWidth: 1, padding: spacing.md },
  partRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: 29 },
  swatch: { borderColor: colors.ink, borderRadius: 3, borderWidth: 1, height: 17, width: 17 },
  partQuantity: { ...type.micro, color: colors.ink, minWidth: 34 },
  partName: { ...type.body, color: colors.ink, flex: 1, fontSize: 11 },
  moreParts: { ...type.micro, color: colors.inkSoft, fontSize: 8, marginTop: spacing.xs },
  timeline: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center', marginTop: spacing.xl },
  timelineDot: {
    alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: radius.sm,
    borderWidth: 1, height: 40, justifyContent: 'center', width: 40,
  },
  timelineDotComplete: { backgroundColor: colors.mintDeep, borderColor: colors.mintDeep },
  timelineDotActive: { backgroundColor: colors.blue },
  timelineText: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  timelineTextActive: { color: colors.white },
  pdfButton: {
    alignItems: 'center', borderColor: colors.ink, borderRadius: radius.md, borderWidth: 2,
    justifyContent: 'center', marginTop: spacing.xl, minHeight: 48,
  },
  pdfButtonText: { ...type.label, color: colors.ink },
  error: { ...type.body, color: colors.alarm, fontSize: 12, marginTop: spacing.md },
});
