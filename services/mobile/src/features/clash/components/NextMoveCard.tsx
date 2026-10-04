import { tactile } from '@/lib/haptics';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/theme';

export function NextMoveCard() {
  const { colors } = useAppTheme();
  const router = useRouter();
  const open = (route: '/usage' | '/assistant') => {
    if (Platform.OS !== 'web') tactile();
    router.push(route);
  };
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.heading}>
        <Ionicons color={colors.icons.info} name="compass-outline" size={21} />
        <Text style={[styles.title, { color: colors.text }]}>Make your next move</Text>
      </View>
      <Text style={[styles.body, { color: colors.textMuted }]}>Start with your usage, then ask Sparky for a practical idea that fits your situation. Keep your comfort and essential needs first.</Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={() => open('/usage')} style={({ pressed }) => [styles.button, { backgroundColor: colors.text }, pressed && styles.pressed]}>
          <Text style={[styles.primaryText, { color: colors.background }]}>View usage</Text>
          <Ionicons color={colors.background} name="arrow-forward" size={16} />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => open('/assistant')} style={({ pressed }) => [styles.button, styles.secondary, { borderColor: colors.border }, pressed && styles.pressed]}>
          <Text style={[styles.secondaryText, { color: colors.text }]}>Ask Sparky</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, padding: 18 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  title: { fontSize: 17, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 21, marginTop: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 15 },
  button: { minHeight: 44, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  secondary: { borderWidth: 1 },
  primaryText: { fontSize: 14, fontWeight: '800' },
  secondaryText: { fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
