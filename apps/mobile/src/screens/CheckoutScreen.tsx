import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { countries } from '../data/mockData';
import { accentForVariant, resolveActiveModel } from '../lib/activeBuild';
import { estimateBuild } from '../lib/brickify';
import type { PhotoModels } from '../lib/photoEngine/voxelizePhoto';
import { estimateDelivery } from '../lib/shippingEstimate';
import { colors, radius, spacing, type } from '../theme/tokens';
import type { BuildFill } from '../types/navigation';

interface CheckoutScreenProps {
  onBack: () => void;
  onDone: () => void;
  selectedVariant: string;
  photoBuild?: PhotoModels | null;
  buildFill: BuildFill;
  countryCode: string;
  buildName: string;
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
}: CheckoutScreenProps) {
  const [guest, setGuest] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [placed, setPlaced] = useState(false);

  const country = countries.find((candidate) => candidate.code === countryCode) ?? countries[0];
  const currency = currencyMeta[country?.currency ?? 'EUR'] ?? { rate: 1, symbol: '€' };
  const money = (eur: number) => `${currency.symbol}${(eur * currency.rate).toFixed(2)}`;

  const estimate = useMemo(() => {
    const model = resolveActiveModel(photoBuild, selectedVariant);
    return estimateBuild(model, accentForVariant(selectedVariant));
  }, [photoBuild, selectedVariant]);
  const side = buildFill === 'hollow' ? estimate.hollow : estimate.full;
  const delivery = useMemo(() => estimateDelivery(countryCode), [countryCode]);
  const total = side.bundleEur + delivery.costEur;

  const identified = guest || (name.trim().length > 1 && /.+@.+\..+/.test(email));
  const canPlace = identified;

  if (placed) {
    return (
      <ScreenFrame accent="mint" eyebrow="Order / Confirmed" onBack={onBack} title="Kit reserved.">
        <View style={styles.doneCard}>
          <Text style={styles.doneMark}>✓</Text>
          <Text style={styles.doneTitle}>Thanks{name ? `, ${name.split(' ')[0]}` : ''}!</Text>
          <Text style={styles.doneBody}>
            Your {buildFill} {buildName} kit ({side.parts} parts) is reserved. In production you would
            get an order confirmation and tracking by email. This is a prototype — no payment was taken
            and no order was actually placed.
          </Text>
        </View>
        <PrimaryButton label="Back to start" onPress={onDone} />
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
          onPress={() => setPlaced(true)}
        />
      }
      onBack={onBack}
      progress={0.95}
      subtitle="Review your kit and confirm. Prototype checkout — no real payment is collected."
      title="Almost there"
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
});
