import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import { colors, radius, spacing, type } from '../theme/tokens';

interface ProgressScreenProps {
  onBack: () => void;
  onContinue: () => void;
}

const jobs = [
  { title: 'Reading the silhouette', note: 'mapping primary volumes', color: colors.coral, soft: colors.coralSoft },
  { title: 'Testing stable geometry', note: 'running 14 structure passes', color: colors.blueBright, soft: colors.blueSoft },
  { title: 'Matching catalog parts', note: 'checking regional availability', color: colors.mint, soft: colors.mintSoft },
] as const;

export function ProgressScreen({ onBack, onContinue }: ProgressScreenProps) {
  const [completed, setCompleted] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCompleted((current) => {
        if (current >= jobs.length) {
          clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, 800);

    return () => clearInterval(timer);
  }, []);

  const ready = completed === jobs.length;

  return (
    <ScreenFrame
      eyebrow="4 / Generating model"
      footer={
        <PrimaryButton
          disabled={!ready}
          label={ready ? 'Open 3D build' : 'Generating…'}
          onPress={onContinue}
        />
      }
      onBack={onBack}
      progress={0.5}
      subtitle="This fixture simulates the geometry, stability, and catalog-matching pipeline locally."
      title={ready ? 'Three build profiles ready.' : 'Generating build systems.'}
    >
      <View accessibilityLiveRegion="polite" style={styles.workbench}>
        <View style={styles.pipelineHeader}>
          <Text style={styles.pipelineTitle}>MODEL PIPELINE / V0.1</Text>
          <View style={styles.pipelineStatus}>
            <View style={styles.pipelineDot} />
            <Text style={styles.pipelineStatusText}>ACTIVE</Text>
          </View>
        </View>
        {jobs.map((job, index) => {
          const isComplete = completed > index;
          const isActive = completed === index;
          return (
            <View
              key={job.title}
              style={[
                styles.job,
                isActive && { backgroundColor: job.soft, borderLeftColor: job.color },
              ]}
            >
              <View style={[styles.jobMark, isComplete && styles.jobMarkDone, !isComplete && { backgroundColor: job.color }]}>
                <Text style={[styles.jobMarkText, isComplete && styles.jobMarkTextDone]}>{isComplete ? '✓' : index + 1}</Text>
              </View>
              <View style={styles.jobCopy}>
                <Text style={styles.jobTitle}>{job.title}</Text>
                <Text style={styles.jobNote}>{isComplete ? 'validation passed' : isActive ? job.note : 'queued'}</Text>
              </View>
              <Text style={[styles.jobState, isComplete && styles.jobStateDone]}>
                {isComplete ? 'READY' : isActive ? 'RUNNING' : 'QUEUED'}
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.reassurance}>Production jobs will continue in the background if you leave this screen.</Text>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  workbench: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  pipelineHeader: {
    alignItems: 'center',
    backgroundColor: colors.panelDark,
    borderBottomColor: colors.panelDark,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  pipelineTitle: {
    ...type.micro,
    color: colors.white,
    letterSpacing: 1.2,
  },
  pipelineStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  pipelineDot: {
    backgroundColor: colors.saffron,
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  pipelineStatusText: {
    ...type.micro,
    color: colors.saffron,
    fontSize: 9,
    letterSpacing: 1.1,
  },
  job: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    borderLeftColor: 'transparent',
    borderLeftWidth: 4,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 78,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  jobMark: {
    alignItems: 'center',
    borderColor: colors.line,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  jobMarkDone: {
    backgroundColor: colors.mintDeep,
    borderColor: colors.mintDeep,
  },
  jobMarkText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '900',
  },
  jobMarkTextDone: {
    color: colors.white,
  },
  jobCopy: {
    flex: 1,
  },
  jobTitle: {
    ...type.body,
    color: colors.ink,
    fontWeight: '900',
  },
  jobNote: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 13,
    lineHeight: 17,
  },
  jobState: {
    ...type.micro,
    color: colors.blue,
    letterSpacing: 0.8,
  },
  jobStateDone: {
    color: colors.mintDeep,
  },
  reassurance: {
    ...type.body,
    color: colors.inkSoft,
    fontSize: 13,
    lineHeight: 19,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
});
