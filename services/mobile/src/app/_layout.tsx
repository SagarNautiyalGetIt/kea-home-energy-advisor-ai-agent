import { useState } from 'react';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppIntro } from '@/components/app-intro';
import { useNotificationResponseRouting } from '@/lib/notifications';
import { AuthProvider } from '@/providers/auth';
import { ToastProvider } from '@/providers/toast';
import { AppThemeProvider, useAppTheme } from '@/theme';

function Navigation() {
  const { mode, navigationTheme } = useAppTheme();
  useNotificationResponseRouting();
  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [introVisible, setIntroVisible] = useState(true);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <Navigation />
            {introVisible ? <AppIntro onDone={() => setIntroVisible(false)} /> : null}
          </ToastProvider>
        </AuthProvider>
      </AppThemeProvider>
    </GestureHandlerRootView>
  );
}
