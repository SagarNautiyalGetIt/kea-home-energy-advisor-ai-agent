export type ExperienceSettings = { holographic: boolean; haptics: boolean; natureSounds: boolean };
export const EXPERIENCE_DEFAULTS: ExperienceSettings = { holographic: false, haptics: true, natureSounds: false };

/** Retain v1 haptics and explicit v2 choices; audio starts as an opt-in. */
export function restoreExperienceSettings(value: string | null, legacy: string | null): ExperienceSettings {
  try {
    const saved: unknown = JSON.parse(value ?? legacy ?? '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ...EXPERIENCE_DEFAULTS };
    const row = saved as Record<string, unknown>;
    return { holographic: value !== null && row.holographic === true, haptics: row.haptics !== false, natureSounds: value !== null && row.natureSounds === true };
  } catch { return { ...EXPERIENCE_DEFAULTS }; }
}
