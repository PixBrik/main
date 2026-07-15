import { useMemo, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { DemoDock } from '../components/DemoDock';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { accentForVariant, resolveActiveModel } from '../lib/activeBuild';
import { brickify, partUrl } from '../lib/brickify';
import type { PhotoModels } from '../lib/photoEngine/voxelizePhoto';
import { colors, radius, spacing, type } from '../theme/tokens';
import type { DemoScreen } from '../types/navigation';

interface BomScreenProps {
  onBack: () => void;
  onNavigate: (screen: DemoScreen) => void;
  selectedVariant: string;
  photoBuild?: PhotoModels | null;
}

const THUMB_W = 55;
const THUMB_H = 48;

/**
 * Real product photo of the exact part+colour; falls back to a swatch.
 * GoBricks renders centre a small part on a large white canvas, so the image
 * is zoomed and clipped — small parts get more zoom than long ones.
 */
function PartThumb({
  uri,
  colorRgb,
  label,
  maxDim,
}: {
  uri: string | null;
  colorRgb: string;
  label: string;
  maxDim: number;
}) {
  const [failed, setFailed] = useState(false);

  if (!uri || failed) {
    return (
      <View style={[styles.swatch, { backgroundColor: colorRgb }]}>
        <View style={styles.swatchStud} />
        <View style={styles.swatchStud} />
      </View>
    );
  }

  const zoom = Math.max(1.25, 2.5 - 0.15 * maxDim);
  const width = THUMB_W * zoom;
  const height = THUMB_H * zoom;

  return (
    <View style={styles.thumbFrame}>
      <Image
        accessibilityLabel={label}
        onError={() => setFailed(true)}
        resizeMode="contain"
        source={{ uri }}
        style={{
          height,
          marginLeft: (THUMB_W - width) / 2 - 3,
          marginTop: (THUMB_H - height) / 2 - 3,
          width,
        }}
      />
      <View style={[styles.thumbDot, { backgroundColor: colorRgb }]} />
    </View>
  );
}

export function BomScreen({ onBack, onNavigate, selectedVariant, photoBuild = null }: BomScreenProps) {
  const bom = useMemo(() => {
    const model = resolveActiveModel(photoBuild, selectedVariant);
    return brickify(model, accentForVariant(selectedVariant));
  }, [photoBuild, selectedVariant]);

  return (
    <ScreenFrame
      accent="coral"
      eyebrow={`Parts / ${bom.totalParts} total`}
      footer={
        <View style={styles.footerGap}>
          <PrimaryButton label="Happy with it? Checkout now" onPress={() => onNavigate('purchase')} />
          <DemoDock active="bom" onNavigate={onNavigate} />
        </View>
      }
      onBack={onBack}
      progress={0.72}
      subtitle="Every brick in your build, matched to real parts with real prices. We pack, sort and ship them as one kit — nothing to hunt down."
      title="Everything in the box"
    >
      <View style={styles.summaryRibbon}>
        <View>
          <Text style={styles.summaryNumber}>{bom.totalParts}</Text>
          <Text style={styles.summaryLabel}>PARTS</Text>
        </View>
        <View style={styles.summaryRule} />
        <View>
          <Text style={styles.summaryNumber}>{bom.colorCount}</Text>
          <Text style={styles.summaryLabel}>COLOURS</Text>
        </View>
        <View style={styles.summaryRule} />
        <View>
          <Text style={styles.summaryNumber}>€{bom.totalEur.toFixed(2)}</Text>
          <Text style={styles.summaryLabel}>{bom.isEstimate ? 'EST. RETAIL' : 'RETAIL'}</Text>
        </View>
      </View>

      <View accessibilityLabel="Bill of materials">
        {bom.lines.map((line) => (
          <View key={`${line.part}-${line.colorId}`} style={styles.partRow}>
            <PartThumb
              colorRgb={line.colorRgb}
              label={`${line.partName} in ${line.colorName}`}
              maxDim={Math.max(line.w, line.l)}
              uri={line.imageUrl}
            />
            <View style={styles.partCopy}>
              <View style={styles.refRow}>
                <Text style={styles.partName}>{line.partName}</Text>
                <Text style={styles.partRef}>#{line.part}</Text>
              </View>
              <Text style={styles.partMeta}>
                {line.colorName} · €{line.unitPriceEur.toFixed(2)}
                {line.estimated ? ' est.' : ''}
                {line.elementId ? ` · ${line.elementId}` : ''}
              </Text>
              {line.substituted ? (
                <Text style={styles.specialTag}>NEAREST AVAILABLE COLOUR SUBSTITUTED</Text>
              ) : null}
            </View>
            <View style={styles.rowActions}>
              <View style={styles.quantityPatch}>
                <Text style={styles.quantity}>×{line.quantity}</Text>
              </View>
              <Pressable
                accessibilityLabel={`Open part page for ${line.partName}`}
                accessibilityRole="link"
                onPress={() => Linking.openURL(partUrl(line))}
                style={({ pressed }) => [styles.linkButton, pressed && styles.linkPressed]}
              >
                <Text style={styles.linkText}>↗</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.demoNote}>
        References, colours, prices and stock come from the GoBricks parts catalog (crawl
        snapshot); lines marked “est.” fell back to the pricing model. Each row links to its
        product page.
      </Text>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  footerGap: {
    gap: spacing.md,
  },
  summaryRibbon: {
    alignItems: 'center',
    backgroundColor: colors.mint,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.xl,
    padding: spacing.lg,
  },
  summaryNumber: {
    ...type.heading,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  summaryLabel: {
    ...type.micro,
    color: colors.ink,
    fontSize: 8,
    textAlign: 'center',
  },
  summaryRule: {
    backgroundColor: colors.ink,
    height: 33,
    opacity: 0.35,
    width: 1,
  },
  partRow: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 86,
    paddingVertical: spacing.md,
  },
  swatch: {
    alignItems: 'flex-start',
    borderColor: colors.ink,
    borderRadius: radius.sm,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 5,
    height: 42,
    justifyContent: 'center',
    paddingTop: 7,
    width: 55,
  },
  swatchStud: {
    backgroundColor: colors.white,
    borderColor: colors.ink,
    borderRadius: 5,
    borderWidth: 1.5,
    height: 8,
    marginTop: -13,
    width: 13,
  },
  thumbFrame: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: THUMB_H,
    overflow: 'hidden',
    padding: 3,
    position: 'relative',
    width: THUMB_W,
  },
  thumbDot: {
    borderColor: colors.ink,
    borderRadius: 3,
    borderWidth: 1,
    bottom: 2,
    height: 10,
    position: 'absolute',
    right: 2,
    width: 10,
  },
  partCopy: {
    flex: 1,
  },
  refRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  partName: {
    ...type.body,
    color: colors.ink,
    fontWeight: '900',
  },
  partRef: {
    ...type.micro,
    color: colors.blue,
  },
  partMeta: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 12,
    lineHeight: 17,
  },
  specialTag: {
    ...type.micro,
    color: colors.coral,
    fontSize: 8,
    letterSpacing: 0.6,
    marginTop: 2,
  },
  rowActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  quantityPatch: {
    alignItems: 'center',
    backgroundColor: colors.saffron,
    borderColor: colors.line,
    borderRadius: radius.sm,
    borderWidth: 1,
    minWidth: 46,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  quantity: {
    ...type.body,
    color: colors.ink,
    fontWeight: '900',
  },
  linkButton: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  linkPressed: {
    backgroundColor: colors.blueSoft,
  },
  linkText: {
    color: colors.blue,
    fontSize: 18,
    fontWeight: '900',
  },
  demoNote: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.lg,
  },
});
