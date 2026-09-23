import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme, type Theme } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export const palette = {
  // Legacy names remain for compatibility, but general UI accents are now
  // deliberately monochrome. Energy-series colours live in semantic tokens.
  violet: '#FFFFFF',
  violetDark: '#D1D1D6',
  violetSoft: '#1C1C1E',
  periwinkle: '#C7C7CC',
  navy: '#FFFFFF',
  green: '#30D158',
  red: '#FF453A',
  amber: '#FFD60A',
  white: '#FFFFFF',
  solar: '#FFD60A',
  grid: '#8E8E93',
  home: '#0A84FF',
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
  background: '#000000',
  surface: '#121212',
  surfaceRaised: '#181818',
  text: '#FFFFFF',
  textMuted: '#C7C7CC',
  border: '#454545',
  input: '#0D0D0D',
  overlay: 'rgba(0, 0, 0, 0.78)',
  tabBar: '#121214',
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
