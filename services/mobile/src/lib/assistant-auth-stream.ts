/** Read the existing session before sending native SSE; never send after cancellation. */
export async function sendAuthenticatedStream(
  xhr: Pick<XMLHttpRequest, 'setRequestHeader' | 'send'>,
  body: string,
  loadToken: () => Promise<string | null>,
  stopped: () => boolean,
  onError: () => void,
) {
  try {
    const token = await loadToken();
    if (stopped()) return;
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(body);
  } catch {
    if (!stopped()) onError();
  }
}
