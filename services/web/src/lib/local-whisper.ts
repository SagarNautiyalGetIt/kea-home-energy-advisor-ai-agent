/** Owns a cancellable worker; terminating it stops downloads/inference and drops audio. */
export class LocalWhisper {
  private worker: Worker | null = null;
  private nextId = 0;
  private pending: { id: number; resolve: (value: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(private readonly onStatus: (message: string) => void, private readonly allowWebGPU = true) {}

  private request(audio?: Float32Array): Promise<string> {
    if (this.pending) return Promise.reject(new Error('Speech recognition is still working.'));
    if (!this.worker) {
      this.worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event) => {
        const pending = this.pending;
        if (!pending || event.data.id !== pending.id) return;
        if (event.data.type === 'progress') {
          this.onStatus(event.data.message);
          return;
        }
        clearTimeout(pending.timer);
        this.pending = null;
        if (event.data.type === 'error') pending.reject(new Error(event.data.message));
        else pending.resolve(event.data.text ?? '');
      };
      this.worker.onerror = () => this.cancel('Speech recognition could not start. Please type your question.');
    }
    this.onStatus(audio ? 'Transcribing on your device…' : 'Preparing speech recognition…');
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => this.cancel('Speech recognition timed out. Please type your question.'), 180_000);
      this.pending = { id, resolve, reject, timer };
      this.worker!.postMessage({ id, audio, allowWebGPU: this.allowWebGPU }, audio ? [audio.buffer] : []);
    });
  }

  async prepare(): Promise<void> { await this.request(); }
  transcribe(audio: Float32Array): Promise<string> { return this.request(audio); }

  cancel(message = 'Voice cancelled'): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error(message));
      this.pending = null;
    }
    this.onStatus('');
  }
}
