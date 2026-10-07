export const PHONE_MODEL = {
  name: 'Qwen3 0.6B · compact',
  revision: 'b5f37287796e5be0ea3dab2e7430873fb3f73e49',
  filename: 'Qwen3-0.6B-Q4_0.gguf',
  bytes: 428_970_080,
  sha256: 'da2572f16c06133561ce56accaa822216f2391ef4d37fba427801cd6736417d4',
} as const;

export function resolvePhoneModelUrl(override?: string): string {
  const selected = override?.trim() || `https://huggingface.co/ggml-org/Qwen3-0.6B-GGUF/resolve/${PHONE_MODEL.revision}/${PHONE_MODEL.filename}`;
  const url = new URL(selected);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('The phone model URL must use HTTPS without embedded credentials.');
  return url.toString();
}

export function verifiedPhoneModel(bytes: number, sha256: string): boolean {
  return bytes === PHONE_MODEL.bytes && sha256.toLowerCase() === PHONE_MODEL.sha256;
}
