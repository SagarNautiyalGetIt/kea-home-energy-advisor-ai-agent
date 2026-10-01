import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Line, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useReducedMotion, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { useAppTheme } from '@/theme';

const HEIGHT = 210;
const PAD_TOP = 10;
const POINT_RADIUS = 2.5;
const ACTIVE_RING_RADIUS = 10;

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

type ChartUnit = 'kwh' | 'cost';
type ChartType = 'line' | 'bar';
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
  horizontalPadding: number,
  leadingInset = 0,
) {
  const plotHeight = HEIGHT - PAD_TOP - bottomPadding;
  return values.map((value, index) => {
    const x = values.length <= 1
      ? width / 2
      : leadingInset + xForIndex(index, values.length, width - leadingInset, horizontalPadding);
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function valueText(value: number, unit: ChartUnit, max: number) {
  if (unit === 'cost') return `$${value.toFixed(2)}`;
  return `${value.toFixed(max <= 2 ? 1 : 0)} kWh`;
}

function Bar({
  x,
  width,
  baseline,
  fullHeight,
  radius,
  fill,
  fillOpacity,
  progress,
}: {
  x: number;
  width: number;
  baseline: number;
  fullHeight: number;
  radius: number;
  fill: string;
  fillOpacity?: number;
  progress: SharedValue<number>;
}) {
  const animatedProps = useAnimatedProps(() => {
    const h = Math.max(0, fullHeight * progress.value);
    return { y: baseline - h, height: h };
  });
  return (
    <AnimatedRect
      animatedProps={animatedProps}
      fill={fill}
      fillOpacity={fillOpacity}
      rx={radius}
      width={width}
      x={x}
    />
  );
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
  chartType = 'line',
  max: requestedMax,
  xLabelInterval = 1,
  accessibilityLabel = 'Electricity usage chart',
  active,
  onActivate,
  leadingDecorativeAnchor = false,
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
  chartType?: ChartType;
  max?: number;
  xLabelInterval?: number;
  accessibilityLabel?: string;
  active?: boolean;
  onActivate?: () => void;
  /** Adds a visual-only line anchor before the first real reading. */
  leadingDecorativeAnchor?: boolean;
  highlightedIndices?: readonly number[];
}) {
  const { colors, mode } = useAppTheme();
  const chartColor = mode === 'dark' ? '#C7F071' : '#277442';
  const comparisonColor = mode === 'dark' ? '#FBBF24' : '#946000';
  const { width: windowWidth } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const reduceMotion = useReducedMotion();

  const lineProgress = useSharedValue(0);
  const barProgress = useSharedValue(0);

  const chartWidth = Math.max(1, Math.round(containerWidth || windowWidth || 360));
  const rightAxisWidth = 26;
  const plotWidth = Math.max(1, chartWidth - rightAxisWidth);
  const isBar = chartType === 'bar';
  const hasDecorativeLeadingAnchor = leadingDecorativeAnchor && !isBar && values.length > 1;
  const leadingDataInset = hasDecorativeLeadingAnchor ? Math.min(12, Math.max(8, plotWidth / (values.length + 1))) : 0;
  const horizontalPadding = isBar ? (values.length >= 20 ? 8 : 32) : 0;
  const isCost = unit === 'cost';
  const minimumCeiling = isCost ? 0.1 : 1;
  const max = Math.max(requestedMax ?? Math.max(...values, ...(previous ?? []), minimumCeiling) * 1.03, minimumCeiling);

  const timeBandRows = timeBands?.length ? Math.max(...timeBands.map((band) => band.row ?? 0)) + 1 : 0;
  const extraAxisRows = (secondaryLabels ? 1 : 0) + (tertiaryLabels ? 1 : 0);
  const bottomPadding = timeBandRows ? 52 + timeBandRows * 18 + extraAxisRows * 20 : tertiaryLabels ? 70 : secondaryLabels ? 60 : 50;
  const plotBottom = HEIGHT - bottomPadding;

  const points = useMemo(
    () => pointsFor(values, max, bottomPadding, plotWidth, horizontalPadding, leadingDataInset),
    [bottomPadding, horizontalPadding, leadingDataInset, max, plotWidth, values]
  );
  const comparePoints = useMemo(
    () => (previous ? pointsFor(previous, max, bottomPadding, plotWidth, horizontalPadding, leadingDataInset) : []),
    [bottomPadding, horizontalPadding, leadingDataInset, max, plotWidth, previous]
  );
  const linePoints = useMemo(
    () => hasDecorativeLeadingAnchor && points[0] ? [{ x: 0, y: points[0].y }, ...points] : points,
    [hasDecorativeLeadingAnchor, points]
  );
  const compareLinePoints = useMemo(
    () => hasDecorativeLeadingAnchor && comparePoints[0] ? [{ x: 0, y: comparePoints[0].y }, ...comparePoints] : comparePoints,
    [comparePoints, hasDecorativeLeadingAnchor]
  );
  const line = useMemo(() => pathFor(linePoints), [linePoints]);
  const compareLine = useMemo(() => pathFor(compareLinePoints), [compareLinePoints]);
  const baselineY = plotBottom;
  const area = line && points.length
    ? `${line} L${points.at(-1)!.x.toFixed(1)} ${baselineY.toFixed(1)} L${linePoints[0]!.x.toFixed(1)} ${baselineY.toFixed(1)} Z`
    : '';
  const onlyPoint = points.length === 1 ? points[0] : undefined;
  const hasCompare = comparePoints.length === values.length && comparePoints.length > 0;
  const slotWidth = points.length > 1 ? points[1]!.x - points[0]!.x : plotWidth;
  const singleBarWidth = Math.max(8, Math.min(30, slotWidth * 0.56));
  const groupBarWidth = Math.max(5, Math.min(15, slotWidth * 0.27));
  const barGap = 3;

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
    barProgress.value = reduceMotion ? 1 : 0;

    if (!reduceMotion) {
      lineProgress.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) });
      barProgress.value = withDelay(120, withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) }));
    }

    return () => {
      cancelAnimation(lineProgress);
      cancelAnimation(barProgress);
    };
  }, [barProgress, lineProgress, reduceMotion, values]);

  const lineAnimatedProps = useAnimatedProps(() => ({
    opacity: lineProgress.value,
  }));
  const compareAnimatedProps = useAnimatedProps(() => ({
    opacity: lineProgress.value * 0.72,
  }));
  const areaAnimatedProps = useAnimatedProps(() => ({
    opacity: lineProgress.value,
  }));
  const pointAnimatedProps = useAnimatedProps(() => ({
    opacity: lineProgress.value,
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
            <Stop offset="0%" stopColor={chartColor} stopOpacity={0.58} />
            <Stop offset="58%" stopColor={chartColor} stopOpacity={0.30} />
            <Stop offset="100%" stopColor={chartColor} stopOpacity={0.04} />
          </LinearGradient>
        </Defs>

        {!isBar && points.map((point, index) => (
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

        {!isBar && area ? <AnimatedPath animatedProps={areaAnimatedProps} d={area} fill="url(#usageAreaShade)" /> : null}

        {isBar ? (
          points.map((point, index) => {
            const mainFill = chartColor;
            if (hasCompare) {
              const comparePoint = comparePoints[index];
              return (
                <G key={`bar-${index}`}>
                  {comparePoint ? (
                    <Bar
                      baseline={plotBottom}
                      fill={comparisonColor}
                      fillOpacity={0.85}
                      fullHeight={Math.max(0, plotBottom - comparePoint.y)}
                      progress={barProgress}
                      radius={Math.min(5, groupBarWidth / 2)}
                      width={groupBarWidth}
                      x={point.x - groupBarWidth - barGap / 2}
                    />
                  ) : null}
                  <Bar
                    baseline={plotBottom}
                    fill={mainFill}
                    fullHeight={Math.max(0, plotBottom - point.y)}
                    progress={barProgress}
                    radius={Math.min(5, groupBarWidth / 2)}
                    width={groupBarWidth}
                    x={point.x + barGap / 2}
                  />
                </G>
              );
            }
            return (
              <Bar
                key={`bar-${index}`}
                baseline={plotBottom}
                fill={mainFill}
                fullHeight={Math.max(0, plotBottom - point.y)}
                progress={barProgress}
                radius={Math.min(6, singleBarWidth / 2)}
                width={singleBarWidth}
                x={point.x - singleBarWidth / 2}
              />
            );
          })
        ) : (
          <>
            {compareLine ? (
              <AnimatedPath
                animatedProps={compareAnimatedProps}
                d={compareLine}
                fill="none"
                stroke={comparisonColor}
                strokeLinecap="round"
                strokeOpacity={0.9}
                strokeWidth={2}
              />
            ) : null}

            {onlyPoint ? (
              <Line
                stroke={chartColor}
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
                stroke={chartColor}
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
                      fill="rgba(199,240,113,0.2)"
                      r={ACTIVE_RING_RADIUS}
                      stroke={chartColor}
                      strokeWidth={2}
                    />
                  ) : null}
                  <AnimatedCircle
                    animatedProps={pointAnimatedProps}
                    cx={point.x}
                    cy={point.y}
                    fill={chartColor}
                    r={isSelected ? 3.5 : POINT_RADIUS}
                    stroke={colors.background}
                    strokeWidth={1}
                  />
                </G>
              );
            })}
          </>
        )}

        {activePoint && activeValue !== undefined && activeLabel ? (() => {
          const metric = valueText(activeValue, unit, max);
          const previousMetric = activePreviousValue !== undefined ? valueText(activePreviousValue, unit, max) : undefined;
          // Compact chip, always floating above the dot (never on it), centered on it.
          const tooltipWidth = activePreviousValue !== undefined ? 120 : 100;
          const tooltipHeight = activePreviousValue !== undefined ? 60 : 44;
          const tooltipX = clamp(
            activePoint.x - tooltipWidth / 2,
            4,
            Math.max(4, plotWidth - tooltipWidth - 4),
          );
          const tooltipY = clamp(activePoint.y - tooltipHeight - 14, 4, Math.max(4, plotBottom - tooltipHeight - 4));

          return (
            <G pointerEvents="none">
              {!isBar ? (
                <Line
                  stroke={chartColor}
                  strokeDasharray="4 5"
                  strokeOpacity={0.82}
                  strokeWidth={1.4}
                  x1={activePoint.x}
                  x2={activePoint.x}
                  y1={activePoint.y + ACTIVE_RING_RADIUS}
                  y2={primaryY - 18}
                />
              ) : null}
              {!isBar && activeComparePoint ? (
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
                rx={12}
                stroke="#456476"
                strokeOpacity={0.9}
                strokeWidth={1.2}
                width={tooltipWidth}
                x={tooltipX}
                y={tooltipY}
              />
              <Path
                d={`M${activePoint.x - 7} ${tooltipY + tooltipHeight - 1} L${activePoint.x} ${tooltipY + tooltipHeight + 9} L${activePoint.x + 7} ${tooltipY + tooltipHeight - 1} Z`}
                fill="#2C2C2E"
                stroke="#456476"
                strokeOpacity={0.9}
                strokeWidth={1.2}
              />
              <SvgText
                fill="#C7D0D9"
                fontSize={10}
                fontWeight="800"
                letterSpacing={0.7}
                textAnchor="middle"
                x={tooltipX + tooltipWidth / 2}
                y={tooltipY + (previousMetric ? 15 : 16)}
              >
                {activeLabel.toUpperCase()}
              </SvgText>
              <SvgText
                fill="#F2F2F7"
                fontSize={previousMetric ? 15 : 16}
                fontWeight="900"
                textAnchor="middle"
                x={tooltipX + tooltipWidth / 2}
                y={tooltipY + (previousMetric ? 33 : 36)}
              >
                {metric}
              </SvgText>
              {previousMetric && activePreviousLabel ? (
                <SvgText
                  fill="#C7D0D9"
                  fontSize={10}
                  fontWeight="700"
                  textAnchor="middle"
                  x={tooltipX + tooltipWidth / 2}
                  y={tooltipY + 50}
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
          const x = leadingDataInset + xForIndex(index, displayLabels.length, plotWidth - leadingDataInset, horizontalPadding);
          const isHourlyAxis = displayLabels.length >= 20;
          const labelX = isHourlyAxis && index === 3 ? x + 4 : x;
          const textAnchor = isBar && !isHourlyAxis
            ? 'middle'
            : index === 0
              ? 'start'
              : index === displayLabels.length - 1
                ? 'end'
                : 'middle';
          const isSelected = visibleActiveIndex === index && displayLabels.length === values.length;
          return (
            <G key={`label-${label}-${index}`}>
              <SvgText
                fill={isSelected ? colors.text : colors.textMuted}
                fontSize={isHourlyAxis ? 9.5 : 12}
                fontWeight="800"
                textAnchor={textAnchor}
                x={labelX}
                y={primaryY}
              >
                {label}
              </SvgText>
              {secondaryLabels?.[index] ? (
                <SvgText
                  fill={colors.text}
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
                  fill={colors.textMuted}
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
                fill={colors.textMuted}
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
          return <G key={`right-axis-${ratio}`}><Line stroke="#456476" strokeOpacity={0.75} strokeWidth={1} x1={plotWidth + 2} x2={plotWidth + 6} y1={y} y2={y} /><SvgText fill={colors.textMuted} fontSize={9} fontWeight="700" textAnchor="end" x={chartWidth - 1} y={y + 3}>{isCost ? `$${axisValue.toFixed(1)}` : axisValue.toFixed(max <= 2 ? 1 : 0)}</SvgText></G>;
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
