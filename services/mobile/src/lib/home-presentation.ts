import type { AucklandWeather } from './auckland-weather';
import { isWeatherFresh } from './auckland-weather.ts';

export function opensHomeDock(dx: number, dy: number): boolean {
  return dy <= -30 && Math.abs(dy) > Math.abs(dx);
}
export function tapsHomeDock(dx: number, dy: number): boolean {
  return Math.abs(dx) < 8 && Math.abs(dy) < 8;
}
const nzClock = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', hour: 'numeric', month: 'numeric', hourCycle: 'h23' });
export function homeAtmosphere(weather: AucklandWeather | null, now = Date.now()) {
  const parts = nzClock.formatToParts(now);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  const fresh = weather && isWeatherFresh(weather, now) ? weather : null;
  const isDay = fresh?.isDay ?? (hour >= 7 && hour < 19);
  const condition = fresh?.condition ?? 'unknown';
  const precipitation = ['rain', 'drizzle', 'storm', 'snow', 'fog'].includes(condition);
  return {
    isDay, condition, nightLight: isDay ? 0 : 1,
    stars: !isDay && !precipitation && (fresh?.cloudCoverPercent ?? 0) < 90,
    starOpacity: Math.max(0.18, 1 - (fresh?.cloudCoverPercent ?? 0) / 110),
    rain: ['rain', 'drizzle', 'storm'].includes(condition), snow: condition === 'snow',
    // Illustrative garden visitors, not a prediction of local wildlife.
    birds: isDay && !precipitation,
    butterflies: isDay && !precipitation,
    fireflies: !isDay && !precipitation,
    cloud: Math.max(isDay ? 0.12 : 0.08, (fresh?.cloudCoverPercent ?? 0) / 100),
    source: fresh ? 'regional-weather' : 'clock-only',
  };
}
