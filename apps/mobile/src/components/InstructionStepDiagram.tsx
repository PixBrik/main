import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import type { AssemblyPlan, AssemblyStep } from '../lib/instructions/assemblyPlan';
import { colors, radius, spacing, type } from '../theme/tokens';

interface InstructionStepDiagramProps {
  plan: AssemblyPlan;
  step: AssemblyStep;
}

const VIEW = 340;
const DRAW = 286;
const PAD = (VIEW - DRAW) / 2;

export function InstructionStepDiagram({ plan, step }: InstructionStepDiagramProps) {
  const planGeometry = useMemo(() => {
    let minI = Infinity;
    let maxI = -Infinity;
    let minK = Infinity;
    let maxK = -Infinity;
    const stepsByLayer = new Map<number, AssemblyStep[]>();
    for (const action of plan.steps) {
      const placement = action.placement;
      minI = Math.min(minI, placement.i);
      maxI = Math.max(maxI, placement.i + placement.spanI - 1);
      minK = Math.min(minK, placement.k);
      maxK = Math.max(maxK, placement.k + placement.spanK - 1);
      const layer = stepsByLayer.get(action.layer) ?? [];
      layer.push(action);
      stepsByLayer.set(action.layer, layer);
    }
    if (!Number.isFinite(minI)) {
      minI = maxI = minK = maxK = 0;
    }
    const cols = Math.max(1, maxI - minI + 1);
    const rows = Math.max(1, maxK - minK + 1);
    const stud = Math.max(3, Math.min(DRAW / cols, DRAW / rows));
    const offsetX = (VIEW - cols * stud) / 2;
    const offsetY = (VIEW - rows * stud) / 2;
    return { minI, minK, offsetX, offsetY, stepsByLayer, stud };
  }, [plan]);
  const diagram = useMemo(() => ({
    ...planGeometry,
    previous: (planGeometry.stepsByLayer.get(step.layer) ?? []).filter(
      (action) => action.number < step.number,
    ),
    support: (planGeometry.stepsByLayer.get(
      step.layer + (step.support.status === 'underside' ? 1 : -1),
    ) ?? []).filter((action) => action.number < step.number),
  }), [planGeometry, step]);

  const rectFor = (action: AssemblyStep) => ({
    height: action.placement.spanK * diagram.stud,
    width: action.placement.spanI * diagram.stud,
    x: diagram.offsetX + (action.placement.i - diagram.minI) * diagram.stud,
    y: diagram.offsetY + (action.placement.k - diagram.minK) * diagram.stud,
  });
  const current = rectFor(step);
  const freshColor = step.partLine?.colorRgb ?? '#E96632';
  const facing = step.placement.facing ?? 1;
  const directionX = facing === 3 ? 1 : facing === 4 ? -1 : 0;
  const directionY = facing === 1 ? 1 : facing === 2 ? -1 : 0;
  const arrowLength = (directionX ? current.width : current.height) * 0.3;
  const arrowCenterX = current.x + current.width / 2;
  const arrowCenterY = current.y + current.height / 2;
  const arrowEndX = arrowCenterX + directionX * arrowLength;
  const arrowEndY = arrowCenterY + directionY * arrowLength;
  const arrowBackX = arrowEndX - directionX * Math.max(7, diagram.stud * 0.28);
  const arrowBackY = arrowEndY - directionY * Math.max(7, diagram.stud * 0.28);
  const arrowWing = Math.max(4, diagram.stud * 0.18);
  const slopeArrowPoints = [
    `${arrowEndX},${arrowEndY}`,
    `${arrowBackX - directionY * arrowWing},${arrowBackY + directionX * arrowWing}`,
    `${arrowBackX + directionY * arrowWing},${arrowBackY - directionX * arrowWing}`,
  ].join(' ');

  return (
    <View
      accessibilityLabel={`Step ${step.number}: place one ${step.partLine?.partName ?? step.placement.part} on layer ${step.layer + 1}`}
      accessibilityRole="image"
      style={styles.shell}
    >
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: '#EEF0EC' }]} />
          <Text style={styles.legendText}>
            {step.support.status === 'underside' ? 'LAYER ABOVE' : 'LAYER BELOW'}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: '#D7DAD4' }]} />
          <Text style={styles.legendText}>ALREADY BUILT</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: freshColor }]} />
          <Text style={styles.legendText}>ADD THIS ONE</Text>
        </View>
      </View>
      <Svg height="100%" viewBox={`0 0 ${VIEW} ${VIEW + 28}`} width="100%">
        <Rect fill="#FAFAF6" height={VIEW} rx={16} width={VIEW} />
        <G opacity={0.22}>
          {diagram.support.map((action) => {
            const rect = rectFor(action);
            return (
              <Rect
                fill="#8C928C"
                height={rect.height}
                key={`support-${action.id}`}
                stroke="#646A65"
                strokeWidth={0.8}
                width={rect.width}
                x={rect.x}
                y={rect.y}
              />
            );
          })}
        </G>
        <G>
          {diagram.previous.map((action) => {
            const rect = rectFor(action);
            return (
              <Rect
                fill="#D7DAD4"
                height={rect.height}
                key={action.id}
                stroke="#8E938E"
                strokeWidth={1}
                width={rect.width}
                x={rect.x}
                y={rect.y}
              />
            );
          })}
        </G>
        <Rect
          fill={freshColor}
          height={current.height}
          rx={Math.min(3, diagram.stud * 0.15)}
          stroke={colors.ink}
          strokeWidth={3}
          width={current.width}
          x={current.x}
          y={current.y}
        />
        {step.placement.shape === 'slope' ? (
          <G>
            <Line
              stroke="#FFFFFF"
              strokeLinecap="round"
              strokeWidth={Math.max(2, diagram.stud * 0.15)}
              x1={arrowCenterX - directionX * arrowLength}
              x2={arrowEndX}
              y1={arrowCenterY - directionY * arrowLength}
              y2={arrowEndY}
            />
            <Polygon fill="#FFFFFF" points={slopeArrowPoints} />
          </G>
        ) : (
          Array.from({ length: step.placement.spanI * step.placement.spanK }, (_, index) => {
            const di = index % step.placement.spanI;
            const dk = Math.floor(index / step.placement.spanI);
            return (
              <Circle
                cx={current.x + (di + 0.5) * diagram.stud}
                cy={current.y + (dk + 0.5) * diagram.stud}
                fill="rgba(255,255,255,0.34)"
                key={`stud-${di}-${dk}`}
                r={Math.max(1.4, diagram.stud * 0.2)}
                stroke="rgba(17,19,21,0.35)"
                strokeWidth={0.7}
              />
            );
          })
        )}
        <Circle
          cx={current.x + current.width / 2}
          cy={Math.max(12, current.y - 13)}
          fill={colors.coral}
          r={10}
          stroke={colors.ink}
          strokeWidth={2}
        />
        <SvgText
          fill="#FFFFFF"
          fontSize={11}
          fontWeight="900"
          textAnchor="middle"
          x={current.x + current.width / 2}
          y={Math.max(16, current.y - 9)}
        >
          +
        </SvgText>
        <Line
          stroke={colors.ink}
          strokeWidth={2}
          x1={VIEW / 2}
          x2={VIEW / 2}
          y1={VIEW + 2}
          y2={VIEW + 14}
        />
        <Polygon
          fill={colors.ink}
          points={`${VIEW / 2 - 5},${VIEW + 11} ${VIEW / 2 + 5},${VIEW + 11} ${VIEW / 2},${VIEW + 18}`}
        />
        <SvgText fill={colors.ink} fontSize={10} fontWeight="900" textAnchor="middle" x={VIEW / 2} y={VIEW + 27}>
          FRONT OF MODEL
        </SvgText>
      </Svg>
      <Text style={styles.layerLabel}>LAYER {step.layer + 1} · TOP VIEW</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    minHeight: 360,
    overflow: 'hidden',
    padding: spacing.sm,
    width: '100%',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'center',
    paddingBottom: spacing.xs,
    paddingTop: spacing.xs,
  },
  legendItem: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  legendSwatch: { borderColor: colors.ink, borderRadius: 2, borderWidth: 1, height: 12, width: 12 },
  legendText: { ...type.micro, color: colors.inkSoft, fontSize: 8 },
  layerLabel: { ...type.micro, color: colors.inkSoft, fontSize: 8, textAlign: 'center' },
});
