import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { countries } from '../data/mockData';
import { accentForVariant, profileForVariant, resolveActiveModel } from '../lib/activeBuild';
import { isCatalogStockError } from '../lib/brickify';
import { assessBuild } from '../lib/kitAssessment';
import { useAppNavigation } from '../lib/navigationContext';
import {
  removeCheckoutDraft,
  saveCheckoutDraft,
  type CheckoutDraftSnapshot,
} from '../lib/checkoutDraftStore';
import {
  createOrder,
  inferOrderPaletteMode,
  snapshotOrderModel,
  type OrderPaletteMode,
  type OrderRecord,
} from '../lib/orderStore';
import type { PhotoModels } from '../lib/photoEngine/voxelizePhoto';
import { usePixBrikAuth } from '../lib/pixbrikAuth';
import { estimateDelivery } from '../lib/shippingEstimate';
import { colors, radius, spacing, type } from '../theme/tokens';
import type { BuildFill, BuildProduct } from '../types/navigation';

interface CheckoutScreenProps {
  buildId: string | null;
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
  source3DSubject?: 'object' | 'person';
  checkoutDraftId?: string | null;
  onCheckoutDraftSaved?: (draft: CheckoutDraftSnapshot) => void;
}

const currencyMeta: Readonly<Record<string, { rate: number; symbol: string }>> = {
  EUR: { rate: 1, symbol: '€' },
  GBP: { rate: 0.86, symbol: '£' },
  USD: { rate: 1.1, symbol: '$' },
};

