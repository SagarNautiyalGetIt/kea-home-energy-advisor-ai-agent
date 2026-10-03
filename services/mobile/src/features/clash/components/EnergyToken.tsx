import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { useAppTheme } from '@/theme';

/** Lightweight isometric artwork; a cosmetic token, not a financial reward. */
export function EnergyToken() {
  const { colors } = useAppTheme();
  return <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.frame}>
    <Svg height={78} width={86} viewBox="0 0 86 78">
      <Polygon fill={colors.icons.energy} opacity={0.55} points="9,32 43,49 77,32 77,44 43,63 9,44" />
      <Polygon fill={colors.icons.energy} points="43,12 77,32 43,51 9,32" />
      <Polygon fill={colors.surfaceRaised} points="43,19 64,32 43,44 22,32" />
    </Svg>
    <View style={styles.icon}><Ionicons name="flash" size={21} color={colors.icons.money} /></View>
  </View>;
}

const styles = StyleSheet.create({ frame: { width: 86, height: 78 }, icon: { position: 'absolute', left: 33, top: 22 } });
