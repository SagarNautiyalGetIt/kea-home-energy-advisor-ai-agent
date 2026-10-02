import { setHapticsEnabled } from './haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Preferences = { holographic: boolean; haptics: boolean };
const defaults: Preferences = { holographic: false, haptics: true };
const key = 'kea-experience-v1';
const Context = createContext({ ...defaults, update: (_: Partial<Preferences>) => {} });

export function ExperiencePreferences({ children }: { children: ReactNode }) {
  const [preferences, set] = useState(defaults);
  useEffect(() => { void AsyncStorage.getItem(key).then(value => {
    if (!value) return;
    try { const saved = JSON.parse(value); set({ holographic: saved.holographic === true, haptics: saved.haptics !== false }); } catch { /* retain safe defaults */ }
  }); }, []);
  useEffect(() => setHapticsEnabled(preferences.haptics), [preferences.haptics]);
  const update = (patch: Partial<Preferences>) => set(current => {
    const next = { ...current, ...patch }; void AsyncStorage.setItem(key, JSON.stringify(next)); return next;
  });
  return <Context.Provider value={{ ...preferences, update }}>{children}</Context.Provider>;
}
export const useExperience = () => useContext(Context);
