export type MouthMode = 'idle' | 'thinking' | 'replying' | 'happy' | 'static';
type EyePosition = { matrix: string };

/** Follow eye centres, which are unaffected by the engine's eyelid compression. */
export function mouthPose(eyes: EyePosition[]) {
  const centres = eyes.map(({ matrix }) => matrix.match(/-?\d+(?:\.\d+)?/g)?.map(Number))
    .filter((values): values is number[] => values?.length === 6 && values.every(Number.isFinite));
  if (centres.length < 2) return 'translate(0 34)';
  const left = centres[0]!;
  const right = centres[1]!;
  const angle = Math.atan2(right[5]! - left[5]!, right[4]! - left[4]!);
  const x = Math.max(-52, Math.min(52, (left[4]! + right[4]!) / 2 - Math.sin(angle) * 60));
  const y = Math.max(-38, Math.min(45, (left[5]! + right[5]!) / 2 + Math.cos(angle) * 60));
  return `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(angle * 180 / Math.PI).toFixed(2)})`;
}

/** Expression and response motion are independent of blinking; no audio lip-sync implied. */
export function mouthShape(mode: MouthMode, time: number, animate = true) {
  if (mode === 'replying') {
    const energy = animate ? Math.max(0, Math.sin(time * 2.8)) * (0.6 + 0.4 * Math.sin(time * 11)) : 0.35;
    const halfWidth = 16 + 4 * energy;
    const halfHeight = 2.5 + 7 * energy;
    const w = halfWidth.toFixed(2);
    const h = halfHeight.toFixed(2);
    return { d: `M-${w} 0 C-${w} -${h} -8 -${h} 0 -${h} C8 -${h} ${w} -${h} ${w} 0 C${w} ${h} 8 ${h} 0 ${h} C-8 ${h} -${w} ${h} -${w} 0 Z`, fill: true, strokeWidth: 0 };
  }
  const d = mode === 'happy' ? 'M-21 -2 Q0 20 21 -2' : mode === 'thinking' ? 'M-11 2 Q0 -1 11 2' : 'M-16 0 Q0 8 16 0';
  return { d, fill: false, strokeWidth: 7.5 };
}
