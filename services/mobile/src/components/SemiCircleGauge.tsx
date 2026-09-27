import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

type SemiCircleGaugeProps = { percentage: number; projectedCost: string };

const width = 240;
const height = 132;
const centerX = width / 2;
const centerY = 109;
const radiusX = 102;
const radiusY = 76;
const arcLength = (Math.PI * (3 * (radiusX + radiusY) - Math.sqrt((3 * radiusX + radiusY) * (radiusX + 3 * radiusY)))) / 2;
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedText = Animated.createAnimatedComponent(SvgText);

function pointAt(progress: number, horizontalOffset = 0, verticalOffset = 0) {
  const angle = Math.PI - Math.PI * progress;
  return { x: centerX + (radiusX + horizontalOffset) * Math.cos(angle), y: centerY - (radiusY + verticalOffset) * Math.sin(angle) };
}

export default function SemiCircleGauge({ percentage, projectedCost }: SemiCircleGaugeProps) {
  const progress = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  const target = Math.min(Math.max(percentage, 0), 100) / 100;
  const arcPath = `M ${centerX - radiusX} ${centerY} A ${radiusX} ${radiusY} 0 0 1 ${centerX + radiusX} ${centerY}`;

  useEffect(() => {
    progress.value = reduceMotion ? target : 0;
    if (!reduceMotion) progress.value = withTiming(target, { duration: 1250, easing: Easing.out(Easing.cubic) });
    return () => cancelAnimation(progress);
  }, [progress, reduceMotion, target]);

  const arcProps = useAnimatedProps(() => ({ strokeDashoffset: arcLength * (1 - progress.value) }));
  const needleProps = useAnimatedProps(() => {
    const angle = Math.PI - Math.PI * progress.value;
    return { cx: centerX + (radiusX + 5) * Math.cos(angle), cy: centerY - (radiusY + 5) * Math.sin(angle) };
  });
  const labelProps = useAnimatedProps(() => {
    const angle = Math.PI - Math.PI * progress.value;
    return { x: centerX + (radiusX - 20) * Math.cos(angle), y: centerY - (radiusY - 18) * Math.sin(angle) - 4 };
  });

  return (
    <View accessibilityLabel={`Projected bill gauge: ${Math.round(target * 100)} percent`} style={styles.wrap}>
      <Svg height={height} width={width} viewBox={`0 0 ${width} ${height}`}>
        <Path d={arcPath} fill="none" stroke="#3A3A3C" strokeLinecap="butt" strokeWidth={7} />
        <AnimatedPath animatedProps={arcProps} d={arcPath} fill="none" stroke="rgba(255, 69, 58, 0.22)" strokeDasharray={`${arcLength} ${arcLength}`} strokeLinecap="round" strokeWidth={14} />
        <AnimatedPath animatedProps={arcProps} d={arcPath} fill="none" stroke="#FF453A" strokeDasharray={`${arcLength} ${arcLength}`} strokeLinecap="round" strokeWidth={4} />

        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const outer = pointAt(tick, 14, 14);
          const inner = pointAt(tick, tick === 0.5 ? 1 : 6, tick === 0.5 ? 1 : 6);
          return <Path d={`M ${outer.x} ${outer.y} L ${inner.x} ${inner.y}`} key={tick} stroke="#8E8E93" strokeWidth={tick === 0.5 ? 2 : 1.5} />;
        })}

        <SvgText fill="#AEAEB2" fontSize="10" fontWeight="700" textAnchor="middle" x={pointAt(0.25, 27, 23).x} y={pointAt(0.25, 27, 23).y}>25%</SvgText>
        <SvgText fill="#AEAEB2" fontSize="10" fontWeight="700" textAnchor="middle" x={centerX} y={13}>50%</SvgText>
        <SvgText fill="#AEAEB2" fontSize="10" fontWeight="700" textAnchor="middle" x={pointAt(0.75, 27, 23).x} y={pointAt(0.75, 27, 23).y}>75%</SvgText>

        <AnimatedCircle animatedProps={needleProps} fill="rgba(255, 69, 58, 0.24)" r={10} />
        <AnimatedCircle animatedProps={needleProps} fill="#FF453A" r={3.5} />
        <AnimatedText animatedProps={labelProps} fill="#FF6961" fontSize="10" fontWeight="700" textAnchor="middle">{Math.round(target * 100)}%</AnimatedText>
        <SvgText fill="#D8D8D8" fontSize="23" fontWeight="700" textAnchor="middle" x={centerX} y={81}>{projectedCost}</SvgText>
        <SvgText fill="#8E8E93" fontSize="8" fontWeight="700" letterSpacing="0.8" textAnchor="middle" x={centerX} y={99}>HIGH BILL RISK</SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { alignItems: 'center', alignSelf: 'stretch', height, justifyContent: 'flex-end', overflow: 'hidden' } });
