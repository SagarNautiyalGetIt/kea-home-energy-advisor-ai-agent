/** Reserve before any asynchronous preflight so duplicate taps cannot race. */
export function singleFlight<T>(busyMessage: string) {
  let busy = false;
  return async (operation: () => Promise<T>): Promise<T> => {
    if (busy) throw new Error(busyMessage);
    busy = true;
    try {
      return await operation();
    } finally {
      busy = false;
    }
  };
}
