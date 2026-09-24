import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme, type Theme } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export const palette = {
  // Tesla-inspired dark interface tokens.
  violet: '#D8D8D8',
  violetDark: '#8E8E8E',
  violetSoft: '#1A1A1A',
  periwinkle: '#8E8E8E',
  navy: '#D8D8D8',
  green: '#30D158',
  red: '#E82127',
  amber: '#FFD60A',
  white: '#D8D8D8',
  solar: '#FFD60A',
  grid: '#707070',
  home: '#3E6AE1',
  battery: '#30D158',
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
  background: '#111111',
  surface: '#1A1A1A',
  surfaceRaised: '#222222',
  text: '#D8D8D8',
  textMuted: '#8E8E8E',
  border: '#222222',
  input: '#1A1A1A',
  overlay: 'rgba(0, 0, 0, 0.78)',
  tabBar: '#1A1A1A',
};

const dark: AppColors = light;

const STORAGE_KEY = 'kea-mobile-color-mode';

type ThemeContextValue = {
  mode: ColorMode;
  colors: AppColors;
  navigationTheme: Theme;
  setMode: (mode: ColorMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ColorMode>('dark');

  useEffect(() => {
    // The product now has one intentional black appearance.
    AsyncStorage.setItem(STORAGE_KEY, 'dark').catch(() => undefined);
  }, []);

  const setMode = (_next: ColorMode) => {
    setModeState('dark');
    void AsyncStorage.setItem(STORAGE_KEY, 'dark');
  };

  const colors = dark;
  const navigationTheme = useMemo<Theme>(() => ({
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      primary: palette.white,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: palette.red,
    },
  }), [colors]);

  return <ThemeContext.Provider value={{ mode, colors, navigationTheme, setMode }}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useAppTheme must be used inside AppThemeProvider');
  return value;
}
