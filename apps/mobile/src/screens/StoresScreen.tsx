import { StyleSheet, Text, View } from 'react-native';

import { DemoDock } from '../components/DemoDock';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { StoreMap } from '../components/StoreMap';
import { stores } from '../data/mockData';
import { colors, radius, spacing, type } from '../theme/tokens';
import type { DemoScreen } from '../types/navigation';

interface StoresScreenProps {
  onBack: () => void;
  onNavigate: (screen: DemoScreen) => void;
}

const storeTints = [colors.coralSoft, colors.blueSoft, colors.mintSoft] as const;

export function StoresScreen({ onBack, onNavigate }: StoresScreenProps) {
  return (
    <ScreenFrame
      accent="mint"
      eyebrow="Local sourcing"
      footer={
        <View style={styles.footerGap}>
          <PrimaryButton label="Open assembly guide" onPress={() => onNavigate('instructions')} />
          <DemoDock active="stores" onNavigate={onNavigate} />
        </View>
      }
      onBack={onBack}
      progress={0.9}
      subtitle="Loose-parts walls change often. PixBrik separates store features, sightings and confirmed stock."
      title="Three nearby options"
    >
      <StoreMap />
      <View style={styles.warning}>
        <Text style={styles.warningMark}>!</Text>
        <Text style={styles.warningText}>Never shown as guaranteed: call ahead before making a special trip.</Text>
      </View>

      {stores.map((store, index) => (
        <View key={store.id} style={styles.store}>
          <View style={styles.storeTop}>
            <View style={[styles.storeNumber, { backgroundColor: storeTints[index % storeTints.length] }]}>
              <Text style={styles.storeNumberText}>{index + 1}</Text>
            </View>
            <View style={styles.storeCopy}>
              <Text style={styles.storeName}>{store.name}</Text>
              <Text style={styles.storeAddress}>{store.address} · {store.distance}</Text>
            </View>
            <Text style={styles.match}>{store.match ? `${store.match} refs` : '—'}</Text>
          </View>
          <View style={styles.storeBottom}>
            <Text style={styles.storeStatus}>{store.status}</Text>
            <Text style={styles.verification}>{store.verification}</Text>
          </View>
        </View>
      ))}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  footerGap: {
    gap: spacing.md,
  },
  warning: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
    marginTop: spacing.md,
  },
  warningMark: {
    backgroundColor: colors.saffron,
    borderColor: colors.line,
    borderRadius: radius.pill,
    borderWidth: 1,
    color: colors.ink,
    fontWeight: '900',
    height: 28,
    lineHeight: 24,
    overflow: 'hidden',
    textAlign: 'center',
    width: 28,
  },
  warningText: {
    ...type.body,
    color: colors.inkSoft,
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  store: {
    backgroundColor: colors.white,
    borderColor: colors.ink,
    borderRadius: radius.lg,
    borderWidth: 2,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  storeTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  storeNumber: {
    alignItems: 'center',
    borderColor: colors.ink,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  storeNumberText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '900',
  },
  storeCopy: {
    flex: 1,
  },
  storeName: {
    ...type.body,
    color: colors.ink,
    fontWeight: '900',
  },
  storeAddress: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 12,
    lineHeight: 17,
  },
  match: {
    ...type.micro,
    color: colors.blue,
    textAlign: 'right',
  },
  storeBottom: {
    backgroundColor: colors.paper,
    borderTopColor: colors.ink,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  storeStatus: {
    ...type.micro,
    color: colors.ink,
  },
  verification: {
    ...type.micro,
    color: colors.coral,
    fontSize: 9,
    textAlign: 'right',
  },
});
