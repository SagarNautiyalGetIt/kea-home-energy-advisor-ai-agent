import type { AucklandWeather } from './auckland-weather';

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
  const month = Number(parts.find(part => part.type === 'month')?.value);
  const fresh = weather && Math.abs(now - weather.observedAt) < 90 * 60 * 1000 ? weather : null;
  const isDay = fresh?.isDay ?? (hour >= 7 && hour < 19);
  const condition = fresh?.condition ?? 'unknown';
  const clear = condition === 'clear' || condition === 'partly-cloudy';
  return {
    isDay, condition, nightLight: isDay ? 0 : 1,
    stars: !isDay && clear, rain: ['rain', 'drizzle', 'storm'].includes(condition), snow: condition === 'snow',
    birds: isDay && clear && hour >= 6 && hour < 11,
    butterflies: isDay && clear && [12, 1, 2].includes(month) && (fresh?.temperatureC ?? 0) >= 18,
    cloud: fresh ? fresh.cloudCoverPercent / 100 : 0,
    source: fresh ? 'regional-weather' : 'clock-only',
  };
}
