export const AURORA_COLORS = ['#5227FF', '#7CFF67', '#5227FF'] as const;

/** Shared curtain geometry for the background and its faint mascot reflection. */
export function auroraRibbon(time: number, phase: number) {
  const points = Array.from({ length: 33 }, (_, i) => {
    const x = i * 12.5;
    const y = 105 + 40 * Math.sin(i / 7 + time + phase) + 16 * Math.sin(i / 3 - time + phase);
    return `${x},${y}`;
  });
  return `M0,-20 L400,-20 L${points.reverse().join(' L')} Z`;
}
