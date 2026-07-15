import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, signals, spacing, type, type SignalName } from '../theme/tokens';

interface ChoiceStripProps {
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
  accent?: SignalName;
  meta?: string;
}

export function ChoiceStrip({
  title,
  description,
  selected,
  onPress,
  accent = 'mint',
  meta,
}: ChoiceStripProps) {
  const signal = signals[accent];

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.strip,
        selected && { backgroundColor: signal.soft, borderColor: colors.ink },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.rail, { backgroundColor: signal.main }]} />
      <View
        style={[
          styles.signalTile,
          { borderColor: signal.deep },
          selected && { backgroundColor: signal.main, borderColor: colors.ink },
        ]}
      >
        <Text style={[styles.signalText, { color: selected ? colors.ink : signal.deep }]}>
          {selected ? '◆' : '◇'}
        </Text>
      </View>
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {meta ? <Text style={[styles.meta, { color: signal.deep }]}>{meta}</Text> : null}
        </View>
        <Text style={styles.description}>{description}</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: signal.deep }]} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
    minHeight: 82,
    overflow: 'hidden',
    paddingRight: spacing.lg,
  },
  pressed: {
    opacity: 0.82,
  },
  rail: {
    alignSelf: 'stretch',
    width: 6,
  },
  signalTile: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1.5,
    height: 42,
    justifyContent: 'center',
    marginLeft: spacing.sm,
    width: 42,
  },
  signalText: {
    fontSize: 18,
    fontWeight: '800',
  },
  copy: {
    flex: 1,
    paddingVertical: spacing.md,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  title: {
    ...type.heading,
    color: colors.ink,
    fontSize: 17,
  },
  description: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 14,
    lineHeight: 19,
    marginTop: 2,
  },
  meta: {
    ...type.micro,
    fontVariant: ['tabular-nums'],
    letterSpacing: 1.1,
  },
  radio: {
    alignItems: 'center',
    borderColor: colors.ink,
    borderRadius: 5,
    borderWidth: 1.5,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  radioSelected: {
    backgroundColor: colors.white,
  },
  radioDot: {
    borderRadius: 2,
    height: 10,
    width: 10,
  },
});
