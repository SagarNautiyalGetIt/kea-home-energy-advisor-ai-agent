import { useCallback, useEffect, useRef, useState } from 'react'
import { BROWSER_MODEL, BrowserSparky, browserModelEnabled, browserModelSupport, priorBrowserModelVersion, removeBrowserModelCache, setBrowserModelEnabled, type BrowserModelStatus } from './browser-sparky'

export function useBrowserSparky() {
  const [enabled, setEnabled] = useState(browserModelEnabled)
  const [status, setStatus] = useState<BrowserModelStatus>({ phase: 'checking', detail: 'Checking this browser…' })
  const worker = useRef<BrowserSparky | null>(null)

  useEffect(() => {
    let mounted = true
    void browserModelSupport().then((issue) => {
      if (!mounted) return
      setStatus(issue
        ? { phase: 'unsupported', detail: issue }
        : { phase: priorBrowserModelVersion() && priorBrowserModelVersion() !== BROWSER_MODEL.revision ? 'update' : 'available', detail: 'Opt in to load the compact model on this browser.' })
    })
    return () => { mounted = false; worker.current?.dispose(); worker.current = null }
  }, [])

  const toggle = useCallback((next: boolean) => {
    setBrowserModelEnabled(next)
    setEnabled(next)
    if (!next) {
      worker.current?.dispose()
      worker.current = null
      setStatus({ phase: 'available', detail: 'On-device Sparky is off. Cached model files remain in this browser.' })
    }
  }, [])

  const install = useCallback(async () => {
    const issue = await browserModelSupport()
    if (issue) { setStatus({ phase: 'unsupported', detail: issue }); return }
    let current: BrowserSparky | null = null
    try {
      if (!worker.current) worker.current = new BrowserSparky()
      current = worker.current
      current.onStatus = setStatus
      await current.load()
    }
    catch (error) {
      if (worker.current === current) setStatus({ phase: 'error', detail: error instanceof Error ? error.message : 'The model could not load.' })
    }
  }, [])

  const answer = useCallback(async (question: string) => {
    if (!enabled || status.phase !== 'ready' || !worker.current) throw new Error('The browser model is not ready.')
    return worker.current.answer(question)
  }, [enabled, status.phase])

  const remove = useCallback(async () => {
    worker.current?.dispose()
    worker.current = null
    try {
      const files = await removeBrowserModelCache()
      setStatus({ phase: 'available', detail: files ? 'The browser model was removed.' : 'No cached model files were found; local model state was cleared.' })
    } catch {
      setStatus({ phase: 'error', detail: 'Could not clear the model cache in this browser.' })
    }
  }, [])

  return { enabled, status, toggle, install, answer, remove, ready: enabled && status.phase === 'ready' }
}
