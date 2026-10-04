export const NAV_DESTINATIONS = [
  { label: 'Home', detail: 'Return to your energy overview', path: '/dashboard', icon: 'home', tint: 'text' },
  { label: 'Usage', detail: 'Track your energy usage', path: '/usage', icon: 'bar-chart-outline', tint: 'energy' },
  { label: 'Sparky AI', detail: 'Ask about your energy', path: '/assistant', icon: 'sparkles', tint: 'text' },
  { label: 'Billing', detail: 'View your billing information', path: '/billing', icon: 'receipt', tint: 'money' },
  { label: 'Power Clash', detail: 'Explore the suburb league · demo', path: '/clash', icon: 'trophy-outline', tint: 'warm' },
  { label: 'More', detail: 'More options', path: '/more', icon: 'grid', tint: 'utility' },
] as const;

/** Leave room for 48px targets, padding and border even on a narrow phone. */
export function bottomNavMargin(width: number, count: number) {
  return Math.max(0, Math.min(58, (width - count * 48 - 18) / 2));
}
