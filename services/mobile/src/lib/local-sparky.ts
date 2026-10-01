import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { Platform, TurboModuleRegistry } from 'react-native';
import { canAnswerWithLocalModel, LOCAL_EVIDENCE_LIMIT } from './local-sparky-policy';
import { singleFlight } from './single-flight';

// Pin both the model revision and its actual file hash. A newer model is an
// explicit update, never a silent change to a customer's offline assistant.
export const PHONE_MODEL = {
  name: 'Qwen3 0.6B · compact',
  revision: 'b5f37287796e5be0ea3dab2e7430873fb3f73e49',
  filename: 'Qwen3-0.6B-Q4_0.gguf',
  bytes: 428_970_080,
  sha256: 'da2572f16c06133561ce56accaa822216f2391ef4d37fba427801cd6736417d4',
} as const;

const MODEL_URL = `https://huggingface.co/ggml-org/Qwen3-0.6B-GGUF/resolve/${PHONE_MODEL.revision}/${PHONE_MODEL.filename}`;
const ENABLED_KEY = 'kea:sparky-phone-model-enabled';
const MIN_RAM_BYTES = 3 * 1024 ** 3;
const MIN_FREE_BYTES = PHONE_MODEL.bytes + 512 * 1024 ** 2;
const modelFile = `kea-sparky-${PHONE_MODEL.revision.slice(0, 12)}.gguf`;

export type PhoneModelStatus = {
  phase: 'checking' | 'unsupported' | 'needs-space' | 'available' | 'installed' | 'update' | 'downloading' | 'error';
  detail: string;
  progress?: number;
};

type NativeFiles = typeof import('react-native-file-access');
let verifiedPath: string | null = null;
let activeDownload: ReturnType<NativeFiles['FileSystem']['fetchManaged']> | null = null;
let activeContext: import('llama.rn').LlamaContext | null = null;
const modelInstall = singleFlight<PhoneModelStatus>('The phone model is already downloading.');

export const isPhoneModelEnabled = async () => (await AsyncStorage.getItem(ENABLED_KEY)) === 'true';
export const setPhoneModelEnabled = async (enabled: boolean) => {
  await AsyncStorage.setItem(ENABLED_KEY, String(enabled));
};

function nativeSupportIssue(): string | null {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return 'On-phone inference needs Android or iOS.';
  if (!TurboModuleRegistry.get('RNLlama')) return 'Install the Kea development build for on-phone AI. Expo Go cannot run this native model.';
  if (Platform.OS === 'android' && !Device.supportedCpuArchitectures?.some((cpu) => cpu.includes('arm64'))) {
    return 'This Android CPU cannot run the available model runtime.';
  }
  if (!Device.totalMemory || Device.totalMemory < MIN_RAM_BYTES) {
    return 'This phone has less than the tested 3 GB memory budget. Sparky can use the Kea service when connected.';
  }
  return null;
}

async function nativeFiles(): Promise<NativeFiles> {
  return import('react-native-file-access');
}

async function modelPath(files: NativeFiles): Promise<string> {
  return `${files.Dirs.DocumentDir}/${modelFile}`;
}

/** A status is only "installed" after the entire file passes SHA-256. */
export async function phoneModelStatus(): Promise<PhoneModelStatus> {
  const unsupported = nativeSupportIssue();
  if (unsupported) return { phase: 'unsupported', detail: unsupported };
  try {
    const files = await nativeFiles();
    const path = await modelPath(files);
    if (await files.FileSystem.exists(path)) {
      const stat = await files.FileSystem.stat(path);
      if (stat.size !== PHONE_MODEL.bytes) {
        verifiedPath = null;
        return { phase: 'error', detail: 'The on-phone model is incomplete. Remove it and install again.' };
      }
      if (verifiedPath !== path) {
        const hash = await files.FileSystem.hash(path, 'SHA-256');
        if (hash.toLowerCase() !== PHONE_MODEL.sha256) {
          return { phase: 'error', detail: 'The model did not pass its integrity check. Remove it and install again.' };
        }
        verifiedPath = path;
      }
      return { phase: 'installed', detail: `${PHONE_MODEL.name} · verified on this phone` };
    }
    const prior = (await files.FileSystem.ls(files.Dirs.DocumentDir)).some((name) => name.startsWith('kea-sparky-') && name.endsWith('.gguf'));
    const space = await files.FileSystem.df();
    if (space.internal_free < MIN_FREE_BYTES) {
      return { phase: 'needs-space', detail: 'Free at least 1 GB of storage before installing the compact model.' };
    }
    return prior
      ? { phase: 'update', detail: 'A newer phone model is available. Download it to continue offline.' }
      : { phase: 'available', detail: `Compact model · 429 MB download · general energy guidance only` };
  } catch {
    return { phase: 'error', detail: 'Could not check the model files on this phone.' };
  }
}

