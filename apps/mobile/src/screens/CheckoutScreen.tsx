import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { countries } from '../data/mockData';
import { accentForVariant, profileForVariant, resolveActiveModel } from '../lib/activeBuild';
import { estimateBuild, hollowBuildModel, isCatalogStockError } from '../lib/brickify';
import { saveBuild } from '../lib/buildGallery';
import {
  createOrder,
  inferOrderPaletteMode,
  type OrderPaletteMode,
  type OrderRecord,
} from '../lib/orderStore';
import type { PhotoModels } from '../lib/photoEngine/voxelizePhoto';
import { estimateDelivery } from '../lib/shippingEstimate';
import { colors, radius, spacing, type } from '../theme/tokens';
import type { BuildFill, BuildProduct } from '../types/navigation';

interface CheckoutScreenProps {
  onBack: () => void;
  onDone: () => void;
  selectedVariant: string;
  photoBuild?: PhotoModels | null;
  buildFill: BuildFill;
  countryCode: string;
  buildName: string;
  buildProduct: BuildProduct;
  paletteMode?: OrderPaletteMode;
  onOrderPlaced: (order: OrderRecord) => void;
  source3DMeshUrl?: string | null;
  source3DRetakesRemaining?: number;
}

const currencyMeta: Readonly<Record<string, { rate: number; symbol: string }>> = {
  EUR: { rate: 1, symbol: '€' },
  GBP: { rate: 0.86, symbol: '£' },
  USD: { rate: 1.1, symbol: '$' },
};

