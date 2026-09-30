export type BillRingTone = 'green' | 'orange' | 'red';

export const BILL_RING_START_DEG = 90;
export const BILL_RING_GREEN_END_DEG = 210;
export const BILL_RING_ORANGE_END_DEG = 330;
export const BILL_RING_MAX_DEG = 449.9;

export function billRingToneForRatio(ratio: number): BillRingTone {
  if (ratio <= 1) return 'green';
  if (ratio <= 1.25) return 'orange';
  return 'red';
}

export function billRingEndAngle(ratio: number) {
  const value = Math.min(1.75, Math.max(0, ratio));
  if (value <= 1) return BILL_RING_START_DEG + value * 120;
  if (value <= 1.25) return BILL_RING_GREEN_END_DEG + ((value - 1) / 0.25) * 120;
  return Math.min(BILL_RING_MAX_DEG, BILL_RING_ORANGE_END_DEG + ((value - 1.25) / 0.5) * 120);
}

export function billRingToneForAngle(angle: number): BillRingTone {
  if (angle <= BILL_RING_GREEN_END_DEG) return 'green';
  if (angle <= BILL_RING_ORANGE_END_DEG) return 'orange';
  return 'red';
}
