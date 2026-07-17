import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { listBuilds } from '../lib/buildGallery';
import { listOrders, type OrderRecord } from '../lib/orderStore';
import { colors, radius, spacing, type } from '../theme/tokens';

interface AccountScreenProps {
  onBack: () => void;
  onOpenBuilds: () => void;
  onOpenInstructions: (order: OrderRecord) => void;
  selectedOrderId?: string | null;
}

function money(order: OrderRecord, amount: number) {
  return `${order.currencySymbol}${amount.toFixed(2)}`;
}

export function AccountScreen({
  onBack,
  onOpenBuilds,
  onOpenInstructions,
  selectedOrderId = null,
}: AccountScreenProps) {
  const [orders] = useState<OrderRecord[]>(listOrders);
  const [expandedId, setExpandedId] = useState<string | null>(selectedOrderId ?? orders[0]?.id ?? null);
  const [buildCount] = useState(() => listBuilds().length);

  return (
    <ScreenFrame
      accent="mint"
      eyebrow="My account"
      footer={<PrimaryButton label={`My builds (${buildCount})`} onPress={onOpenBuilds} />}
      onBack={onBack}
      subtitle="Orders and build guides are saved on this device while account sign-in is being prepared."
      title="Your PixBrik orders."
    >
      {orders.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>NO ORDERS YET</Text>
          <Text style={styles.emptyBody}>
            Complete the demo checkout and the exact kit, price, colours and generated guide will appear here.
          </Text>
        </View>
      ) : (
        <View style={styles.orders}>
          {orders.map((order) => {
            const expanded = expandedId === order.id;
            const date = new Date(order.createdAt).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            });
            return (
              <View key={order.id} style={[styles.orderCard, expanded && styles.orderCardExpanded]}>
                <Pressable
                  accessibilityLabel={`${expanded ? 'Close' : 'Open'} order ${order.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  onPress={() => setExpandedId(expanded ? null : order.id)}
                  style={({ pressed }) => [styles.orderHead, pressed && styles.pressed]}
                >
                  <View style={styles.orderHeadCopy}>
                    <Text style={styles.orderId}>{order.id}</Text>
                    <Text numberOfLines={1} style={styles.orderName}>{order.buildName}</Text>
                    <Text style={styles.orderDate}>{date}</Text>
                  </View>
                  <View style={styles.orderHeadPrice}>
                    <Text style={styles.status}>RESERVED · DEMO</Text>
                    <Text style={styles.total}>{money(order, order.totalPrice)}</Text>
                    <Text style={styles.chevron}>{expanded ? '−' : '+'}</Text>
                  </View>
                </Pressable>

                {expanded ? (
                  <View style={styles.details}>
                    <View style={styles.detailGrid}>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>PRODUCT</Text>
                        <Text style={styles.detailValue}>
                          {order.product === 'sculpture' ? 'True 3D sculpture' : 'Flat photo panel'}
                        </Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>BUILD</Text>
                        <Text style={styles.detailValue}>{order.profile} · {order.fill}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>KIT</Text>
                        <Text style={styles.detailValue}>{order.kitQuantity} × {order.parts.toLocaleString()} parts</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>COLOURS</Text>
                        <Text style={styles.detailValue}>
                          {order.paletteMode === 'black-white' ? 'Black & white' : 'Natural'} · {order.colorCount}
                        </Text>
                      </View>
                      {order.source3DMeshUrl ? (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>SOURCE 3D</Text>
                          <Text style={styles.detailValue}>Approved mesh linked</Text>
                        </View>
                      ) : null}
                    </View>

                    <View accessibilityLabel={`${order.colorCount} ordered brick colours`} style={styles.palette}>
                      {order.colors.slice(0, 12).map((color) => (
                        <View
                          key={`${color.name}-${color.hex}`}
                          style={[styles.swatch, { backgroundColor: color.hex }]}
                        />
                      ))}
                    </View>

                    <View style={styles.priceRows}>
                      <View style={styles.priceRow}>
                        <Text style={styles.priceLabel}>Kit</Text>
                        <Text style={styles.priceValue}>{money(order, order.kitPrice)}</Text>
                      </View>
                      <View style={styles.priceRow}>
                        <Text style={styles.priceLabel}>Shipping · {order.countryCode}</Text>
                        <Text style={styles.priceValue}>{money(order, order.shippingPrice)}</Text>
                      </View>
                      <View style={[styles.priceRow, styles.priceTotalRow]}>
                        <Text style={styles.priceTotalLabel}>TOTAL</Text>
                        <Text style={styles.priceTotal}>{money(order, order.totalPrice)} {order.currency}</Text>
                      </View>
                    </View>

                    <Text style={styles.delivery}>Estimated delivery {order.deliveryRange}</Text>
                    <PrimaryButton
                      label="Open this build's instructions"
                      onPress={() => onOpenInstructions(order)}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  orders: { gap: spacing.md },
  emptyCard: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    padding: spacing.xl,
  },
  emptyTitle: { ...type.heading, color: colors.ink },
  emptyBody: { ...type.body, color: colors.inkSoft, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  orderCard: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  orderCardExpanded: { borderColor: colors.ink },
  orderHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 96,
    padding: spacing.lg,
  },
  orderHeadCopy: { flex: 1, paddingRight: spacing.md },
  orderId: { ...type.micro, color: colors.mintDeep, letterSpacing: 0.8 },
  orderName: { ...type.heading, color: colors.ink, fontSize: 18, marginTop: 3 },
  orderDate: { ...type.micro, color: colors.inkSoft, fontSize: 9, marginTop: 3 },
  orderHeadPrice: { alignItems: 'flex-end' },
  status: { ...type.micro, color: colors.mintDeep, fontSize: 8 },
  total: { ...type.heading, color: colors.ink, fontSize: 18, marginTop: 3 },
  chevron: { color: colors.ink, fontSize: 22, fontWeight: '800', lineHeight: 24 },
  details: {
    backgroundColor: colors.mintSoft,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  detailItem: { minWidth: '45%', flex: 1 },
  detailLabel: { ...type.micro, color: colors.inkSoft, fontSize: 8 },
  detailValue: { ...type.body, color: colors.ink, fontSize: 12, fontWeight: '800', textTransform: 'capitalize' },
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  swatch: { borderColor: colors.ink, borderRadius: 4, borderWidth: 1, height: 20, width: 20 },
  priceRows: { backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.md },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  priceLabel: { ...type.body, color: colors.inkSoft, fontSize: 12 },
  priceValue: { ...type.body, color: colors.ink, fontSize: 12, fontVariant: ['tabular-nums'], fontWeight: '800' },
  priceTotalRow: { borderTopColor: colors.line, borderTopWidth: 1, marginTop: spacing.xs, paddingTop: spacing.sm },
  priceTotalLabel: { ...type.label, color: colors.ink },
  priceTotal: { ...type.heading, color: colors.ink, fontSize: 16, fontVariant: ['tabular-nums'] },
  delivery: { ...type.micro, color: colors.mintDeep, fontSize: 9 },
  pressed: { opacity: 0.72 },
});
