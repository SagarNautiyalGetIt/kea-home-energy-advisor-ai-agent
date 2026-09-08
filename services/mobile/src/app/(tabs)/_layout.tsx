import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '@/providers/auth';
import { palette, useAppTheme } from '@/theme';

const icons: Record<string, { active: keyof typeof Ionicons.glyphMap; idle: keyof typeof Ionicons.glyphMap }> = {
  dashboard: { active: 'home', idle: 'home-outline' },
  usage: { active: 'analytics', idle: 'analytics-outline' },
  assistant: { active: 'sparkles', idle: 'sparkles-outline' },
  billing: { active: 'receipt', idle: 'receipt-outline' },
  more: { active: 'grid', idle: 'grid-outline' },
};

export default function TabsLayout() {
  const { ready, session } = useAuth();
  const { colors } = useAppTheme();
  if (!ready) return <View style={[styles.loading, { backgroundColor: colors.background }]}><ActivityIndicator color={palette.violet} size="large" /></View>;
  if (!session) return <Redirect href="/login" />;

  return (
    <Tabs screenOptions={({ route }) => ({
      headerShown: false,
      tabBarActiveTintColor: palette.violet,
      tabBarInactiveTintColor: colors.textMuted,
      tabBarHideOnKeyboard: true,
      tabBarLabelStyle: styles.label,
      tabBarStyle: [styles.tabBar, { backgroundColor: colors.tabBar, borderTopColor: colors.border }],
      tabBarIcon: ({ color, focused, size }) => {
        const icon = icons[route.name];
        return icon ? <Ionicons color={color} name={focused ? icon.active : icon.idle} size={size} /> : null;
      },
    })}>
      <Tabs.Screen name="dashboard" options={{ title: 'Home' }} />
      <Tabs.Screen name="usage" options={{ title: 'Usage' }} />
      <Tabs.Screen name="assistant" options={{ title: 'Sparky AI' }} />
      <Tabs.Screen name="billing" options={{ title: 'Billing' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
      <Tabs.Screen name="plans" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
      <Tabs.Screen name="help" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabBar: { height: 70, paddingTop: 7, paddingBottom: 8, borderTopWidth: 1 },
  label: { fontSize: 10, fontWeight: '800' },
});
