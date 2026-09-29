import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export const palette = {
  // Tesla-inspired dark interface tokens.
  violet: '#D8D8D8',
  violetDark: '#8E8E8E',
  violetSoft: '#1A1A1A',
  periwinkle: '#8E8E8E',
  navy: '#D8D8D8',
  green: '#30D158',
  greenDark: '#06402B',
  golden: '#C9A227',
  red: '#E82127',
  amber: '#FFD60A',
  white: '#D8D8D8',
  solar: '#FFD60A',
  grid: '#707070',
  home: '#3E6AE1',
  battery: '#30D158',
} as const;

export type ColorMode = 'light' | 'dark';

// --- Soft semantic icon tints -------------------------------------------------
// Vivid, confident accent colours applied directly on the icon glyph — no
// background chips. Bright enough to scan at a glance, balanced to stay
// comfortable on both the light (#F5F5F5) and dark (#111111) backgrounds.
// Pick by meaning, not decoration:
//   energy  — usage, solar, charts        money   — billing, cost, plans pricing
//   ai      — Sparky AI                    alert   — bill shock, warnings
//   info    — profile, contact, links      success — savings, confirmations, eco
//   warm    — home, comfort                utility — settings, neutral
export type IconTint = 'energy' | 'money' | 'ai' | 'alert' | 'info' | 'success' | 'warm' | 'utility';

const iconTintsLight: Record<IconTint, string> = {
  energy: '#0CA678',
  money: '#F59E0B',
  ai: '#8B5CF6',
  alert: '#EF4444',
  info: '#3B82F6',
  success: '#22C55E',
  warm: '#F97316',
  utility: '#64748B',
};

const iconTintsDark: Record<IconTint, string> = {
  energy: '#34D399',
  money: '#FBBF24',
  ai: '#A78BFA',
  alert: '#F87171',
  info: '#60A5FA',
  success: '#4ADE80',
  warm: '#FB923C',
  utility: '#94A3B8',
};

// --- Type scale ----------------------------------------------------------------
// Mobile readability scale adopted 2026-09-27:
//   Body 16 (14 minimum) · H1 24–30 · H2 20–24 · H3 18–20 ·
//   Buttons/inputs 14–16 (inputs >= 16 on iOS to avoid auto-zoom) ·
//   Captions/hints 12–14 (never below 11).
// Body copy uses lineHeight 1.4–1.6x the font size. Dynamic Type: React Native
// scales Text with the OS accessibility setting by default and the app never
// sets allowFontScaling={false}, so larger-text settings keep working.
export const typeScale = {
  display: 34, // hero stat numbers (bill totals, usage counters)
  h1: 26, // screen-level headings
  h2: 22, // section headings
  h3: 19, // card titles
  body: 16, // default reading text
  bodySmall: 14, // compact reading text (minimum for body copy)
  button: 15, // buttons
  input: 16, // text inputs (iOS auto-zoom guard)
  caption: 12, // captions, hints, meta text
  micro: 11, // absolute floor — tiny uppercase eyebrows/badges only
} as const;

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
  primary: string;
  onPrimary: string;
  icons: Record<IconTint, string>;
};

const dark: AppColors = {
  background: '#111111',
  surface: '#1A1A1A',
  surfaceRaised: '#222222',
  text: '#D8D8D8',
  textMuted: '#8E8E8E',
  border: '#222222',
  input: '#1A1A1A',
  overlay: 'rgba(0, 0, 0, 0.78)',
  tabBar: '#1A1A1A',
  primary: '#D8D8D8',
  onPrimary: '#000000',
  icons: iconTintsDark,
};

const light: AppColors = {
  background: '#EEEEEE',
  surface: '#FFFFFF',
  surfaceRaised: '#F1F3F5',
  text: '#17191C',
  textMuted: '#5F6368',
  border: '#DDE1E6',
  input: '#F2F4F7',
  overlay: 'rgba(17, 25, 28, 0.36)',
  tabBar: '#FFFFFF',
  primary: '#3E6AE1',
  onPrimary: '#FFFFFF',
  icons: iconTintsLight,
};

const STORAGE_KEY = 'kea-mobile-color-mode';
const DEFAULT_THEME_MIGRATION_KEY = 'kea-mobile-dark-default-v1';

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
    void Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(DEFAULT_THEME_MIGRATION_KEY),
    ]).then(([saved, migrated]) => {
      if (!migrated) {
        setModeState('dark');
        void AsyncStorage.multiSet([
          [STORAGE_KEY, 'dark'],
          [DEFAULT_THEME_MIGRATION_KEY, 'done'],
        ]).catch(() => undefined);
        return;
      }
      if (saved === 'light' || saved === 'dark') setModeState(saved);
    }).catch(() => undefined);
  }, []);

  const setMode = (next: ColorMode) => {
    setModeState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  };

  const colors = mode === 'dark' ? dark : light;
  const navigationTheme = useMemo<Theme>(() => ({
    ...(mode === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(mode === 'dark' ? DarkTheme : DefaultTheme).colors,
      primary: mode === 'dark' ? palette.white : palette.home,
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
