import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { LIBRARY_COLORS, type LibraryCategory, type LibraryEra, type LibraryEntry } from '../data/carLibrary';
import { addLibraryEntry, listLibrary, removeLibraryEntry, resetLibrary } from '../lib/libraryStore';
import { colors, radius, spacing, type } from '../theme/tokens';

interface AdminScreenProps {
  onBack: () => void;
}

const CATEGORIES: LibraryCategory[] = ['car', 'animal', 'plant', 'object'];
const ERAS: LibraryEra[] = ['classic', 'modern'];

export function AdminScreen({ onBack }: AdminScreenProps) {
  const [entries, setEntries] = useState<LibraryEntry[]>(() => listLibrary());
  const [name, setName] = useState('');
  const [category, setCategory] = useState<LibraryCategory>('car');
  const [era, setEra] = useState<LibraryEra>('classic');
  const [meshUrl, setMeshUrl] = useState('');
  const [color, setColor] = useState(LIBRARY_COLORS[0]!);

  const refresh = () => setEntries(listLibrary());

  const add = () => {
    if (name.trim().length < 2) return;
    addLibraryEntry({
      name: name.trim(),
      category,
      era: category === 'car' ? era : undefined,
      tags: [],
      meshUrl: meshUrl.trim() || null,
      defaultColor: color,
    });
    setName('');
    setMeshUrl('');
    refresh();
  };

  return (
    <ScreenFrame
      accent="saffron"
      eyebrow="Admin / Library"
      footer={<PrimaryButton label="Add to library" onPress={add} />}
      onBack={onBack}
      subtitle="Prototype admin. Entries are stored on this device to demo bulk-loading the object library. Use generic, non-branded names."
      title="Manage library"
    >
      <Text style={styles.sectionLabel}>NEW ENTRY</Text>
      <TextInput
        accessibilityLabel="Model name"
        onChangeText={setName}
        placeholder="Generic model name (e.g. 60s Muscle Coupe)"
        placeholderTextColor={colors.inkSoft}
        style={styles.input}
        value={name}
      />
      <View style={styles.chipRow}>
        {CATEGORIES.map((option) => (
          <Pressable
            accessibilityRole="button"
            key={option}
            onPress={() => setCategory(option)}
            style={[styles.chip, category === option && styles.chipActive]}
          >
            <Text style={[styles.chipText, category === option && styles.chipTextActive]}>{option}</Text>
          </Pressable>
        ))}
      </View>
      {category === 'car' ? (
        <View style={styles.chipRow}>
          {ERAS.map((option) => (
            <Pressable
              accessibilityRole="button"
              key={option}
              onPress={() => setEra(option)}
              style={[styles.chip, era === option && styles.chipActive]}
            >
              <Text style={[styles.chipText, era === option && styles.chipTextActive]}>{option}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <TextInput
        accessibilityLabel="Mesh URL"
        autoCapitalize="none"
        onChangeText={setMeshUrl}
        placeholder="GLB mesh URL (optional — leave blank for placeholder)"
        placeholderTextColor={colors.inkSoft}
        style={styles.input}
        value={meshUrl}
      />
      <View style={styles.colorRow}>
        {LIBRARY_COLORS.map((hex) => (
          <Pressable
            accessibilityLabel={`Colour ${hex}`}
            accessibilityRole="button"
            key={hex}
            onPress={() => setColor(hex)}
            style={[styles.colorDot, { backgroundColor: hex }, color === hex && styles.colorDotActive]}
          />
        ))}
      </View>

      <View style={styles.listHeader}>
        <Text style={styles.sectionLabel}>LIBRARY ({entries.length})</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            resetLibrary();
            refresh();
          }}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <Text style={styles.resetText}>Reset to defaults</Text>
        </Pressable>
      </View>
      {entries.map((entry) => (
        <View key={entry.id} style={styles.row}>
          <View style={[styles.swatch, { backgroundColor: entry.defaultColor }]} />
          <View style={styles.rowCopy}>
            <Text style={styles.rowName}>{entry.name}</Text>
            <Text style={styles.rowMeta}>
              {entry.category}
              {entry.era ? ` · ${entry.era}` : ''} · {entry.meshUrl ? 'mesh set' : 'no mesh'}
              {entry.seed ? ' · seed' : ''}
            </Text>
          </View>
          {entry.seed ? (
            <Text style={styles.rowLocked}>seed</Text>
          ) : (
            <Pressable
              accessibilityLabel={`Remove ${entry.name}`}
              accessibilityRole="button"
              onPress={() => {
                removeLibraryEntry(entry.id);
                refresh();
              }}
              style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
            >
              <Text style={styles.removeText}>✕</Text>
            </Pressable>
          )}
        </View>
      ))}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    ...type.label,
    color: colors.inkSoft,
    marginBottom: spacing.md,
  },
  input: {
    ...type.body,
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1.5,
    color: colors.ink,
    fontSize: 14,
    marginBottom: spacing.sm,
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  chip: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1.5,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  chipActive: {
    backgroundColor: colors.panelDark,
    borderColor: colors.ink,
  },
  chipText: {
    ...type.body,
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  chipTextActive: {
    color: colors.white,
  },
  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  colorDot: {
    borderColor: colors.line,
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 34,
    width: 34,
  },
  colorDotActive: {
    borderColor: colors.ink,
    borderWidth: 3,
  },
  listHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  resetText: {
    ...type.micro,
    color: colors.coral,
    marginBottom: spacing.md,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 54,
  },
  swatch: {
    borderColor: colors.ink,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    height: 28,
    width: 28,
  },
  rowCopy: {
    flex: 1,
  },
  rowName: {
    ...type.body,
    color: colors.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  rowMeta: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 9,
    textTransform: 'capitalize',
  },
  rowLocked: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 9,
  },
  remove: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  removeText: {
    color: colors.coral,
    fontSize: 16,
    fontWeight: '900',
  },
  pressed: {
    opacity: 0.6,
  },
});
