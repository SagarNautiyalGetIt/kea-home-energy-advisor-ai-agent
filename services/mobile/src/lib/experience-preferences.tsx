import { setHapticsEnabled } from './haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { EXPERIENCE_DEFAULTS, restoreExperienceSettings, type ExperienceSettings } from './experience-settings';

const key = 'kea-experience-v2';
const Context = createContext({ ...EXPERIENCE_DEFAULTS, update: (_: Partial<ExperienceSettings>) => {} });

export function ExperiencePreferences({ children }: { children: ReactNode }) {
  const [preferences, set] = useState(EXPERIENCE_DEFAULTS);
  const edits = useRef<Partial<ExperienceSettings>>({});
  const hydrated = useRef(false);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const persist = useCallback((next: ExperienceSettings) => {
    writes.current = writes.current.catch(() => {}).then(() => AsyncStorage.setItem(key, JSON.stringify(next)));
    void writes.current.catch(() => { /* Session preference still works without storage. */ });
  }, []);
  useEffect(() => {
    let alive = true;
    void Promise.all([AsyncStorage.getItem(key), AsyncStorage.getItem('kea-experience-v1')]).then(([value, legacy]) => {
      if (!alive) return;
      const next = { ...restoreExperienceSettings(value, legacy), ...edits.current };
      hydrated.current = true;
      set(next);
      // A choice made during loading must retain the other saved preferences.
      if (Object.keys(edits.current).length) persist(next);
    }).catch(() => { /* retain safe defaults when storage is unavailable */ });
    return () => { alive = false; };
  }, [persist]);
  useEffect(() => setHapticsEnabled(preferences.haptics), [preferences.haptics]);
  const update = (patch: Partial<ExperienceSettings>) => {
    edits.current = { ...edits.current, ...patch };
    set(current => {
      const next = { ...current, ...patch };
      // Serial writes prevent a quick on/off gesture from saving the older value.
      if (hydrated.current) persist(next);
      return next;
    });
  };
  return <Context.Provider value={{ ...preferences, update }}>{children}</Context.Provider>;
}
export const useExperience = () => useContext(Context);
