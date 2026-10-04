export function canClaimEdgeBack(path: string, startX: number, dx: number, dy: number) {
  return !['/', '/dashboard', '/login'].includes(path) && startX >= 0 && startX <= 24 && dx > 18 && dx > Math.abs(dy) * 1.7;
}
export function shouldCompleteEdgeBack(dx: number, dy: number, velocity: number) {
  return dx > Math.abs(dy) * 1.7 && (dx >= 75 || (dx >= 35 && velocity > 0.5));
}
export function backFallback(path: string): '/dashboard' | '/more' | '/settings' | '/plans' | '/assistant' | '/login' {
  if (path === '/solar') return '/plans';
  if (path === '/voice') return '/assistant';
  if (path === '/register') return '/login';
  if (['/privacy', '/terms', '/notifications'].includes(path)) return '/settings';
  if (['/settings', '/profile', '/outages', '/plans', '/help', '/solar', '/devices'].includes(path)) return '/more';
  return '/dashboard';
}
