import { pipeline, type ProgressInfo } from '@huggingface/transformers'
import { BROWSER_MODEL } from './browser-sparky-config'

type Request = { id: number; kind: 'load' } | { id: number; kind: 'answer'; question: string }
type Generator = (messages: { role: 'system' | 'user'; content: string }[], options: { max_new_tokens: number; do_sample: boolean }) => Promise<unknown>
let generator: Generator | null = null
let loading: Promise<Generator> | null = null

function post(id: number, kind: 'progress' | 'ready' | 'answer' | 'error', detail: string, progress?: number) {
  self.postMessage({ id, kind, detail, progress })
}

async function load(id: number): Promise<Generator> {
  if (generator) return generator
  const createGenerator = pipeline as unknown as (task: 'text-generation', model: string, options: { revision: string; device: 'webgpu'; dtype: 'q4f16'; progress_callback: (event: ProgressInfo) => void }) => Promise<Generator>
  loading ??= createGenerator('text-generation', BROWSER_MODEL.id, {
    revision: BROWSER_MODEL.revision,
    device: 'webgpu',
    dtype: 'q4f16',
    progress_callback: (event) => {
      if (event.status === 'progress') post(id, 'progress', `Downloading ${event.file}`, event.progress)
      else if (event.status === 'ready') post(id, 'progress', 'Loading model into browser memory')
    },
  })
  try {
    generator = await loading
    return generator
  } catch (error) {
    loading = null
    throw error
  }
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id } = event.data
  try {
    const model = await load(id)
    if (event.data.kind === 'load') {
      post(id, 'ready', 'Qwen3 0.6B · ready on this browser')
      return
    }
    const result = await model([
      { role: 'system', content: 'You are Sparky, a concise New Zealand energy educator. You have no access to this customer account, meter, bill, tariff, devices or suburb. Explain general energy concepts only. Never claim a household result, saving, carbon offset or reward. Do not invent sources.' },
      { role: 'user', content: event.data.question },
    ], { max_new_tokens: 160, do_sample: false })
    const first = Array.isArray(result) ? result[0] : undefined
    const output = Array.isArray(first) ? first[0] : first
    const generated = output && typeof output === 'object' && 'generated_text' in output ? output.generated_text : undefined
    const last = Array.isArray(generated) ? generated.at(-1) : undefined
    const answer = typeof generated === 'string' ? generated : last && typeof last === 'object' && 'content' in last && typeof last.content === 'string' ? last.content : undefined
    post(id, 'answer', answer?.trim() || 'The browser model did not produce an answer. Please try again.')
  } catch (error) {
    post(id, 'error', error instanceof Error ? error.message : 'The browser model could not load.')
  }
}
