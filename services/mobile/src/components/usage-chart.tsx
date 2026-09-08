import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Line, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { palette, useAppTheme } from '@/theme';

const WIDTH = 340;
const HEIGHT = 230;
const PAD_LEFT = 34;
const PAD_RIGHT = 5;
const PAD_TOP = 14;

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function pointsFor(values: readonly number[], max: number, bottomPadding: number) {
  return values.map((value, index) => {
    const x = PAD_LEFT + (index / Math.max(values.length - 1, 1)) * (WIDTH - PAD_LEFT - PAD_RIGHT);
    const y = HEIGHT - bottomPadding - (value / max) * (HEIGHT - PAD_TOP - bottomPadding);
    return { x, y };
  });
}

function pathFor(points: readonly { x: number; y: number }[]) {
  return points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
}

function pathLength(points: readonly { x: number; y: number }[]) {
  return Math.max(1, points.slice(1).reduce((total, point, index) => {
    const previous = points[index];
    return previous ? total + Math.hypot(point.x - previous.x, point.y - previous.y) : total;
  }, 0));
}

type ChartUnit = 'kwh' | 'cost';
type TimeBand = { label: string; startIndex: number; endIndex: number; row?: number };

function formatMetric(value: number, unit: ChartUnit, ceiling: number) {
  const decimals = ceiling <= 2 ? 1 : 0;
  return unit === 'cost' ? `$${value.toFixed(decimals)}` : value.toFixed(decimals);
}

