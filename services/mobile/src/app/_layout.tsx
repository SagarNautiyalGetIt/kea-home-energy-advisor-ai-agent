import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppIntro } from '@/components/app-intro';
import { EdgeBackBoundary } from '@/components/edge-back-boundary';
import { useNotificationResponseRouting, usePushRegistration } from '@/lib/notifications';
import { ExperiencePreferences } from '@/lib/experience-preferences';
import { AuthProvider, useAuth } from '@/providers/auth';
import { ToastProvider } from '@/providers/toast';
import { AppThemeProvider, useAppTheme } from '@/theme';

function Navigation() {
  const { mode, navigationTheme } = useAppTheme();
  useNotificationResponseRouting();
  usePushRegistration(useAuth().session?.customerId);
  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <EdgeBackBoundary><Stack screenOptions={{ headerShown: false, animation: 'fade', gestureEnabled: false }} /></EdgeBackBoundary>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [introVisible, setIntroVisible] = useState(true);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppThemeProvider>
        <ExperiencePreferences><AuthProvider>
          <ToastProvider>
            <View style={styles.appRoot}>
              <View style={styles.navigationLayer}>
                <Navigation />
              </View>
            </View>
            {introVisible ? <AppIntro onDone={() => setIntroVisible(false)} /> : null}
          </ToastProvider>
        </AuthProvider></ExperiencePreferences>
      </AppThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  appRoot: { flex: 1 },
  navigationLayer: { flex: 1 },
});