export function CheckoutScreen({
  buildId,
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
  source3DSubject = 'object',
  checkoutDraftId = null,
  onCheckoutDraftSaved,
}: CheckoutScreenProps) {
  const [placed, setPlaced] = useState<OrderRecord | null>(null);
  const [storageError, setStorageError] = useState('');
  const [savedDraftId, setSavedDraftId] = useState(checkoutDraftId);
  const [draftStorageState, setDraftStorageState] = useState<'saving' | 'saved' | 'unavailable'>('saving');
  const auth = usePixBrikAuth();
  const navigate = useAppNavigation();
  const authLoading = auth.configured && !auth.loaded;
  const signedIn = auth.loaded && auth.isSignedIn && !!auth.user;
  const customerEmail = signedIn ? auth.user?.email ?? null : null;
  const customerName = signedIn ? auth.user?.displayName ?? null : null;

  const country = countries.find((candidate) => candidate.code === countryCode) ?? countries[0];
  const currency = currencyMeta[country?.currency ?? 'EUR'] ?? { rate: 1, symbol: '€' };
  const money = (eur: number) => `${currency.symbol}${(eur * currency.rate).toFixed(2)}`;

  const model = useMemo(() => resolveActiveModel(photoBuild, selectedVariant), [photoBuild, selectedVariant]);
  const accent = accentForVariant(selectedVariant);
  const estimate = useMemo(() => {
    try {
      return assessBuild(model, accent);
    } catch (error) {
      if (isCatalogStockError(error)) return null;
      throw error;
    }
  }, [accent, model]);
  const delivery = useMemo(() => estimateDelivery(countryCode), [countryCode]);
  const selectedSide = estimate
    ? buildFill === 'hollow'
      ? estimate.hollow
      : estimate.full
    : null;

  useEffect(() => {
    if (!selectedSide?.buildable) {
      setDraftStorageState('unavailable');
      return;
    }
    const palette = paletteMode ?? inferOrderPaletteMode(model);
    const saved = saveCheckoutDraft({
      id: savedDraftId ?? checkoutDraftId,
      build: {
        accent,
        buildId,
        fill: buildFill,
        hasDepth: photoBuild?.hasDepth ?? buildProduct === 'sculpture',
        mode: photoBuild?.mode ?? (buildProduct === 'sculpture' ? 'volume' : 'relief'),
        name: buildName.trim() || 'PixBrik build',
        paletteMode: palette,
        product: buildProduct,
        selectedVariant,
        source3DMeshUrl,
        source3DRetakesRemaining,
        source3DSubject,
        style: photoBuild?.style ?? 'natural',
      },
      delivery: {
        countryCode,
        rangeLabel: delivery.rangeLabel,
      },
      model: snapshotOrderModel(model, accent),
      quote: {
        currency: country?.currency ?? 'EUR',
        currencySymbol: currency.symbol,
        kitPrice: Number((selectedSide.bundleEur * currency.rate).toFixed(2)),
        quotedAt: new Date().toISOString(),
        requiresServerReprice: true,
        shippingPrice: Number((delivery.costEur * currency.rate).toFixed(2)),
        totalPrice: Number(((selectedSide.bundleEur + delivery.costEur) * currency.rate).toFixed(2)),
      },
    });
    if (!saved) {
      setDraftStorageState('unavailable');
      return;
    }
    setSavedDraftId(saved.id);
    setDraftStorageState('saved');
    onCheckoutDraftSaved?.(saved);
  }, [
    accent,
    buildFill,
    buildId,
    buildName,
    buildProduct,
    checkoutDraftId,
    country?.currency,
    countryCode,
    currency.rate,
    currency.symbol,
    delivery.costEur,
    delivery.rangeLabel,
    model,
    onCheckoutDraftSaved,
    paletteMode,
    photoBuild?.hasDepth,
    photoBuild?.mode,
    photoBuild?.style,
    savedDraftId,
    selectedSide,
    selectedVariant,
    source3DMeshUrl,
    source3DRetakesRemaining,
    source3DSubject,
  ]);

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

  if (!selectedSide?.buildable) {
    return (
      <ScreenFrame
        accent="coral"
        eyebrow="Buildability check"
        footer={<PrimaryButton label="Choose another option" onPress={onBack} />}
        onBack={onBack}
        title="This combination cannot be ordered."
        subtitle="PixBrik will not take an order unless the exact catalog packing can produce a safe step-by-step guide."
      >
        <View accessibilityRole="alert" style={styles.doneCard}>
          <Text style={styles.doneTitle}>Choose a highlighted size or fill.</Text>
          <Text style={styles.doneBody}>
            {selectedSide?.assemblyIssue ?? 'One or more pieces cannot lock onto the assembled model.'}
          </Text>
        </View>
      </ScreenFrame>
    );
  }

  const side = selectedSide;
  const total = side.bundleEur + delivery.costEur;

  const placeOrder = () => {
    setStorageError('');
    const order = createOrder({
      accent,
      buildId,
      buildName,
      countryCode,
      currency: country?.currency ?? 'EUR',
      currencySymbol: currency.symbol,
      customerEmail: null,
      customerName: null,
      deliveryRange: delivery.rangeLabel,
      fill: buildFill,
      guest: true,
      kitPrice: Number((side.bundleEur * currency.rate).toFixed(2)),
      model,
      paletteMode: paletteMode ?? inferOrderPaletteMode(model),
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
    if (savedDraftId) removeCheckoutDraft(savedDraftId);
    setPlaced(order);
  };

  if (placed) {
    return (
      <ScreenFrame accent="mint" eyebrow="Demo / Saved" onBack={onBack} title="Demo order saved.">
        <View style={styles.doneCard}>
          <Text style={styles.doneMark}>✓</Text>
          <Text style={styles.doneTitle}>
            Thanks{customerName ? `, ${customerName.split(' ')[0]}` : ''}!
          </Text>
          <Text style={styles.doneBody}>
            Your {buildFill} {buildName} kit ({placed.parts} parts) is saved as demo order {placed.id}.
            Its exact model, colours, price and generated instructions are saved in the device section
            of Account. This is a local demo record: it is not synced and no payment was taken.
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
          label="Save demo order on this device"
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

      <Text style={styles.sectionLabel}>ACCOUNT &amp; ORDER STORAGE</Text>
      <View style={styles.identityNotice}>
        <Text style={styles.identityTitle}>
          {authLoading
            ? 'CHECKING SECURE SIGN-IN…'
            : signedIn
            ? `SIGNED IN AS ${customerEmail ?? customerName ?? 'PIXBRIK BUILDER'}`
            : 'NOT SIGNED IN · DEVICE-ONLY DEMO'}
        </Text>
        <Text style={styles.formNote}>
          {authLoading
            ? 'You can still save this local demo while account status loads. No account data is written into the saved order.'
            : signedIn
            ? 'Your Clerk session is active. This prototype order still stays on this device and stores no account name or email until the PostgreSQL order service is connected.'
            : 'Saving this demo does not create an account. Production checkout will collect contact, delivery and payment details before placing a real order.'}
        </Text>
        <Text accessibilityLiveRegion="polite" style={styles.draftNote}>
          {draftStorageState === 'saved'
            ? 'Your exact model, size, fill, colours and delivery choice are saved in this browser for 30 days. This is device-only; no recovery email will be sent.'
            : draftStorageState === 'saving'
            ? 'Saving this exact checkout in this browser…'
            : 'This browser could not save a resumable checkout. Keep this page open if you want to return to it.'}
        </Text>
      </View>
      {!signedIn && auth.configured && auth.loaded ? (
        <Pressable
          accessibilityHint="Opens the real Clerk sign-in and account creation screen"
          accessibilityRole="button"
          onPress={() => navigate('account')}
          style={({ pressed }) => [styles.signInAction, pressed && styles.pressed]}
        >
          <Text style={styles.signInActionText}>SIGN IN OR CREATE ACCOUNT →</Text>
        </Pressable>
      ) : null}
      {!signedIn && !auth.configured ? (
        <Text accessibilityRole="alert" style={styles.authUnavailable}>
          Sign-in will appear here after the production Clerk key is configured.
        </Text>
      ) : null}
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
  identityNotice: {
    backgroundColor: colors.white,
    borderColor: colors.ink,
    borderRadius: radius.md,
    borderWidth: 1.5,
    padding: spacing.md,
  },
  identityTitle: {
    ...type.label,
    color: colors.ink,
    fontSize: 11,
  },
  signInAction: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  signInActionText: {
    ...type.label,
    color: colors.saffron,
    fontSize: 12,
  },
  authUnavailable: {
    ...type.micro,
    color: colors.alarm,
    fontSize: 10,
    lineHeight: 14,
    marginTop: spacing.sm,
  },
  formNote: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 10,
    lineHeight: 14,
    marginTop: spacing.xs,
  },
  draftNote: {
    ...type.micro,
    borderTopColor: '#D8DCE7',
    borderTopWidth: 1,
    color: colors.inkSoft,
    fontSize: 10,
    lineHeight: 14,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
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