export const installPhoneModel = (onProgress: (status: PhoneModelStatus) => void): Promise<PhoneModelStatus> => modelInstall(async () => {
  const status = await phoneModelStatus();
  if (status.phase === 'installed') return status;
  if (status.phase !== 'available' && status.phase !== 'update') throw new Error(status.detail);
  if (activeDownload) throw new Error('The phone model is already downloading.');
  const files = await nativeFiles();
  const target = await modelPath(files);
  const temporary = `${target}.part`;
  try {
    if (await files.FileSystem.exists(temporary)) await files.FileSystem.unlink(temporary);
    onProgress({ phase: 'downloading', detail: 'Downloading on-phone model…', progress: 0 });
    activeDownload = files.FileSystem.fetchManaged(MODEL_URL, { path: temporary, network: 'unmetered' }, (read) => {
      onProgress({ phase: 'downloading', detail: 'Downloading on-phone model…', progress: Math.min(1, read / PHONE_MODEL.bytes) });
    });
    const response = await activeDownload.result;
    if (!response.ok) throw new Error(`Model download failed (${response.status}).`);
    onProgress({ phase: 'downloading', detail: 'Verifying model integrity…', progress: 1 });
    const stat = await files.FileSystem.stat(temporary);
    if (stat.size !== PHONE_MODEL.bytes) throw new Error('Model download was incomplete.');
    const hash = await files.FileSystem.hash(temporary, 'SHA-256');
    if (hash.toLowerCase() !== PHONE_MODEL.sha256) throw new Error('Model integrity check failed.');
    await files.FileSystem.mv(temporary, target);
    verifiedPath = target;
    const older = (await files.FileSystem.ls(files.Dirs.DocumentDir)).filter((name) => name.startsWith('kea-sparky-') && name.endsWith('.gguf') && name !== modelFile);
    for (const name of older) await files.FileSystem.unlink(`${files.Dirs.DocumentDir}/${name}`);
    return { phase: 'installed', detail: `${PHONE_MODEL.name} · verified on this phone` };
  } finally {
    activeDownload = null;
    if (await files.FileSystem.exists(temporary)) await files.FileSystem.unlink(temporary);
  }
});

export async function cancelPhoneModelDownload() {
  await activeDownload?.cancel();
}

export async function removePhoneModel(): Promise<PhoneModelStatus> {
  await activeContext?.stopCompletion();
  await activeContext?.release();
  activeContext = null;
  verifiedPath = null;
  const files = await nativeFiles();
  const path = await modelPath(files);
  if (await files.FileSystem.exists(path)) await files.FileSystem.unlink(path);
  return phoneModelStatus();
}

/** Only general education is generated locally until a verified household fact pack exists. */
export async function answerOnPhone(question: string, onText: (text: string) => void): Promise<string> {
  if (!canAnswerWithLocalModel(question)) return LOCAL_EVIDENCE_LIMIT;
  const status = await phoneModelStatus();
  if (status.phase !== 'installed') throw new Error(status.detail);
  const files = await nativeFiles();
  const llama = await import('llama.rn');
  const context = await llama.initLlama({ model: `file://${await modelPath(files)}`, n_ctx: 1024, n_gpu_layers: 0, use_mlock: false });
  activeContext = context;
  try {
    const result = await context.completion({
      messages: [
        { role: 'system', content: 'You are Sparky, a concise New Zealand energy educator. You have NO access to this customer\'s account, meter, bills, devices, plan, or suburb. Explain only general concepts. Do not claim a household result, saving, tariff, carbon offset, or reward. Say when a question needs verified Kea account data.' },
        { role: 'user', content: question },
      ],
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0.2,
      n_predict: 180,
    }, (part) => { if (part.content) onText(part.content); });
    return result.text?.trim() || 'The on-phone model did not produce an answer. Please try again.';
  } finally {
    activeContext = null;
    await context.release();
  }
}

export async function stopPhoneAnswer() {
  await activeContext?.stopCompletion();
}
