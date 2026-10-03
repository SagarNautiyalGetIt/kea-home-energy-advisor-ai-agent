/** A delayed failure from an old account must never expire a newer sign-in. */
export function shouldExpireSession(status: number, requestedToken: string | null, currentToken: string | null, path: string) {
  return status === 401 && requestedToken !== null && requestedToken === currentToken && !path.startsWith('/api/auth/login');
}

export function sessionMatches(value: unknown, customerId: string) {
  return Boolean(value) && typeof value === 'object' && (value as Record<string, unknown>).customer_id === customerId;
}
