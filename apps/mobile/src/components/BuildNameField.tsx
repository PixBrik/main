import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { latestBuild, renameBuild } from '../lib/buildGallery';
import { colors, radius, spacing, type } from '../theme/tokens';

/**
 * Name-your-build field. Renames the most recently saved build (the one just
 * created) so it shows under "Previous builds" with a memorable name. Purely
 * local (localStorage via buildGallery) — no app wiring needed.
 */
export function BuildNameField({ enabled }: { enabled: boolean }) {
  const [name, setName] = useState(() => latestBuild()?.name ?? '');
  const [saved, setSaved] = useState(false);

  if (!enabled) return null;

  const save = () => {
    const target = latestBuild();
    if (target && renameBuild(target.id, name)) {
      setSaved(true);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>NAME THIS BUILD</Text>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="Build name"
          maxLength={40}
          onChangeText={(value) => {
            setName(value);
            setSaved(false);
          }}
          placeholder="e.g. Mum's cat, my car…"
          placeholderTextColor={colors.inkSoft}
          returnKeyType="done"
          onSubmitEditing={save}
          style={styles.input}
          value={name}
        />
        <Pressable
          accessibilityRole="button"
          onPress={save}
          style={({ pressed }) => [styles.button, saved && styles.buttonSaved, pressed && styles.pressed]}
        >
          <Text style={[styles.buttonText, saved && styles.buttonTextSaved]}>{saved ? 'Saved ✓' : 'Save name'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.xl,
  },
  label: {
    ...type.label,
    color: colors.inkSoft,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  input: {
    ...type.body,
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1.5,
    color: colors.ink,
    flex: 1,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: spacing.lg,
  },
  buttonSaved: {
    backgroundColor: colors.mintDeep,
  },
  buttonText: {
    ...type.body,
    color: colors.white,
    fontSize: 13,
    fontWeight: '800',
  },
  buttonTextSaved: {
    color: colors.white,
  },
  pressed: {
    opacity: 0.75,
  },
});
