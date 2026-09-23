import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Line, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useAppTheme } from '@/theme';

const HEIGHT = 210;
const PAD_TOP = 10;
const POINT_RADIUS = 4.2;
const ACTIVE_RING_RADIUS = 10;

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type ChartUnit = 'kwh' | 'cost';
type TimeBand = { label: string; startIndex: number; endIndex: number; row?: number };

function xForIndex(index: number, count: number, plotWidth: number, horizontalPadding: number): number {
  if (count <= 1) return plotWidth / 2;
  const safeWidth = Math.max(1, plotWidth - horizontalPadding * 2);
  return horizontalPadding + (index / (count - 1)) * safeWidth;
}

function pointsFor(
  values: readonly number[],
  max: number,
  bottomPadding: number,
  width: number,
  horizontalPadding: number
) {
  const plotHeight = HEIGHT - PAD_TOP - bottomPadding;
  return values.map((value, index) => {
    const x = xForIndex(index, values.length, width, horizontalPadding);
    const y = HEIGHT - bottomPadding - (value / max) * plotHeight;
    return { x, y };
  });
}

function pathFor(points: readonly { x: number; y: number }[]) {
  if (!points.length) return '';
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index] as { x: number; y: number };
    const controlOffset = (point.x - previous.x) * 0.46;
    return `${path} C${(previous.x + controlOffset).toFixed(1)} ${previous.y.toFixed(1)} ${(point.x - controlOffset).toFixed(1)} ${point.y.toFixed(1)} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }, `M${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`);
}

function pathLength(points: readonly { x: number; y: number }[]) {
  return Math.max(1, points.slice(1).reduce((total, point, index) => {
    const previous = points[index];
    return previous ? total + Math.hypot(point.x - previous.x, point.y - previous.y) : total;
  }, 0));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function valueText(value: number, unit: ChartUnit, max: number) {
  if (unit === 'cost') return `$${value.toFixed(2)}`;
  return `${value.toFixed(max <= 2 ? 1 : 0)} kWh`;
}

export function UsageChart({
  values,
  labels,
  axisLabels,
  secondaryLabels,
  tertiaryLabels,
  tooltipLabels,
  previousTooltipLabels,
  timeBands,
  previous,
  unit = 'kwh',
  max: requestedMax,
  xLabelInterval = 1,
  accessibilityLabel = 'Electricity usage chart',
  active,
  onActivate,
}: {
  values: readonly number[];
  labels: readonly string[];
  axisLabels?: readonly string[];
  secondaryLabels?: readonly string[];
  tertiaryLabels?: readonly string[];
  tooltipLabels?: readonly string[];
  previousTooltipLabels?: readonly string[];
  timeBands?: readonly TimeBand[];
  previous?: readonly number[];
  unit?: ChartUnit;
  max?: number;
  xLabelInterval?: number;
  accessibilityLabel?: string;
  active?: boolean;
  onActivate?: () => void;
  highlightedIndices?: readonly number[];
}) {
  const { colors } = useAppTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const reduceMotion = useReducedMotion();

  const lineProgress = useSharedValue(0);
  const areaProgress = useSharedValue(0);
  const pointProgress = useSharedValue(0);

  const chartWidth = Math.max(1, Math.round(containerWidth || windowWidth || 360));
  const rightAxisWidth = 38;
  const plotWidth = Math.max(1, chartWidth - rightAxisWidth);
  const horizontalPadding = POINT_RADIUS + 1;
  const isCost = unit === 'cost';
  const minimumCeiling = isCost ? 0.1 : 1;
  const max = Math.max(requestedMax ?? Math.max(...values, ...(previous ?? []), minimumCeiling) * 1.03, minimumCeiling);

  const timeBandRows = timeBands?.length ? Math.max(...timeBands.map((band) => band.row ?? 0)) + 1 : 0;
  const extraAxisRows = (secondaryLabels ? 1 : 0) + (tertiaryLabels ? 1 : 0);
  const bottomPadding = timeBandRows ? 52 + timeBandRows * 18 + extraAxisRows * 20 : tertiaryLabels ? 70 : secondaryLabels ? 60 : 50;
  const plotBottom = HEIGHT - bottomPadding;

  const points = useMemo(
    () => pointsFor(values, max, bottomPadding, plotWidth, horizontalPadding),
    [bottomPadding, horizontalPadding, max, plotWidth, values]
  );
  const comparePoints = useMemo(
    () => (previous ? pointsFor(previous, max, bottomPadding, plotWidth, horizontalPadding) : []),
    [bottomPadding, horizontalPadding, max, plotWidth, previous]
  );
  const line = useMemo(() => pathFor(points), [points]);
  const compareLine = useMemo(() => pathFor(comparePoints), [comparePoints]);
  const length = useMemo(() => pathLength(points), [points]);
  const baselineY = plotBottom;
  const area = line && points.length
    ? `${line} L${points.at(-1)!.x.toFixed(1)} ${baselineY.toFixed(1)} L${points[0]!.x.toFixed(1)} ${baselineY.toFixed(1)} Z`
    : '';
  const onlyPoint = points.length === 1 ? points[0] : undefined;

  const visibleActiveIndex = active === false ? null : activeIndex;
  const activePoint = visibleActiveIndex === null ? undefined : points[visibleActiveIndex];
  const activeComparePoint = visibleActiveIndex === null ? undefined : comparePoints[visibleActiveIndex];
  const activeValue = visibleActiveIndex === null ? undefined : values[visibleActiveIndex];
  const activePreviousValue = visibleActiveIndex === null ? undefined : previous?.[visibleActiveIndex];
  const activeLabel =
    visibleActiveIndex === null
      ? undefined
      : tooltipLabels?.[visibleActiveIndex] ?? labels[visibleActiveIndex] ?? `Point ${visibleActiveIndex + 1}`;
  const activePreviousLabel =
    visibleActiveIndex === null ? undefined : previousTooltipLabels?.[visibleActiveIndex] ?? activeLabel;
  const displayLabels = axisLabels ?? labels;
  const selectedAccessibility = activeLabel && activeValue !== undefined
    ? `${accessibilityLabel}. Selected ${activeLabel}, ${valueText(activeValue, unit, max)}.`
    : accessibilityLabel;

  const handleChartTouch = (locationX: number) => {
    const count = points.length;
    if (!count) return;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    points.forEach((point, index) => {
      const distance = Math.abs(point.x - locationX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    setActiveIndex(nearestIndex);
    onActivate?.();
  };

  useEffect(() => {
    lineProgress.value = reduceMotion ? 1 : 0;
    areaProgress.value = reduceMotion ? 1 : 0;
    pointProgress.value = reduceMotion ? 1 : 0;

    if (!reduceMotion) {
      lineProgress.value = withTiming(1, { duration: 850, easing: Easing.bezier(0.22, 0.7, 0.25, 1) });
      areaProgress.value = withDelay(150, withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) }));
      pointProgress.value = withDelay(520, withTiming(1, { duration: 250, easing: Easing.out(Easing.quad) }));
    }

    return () => {
      cancelAnimation(lineProgress);
      cancelAnimation(areaProgress);
      cancelAnimation(pointProgress);
    };
  }, [areaProgress, lineProgress, pointProgress, reduceMotion, values]);

  const lineAnimatedProps = useAnimatedProps(() => ({
    strokeDashoffset: length * (1 - lineProgress.value),
  }));
  const compareAnimatedProps = useAnimatedProps(() => ({
    opacity: areaProgress.value * 0.72,
  }));
  const areaAnimatedProps = useAnimatedProps(() => ({
    opacity: areaProgress.value,
  }));
  const pointAnimatedProps = useAnimatedProps(() => ({
    opacity: pointProgress.value,
  }));

  const primaryY = timeBandRows
    ? HEIGHT - 42 - timeBandRows * 18 - (tertiaryLabels ? 18 : 0)
    : tertiaryLabels
      ? HEIGHT - 50
      : secondaryLabels
        ? HEIGHT - 42
        : HEIGHT - 22;
  const secondaryY = primaryY + 24;
  const tertiaryY = secondaryY + 18;

  return (
    <View
      onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
      style={styles.wrap}
    >
      <Svg height={HEIGHT} viewBox={`0 0 ${chartWidth} ${HEIGHT}`} width="100%">
        <Defs>
          <LinearGradient id="usageAreaShade" x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0%" stopColor="#0B4F6C" stopOpacity={0.58} />
            <Stop offset="58%" stopColor="#083247" stopOpacity={0.30} />
            <Stop offset="100%" stopColor="#083247" stopOpacity={0.04} />
          </LinearGradient>
        </Defs>

        {points.map((point, index) => (
          <Line
            key={`grid-${index}`}
            stroke="#3A3A3C"
            strokeDasharray="5 7"
            strokeOpacity={0.38}
            strokeWidth={1}
            x1={point.x}
            x2={point.x}
            y1={PAD_TOP + 2}
            y2={plotBottom + 2}
          />
        ))}

        {area ? <AnimatedPath animatedProps={areaAnimatedProps} d={area} fill="url(#usageAreaShade)" /> : null}

        {compareLine ? (
          <AnimatedPath
            animatedProps={compareAnimatedProps}
            d={compareLine}
            fill="none"
            stroke="#164F69"
            strokeDasharray="5 6"
            strokeLinecap="round"
            strokeOpacity={0.48}
            strokeWidth={1.7}
          />
        ) : null}

        {onlyPoint ? (
          <Line
            stroke="#164F69"
            strokeLinecap="round"
            strokeOpacity={0.86}
            strokeWidth={3.3}
            x1={horizontalPadding}
            x2={plotWidth - horizontalPadding}
            y1={onlyPoint.y}
            y2={onlyPoint.y}
          />
        ) : (
          <AnimatedPath
            animatedProps={lineAnimatedProps}
            d={line}
            fill="none"
            stroke="#164F69"
            strokeDasharray={`${length} ${length}`}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={3.3}
          />
        )}

        {points.map((point, index) => {
          const isSelected = visibleActiveIndex === index;
          return (
            <G key={`point-${index}`}>
              {isSelected ? (
                <Circle
                  cx={point.x}
                  cy={point.y}
                  fill="rgba(56,189,248,0.2)"
                  r={ACTIVE_RING_RADIUS}
                  stroke="#7DD3FC"
                  strokeWidth={2}
                />
              ) : null}
              <AnimatedCircle
                animatedProps={pointAnimatedProps}
                cx={point.x}
                cy={point.y}
                fill={isSelected ? '#7DD3FC' : '#164F69'}
                r={isSelected ? 5.5 : POINT_RADIUS}
                stroke="#0B0B0D"
                strokeWidth={2.2}
              />
            </G>
          );
        })}

        {activePoint && activeValue !== undefined && activeLabel ? (() => {
          const metric = valueText(activeValue, unit, max);
          const previousMetric = activePreviousValue !== undefined ? valueText(activePreviousValue, unit, max) : undefined;
          const tooltipWidth = activePreviousValue !== undefined ? 176 : 152;
          const tooltipHeight = activePreviousValue !== undefined ? 76 : 60;
          const tooltipX = clamp(activePoint.x - tooltipWidth / 2, 8, plotWidth - tooltipWidth - 8);
          const highestPoint = activeComparePoint ? Math.min(activePoint.y, activeComparePoint.y) : activePoint.y;
          const tooltipY = clamp(highestPoint - tooltipHeight - 18, 8, Math.max(8, plotBottom - tooltipHeight - 10));
          const tailX = clamp(activePoint.x, tooltipX + 18, tooltipX + tooltipWidth - 18);

          return (
            <G pointerEvents="none">
              <Line
                stroke="#38BDF8"
                strokeDasharray="4 5"
                strokeOpacity={0.82}
                strokeWidth={1.4}
                x1={activePoint.x}
                x2={activePoint.x}
                y1={activePoint.y + ACTIVE_RING_RADIUS}
                y2={primaryY - 18}
              />
              {activeComparePoint ? (
                <Circle
                  cx={activeComparePoint.x}
                  cy={activeComparePoint.y}
                  fill="#8E8E93"
                  r={4.5}
                  stroke="#F2F2F7"
                  strokeWidth={1.8}
                />
              ) : null}
              <Rect
                fill="#2C2C2E"
                height={tooltipHeight}
                rx={24}
                stroke="#456476"
                strokeOpacity={0.9}
                strokeWidth={1.2}
                width={tooltipWidth}
                x={tooltipX}
                y={tooltipY}
              />
              <Path
                d={`M${tailX - 12} ${tooltipY + tooltipHeight - 2} L${tailX} ${tooltipY + tooltipHeight + 12} L${tailX + 12} ${tooltipY + tooltipHeight - 2} Z`}
                fill="#2C2C2E"
                stroke="#456476"
                strokeOpacity={0.9}
                strokeWidth={1.2}
              />
              <SvgText
                fill="#C7D0D9"
                fontSize={12}
                fontWeight="800"
                letterSpacing={0.7}
                textAnchor="middle"
                x={tooltipX + tooltipWidth / 2}
                y={tooltipY + 24}
              >
                {activeLabel.toUpperCase()}
              </SvgText>
              <SvgText
                fill="#F2F2F7"
                fontSize={20}
                fontWeight="900"
                textAnchor="middle"
                x={tooltipX + tooltipWidth / 2}
                y={tooltipY + 48}
              >
                {metric}
              </SvgText>
              {previousMetric && activePreviousLabel ? (
                <SvgText
                  fill={colors.textMuted}
                  fontSize={11}
                  fontWeight="700"
                  textAnchor="middle"
                  x={tooltipX + tooltipWidth / 2}
                  y={tooltipY + 66}
                >
                  {`${activePreviousLabel}: ${previousMetric}`}
                </SvgText>
              ) : null}
            </G>
          );
        })() : null}

        {displayLabels.map((label, index) => {
          if (!label) return null;
          if (index % xLabelInterval !== 0 && index !== displayLabels.length - 1) return null;
          const x = xForIndex(index, displayLabels.length, plotWidth, horizontalPadding);
          const isHourlyAxis = displayLabels.length >= 20;
          const labelX = isHourlyAxis && index === 3 ? x + 4 : x;
          const textAnchor = index === 0 ? 'start' : index === displayLabels.length - 1 ? 'end' : 'middle';
          const isSelected = visibleActiveIndex === index && displayLabels.length === values.length;
          return (
            <G key={`label-${label}-${index}`}>
              {isSelected ? (
                <Rect
                  fill="rgba(56,189,248,0.18)"
                  height={secondaryLabels ? 56 : 30}
                  rx={18}
                  stroke="#456476"
                  strokeOpacity={0.9}
                  width={46}
                  x={x - 23}
                  y={primaryY - 19}
                />
              ) : null}
              <SvgText
                fill={isSelected ? '#7DD3FC' : '#A1A1AA'}
                fontSize={isHourlyAxis ? 11 : 12}
                fontWeight="800"
                textAnchor={textAnchor}
                x={labelX}
                y={primaryY}
              >
                {label}
              </SvgText>
              {secondaryLabels?.[index] ? (
                <SvgText
                  fill={isSelected ? '#7DD3FC' : '#F2F2F7'}
                  fontSize={13}
                  fontWeight="900"
                  textAnchor={textAnchor}
                  x={x}
                  y={secondaryY}
                >
                  {secondaryLabels[index]}
                </SvgText>
              ) : null}
              {tertiaryLabels?.[index] ? (
                <SvgText
                  fill="#A1A1AA"
                  fontSize={10.5}
                  fontWeight="700"
                  textAnchor={textAnchor}
                  x={x}
                  y={tertiaryY}
                >
                  {tertiaryLabels[index]}
                </SvgText>
              ) : null}
            </G>
          );
        })}

        {timeBands?.map((band) => {
          const row = band.row ?? 0;
          const startX = xForIndex(band.startIndex, labels.length, plotWidth, horizontalPadding);
          const endX = xForIndex(band.endIndex, labels.length, plotWidth, horizontalPadding);
          const center = (startX + endX) / 2;
          const y = HEIGHT - 14 - (timeBandRows - row - 1) * 18;
          const textGap = Math.max(34, band.label.length * 4.8);
          return (
            <G key={`${band.label}-${row}`} opacity={0.7}>
              <Line stroke="#5A5A5F" strokeOpacity={0.7} strokeWidth={1} x1={horizontalPadding} x2={Math.max(horizontalPadding, center - textGap)} y1={y - 5} y2={y - 5} />
              <Line stroke="#5A5A5F" strokeOpacity={0.7} strokeWidth={1} x1={Math.min(plotWidth - horizontalPadding, center + textGap)} x2={plotWidth - horizontalPadding} y1={y - 5} y2={y - 5} />
              <SvgText
                fill="#A1A1AA"
                fontSize={12}
                fontWeight="900"
                letterSpacing={2}
                textAnchor="middle"
                x={center}
                y={y}
              >
                {band.label}
              </SvgText>
            </G>
          );
        })}
        {[1, 0.66, 0.33, 0].map((ratio) => {
          const y = PAD_TOP + (1 - ratio) * (plotBottom - PAD_TOP);
          const axisValue = max * ratio;
          return <G key={`right-axis-${ratio}`}><Line stroke="#456476" strokeOpacity={0.75} strokeWidth={1} x1={plotWidth + 2} x2={plotWidth + 6} y1={y} y2={y} /><SvgText fill="#A1A1AA" fontSize={9} fontWeight="700" textAnchor="end" x={chartWidth - 1} y={y + 3}>{isCost ? `$${axisValue.toFixed(1)}` : axisValue.toFixed(max <= 2 ? 1 : 0)}</SvgText></G>;
        })}
      </Svg>
      <Pressable
        accessibilityLabel={selectedAccessibility}
        accessibilityRole="button"
        onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
        onTouchMove={(event) => {
          event.stopPropagation();
          handleChartTouch(event.nativeEvent.locationX);
        }}
        onTouchStart={(event) => {
          event.stopPropagation();
          handleChartTouch(event.nativeEvent.locationX);
        }}
        style={[styles.touchLayer, { height: Math.max(44, plotBottom - PAD_TOP), top: PAD_TOP }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: HEIGHT,
    width: '100%',
  },
  touchLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
