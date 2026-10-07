export function notificationRoute(screen: unknown) {
  if (screen === 'dashboard') return '/dashboard' as const;
  if (screen === 'usage') return '/usage' as const;
  if (screen === 'assistant') return '/assistant' as const;
  if (screen === 'billing') return '/billing' as const;
  return undefined;
}
