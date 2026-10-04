import { setHapticsEnabled } from './haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Preferences = { holographic: boolean; haptics: boolean };
const defaults: Preferences = { holographic: false, haptics: true };
const key = 'kea-experience-v2';
const Context = createContext({ ...defaults, update: (_: Partial<Preferences>) => {} });

export function ExperiencePreferences({ children }: { children: ReactNode }) {
  const [preferences, set] = useState(defaults);
  useEffect(() => {
    let alive = true;
    void Promise.all([AsyncStorage.getItem(key), AsyncStorage.getItem('kea-experience-v1')]).then(([value, legacy]) => {
      if (!alive) return;
      try {
        const saved = JSON.parse(value ?? legacy ?? '{}');
        // Everyone receives the new realistic reveal default. Keep legacy haptics;
        // an explicit holographic choice made in v2 still remains available.
        set({ holographic: value !== null && saved.holographic === true, haptics: saved.haptics !== false });
      } catch { /* retain safe defaults */ }
    }).catch(() => { /* retain safe defaults when storage is unavailable */ });
    return () => { alive = false; };
  }, []);
  useEffect(() => setHapticsEnabled(preferences.haptics), [preferences.haptics]);
  const update = (patch: Partial<Preferences>) => set(current => {
    const next = { ...current, ...patch }; void AsyncStorage.setItem(key, JSON.stringify(next)); return next;
  });
  return <Context.Provider value={{ ...preferences, update }}>{children}</Context.Provider>;
}
export const useExperience = () => useContext(Context);
