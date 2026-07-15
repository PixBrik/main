import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BuildPreview } from '../components/BuildPreview';
import { DemoDock } from '../components/DemoDock';
import { ScreenFrame } from '../components/ScreenFrame';
import { instructions } from '../data/mockData';
import { colors, radius, spacing, type } from '../theme/tokens';
import type { DemoScreen } from '../types/navigation';

interface InstructionsScreenProps {
  onBack: () => void;
  onNavigate: (screen: DemoScreen) => void;
  onRestart: () => void;
}

export function InstructionsScreen({ onBack, onNavigate, onRestart }: InstructionsScreenProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = instructions[stepIndex] ?? instructions[0];
  const atStart = stepIndex === 0;
  const atEnd = stepIndex === instructions.length - 1;

  if (!step) return null;

  return (
    <ScreenFrame
      accent="saffron"
      eyebrow={`Assembly / Step ${stepIndex + 1} of ${instructions.length}`}
      footer={
        <View style={styles.footerGap}>
          <View style={styles.controls}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: atStart }}
              disabled={atStart}
              onPress={() => setStepIndex((current) => Math.max(0, current - 1))}
              style={({ pressed }) => [styles.previous, atStart && styles.disabled, pressed && styles.pressed]}
            >
              <Text style={styles.previousText}>← Back</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (atEnd) {
                  onRestart();
                  return;
                }
                setStepIndex((current) => Math.min(instructions.length - 1, current + 1));
              }}
              style={({ pressed }) => [styles.next, pressed && styles.pressed]}
            >
              <Text style={styles.nextText}>{atEnd ? 'Start new build ↻' : 'Next step →'}</Text>
            </Pressable>
          </View>
          <DemoDock active="instructions" onNavigate={onNavigate} />
        </View>
      }
      onBack={onBack}
      progress={0.94 + stepIndex * 0.02}
      subtitle="Isolate each stage, review the parts added, and check the connection before moving forward."
      title={step.title}
    >
      <BuildPreview accent={colors.blue} label={`ASSEMBLY / STEP ${step.number}`} step={step.number} />

      <View style={styles.stepCard}>
        <View style={styles.stepTop}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeNumber}>{step.number}</Text>
          </View>
          <Text style={styles.stepBody}>{step.body}</Text>
        </View>
        <View style={styles.stepMeta}>
          <Text style={styles.pieces}>{step.parts}</Text>
          <Text style={styles.tip}>TIP · {step.tip}</Text>
        </View>
      </View>

      <View style={styles.timeline}>
        {instructions.map((item, index) => {
          const active = index === stepIndex;
          const complete = index < stepIndex;
          return (
            <Pressable
              accessibilityLabel={`Go to step ${index + 1}: ${item.title}`}
              accessibilityRole="button"
              key={item.id}
              onPress={() => setStepIndex(index)}
              style={[
                styles.timelineDot,
                complete && styles.timelineDotComplete,
                active && styles.timelineDotActive,
              ]}
            >
              <Text style={[styles.timelineText, (active || complete) && styles.timelineTextActive]}>{index + 1}</Text>
            </Pressable>
          );
        })}
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  footerGap: {
    gap: spacing.md,
  },
  controls: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  previous: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 51,
  },
  next: {
    alignItems: 'center',
    backgroundColor: colors.blue,
    borderColor: colors.blue,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1.35,
    justifyContent: 'center',
    minHeight: 51,
  },
  previousText: {
    ...type.body,
    color: colors.ink,
    fontSize: 14,
    fontWeight: '900',
  },
  nextText: {
    ...type.body,
    color: colors.white,
    fontSize: 14,
    fontWeight: '900',
  },
  disabled: {
    opacity: 0.35,
  },
  pressed: {
    opacity: 0.72,
  },
  stepCard: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  stepTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  stepBadge: {
    alignItems: 'center',
    backgroundColor: colors.saffron,
    borderColor: colors.line,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  stepBadgeNumber: {
    ...type.heading,
    color: colors.ink,
  },
  stepBody: {
    ...type.body,
    color: colors.ink,
    flex: 1,
  },
  stepMeta: {
    backgroundColor: colors.mint,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  pieces: {
    ...type.micro,
    color: colors.ink,
  },
  tip: {
    ...type.micro,
    color: colors.ink,
    textAlign: 'right',
  },
  timeline: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  timelineDot: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  timelineDotComplete: {
    backgroundColor: colors.mintDeep,
    borderColor: colors.mintDeep,
  },
  timelineDotActive: {
    backgroundColor: colors.blue,
  },
  timelineText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '900',
  },
  timelineTextActive: {
    color: colors.white,
  },
});
