import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

// The revision is immutable; Cache Storage can reuse model files across visits.
const MODEL = 'onnx-community/whisper-tiny.en';
const REVISION = '2575352d61be1bf7225cf8f8b268a4678025fc58';
env.allowLocalModels = false;
env.useBrowserCache = true;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;

let transcriber: AutomaticSpeechRecognitionPipeline | undefined;
let device: 'webgpu' | 'wasm' = 'gpu' in navigator ? 'webgpu' : 'wasm';

async function prepare(id: number) {
  if (transcriber) return transcriber;
  try {
    // Transformers' generic pipeline overload expands beyond TypeScript's union limit.
    // This task always creates an ASR pipeline; keep its concrete result type below.
    // @ts-expect-error TS2590: upstream pipeline overload is too complex to represent.
    transcriber = await pipeline('automatic-speech-recognition', MODEL, {
      revision: REVISION,
      device,
      dtype: device === 'webgpu' ? 'fp32' : 'q8',
      progress_callback: (progress) => {
        if (progress.status === 'progress') {
          self.postMessage({ id, type: 'progress', message:
            `Downloading speech model: ${Math.round(progress.progress)}%` });
        }
      },
    });
  } catch (error) {
    if (device !== 'webgpu') throw error;
    device = 'wasm';
    return prepare(id);
  }
  return transcriber;
}

// The client serializes requests. No recording leaves this worker/device.
self.onmessage = async (event: MessageEvent<{ id: number; audio?: Float32Array; allowWebGPU?: boolean }>) => {
  const { id, audio } = event.data;
  if (event.data.allowWebGPU === false && !transcriber) device = 'wasm';
  try {
    let model = await prepare(id);
    if (!audio) {
      self.postMessage({ id, type: 'ready' });
      return;
    }
    if (audio.length > 30 * 16_000) throw new Error('Recording exceeds 30 seconds');
    let result;
    try {
      result = await model(audio, { max_new_tokens: 128 });
    } catch (error) {
      if (device !== 'webgpu') throw error;
      await model.dispose();
      transcriber = undefined;
      device = 'wasm';
      model = await prepare(id);
      result = await model(audio, { max_new_tokens: 128 });
    }
    self.postMessage({ id, type: 'result', text: (Array.isArray(result) ? result[0]?.text : result.text) ?? '' });
  } catch {
    self.postMessage({ id, type: 'error', message: 'Speech recognition could not run on this device. Please type your question.' });
  }
};
