import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { InkLoader } from '../components/InkLoader';
import { countries } from '../data/mockData';
import { accentForVariant, resolveActiveModel } from '../lib/activeBuild';
import {
  BUNDLE_MARKUP,
  isCatalogStockError,
} from '../lib/brickify';
import { assessBuild, type AssessedBuildSide } from '../lib/kitAssessment';
import type { PhotoModels } from '../lib/photoEngine/voxelizePhoto';
import { estimateDelivery } from '../lib/shippingEstimate';
import { whenVisible } from '../lib/whenVisible';
import { colors, fonts, inkAlpha, radius, saffronAlpha, shadow, spacing, type } from '../theme/tokens';
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

/** 5×3 cross-section: hollow keeps a supported outer shell; full fills the core. */
function CrossSection({ hollow, onInk }: { hollow: boolean; onInk: boolean }) {
  const cells = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      const isCore = hollow && row === 1 && col >= 1 && col <= 3;
      cells.push(
        <View
          key={`${row}-${col}`}
          style={[
            styles.gridCell,
            { backgroundColor: isCore ? colors.core : onInk ? colors.saffron : colors.ink },
          ]}
        />,
      );
    }
  }
  return <View style={styles.grid}>{cells}</View>;
}

const STAGES = ['Reading the model', 'Matching parts', 'Pricing parts', 'Almost done'] as const;

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
  const [pricing, setPricing] = useState<'pending' | 'done'>('pending');
  const [pricingProgress, setPricingProgress] = useState(0);
  const country = countries.find((candidate) => candidate.code === countryCode) ?? countries[0];
  const currency = currencyMeta[country?.currency ?? 'EUR'] ?? { rate: 1, symbol: '€' };
  const toLocal = (eur: number) => eur * currency.rate;
  const money = (eur: number) => `${currency.symbol}${toLocal(eur).toFixed(2)}`;

  const estimate = useMemo(() => {
    const model = resolveActiveModel(photoBuild, selectedVariant);
    try {
      return assessBuild(model, accentForVariant(selectedVariant));
    } catch (error) {
      if (isCatalogStockError(error)) return null;
      throw error;
    }
  }, [photoBuild, selectedVariant]);

  const side: AssessedBuildSide | null = estimate
    ? buildFill === 'hollow'
      ? estimate.hollow
      : estimate.full
    : null;
  const otherSide = estimate
    ? buildFill === 'hollow'
      ? estimate.full
      : estimate.hollow
    : null;

  useEffect(() => {
    if (side && !side.buildable && otherSide?.buildable) {
      onBuildFillChange(buildFill === 'hollow' ? 'full' : 'hollow');
    }
  }, [buildFill, onBuildFillChange, otherSide, side]);
  const savingPct = estimate ? Math.round(estimate.hollowSaving * 100) : 0;
  const delivery = useMemo(() => estimateDelivery(countryCode), [countryCode]);
  const totalEur = side ? side.bundleEur + delivery.costEur : 0;
  const buildName = (photoBuild?.label ?? 'Signal Fox').toUpperCase();

  // Branded pricing wait: staged ink-fill, then crossfade into the kit.
  const contentIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!estimate) return;
    let cancelled = false;
    const cleanup = whenVisible(
      () => {
        const start = Date.now();
        const DURATION = 2100;
        const tick = () => {
          if (cancelled) return;
          const progress = Math.min(1, (Date.now() - start) / DURATION);
          setPricingProgress(progress);
          if (progress < 1) {
            setTimeout(tick, 40);
          } else {
            setPricing('done');
            Animated.timing(contentIn, {
              duration: 200,
              easing: Easing.out(Easing.quad),
              toValue: 1,
              useNativeDriver: true,
            }).start();
          }
        };
        tick();
      },
      () => {
        setPricingProgress(1);
        setPricing('done');
        contentIn.setValue(1);
      },
    );
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [contentIn, estimate]);

  // The big total counts digit-by-digit whenever it changes.
  const totalAnim = useRef(new Animated.Value(0)).current;
  const [shownTotal, setShownTotal] = useState(0);
  useEffect(() => {
    const id = totalAnim.addListener(({ value }) => setShownTotal(value));
    return () => totalAnim.removeListener(id);
  }, [totalAnim]);
  useEffect(() => {
    if (!estimate || pricing !== 'done') return;
    // Hidden tabs suspend rAF — jump straight to the value so it can't stick at 0.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      totalAnim.setValue(toLocal(totalEur));
      return;
    }
    Animated.timing(totalAnim, {
      duration: 400,
      easing: Easing.out(Easing.cubic),
      toValue: toLocal(totalEur),
      useNativeDriver: false,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimate, pricing, totalEur, currency.rate]);

  if (!estimate || !side || !side.buildable) {
    return (
      <View style={styles.screen}>
        <View style={styles.unavailableScreen}>
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={onBack}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <Text style={styles.backText}>←</Text>
          </Pressable>
          <View accessibilityRole="alert" style={styles.unavailableMessage}>
            <Text accessibilityRole="header" style={styles.screenTitle}>
              {side && !side.buildable ? 'BUILD OPTION UNAVAILABLE' : 'KIT UNAVAILABLE'}
            </Text>
            <Text style={styles.cardCaption}>
              {side && !side.buildable
                ? `${side.assemblyIssue} PixBrik will not sell a kit that cannot generate a safe guide. Go back and choose a highlighted size or fill.`
                : 'Current catalog stock cannot cover every piece in this build. No order has been created. Go back and choose another build profile, or try again later.'}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  if (pricing === 'pending') {
    const stage = STAGES[Math.min(STAGES.length - 1, Math.floor(pricingProgress * STAGES.length))]!;
    const label = stage === 'Pricing parts' ? `Pricing ${side.parts.toLocaleString('en-US')} parts` : stage;
    return (
      <View style={styles.loaderScreen}>
        <InkLoader dots progress={pricingProgress} size={52} stage={label} />
        <Text style={styles.loaderFoot}>
          Matching every brick to the current catalog snapshot.{'\n'}This takes a few seconds.
        </Text>
      </View>
    );
  }

  const totalWhole = Math.floor(shownTotal);
  const totalCents = Math.round((shownTotal - totalWhole) * 100);

  // Reinforced hollow first — same approved outside, with the base/ribs that
  // make the lower-part-count model practical to assemble.
  const options = [
    { id: 'hollow' as BuildFill, name: 'REINFORCED HOLLOW', meta: estimate.hollow.buildable ? `${estimate.hollow.parts.toLocaleString('en-US')} parts${savingPct > 0 ? ` · −${savingPct}%` : ''} · internal supports` : 'Not offered · cannot produce a safe guide', price: estimate.hollow.bundleEur, buildable: estimate.hollow.buildable },
    { id: 'full' as BuildFill, name: 'SOLID · COLLECTOR', meta: estimate.full.buildable ? `${estimate.full.parts.toLocaleString('en-US')} parts · filled core` : 'Not offered · cannot produce a safe guide', price: estimate.full.bundleEur, buildable: estimate.full.buildable },
  ];

  return (
    <Animated.View style={[styles.screen, { opacity: contentIn }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={onBack}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <Text style={styles.backText}>←</Text>
          </Pressable>
          <Text style={styles.screenTitle}>YOUR KIT</Text>
          <View style={styles.backPlaceholder} />
        </View>

        <Text style={styles.estimateLabel}>
          {buildName} · ESTIMATE
        </Text>
        <View style={styles.priceRow}>
          <Text style={styles.priceWhole}>
            {currency.symbol}
            {totalWhole.toLocaleString('en-US')}
          </Text>
          <Text style={styles.priceCents}>.{totalCents.toString().padStart(2, '0')}</Text>
        </View>
        <Text style={styles.priceSub}>Kit + shipping · excludes tax · prototype, no payment taken</Text>

        <View accessibilityRole="radiogroup" style={styles.cardRow}>
          {options.map((option) => {
            const selected = buildFill === option.id;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: !option.buildable }}
                disabled={!option.buildable}
                key={option.id}
                onPress={() => onBuildFillChange(option.id)}
                style={({ pressed }) => [
                  styles.card,
                  selected ? styles.cardInk : styles.cardWhite,
                  !option.buildable && styles.cardUnavailable,
                  pressed && styles.pressed,
                ]}
              >
                <CrossSection hollow={option.id === 'hollow'} onInk={selected} />
                <Text style={[styles.cardName, { color: selected ? colors.saffron : colors.ink }]}>
                  {option.name}
                </Text>
                <Text style={[styles.cardMeta, { color: selected ? saffronAlpha(0.7) : inkAlpha(0.6) }]}>
                  {option.meta}
                </Text>
                <Text style={[styles.cardPrice, { color: selected ? colors.white : colors.ink }]}>
                  {option.buildable ? money(option.price) : '—'}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.cardCaption}>
          Same approved outside. Reinforced hollow keeps two base layers plus internal ribs and
          columns; solid fills the entire hidden core. One-piece-at-a-time guide included.
        </Text>

        <Text style={styles.shipLabel}>SHIP TO</Text>
        <View accessibilityRole="radiogroup" style={styles.chipRow}>
          {countries.map((candidate) => {
            const selected = candidate.code === countryCode;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={candidate.code}
                onPress={() => onCountryChange(candidate.code)}
                style={({ pressed }) => [
                  styles.chip,
                  selected ? styles.chipSelected : styles.chipIdle,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipCode, { color: selected ? colors.saffron : inkAlpha(0.55) }]}>
                  {candidate.code}
                </Text>
                {selected ? <Text style={styles.chipName}>{candidate.name}</Text> : null}
              </Pressable>
            );
          })}
        </View>

        {/* The screen's ONE alarm element. */}
        <View style={styles.deliveryRow}>
          <View style={styles.alarmDot} />
          <Text style={styles.deliveryText}>
            Arrives <Text style={styles.deliveryDates}>{delivery.rangeLabel.toUpperCase()}</Text> ·{' '}
            {money(delivery.costEur)} shipping
          </Text>
        </View>

        <Text style={styles.fine}>
          Includes a {Math.round(BUNDLE_MARKUP * 100)}% preparation service.
        </Text>
      </ScrollView>

      <View style={styles.dockWrap}>
        <View style={styles.dock}>
          <View style={styles.dockTotal}>
            <Text style={styles.dockTotalLabel}>TOTAL</Text>
            <Text style={styles.dockTotalValue}>{money(totalEur)}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => onNavigate('checkout')}
            style={({ pressed }) => [styles.dockSlab, pressed && styles.pressed]}
          >
            <Text style={styles.dockSlabText}>CHECKOUT →</Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  loaderScreen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loaderFoot: {
    ...type.body,
    bottom: spacing.huge,
    color: inkAlpha(0.6),
    fontSize: 12,
    position: 'absolute',
    textAlign: 'center',
  },
  unavailableScreen: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: 520,
    padding: spacing.xl,
    width: '100%',
  },
  unavailableMessage: {
    marginTop: spacing.xl,
  },
  scroll: {
    alignSelf: 'center',
    flexGrow: 1,
    maxWidth: 520,
    paddingBottom: 130,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    width: '100%',
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  back: {
    ...shadow.card,
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  backText: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '700',
  },
  backPlaceholder: {
    width: 46,
  },
  screenTitle: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 16,
    letterSpacing: -0.3,
  },
  pressed: {
    transform: [{ scale: 0.97 }],
  },
  estimateLabel: {
    color: inkAlpha(0.66),
    fontFamily: fonts.extrabold,
    fontSize: 12,
    letterSpacing: 1,
  },
  priceRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    marginTop: 2,
  },
  priceWhole: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 72,
    fontVariant: ['tabular-nums'],
    letterSpacing: -3,
    lineHeight: 76,
  },
  priceCents: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 26,
    fontVariant: ['tabular-nums'],
    marginLeft: 2,
  },
  priceSub: {
    color: inkAlpha(0.66),
    fontFamily: fonts.semibold,
    fontSize: 12,
    marginTop: 4,
  },
  cardRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: spacing.xl,
  },
  card: {
    borderRadius: radius.lg,
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  cardInk: {
    backgroundColor: colors.ink,
  },
  cardWhite: {
    ...shadow.card,
    backgroundColor: colors.white,
    shadowOpacity: 0.12,
  },
  cardUnavailable: {
    opacity: 0.45,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
    marginBottom: spacing.md,
    width: 5 * 14 + 4 * 3,
  },
  gridCell: {
    borderRadius: 2,
    height: 14,
    width: 14,
  },
  cardName: {
    fontFamily: fonts.display,
    fontSize: 18,
    letterSpacing: -0.4,
  },
  cardMeta: {
    fontFamily: fonts.bold,
    fontSize: 11,
    marginTop: 2,
  },
  cardPrice: {
    fontFamily: fonts.display,
    fontSize: 22,
    fontVariant: ['tabular-nums'],
    marginTop: spacing.sm,
  },
  cardCaption: {
    color: inkAlpha(0.6),
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.md,
  },
  shipLabel: {
    ...type.micro,
    color: inkAlpha(0.55),
    marginTop: spacing.xl,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  chip: {
    alignItems: 'center',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 18,
  },
  chipIdle: {
    backgroundColor: inkAlpha(0.08),
  },
  chipSelected: {
    backgroundColor: colors.ink,
  },
  chipCode: {
    fontFamily: fonts.extrabold,
    fontSize: 13,
  },
  chipName: {
    color: colors.saffron,
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  deliveryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  alarmDot: {
    backgroundColor: colors.alarm,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  deliveryText: {
    color: colors.ink,
    fontFamily: fonts.extrabold,
    fontSize: 13,
  },
  deliveryDates: {
    fontFamily: fonts.display,
  },
  fine: {
    color: inkAlpha(0.5),
    fontFamily: fonts.medium,
    fontSize: 10,
    lineHeight: 14,
    marginTop: spacing.lg,
  },
  dockWrap: {
    alignItems: 'center',
    bottom: 20,
    left: 0,
    paddingHorizontal: spacing.lg,
    position: 'absolute',
    right: 0,
  },
  dock: {
    ...shadow.dock,
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radius.xl,
    flexDirection: 'row',
    gap: spacing.md,
    maxWidth: 520 - spacing.lg * 2,
    padding: 14,
    width: '100%',
  },
  dockTotal: {
    paddingLeft: spacing.sm,
  },
  dockTotalLabel: {
    color: saffronAlpha(0.6),
    fontFamily: fonts.extrabold,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  dockTotalValue: {
    color: colors.saffron,
    fontFamily: fonts.display,
    fontSize: 20,
    fontVariant: ['tabular-nums'],
  },
  dockSlab: {
    alignItems: 'center',
    backgroundColor: colors.saffron,
    borderRadius: radius.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: 56,
  },
  dockSlabText: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 17,
    letterSpacing: -0.3,
  },
});
