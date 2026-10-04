export type HomeModelResult<T> = { status: 'ready'; model: T } | { status: 'unavailable' };

/** Coalesce the one Home asset across mounts; failures settle without render throws. */
export function createHomeModelResource<T>(load: (url: string) => Promise<T>) {
  let cached: { url: string; result: Promise<HomeModelResult<T>> } | undefined;
  return (url: string): Promise<HomeModelResult<T>> => {
    if (cached?.url === url) return cached.result;
    const result = Promise.resolve().then(() => load(url)).then(
      model => ({ status: 'ready' as const, model }),
      () => ({ status: 'unavailable' as const }),
    );
    cached = { url, result };
    return result;
  };
}
