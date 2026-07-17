import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { LIBRARY_COLORS, type LibraryEntry } from '../data/carLibrary';
import { listLibrary } from '../lib/libraryStore';
import { colors, radius, spacing, type } from '../theme/tokens';
import type { DemoScreen } from '../types/navigation';

interface LibraryScreenProps {
  onBack: () => void;
  onNavigate: (screen: DemoScreen) => void;
  onGenerate: (entry: LibraryEntry, colorHex: string) => Promise<void>;
  generating: boolean;
  generationProgress?: number;
}

type EraFilter = 'all' | 'classic' | 'modern';

export function LibraryScreen({
  onBack,
  onNavigate,
  onGenerate,
  generating,
  generationProgress = 0,
}: LibraryScreenProps) {
  const [entries] = useState<LibraryEntry[]>(() => listLibrary());
  const [era, setEra] = useState<EraFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);

  const cars = useMemo(
    () => entries.filter((entry) => entry.category === 'car' && (era === 'all' || entry.era === era)),
    [entries, era],
  );
  const others = useMemo(() => entries.filter((entry) => entry.category !== 'car'), [entries]);
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const buildColor = color ?? selected?.defaultColor ?? LIBRARY_COLORS[0]!;

  const renderCard = (entry: LibraryEntry) => {
    const active = entry.id === selectedId;
    const buildable = !!entry.meshUrl;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        key={entry.id}
        onPress={() => {
          setSelectedId(entry.id);
          setColor(entry.defaultColor);
        }}
        style={[styles.card, active && styles.cardActive, !buildable && styles.cardDisabled]}
      >
        <View style={[styles.swatch, { backgroundColor: entry.defaultColor }]} />
        <View style={styles.cardCopy}>
          <Text style={styles.cardName}>{entry.name}</Text>
          <Text style={styles.cardMeta}>
            {entry.era ? `${entry.era} · ` : ''}
            {buildable ? 'ready to build' : 'model coming soon'}
          </Text>
        </View>
        {active ? <Text style={styles.cardCheck}>◆</Text> : null}
      </Pressable>
    );
  };

  return (
    <ScreenFrame
      accent="indigo"
      eyebrow="Library / Pick a model"
      footer={
        selected && selected.meshUrl ? (
          <PrimaryButton
            disabled={generating}
            label={
              generating
                ? `Generating three build sizes… ${Math.round(generationProgress * 100)}%`
                : `Build the ${selected.name}`
            }
            onPress={() => onGenerate(selected, buildColor)}
          />
        ) : (
          <PrimaryButton disabled label={selected ? 'Model coming soon' : 'Pick a model to continue'} onPress={() => undefined} />
        )
      }
      onBack={onBack}
      subtitle="Pick a model and a colour — we generate the brick build for you, no photo needed."
      title="Object library"
    >
      <View accessibilityRole="radiogroup" style={styles.eraRow}>
        {(['all', 'classic', 'modern'] as const).map((option) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: era === option }}
            key={option}
            onPress={() => setEra(option)}
            style={[styles.eraChip, era === option && styles.eraChipActive]}
          >
            <Text style={[styles.eraText, era === option && styles.eraTextActive]}>
              {option === 'all' ? 'All cars' : option}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.list}>{cars.map(renderCard)}</View>

      {others.length ? (
        <>
          <Text style={styles.sectionLabel}>MORE OBJECTS</Text>
          <View style={styles.list}>{others.map(renderCard)}</View>
        </>
      ) : null}

      {selected ? (
        <View style={styles.colorPanel}>
          <Text style={styles.sectionLabel}>COLOUR</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.colorRow}>
              {LIBRARY_COLORS.map((hex) => (
                <Pressable
                  accessibilityLabel={`Colour ${hex}`}
                  accessibilityRole="button"
                  key={hex}
                  onPress={() => setColor(hex)}
                  style={[styles.colorDot, { backgroundColor: hex }, buildColor === hex && styles.colorDotActive]}
                />
              ))}
            </View>
          </ScrollView>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={() => onNavigate('admin')}
        style={({ pressed }) => [styles.adminLink, pressed && styles.pressed]}
      >
        <Text style={styles.adminLinkText}>Manage library (admin) →</Text>
      </Pressable>

      <Text style={styles.disclaimer}>
        Model names are generic and not affiliated with, endorsed by, or licensed from any vehicle
        manufacturer. Prototype library.
      </Text>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  eraRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  eraChip: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flex: 1,
    justifyContent: 'center',
    minHeight: 42,
  },
  eraChipActive: {
    backgroundColor: colors.blue,
    borderColor: colors.ink,
  },
  eraText: {
    ...type.body,
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  eraTextActive: {
    color: colors.white,
  },
  list: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  card: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: spacing.md,
  },
  cardActive: {
    backgroundColor: colors.blueSoft,
    borderColor: colors.ink,
  },
  cardDisabled: {
    opacity: 0.6,
  },
  swatch: {
    borderColor: colors.ink,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    height: 34,
    width: 34,
  },
  cardCopy: {
    flex: 1,
  },
  cardName: {
    ...type.body,
    color: colors.ink,
    fontWeight: '900',
  },
  cardMeta: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 9,
    textTransform: 'capitalize',
  },
  cardCheck: {
    color: colors.blue,
    fontSize: 16,
    fontWeight: '900',
  },
  sectionLabel: {
    ...type.label,
    color: colors.inkSoft,
    marginBottom: spacing.md,
  },
  colorPanel: {
    marginBottom: spacing.lg,
  },
  colorRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: 2,
  },
  colorDot: {
    borderColor: colors.line,
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 38,
    width: 38,
  },
  colorDotActive: {
    borderColor: colors.ink,
    borderWidth: 3,
  },
  adminLink: {
    justifyContent: 'center',
    minHeight: 44,
  },
  adminLinkText: {
    ...type.body,
    color: colors.blue,
    fontSize: 13,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.6,
  },
  disclaimer: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 9,
    lineHeight: 13,
    marginTop: spacing.sm,
  },
});
