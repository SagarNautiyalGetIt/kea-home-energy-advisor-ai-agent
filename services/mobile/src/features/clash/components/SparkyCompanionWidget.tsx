import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/theme';

export function SparkyCompanionWidget() {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={[styles.avatarWrap, { backgroundColor: colors.surfaceRaised }]}>
        <Image accessibilityLabel="Sparky the Kea" contentFit="cover" source={require('../../../../assets/kea/kea-profile.png')} style={styles.avatar} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.eyebrow, { color: colors.textMuted }]}>SPARKY AI</Text>
        <Text style={[styles.title, { color: colors.text }]}>Every route to progress counts.</Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>Conservation, smart charging, off-peak timing and solar each have a place here. Sparky can explain verified figures when this programme is ready.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 13 },
  avatarWrap: { width: 58, height: 58, borderRadius: 17, overflow: 'hidden' },
  avatar: { width: 58, height: 58 },
  copy: { flex: 1 },
  eyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  title: { fontSize: 14, lineHeight: 18, fontWeight: '800', marginTop: 4 },
  body: { fontSize: 11, lineHeight: 16, marginTop: 4 },
});
