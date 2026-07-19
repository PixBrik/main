import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { BricklingAvatar } from '../components/BricklingAvatar';
import { ClerkAuthPanel } from '../components/ClerkAuthPanel';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { listBuilds } from '../lib/buildGallery';
import { clear360Capture, has360Capture } from '../lib/capture360Store';
import { clearLastCapture, hasLastCapture } from '../lib/captureStore';
import { listOrders, type OrderRecord } from '../lib/orderStore';
import { usePixBrikAuth } from '../lib/pixbrikAuth';
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
  const auth = usePixBrikAuth();
  const [orders] = useState<OrderRecord[]>(listOrders);
  const [expandedId, setExpandedId] = useState<string | null>(selectedOrderId ?? orders[0]?.id ?? null);
  const [buildCount] = useState(() => listBuilds().length);
  const [rawCapturePresent, setRawCapturePresent] = useState(
    () => Platform.OS === 'web' && (has360Capture() || hasLastCapture()),
  );
  const [signOutState, setSignOutState] = useState<'idle' | 'working' | 'failed'>('idle');
  const currentUser = auth.loaded && auth.isSignedIn ? auth.user : null;
  const hasBrowserStorage = Platform.OS === 'web';

  const signOut = async () => {
    if (!currentUser || signOutState === 'working') return;
    setSignOutState('working');
    try {
      await auth.signOut();
      setSignOutState('idle');
    } catch {
      setSignOutState('failed');
    }
  };

  return (
    <ScreenFrame
      accent="mint"
      eyebrow={
        currentUser
          ? 'Account / Signed in'
          : auth.configured
            ? hasBrowserStorage
              ? 'Account / Browser only'
              : 'Account / Project saving off'
            : hasBrowserStorage
              ? 'Account / Browser workspace'
              : 'Account / Storage unavailable'
      }
      footer={<PrimaryButton label={`Build gallery (${buildCount})`} onPress={onOpenBuilds} />}
      onBack={onBack}
      subtitle={
        auth.configured
          ? hasBrowserStorage
            ? 'Identity and browser project storage are separate. Signing in does not upload the builds or demo orders saved in this browser.'
            : 'Identity and project storage are separate. This native build does not save builds or demo orders locally yet.'
          : hasBrowserStorage
            ? 'Your browser builds and demo orders are ready below. Cloud sync is not connected yet.'
            : 'Cloud account sign-in and local project saving are not connected in this native build.'
      }
      title={
        currentUser
          ? `Hi, ${currentUser.displayName.split(/\s+/)[0]}.`
          : auth.configured
            ? 'Your PixBrik space.'
            : hasBrowserStorage
              ? 'Your browser workspace.'
              : 'Your PixBrik space.'
      }
    >
      {!auth.configured ? (
        <View style={styles.authNotice}>
          <Text style={styles.authKicker}>
            {hasBrowserStorage ? 'BROWSER WORKSPACE READY' : 'LOCAL PROJECT SAVING UNAVAILABLE'}
          </Text>
          <Text style={styles.authBody}>
            {hasBrowserStorage
              ? 'You can create builds, review saved orders and open instructions in this browser. Cloud account sign-in and sync are not connected yet, so this data will not follow you to another browser or device.'
              : 'This native app build does not save builds or demo orders locally. Cloud account sign-in and sync are also not connected yet; use the web app for browser-local saving.'}
          </Text>
        </View>
      ) : !auth.loaded ? (
        <View accessibilityLiveRegion="polite" style={styles.authNotice}>
          <Text style={styles.authKicker}>CHECKING SECURE SIGN-IN…</Text>
          <Text style={styles.authBody}>
            {hasBrowserStorage
              ? 'Your browser builds remain available while account status loads.'
              : 'Account status is loading. This native app build has no local project storage.'}
          </Text>
        </View>
      ) : currentUser ? (
        <View style={styles.identityCard}>
          <BricklingAvatar
            label={currentUser.displayName}
            seed={currentUser.id}
            size={58}
          />
          <View style={styles.identityCopy}>
            <Text style={styles.authKicker}>SIGNED IN WITH CLERK</Text>
            <Text style={styles.identityName}>{currentUser.displayName}</Text>
            {currentUser.email ? <Text style={styles.identityEmail}>{currentUser.email}</Text> : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: signOutState === 'working' }}
            disabled={signOutState === 'working'}
            onPress={() => void signOut()}
            style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
          >
            <Text style={styles.signOutText}>{signOutState === 'working' ? 'SIGNING OUT…' : 'SIGN OUT'}</Text>
          </Pressable>
          {signOutState === 'failed' ? (
            <Text accessibilityRole="alert" style={styles.authError}>
              Sign-out did not complete. Check your connection and try again.
            </Text>
          ) : null}
          <Text style={styles.identityBoundary}>
            {hasBrowserStorage
              ? "Signing out ends the Clerk session. It does not delete or transfer this browser's local data."
              : 'Signing out ends the Clerk session. This native app build has no local build or order storage.'}
          </Text>
        </View>
      ) : (
        <ClerkAuthPanel />
      )}

      <View style={styles.deviceBoundary}>
        <Text style={styles.deviceBoundaryTitle}>
          {hasBrowserStorage ? 'PRIVATE TO THIS BROWSER · CLOUD SYNC OFF' : 'LOCAL PROJECT SAVING OFF'}
        </Text>
        <Text style={styles.deviceBoundaryBody}>
          {hasBrowserStorage
            ? `${buildCount} build${buildCount === 1 ? '' : 's'} and ${orders.length} demo order${orders.length === 1 ? '' : 's'} are visible only in this browser.`
            : 'This native app build has no local build or order storage. Cloud sync is also off.'}
        </Text>
      </View>

      {hasBrowserStorage ? (
        <View style={styles.capturePrivacyCard}>
          <View style={styles.capturePrivacyCopy}>
            <Text style={styles.capturePrivacyTitle}>SOURCE PHOTO PRIVACY</Text>
            <Text style={styles.capturePrivacyBody}>
              Raw capture photos are kept only in this browser for retakes and expire automatically after 24 hours.
              Saved brick models and demo orders do not need the raw photos.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !rawCapturePresent }}
            disabled={!rawCapturePresent}
            onPress={() => {
              clear360Capture();
              clearLastCapture();
              setRawCapturePresent(false);
            }}
            style={({ pressed }) => [
              styles.deleteCaptures,
              !rawCapturePresent && styles.deleteCapturesDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.deleteCapturesText}>
              {rawCapturePresent ? 'DELETE CAPTURED PHOTOS' : 'NO RAW PHOTOS STORED'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>{hasBrowserStorage ? 'ORDERS IN THIS BROWSER' : 'SAVED ORDERS'}</Text>
      {orders.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>NO ORDERS YET</Text>
          <Text style={styles.emptyBody}>
            {hasBrowserStorage
              ? 'Complete the demo checkout and the exact kit, price, colours and generated guide will appear in this browser. It will not be added to your Clerk account.'
              : 'This native app build cannot save demo orders yet. Use the web app for browser-local order review and instructions until cloud accounts are connected.'}
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
                    <Text style={styles.status}>SAVED · DEMO</Text>
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
  authNotice: {
    backgroundColor: colors.white,
    borderColor: colors.ink,
    borderRadius: radius.lg,
    borderWidth: 2,
    marginBottom: spacing.lg,
    padding: spacing.lg,
  },
  authKicker: { ...type.label, color: colors.ink },
  authBody: { ...type.body, color: colors.inkSoft, fontSize: 13, marginTop: spacing.sm },
  identityCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.ink,
    borderRadius: radius.lg,
    borderWidth: 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.lg,
    padding: spacing.lg,
  },
  identityCopy: { flex: 1, minWidth: 150 },
  identityName: { ...type.heading, color: colors.ink, fontSize: 18, marginTop: 2 },
  identityEmail: { ...type.body, color: colors.inkSoft, fontSize: 12 },
  signOut: {
    borderColor: colors.ink,
    borderRadius: radius.pill,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.lg,
  },
  signOutText: { ...type.label, color: colors.ink },
  authError: { ...type.body, color: colors.danger, flexBasis: '100%', fontSize: 12 },
  identityBoundary: { ...type.body, color: colors.inkSoft, flexBasis: '100%', fontSize: 11 },
  deviceBoundary: {
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
    padding: spacing.lg,
  },
  deviceBoundaryTitle: { ...type.label, color: colors.saffron },
  deviceBoundaryBody: { ...type.body, color: colors.white, fontSize: 12, marginTop: spacing.xs },
  capturePrivacyCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.lg,
    padding: spacing.lg,
  },
  capturePrivacyCopy: { flex: 1, minWidth: 220 },
  capturePrivacyTitle: { ...type.label, color: colors.ink },
  capturePrivacyBody: { ...type.body, color: colors.inkSoft, fontSize: 11, marginTop: spacing.xs },
  deleteCaptures: {
    borderColor: colors.ink,
    borderRadius: radius.pill,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  deleteCapturesDisabled: { opacity: 0.45 },
  deleteCapturesText: { ...type.micro, color: colors.ink, fontSize: 8 },
  sectionLabel: { ...type.label, color: colors.inkSoft, marginBottom: spacing.sm },
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
