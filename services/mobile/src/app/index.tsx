import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '@/providers/auth';
import { palette, useAppTheme } from '@/theme';

export default function Index() {
  const { ready, session } = useAuth();
  const { colors } = useAppTheme();
  if (!ready) return <View style={[styles.loading, { backgroundColor: colors.background }]}><ActivityIndicator color={palette.violet} size="large" /></View>;
  return <Redirect href={session ? '/dashboard' : '/login'} />;
}

const styles = StyleSheet.create({ loading: { flex: 1, alignItems: 'center', justifyContent: 'center' } });
