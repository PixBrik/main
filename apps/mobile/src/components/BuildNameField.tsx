import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { renameBuild } from '../lib/buildGallery';
import { colors, radius, spacing, type } from '../theme/tokens';

/** Names the exact reviewed build while keeping the downstream order name in sync. */
interface BuildNameFieldProps {
  buildId: string | null;
  enabled: boolean;
  name: string;
  onNameChange: (name: string) => void;
}

export function BuildNameField({ buildId, enabled, name, onNameChange }: BuildNameFieldProps) {
  const [savedIdentity, setSavedIdentity] = useState<{ buildId: string; name: string } | null>(null);
  const trimmedName = name.trim();
  const saved =
    !!buildId &&
    !!trimmedName &&
    savedIdentity?.buildId === buildId &&
    savedIdentity.name === trimmedName;

  if (!enabled) return null;

  const save = () => {
    if (!trimmedName) return;
    if (!buildId) {
      onNameChange(trimmedName);
      setSavedIdentity(null);
      return;
    }
    if (!renameBuild(buildId, trimmedName)) return;
    onNameChange(trimmedName);
    setSavedIdentity({ buildId, name: trimmedName });
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>NAME THIS BUILD</Text>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="Build name"
          maxLength={40}
          onChangeText={(value) => {
            onNameChange(value);
            setSavedIdentity(null);
          }}
          placeholder="e.g. Mum's cat, my car…"
          placeholderTextColor={colors.inkSoft}
          returnKeyType="done"
          onSubmitEditing={save}
          style={styles.input}
          value={name}
        />
        <Pressable
          accessibilityHint={
            buildId
              ? 'Saves the name with this browser build.'
              : 'Uses the name for this session and any demo order; this build is not saved in the gallery.'
          }
          accessibilityRole="button"
          onPress={save}
          style={({ pressed }) => [styles.button, saved && styles.buttonSaved, pressed && styles.pressed]}
        >
          <Text style={[styles.buttonText, saved && styles.buttonTextSaved]}>
            {buildId ? (saved ? 'Saved ✓' : 'Save name') : 'Use name'}
          </Text>
        </Pressable>
      </View>
      {!buildId ? (
        <Text style={styles.hint}>
          This build is not saved in the gallery. Its name applies to this session and any demo order only.
        </Text>
      ) : null}
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
  hint: {
    ...type.micro,
    color: colors.inkSoft,
    fontSize: 9,
    lineHeight: 13,
    marginTop: spacing.xs,
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
