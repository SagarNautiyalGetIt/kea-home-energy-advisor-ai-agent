import { BROWSER_MODEL } from './browser-sparky-config'
export { BROWSER_MODEL } from './browser-sparky-config'

const ENABLED_KEY = 'kea:sparky-browser-enabled'
const REVISION_KEY = 'kea:sparky-browser-revision'
const MIN_FREE_BYTES = 850_000_000

export type BrowserModelPhase = 'checking' | 'unsupported' | 'available' | 'update' | 'loading' | 'ready' | 'error'
export type BrowserModelStatus = { phase: BrowserModelPhase; detail: string; progress?: number }
type WorkerReply = { id: number; kind: 'progress' | 'ready' | 'answer' | 'error'; detail: string; progress?: number }

export function browserModelEnabled() { return localStorage.getItem(ENABLED_KEY) === 'true' }
export function setBrowserModelEnabled(enabled: boolean) { localStorage.setItem(ENABLED_KEY, String(enabled)) }

export async function browserModelSupport(): Promise<string | null> {
  if (!window.isSecureContext) return 'Browser-local AI needs HTTPS or localhost.'
  if (typeof Worker === 'undefined') return 'This browser cannot run the model in a background worker.'
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
  if (!gpu || !await gpu.requestAdapter()) return 'WebGPU is unavailable here. Connected Sparky remains available.'
  const estimate = await navigator.storage?.estimate?.().catch(() => null)
  if (estimate?.quota && estimate.quota - (estimate.usage ?? 0) < MIN_FREE_BYTES) {
    return 'This browser has less than 850 MB free for the model and its cache.'
  }
  return null
}

export function priorBrowserModelVersion() { return localStorage.getItem(REVISION_KEY) }

/** Remove only this model's cached files, leaving other browser models untouched. */
export async function removeBrowserModelCache(): Promise<number> {
  let removed = 0
  if ('caches' in window) {
    for (const name of await caches.keys()) {
      if (!name.startsWith('transformers-cache')) continue
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        if (decodeURIComponent(request.url).includes(BROWSER_MODEL.id) && await cache.delete(request)) removed += 1
      }
    }
  }
  localStorage.removeItem(REVISION_KEY)
  return removed
}

export class BrowserSparky {
  private worker = new Worker(new URL('./browser-sparky.worker.ts', import.meta.url), { type: 'module' })
  private nextId = 0
  private pending = new Map<number, { resolve: (value: string) => void; reject: (error: Error) => void }>()
  onStatus: (status: BrowserModelStatus) => void = () => {}

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data
      if (reply.kind === 'progress') {
        this.onStatus({ phase: 'loading', detail: reply.detail, progress: reply.progress })
        return
      }
      if (reply.kind === 'ready') {
        localStorage.setItem(REVISION_KEY, BROWSER_MODEL.revision)
        this.onStatus({ phase: 'ready', detail: reply.detail })
      }
      const pending = this.pending.get(reply.id)
      if (!pending) return
      if (reply.kind === 'ready' || reply.kind === 'answer') pending.resolve(reply.detail)
      if (reply.kind === 'error') {
        this.onStatus({ phase: 'error', detail: reply.detail })
        pending.reject(new Error(reply.detail))
      }
      this.pending.delete(reply.id)
    }
    this.worker.onerror = () => {
      const error = new Error('The browser model worker stopped.')
      this.onStatus({ phase: 'error', detail: error.message })
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
    }
  }

  private request(kind: 'load' | 'answer', question?: string) {
    const id = ++this.nextId
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, kind, question })
    })
  }

  load() { this.onStatus({ phase: 'loading', detail: 'Preparing browser model…' }); return this.request('load') }
  answer(question: string) { return this.request('answer', question) }
  dispose() {
    this.worker.terminate()
    for (const pending of this.pending.values()) pending.reject(new Error('Browser model stopped.'))
    this.pending.clear()
  }
}