export function UsageChart({ values, labels, axisLabels, secondaryLabels, tertiaryLabels, tooltipLabels, previousTooltipLabels, timeBands, previous, unit = 'kwh', max: requestedMax, xLabelInterval = 1, accessibilityLabel = 'Electricity usage chart', active, onActivate, onDismiss }: { values: readonly number[]; labels: readonly string[]; axisLabels?: readonly string[]; secondaryLabels?: readonly string[]; tertiaryLabels?: readonly string[]; tooltipLabels?: readonly string[]; previousTooltipLabels?: readonly string[]; timeBands?: readonly TimeBand[]; previous?: readonly number[]; unit?: ChartUnit; max?: number; xLabelInterval?: number; accessibilityLabel?: string; active?: boolean; onActivate?: () => void; onDismiss?: () => void }) {
  const { colors } = useAppTheme();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [plotPixelWidth, setPlotPixelWidth] = useState(0);
  const reduceMotion = useReducedMotion();
  const lineProgress = useSharedValue(0);
  const areaProgress = useSharedValue(0);
  const pointProgress = useSharedValue(0);
  const minimumCeiling = unit === 'cost' ? 0.1 : 1;
  const max = Math.max(requestedMax ?? Math.max(...values, ...(previous ?? []), minimumCeiling) * 1.12, minimumCeiling);
  const timeBandRows = timeBands?.length ? Math.max(...timeBands.map((band) => band.row ?? 0)) + 1 : 0;
  const extraAxisRows = (secondaryLabels ? 1 : 0) + (tertiaryLabels ? 1 : 0);
  const bottomPadding = timeBandRows ? 28 + timeBandRows * 16 + extraAxisRows * 14 : tertiaryLabels ? 58 : secondaryLabels ? 44 : 28;
  const points = useMemo(() => pointsFor(values, max, bottomPadding), [bottomPadding, max, values]);
  const comparePoints = useMemo(() => previous ? pointsFor(previous, max, bottomPadding) : [], [bottomPadding, max, previous]);
  const line = useMemo(() => pathFor(points), [points]);
  const compareLine = useMemo(() => pathFor(comparePoints), [comparePoints]);
  const length = useMemo(() => pathLength(points), [points]);
  const area = line ? `${line} L${WIDTH - PAD_RIGHT} ${HEIGHT - bottomPadding} L${PAD_LEFT} ${HEIGHT - bottomPadding} Z` : '';
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const plotBottom = HEIGHT - bottomPadding;
  const visibleActiveIndex = active === false ? null : activeIndex;
  const activePoint = visibleActiveIndex === null ? undefined : points[visibleActiveIndex];
  const activeComparePoint = visibleActiveIndex === null ? undefined : comparePoints[visibleActiveIndex];
  const activeValue = visibleActiveIndex === null ? undefined : values[visibleActiveIndex];
  const activePreviousValue = visibleActiveIndex === null ? undefined : previous?.[visibleActiveIndex];
  const activeLabel = visibleActiveIndex === null ? undefined : tooltipLabels?.[visibleActiveIndex] ?? labels[visibleActiveIndex] ?? `Point ${visibleActiveIndex + 1}`;
  const activePreviousLabel = visibleActiveIndex === null ? undefined : previousTooltipLabels?.[visibleActiveIndex] ?? activeLabel;
  const displayLabels = axisLabels ?? labels;
  const dismissTooltip = () => {
    setActiveIndex(null);
    onDismiss?.();
  };
  const handleChartTouch = (locationX: number, locationY: number) => {
    if (!plotPixelWidth || !points.length) return;
    const ratio = Math.max(0, Math.min(1, locationX / plotPixelWidth));
    const exactIndex = ratio * Math.max(points.length - 1, 0);
    const nearestIndex = Math.round(ratio * Math.max(points.length - 1, 0));
    const leftIndex = Math.floor(exactIndex);
    const rightIndex = Math.min(points.length - 1, Math.ceil(exactIndex));
    const progress = exactIndex - leftIndex;
    const primaryBoundary = (points[leftIndex]?.y ?? plotBottom) + ((points[rightIndex]?.y ?? plotBottom) - (points[leftIndex]?.y ?? plotBottom)) * progress;
    const compareBoundary = comparePoints.length ? (comparePoints[leftIndex]?.y ?? plotBottom) + ((comparePoints[rightIndex]?.y ?? plotBottom) - (comparePoints[leftIndex]?.y ?? plotBottom)) * progress : plotBottom;
    const selectableBoundary = comparePoints.length ? Math.min(primaryBoundary, compareBoundary) : primaryBoundary;
    if (locationY + PAD_TOP < selectableBoundary - 12) {
      dismissTooltip();
      return;
    }
    setActiveIndex(nearestIndex);
    onActivate?.();
  };

  useEffect(() => {
    lineProgress.value = reduceMotion ? 1 : 0;
    areaProgress.value = reduceMotion ? 1 : 0;
    pointProgress.value = reduceMotion ? 1 : 0;

    if (!reduceMotion) {
      lineProgress.value = withTiming(1, { duration: 1500, easing: Easing.bezier(0.22, 0.7, 0.25, 1) });
      areaProgress.value = withDelay(350, withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }));
      pointProgress.value = withDelay(1200, withTiming(1, { duration: 350, easing: Easing.out(Easing.quad) }));
    }

    return () => {
      cancelAnimation(lineProgress);
      cancelAnimation(areaProgress);
      cancelAnimation(pointProgress);
    };
  }, [area, areaProgress, compareLine, lineProgress, pointProgress, reduceMotion]);

  const lineAnimatedProps = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - lineProgress.value) }));
  const compareAnimatedProps = useAnimatedProps(() => ({ opacity: areaProgress.value * 0.8 }));
  const areaAnimatedProps = useAnimatedProps(() => ({ opacity: areaProgress.value }));
  const pointAnimatedProps = useAnimatedProps(() => ({ opacity: pointProgress.value }));

  return (
    <View accessibilityLabel={accessibilityLabel} accessibilityRole="image" style={styles.wrap}>
      <Svg width="100%" height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <Defs><LinearGradient id="area" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={palette.violet} stopOpacity={0.24} /><Stop offset="1" stopColor={palette.violet} stopOpacity={0.01} /></LinearGradient></Defs>
        {yTicks.map((ratio) => {
          const y = PAD_TOP + ratio * (HEIGHT - PAD_TOP - bottomPadding);
          return <G key={ratio}><Line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y} y2={y} stroke={colors.border} strokeWidth={1} /><SvgText fill={colors.textMuted} fontSize={10.5} fontWeight="800" textAnchor="end" x={PAD_LEFT - 4} y={y + 4}>{formatMetric(max * (1 - ratio), unit, max)}</SvgText></G>;
        })}
        {area ? <AnimatedPath animatedProps={areaAnimatedProps} d={area} fill="url(#area)" /> : null}
        {compareLine ? <AnimatedPath animatedProps={compareAnimatedProps} d={compareLine} fill="none" stroke={colors.textMuted} strokeDasharray="6 6" strokeLinecap="round" strokeWidth={2} /> : null}
        <AnimatedPath animatedProps={lineAnimatedProps} d={line} fill="none" stroke={palette.violet} strokeDasharray={`${length} ${length}`} strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.5} />
        {points.map((point, index) => <AnimatedCircle animatedProps={pointAnimatedProps} cx={point.x} cy={point.y} fill={colors.surface} key={`${point.x}-${index}`} r={index === points.length - 1 ? 5 : 3} stroke={palette.violet} strokeWidth={index === points.length - 1 ? 3 : 2} />)}
        {activePoint && activeValue !== undefined && activeLabel ? (() => {
          const metric = unit === 'cost' ? `$${activeValue.toFixed(max <= 2 ? 1 : 0)}` : `${activeValue.toFixed(max <= 2 ? 1 : 0)} kWh`;
          const tooltipText = `${activeLabel} · ${metric}`;
          const previousMetric = activePreviousValue === undefined ? undefined : unit === 'cost' ? `$${activePreviousValue.toFixed(max <= 2 ? 1 : 0)}` : `${activePreviousValue.toFixed(max <= 2 ? 1 : 0)} kWh`;
          const previousText = previousMetric && activePreviousLabel ? `${activePreviousLabel} · ${previousMetric}` : undefined;
          const longestText = previousText && previousText.length > tooltipText.length ? previousText : tooltipText;
          const tooltipWidth = Math.min(previousText ? 178 : 124, Math.max(72, longestText.length * 6.1 + 18));
          const tooltipHeight = previousText ? 46 : 30;
          const tooltipX = Math.min(WIDTH - tooltipWidth - 4, Math.max(4, activePoint.x - tooltipWidth / 2));
          const highestPoint = activeComparePoint ? Math.min(activePoint.y, activeComparePoint.y) : activePoint.y;
          const tooltipY = Math.max(4, highestPoint - tooltipHeight - 13);
          return <G pointerEvents="none"><Line stroke={palette.periwinkle} strokeDasharray="4 4" strokeWidth={1.2} x1={activePoint.x} x2={activePoint.x} y1={PAD_TOP} y2={plotBottom} /><Circle cx={activePoint.x} cy={activePoint.y} fill={colors.surface} r={6} stroke={palette.violet} strokeWidth={3} />{activeComparePoint ? <Circle cx={activeComparePoint.x} cy={activeComparePoint.y} fill={colors.surface} r={5} stroke={colors.textMuted} strokeWidth={2.5} /> : null}<Rect fill={palette.periwinkle} height={tooltipHeight} rx={9} width={tooltipWidth} x={tooltipX} y={tooltipY} /><SvgText fill="#FFFFFF" fontSize={11} fontWeight="900" textAnchor="middle" x={tooltipX + tooltipWidth / 2} y={tooltipY + (previousText ? 18 : 20)}>{tooltipText}</SvgText>{previousText ? <SvgText fill="#FFFFFF" fontSize={11} fontWeight="900" textAnchor="middle" x={tooltipX + tooltipWidth / 2} y={tooltipY + 35}>{previousText}</SvgText> : null}</G>;
        })() : null}
        {timeBands?.map((band) => {
          const denominator = Math.max(labels.length - 1, 1);
          const x1 = PAD_LEFT + (band.startIndex / denominator) * (WIDTH - PAD_LEFT - PAD_RIGHT);
          const x2 = PAD_LEFT + (band.endIndex / denominator) * (WIDTH - PAD_LEFT - PAD_RIGHT);
          const center = (x1 + x2) / 2;
          const row = band.row ?? 0;
          const y = HEIGHT - 7 - (timeBandRows - row - 1) * 16;
          const labelHalfWidth = Math.min(Math.max(14, band.label.length * 2.45 + 5), Math.max(14, (x2 - x1) / 2 - 5));
          return <G key={`${band.label}-${row}`} opacity={0.58}><Line x1={x1} x2={center - labelHalfWidth} y1={y} y2={y} stroke={colors.textMuted} strokeWidth={1} /><Line x1={center + labelHalfWidth} x2={x2} y1={y} y2={y} stroke={colors.textMuted} strokeWidth={1} /><Line x1={x1} x2={x1} y1={y - 3} y2={y + 3} stroke={colors.textMuted} strokeWidth={1} /><Line x1={x2} x2={x2} y1={y - 3} y2={y + 3} stroke={colors.textMuted} strokeWidth={1} /><SvgText fill={colors.textMuted} fontSize={8.5} fontWeight="800" textAnchor="middle" x={center} y={y + 3}>{band.label}</SvgText></G>;
        })}
        {displayLabels.map((label, index) => {
          if (index % xLabelInterval !== 0 && index !== displayLabels.length - 1) return null;
          const x = PAD_LEFT + (index / Math.max(displayLabels.length - 1, 1)) * (WIDTH - PAD_LEFT - PAD_RIGHT);
          const anchor = index === 0 ? 'start' : index === displayLabels.length - 1 ? 'end' : 'middle';
          const hasThreeRows = Boolean(tertiaryLabels);
          const primaryY = timeBandRows ? HEIGHT - timeBandRows * 16 - 7 - extraAxisRows * 14 : hasThreeRows ? HEIGHT - 35 : secondaryLabels ? HEIGHT - 23 : HEIGHT - 8;
          const secondaryY = timeBandRows ? primaryY + 14 : hasThreeRows ? HEIGHT - 20 : HEIGHT - 7;
          const tertiaryY = timeBandRows ? secondaryY + 16 : HEIGHT - 4;
          return <G key={`${label}-${index}`}><SvgText fill={colors.textMuted} fontSize={10} fontWeight="800" textAnchor={anchor} x={x} y={primaryY}>{label}</SvgText>{secondaryLabels?.[index] ? <SvgText fill={colors.textMuted} fontSize={9} fontWeight="800" opacity={0.9} textAnchor={anchor} x={x} y={secondaryY}>{secondaryLabels[index]}</SvgText> : null}{tertiaryLabels?.[index] ? <SvgText fill={colors.textMuted} fontSize={8.5} fontWeight="800" opacity={0.86} textAnchor={anchor} x={x} y={tertiaryY}>{tertiaryLabels[index]}</SvgText> : null}</G>;
        })}
      </Svg>
      <Pressable accessibilityHint="Shows the nearest usage value" accessibilityLabel={accessibilityLabel} accessibilityRole="button" onLayout={(event) => setPlotPixelWidth(event.nativeEvent.layout.width)} onTouchMove={(event) => { event.stopPropagation(); handleChartTouch(event.nativeEvent.locationX, event.nativeEvent.locationY); }} onTouchStart={(event) => { event.stopPropagation(); handleChartTouch(event.nativeEvent.locationX, event.nativeEvent.locationY); }} style={[styles.touchLayer, { left: `${(PAD_LEFT / WIDTH) * 100}%`, right: `${(PAD_RIGHT / WIDTH) * 100}%`, top: PAD_TOP, height: plotBottom - PAD_TOP }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', width: '100%' },
  touchLayer: { position: 'absolute', zIndex: 2 },
});
