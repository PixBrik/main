import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { DemoDock } from '../components/DemoDock';
import { FillPreview } from '../components/FillPreview';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { countries } from '../data/mockData';
import { accentForVariant, resolveActiveModel } from '../lib/activeBuild';
import { BUNDLE_MARKUP, estimateBuild, type BuildEstimateSide } from '../lib/brickify';
import type { PhotoModels } from '../lib/photoEngine/voxelizePhoto';
import { estimateDelivery } from '../lib/shippingEstimate';
import { colors, radius, spacing, type } from '../theme/tokens';
import type { BuildFill, DemoScreen } from '../types/navigation';

interface PurchaseScreenProps {
  countryCode: string;
  onCountryChange: (code: string) => void;
  onBack: () => void;
  onNavigate: (screen: DemoScreen) => void;
  selectedVariant: string;
  photoBuild?: PhotoModels | null;
  buildFill: BuildFill;
  onBuildFillChange: (fill: BuildFill) => void;
}

const currencyMeta: Readonly<Record<string, { rate: number; symbol: string }>> = {
  EUR: { rate: 1, symbol: '€' },
  GBP: { rate: 0.86, symbol: '£' },
  USD: { rate: 1.1, symbol: '$' },
};


export function PurchaseScreen({
  countryCode,
  onCountryChange,
  onBack,
  onNavigate,
  selectedVariant,
  photoBuild = null,
  buildFill,
  onBuildFillChange,
}: PurchaseScreenProps) {
  const [coupon, setCoupon] = useState('');
  const country = countries.find((candidate) => candidate.code === countryCode) ?? countries[0];
  const currency = currencyMeta[country?.currency ?? 'EUR'] ?? { rate: 1, symbol: '€' };
  const money = (eur: number) => `${currency.symbol}${(eur * currency.rate).toFixed(2)}`;

  const estimate = useMemo(() => {
    const model = resolveActiveModel(photoBuild, selectedVariant);
    return estimateBuild(model, accentForVariant(selectedVariant));
  }, [photoBuild, selectedVariant]);

  const side: BuildEstimateSide = buildFill === 'hollow' ? estimate.hollow : estimate.full;
  const savingPct = Math.round(estimate.hollowSaving * 100);
  const delivery = useMemo(() => estimateDelivery(countryCode), [countryCode]);
  const total = side.bundleEur + delivery.costEur;

  const options: ReadonlyArray<{ id: BuildFill; title: string; blurb: string; data: BuildEstimateSide }> = [
    { id: 'full', title: 'Full build', blurb: 'Solid all the way through', data: estimate.full },
    {
      id: 'hollow',
      title: 'Hollow build',
      blurb: savingPct > 0 ? `Shell only · ~${savingPct}% fewer parts` : 'Shell only',
      data: estimate.hollow,
    },
  ];

  return (
    <ScreenFrame
      accent="mint"
      eyebrow={`Bundle / ${countryCode}`}
      footer={
        <View style={styles.footerGap}>
          <PrimaryButton label="Create account & checkout" onPress={() => onNavigate('checkout')} />
          <DemoDock active="purchase" onNavigate={onNavigate} />
        </View>
      }
      onBack={onBack}
      progress={0.82}
      subtitle="We bundle every part and ship it to you as one prepared kit — with step-by-step instructions in the box. Choose how solid you want it. Prices are estimates until finalised."
      title="Your kit estimate"
    >
      <Text style={styles.label}>CHOOSE YOUR BUILD</Text>
      <View accessibilityRole="radiogroup" style={styles.fillRow}>
        {options.map((option) => {
          const active = buildFill === option.id;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              key={option.id}
              onPress={() => onBuildFillChange(option.id)}
              style={[styles.fillCard, active && styles.fillCardActive]}
            >
              <FillPreview color="#E96632" hollow={option.id === 'hollow'} />
              <Text style={[styles.fillTitle, active && styles.fillTitleActive]}>{option.title}</Text>
              <Text style={[styles.fillParts, active && styles.fillPartsActive]}>{option.data.parts} pieces</Text>
              <Text style={[styles.fillPrice, active && styles.fillPriceActive]}>{money(option.data.bundleEur)}</Text>
              <Text style={[styles.fillBlurb, active && styles.fillBlurbActive]}>{option.blurb}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.bothNote}>
        Both options include the full step-by-step PixBrik build guide. Hollow keeps the visible
        surface and empties the inside — a cheaper way to get the same look.
      </Text>

      <Text style={styles.label}>SHIP TO</Text>
      <View accessibilityRole="radiogroup" style={styles.countryRow}>
        {countries.map((candidate) => {
          const active = candidate.code === countryCode;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              key={candidate.code}
              onPress={() => onCountryChange(candidate.code)}
              style={[styles.country, active && styles.countrySelected]}
            >
              <Text style={[styles.countryCode, active && styles.countryCodeSelected]}>{candidate.code}</Text>
              <Text style={[styles.countryName, active && styles.countryNameSelected]}>{candidate.name}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.summary}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>
            {buildFill === 'hollow' ? 'Hollow' : 'Full'} kit · {side.parts} parts
          </Text>
          <Text style={styles.summaryValue}>{money(side.bundleEur)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Shipping ({countryCode}) · estimate</Text>
          <Text style={styles.summaryValue}>{money(delivery.costEur)}</Text>
        </View>
        <View style={styles.deliveryRow}>
          <Text style={styles.deliveryIcon}>⛟</Text>
          <Text style={styles.deliveryText}>
            Estimated delivery to {country?.name ?? countryCode}: <Text style={styles.deliveryDate}>{delivery.rangeLabel}</Text>
          </Text>
        </View>
        <View style={styles.couponRow}>
          <TextInput
            accessibilityLabel="Coupon code"
            autoCapitalize="characters"
            onChangeText={setCoupon}
            placeholder="Coupon code"
            placeholderTextColor={colors.inkSoft}
            style={styles.couponInput}
            value={coupon}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => undefined}
            style={({ pressed }) => [styles.couponApply, pressed && styles.pressed]}
          >
            <Text style={styles.couponApplyText}>Apply</Text>
          </Pressable>
        </View>
        <View style={[styles.summaryRow, styles.totalRow]}>
          <Text style={styles.totalLabel}>Estimated total</Text>
          <Text style={styles.totalValue}>{money(total)}</Text>
        </View>
        <Text style={styles.fine}>
          Includes a {Math.round(BUNDLE_MARKUP * 100)}% preparation service. Shipping and coupon rules are
          placeholders. Excludes VAT. This is a prototype — no payment is taken.
        </Text>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  footerGap: {
    gap: spacing.md,
  },
  label: {
    ...type.label,
    color: colors.inkSoft,
    marginBottom: spacing.md,
  },
  fillRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  fillCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    flex: 1,
    gap: 2,
    padding: spacing.md,
  },
  fillCardActive: {
    backgroundColor: colors.mintSoft,
    borderColor: colors.ink,
  },
  fillTitle: {
    ...type.body,
    color: colors.ink,
    fontWeight: '900',
  },
  fillTitleActive: {
    color: colors.ink,
  },
  fillParts: {
    ...type.micro,
    color: colors.inkSoft,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  fillPartsActive: {
    color: colors.mintDeep,
  },
  fillPrice: {
    ...type.heading,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  fillPriceActive: {
    color: colors.ink,
  },
  fillBlurb: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 9,
    marginTop: 4,
  },
  fillBlurbActive: {
    color: colors.mintDeep,
  },
  bothNote: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: spacing.xl,
  },
  countryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  country: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    minHeight: 60,
    padding: spacing.sm,
  },
  countrySelected: {
    backgroundColor: colors.ink,
  },
  countryCode: {
    ...type.heading,
    color: colors.ink,
    fontSize: 17,
  },
  countryCodeSelected: {
    color: colors.mint,
  },
  countryName: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 9,
  },
  countryNameSelected: {
    color: colors.white,
  },
  summary: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  summaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  summaryLabel: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 13,
  },
  summaryValue: {
    ...type.body,
    color: colors.ink,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
  },
  deliveryRow: {
    alignItems: 'center',
    backgroundColor: colors.mintSoft,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  deliveryIcon: {
    color: colors.mintDeep,
    fontSize: 15,
  },
  deliveryText: {
    ...type.body,
    color: colors.ink,
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  deliveryDate: {
    color: colors.mintDeep,
    fontWeight: '900',
  },
  couponRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  couponInput: {
    ...type.body,
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.ink,
    flex: 1,
    fontSize: 13,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  couponApply: {
    alignItems: 'center',
    backgroundColor: colors.paperDeep,
    borderRadius: radius.sm,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: spacing.lg,
  },
  couponApplyText: {
    ...type.body,
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.7,
  },
  totalRow: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
  totalLabel: {
    ...type.body,
    color: colors.ink,
    fontWeight: '900',
  },
  totalValue: {
    ...type.heading,
    color: colors.mintDeep,
    fontVariant: ['tabular-nums'],
  },
  fine: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 9,
    lineHeight: 13,
    marginTop: spacing.md,
  },
});
