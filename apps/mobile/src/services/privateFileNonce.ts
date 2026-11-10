import { randomUUID } from 'expo-crypto';

/** 私人檔案路徑用的不可預測識別碼（密碼學亂數）。 */
export function privateFileNonce(): string {
  const id = randomUUID();
  if (typeof id === 'string' && id) return id.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  const webCrypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (!webCrypto?.getRandomValues) throw new Error('Secure random generator unavailable');
  webCrypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