export function CheckoutScreen({
  onBack,
  onDone,
  selectedVariant,
  photoBuild = null,
  buildFill,
  countryCode,
  buildName,
  buildProduct,
  paletteMode,
  onOrderPlaced,
  source3DMeshUrl = null,
  source3DRetakesRemaining = 0,
}: CheckoutScreenProps) {
  const [guest, setGuest] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [placed, setPlaced] = useState<OrderRecord | null>(null);
  const [storageError, setStorageError] = useState('');

  const country = countries.find((candidate) => candidate.code === countryCode) ?? countries[0];
  const currency = currencyMeta[country?.currency ?? 'EUR'] ?? { rate: 1, symbol: '€' };
  const money = (eur: number) => `${currency.symbol}${(eur * currency.rate).toFixed(2)}`;

  const model = useMemo(() => resolveActiveModel(photoBuild, selectedVariant), [photoBuild, selectedVariant]);
  const accent = accentForVariant(selectedVariant);
  const estimate = useMemo(() => {
    try {
      return estimateBuild(model, accent);
    } catch (error) {
      if (isCatalogStockError(error)) return null;
      throw error;
    }
  }, [accent, model]);
  const delivery = useMemo(() => estimateDelivery(countryCode), [countryCode]);

  if (!estimate) {
    return (
      <ScreenFrame
        accent="mint"
        eyebrow="Catalog stock"
        footer={<PrimaryButton label="Go back" onPress={onBack} />}
        title="This kit is unavailable right now."
        subtitle="Current catalog stock cannot cover every piece in this build. No order has been created."
      >
        <View accessibilityRole="alert" style={styles.doneCard}>
          <Text style={styles.doneTitle}>We cannot complete this kit from the current catalog.</Text>
          <Text style={styles.doneBody}>Go back and choose another build profile, or try again later.</Text>
        </View>
      </ScreenFrame>
    );
  }

  const side = buildFill === 'hollow' ? estimate.hollow : estimate.full;
  const total = side.bundleEur + delivery.costEur;

  const identified = guest || (name.trim().length > 1 && /.+@.+\..+/.test(email));
  const canPlace = identified;

  const placeOrder = () => {
    setStorageError('');
    const orderedModel = buildFill === 'hollow' ? hollowBuildModel(model) : model;
    const saved = saveBuild(buildName, orderedModel, accent, {
      hasDepth: photoBuild?.hasDepth ?? buildProduct === 'sculpture',
      mode: photoBuild?.mode ?? (buildProduct === 'sculpture' ? 'volume' : 'relief'),
      product: buildProduct,
      provenance: buildProduct === 'sculpture' ? 'provider-3d' : 'flat-photo',
      ...(source3DMeshUrl
        ? { source3DMeshUrl, source3DRetakesRemaining }
        : {}),
      style: photoBuild?.style ?? 'natural',
    });
    const order = createOrder({
      accent,
      buildId: saved?.id ?? null,
      buildName,
      countryCode,
      currency: country?.currency ?? 'EUR',
      currencySymbol: currency.symbol,
      customerEmail: guest ? null : email,
      customerName: guest ? null : name,
      deliveryRange: delivery.rangeLabel,
      fill: buildFill,
      guest,
      kitPrice: Number((side.bundleEur * currency.rate).toFixed(2)),
      model: orderedModel,
      paletteMode: paletteMode ?? inferOrderPaletteMode(orderedModel),
      product: buildProduct,
      profile: profileForVariant(selectedVariant),
      selectedVariant,
      shippingPrice: Number((delivery.costEur * currency.rate).toFixed(2)),
      source3DMeshUrl,
      source3DRetakesRemaining,
      style: photoBuild?.style ?? 'natural',
      totalPrice: Number((total * currency.rate).toFixed(2)),
    });
    if (!order) {
      setStorageError('We could not save this order on this device. Check browser storage and try again.');
      return;
    }
    setPlaced(order);
  };

  if (placed) {
    return (
      <ScreenFrame accent="mint" eyebrow="Order / Confirmed" onBack={onBack} title="Kit reserved.">
        <View style={styles.doneCard}>
          <Text style={styles.doneMark}>✓</Text>
          <Text style={styles.doneTitle}>Thanks{name ? `, ${name.split(' ')[0]}` : ''}!</Text>
          <Text style={styles.doneBody}>
            Your {buildFill} {buildName} kit ({placed.parts} parts) is reserved under order {placed.id}.
            Its exact model, colours, price and generated instructions are now saved in My Account on
            this device. This is still a demo reservation — no payment was taken.
          </Text>
        </View>
        <View style={styles.doneActions}>
          <PrimaryButton label="View order & instructions" onPress={() => onOrderPlaced(placed)} />
          <Pressable
            accessibilityRole="button"
            onPress={onDone}
            style={({ pressed }) => [styles.startOver, pressed && styles.pressed]}
          >
            <Text style={styles.startOverText}>BACK TO START</Text>
          </Pressable>
        </View>
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame
      accent="mint"
      eyebrow="Checkout"
      footer={
        <PrimaryButton
          accessibilityHint="Prototype checkout — no payment is processed"
          disabled={!canPlace}
          label={canPlace ? 'Place order (demo)' : 'Add your details to continue'}
          onPress={placeOrder}
        />
      }
      onBack={onBack}
      progress={0.95}
      subtitle="One last look. Prototype checkout — no real payment is collected."
      title="Almost theirs."
    >
      <View style={styles.order}>
        <Text style={styles.orderLabel}>ORDER SUMMARY</Text>
        <View style={styles.orderRow}>
          <Text style={styles.orderName}>
            {buildName} · {buildFill} build
          </Text>
          <Text style={styles.orderVal}>{money(side.bundleEur)}</Text>
        </View>
        <Text style={styles.orderMeta}>
          {side.parts} parts · {side.colorCount} colours · step-by-step guide included
        </Text>
        <View style={styles.orderRow}>
          <Text style={styles.orderMeta}>Shipping ({countryCode})</Text>
          <Text style={styles.orderVal}>{money(delivery.costEur)}</Text>
        </View>
        <Text style={styles.orderDelivery}>Estimated delivery {delivery.rangeLabel}</Text>
        <View style={[styles.orderRow, styles.orderTotal]}>
          <Text style={styles.orderTotalLabel}>Total</Text>
          <Text style={styles.orderTotalVal}>{money(total)}</Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>YOUR DETAILS</Text>
      <View style={styles.accountToggle}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setGuest(false)}
          style={[styles.toggleChip, !guest && styles.toggleChipActive]}
        >
          <Text style={[styles.toggleText, !guest && styles.toggleTextActive]}>Create account</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setGuest(true)}
          style={[styles.toggleChip, guest && styles.toggleChipActive]}
        >
          <Text style={[styles.toggleText, guest && styles.toggleTextActive]}>Continue as guest</Text>
        </Pressable>
      </View>

      {!guest ? (
        <View style={styles.form}>
          <TextInput
            accessibilityLabel="Full name"
            autoCapitalize="words"
            onChangeText={setName}
            placeholder="Full name"
            placeholderTextColor={colors.inkSoft}
            style={styles.input}
            value={name}
          />
          <TextInput
            accessibilityLabel="Email address"
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Email address"
            placeholderTextColor={colors.inkSoft}
            style={styles.input}
            value={email}
          />
          <Text style={styles.formNote}>
            Prototype only — details are kept on this device to demo the flow and are never sent
            anywhere. No password or card is collected.
          </Text>
        </View>
      ) : (
        <Text style={styles.formNote}>
          You can check out without an account. Delivery details would be collected next in production.
        </Text>
      )}
      {storageError ? <Text accessibilityRole="alert" style={styles.storageError}>{storageError}</Text> : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  order: {
    backgroundColor: colors.panelDark,
    borderLeftColor: colors.mint,
    borderLeftWidth: 5,
    borderRadius: radius.lg,
    marginBottom: spacing.xl,
    padding: spacing.lg,
  },
  orderLabel: {
    ...type.micro,
    color: colors.mint,
    letterSpacing: 1.2,
    marginBottom: spacing.sm,
  },
  orderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  orderName: {
    ...type.body,
    color: colors.white,
    fontWeight: '900',
    textTransform: 'capitalize',
  },
  orderVal: {
    ...type.body,
    color: colors.white,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
  },
  orderMeta: {
    ...type.micro,
    color: '#AEB5C7',
    fontSize: 10,
  },
  orderDelivery: {
    ...type.micro,
    color: colors.mint,
    fontSize: 10,
    marginTop: 2,
  },
  orderTotal: {
    borderTopColor: '#31384D',
    borderTopWidth: 1,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
  orderTotalLabel: {
    ...type.body,
    color: colors.white,
    fontWeight: '900',
  },
  orderTotalVal: {
    ...type.heading,
    color: colors.mint,
    fontVariant: ['tabular-nums'],
  },
  sectionLabel: {
    ...type.label,
    color: colors.inkSoft,
    marginBottom: spacing.md,
  },
  accountToggle: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  toggleChip: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  toggleChipActive: {
    backgroundColor: colors.blue,
    borderColor: colors.ink,
  },
  toggleText: {
    ...type.body,
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  toggleTextActive: {
    color: colors.white,
  },
  form: {
    gap: spacing.sm,
  },
  input: {
    ...type.body,
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1.5,
    color: colors.ink,
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  formNote: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 10,
    lineHeight: 14,
    marginTop: spacing.xs,
  },
  doneCard: {
    alignItems: 'center',
    backgroundColor: colors.mintSoft,
    borderRadius: radius.lg,
    marginBottom: spacing.xl,
    padding: spacing.xl,
  },
  doneMark: {
    color: colors.mintDeep,
    fontSize: 40,
    fontWeight: '900',
  },
  doneTitle: {
    ...type.heading,
    color: colors.ink,
    marginTop: spacing.sm,
  },
  doneBody: {
    ...type.body,
    color: colors.ink,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  doneActions: {
    gap: spacing.md,
  },
  startOver: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  startOverText: {
    ...type.label,
    color: colors.ink,
  },
  pressed: {
    opacity: 0.7,
  },
  storageError: {
    ...type.body,
    color: colors.alarm,
    fontSize: 12,
    fontWeight: '800',
    marginTop: spacing.md,
  },
});
