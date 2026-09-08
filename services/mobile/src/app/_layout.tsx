import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
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
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <Navigation />
          </ToastProvider>
        </AuthProvider>
      </AppThemeProvider>
    </GestureHandlerRootView>
  );
}
