import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance } from 'react-native';

export const palette = {
  violet: '#4A25FF',
  violetDark: '#3513E7',
  violetSoft: '#EEEAFE',
  periwinkle: '#868CFF',
  navy: '#263574',
  green: '#21B885',
  red: '#D94D61',
  amber: '#F5A524',
  white: '#FFFFFF',
} as const;

export type ColorMode = 'light' | 'dark';

export type AppColors = {
  background: string;
  surface: string;
  surfaceRaised: string;
  text: string;
  textMuted: string;
  border: string;
  input: string;
  overlay: string;
  tabBar: string;
};

const light: AppColors = {
  background: '#F4F7FF',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  text: '#263574',
  textMuted: '#68779F',
  border: '#E5EAF6',
  input: '#F8F9FD',
  overlay: 'rgba(22, 31, 70, 0.48)',
  tabBar: '#FFFFFF',
};

const dark: AppColors = {
  background: '#0C1122',
  surface: '#141A30',
  surfaceRaised: '#1B2340',
  text: '#F4F6FF',
  textMuted: '#AEB9D6',
  border: '#303A5A',
  input: '#11172A',
  overlay: 'rgba(0, 0, 0, 0.7)',
  tabBar: '#12182B',
};

const STORAGE_KEY = 'kea-mobile-color-mode';

type ThemeContextValue = {
  mode: ColorMode;
  colors: AppColors;
  navigationTheme: Theme;
  setMode: (mode: ColorMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ColorMode>(Appearance.getColorScheme() === 'dark' ? 'dark' : 'light');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark') setModeState(saved);
    }).catch(() => undefined);
  }, []);

  const setMode = (next: ColorMode) => {
    setModeState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  };

  const colors = mode === 'dark' ? dark : light;
  const navigationTheme = useMemo<Theme>(() => ({
    ...(mode === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(mode === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
      primary: palette.violet,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: palette.red,
    },
  }), [colors, mode]);

  return <ThemeContext.Provider value={{ mode, colors, navigationTheme, setMode }}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useAppTheme must be used inside AppThemeProvider');
  return value;
}
