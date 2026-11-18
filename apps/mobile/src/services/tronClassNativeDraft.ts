import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import type { TronClassLocalFile, TronClassPreparation } from './tronClassIntegrationTypes';
import { isTronClassOperationId } from './tronClassIntegration';

export const TRONCLASS_LOCAL_LIMITS = {
  maxFiles: 4,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
};
export function nativeTronClassLimits(preparation: TronClassPreparation | null) {
  const rules = preparation?.rules;
  return rules?.status === 'confirmed'
    ? {
        confirmed: true,
        allowsText: rules.allowsText,
        allowsAttachments: rules.allowsAttachments,
        maxFiles: Math.min(4, preparation.maxFiles),
        maxFileBytes: Math.min(TRONCLASS_LOCAL_LIMITS.maxFileBytes, preparation.maxFileBytes),
        maxTotalBytes: Math.min(TRONCLASS_LOCAL_LIMITS.maxTotalBytes, rules.maxTotalBytes),
        contentTypes: preparation.allowedContentTypes,
      }
    : {
        confirmed: false,
        allowsText: true,
        allowsAttachments: true,
        ...TRONCLASS_LOCAL_LIMITS,
        contentTypes: [] as string[],
      };
}
export function nativeTronClassPayloadIssue(
  content: string,
  files: TronClassLocalFile[],
  preparation: TronClassPreparation | null,
  requireConfirmed = false,
): string | null {
  const limits = nativeTronClassLimits(preparation);
  if (requireConfirmed && !limits.confirmed) return '尚未確認校方繳交規則，請重新讀取。';
  if (!content.trim() && !files.length) return '請先輸入作業內容或選擇附件。';
  if (content.length > 20000) return '作業文字最多 20,000 字。';
  if (content.trim() && !limits.allowsText) return '這份作業不接受文字內容，請依校方要求改用附件。';
  if (files.length && !limits.allowsAttachments) return '這份作業不接受附件，請先移除附件。';
  if (files.length > limits.maxFiles) return `最多可選擇 ${limits.maxFiles} 個附件。`;
  if (
    files.some(
      (file) =>
        !file.name ||
        file.name.length > 200 ||
        /[\\/]/.test(file.name) ||
        Array.from(file.name).some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ),
    )
  )
    return '請調整附件名稱，避免路徑或特殊控制字元。';
  if (
    files.some(
      (file) =>
        !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > limits.maxFileBytes,
    )
  )
    return `單一附件須介於 1 B 與 ${nativeTronClassSize(limits.maxFileBytes)} 之間。`;
  if (files.reduce((sum, file) => sum + file.size, 0) > limits.maxTotalBytes)
    return `附件合計不可超過 ${nativeTronClassSize(limits.maxTotalBytes)}。`;
  if (
    files.some(
      (file) =>
        !/^(file|content):\/\//.test(file.uri) ||
        !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(file.contentType),
    )
  )
    return '附件格式或讀取位置無法確認，請重新選檔。';
  if (
    limits.contentTypes.length &&
    files.some((file) => !limits.contentTypes.includes(file.contentType))
  )
    return '其中有校方不接受的附件格式，請依要求重新選檔。';
  return null;
}
export function nativeTronClassSize(bytes: number): string {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export async function readNativeTronClassFile(
  file: TronClassLocalFile,
): Promise<{ bytes: Uint8Array; sha256: string }> {
  if (
    !/^(file|content):\/\//.test(file.uri) ||
    file.size <= 0 ||
    file.size > TRONCLASS_LOCAL_LIMITS.maxFileBytes
  )
    throw new Error('FILE_INVALID');
  const local = new File(file.uri);
  if (local.size !== file.size) throw new Error('FILE_CHANGED');
  const bytes = new Uint8Array(await local.arrayBuffer());
  if (bytes.byteLength !== file.size) throw new Error('FILE_CHANGED');
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  const sha256 = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return { bytes, sha256 };
}

// Only the opaque operation ID is persisted. No draft, school identity, cookie, or upload state.
function pendingKey(owner: string, courseId: number, homeworkId: number) {
  return `nuni.tronclass.pending.v1:${encodeURIComponent(owner)}:${courseId}:${homeworkId}`;
}
// Screens for the same owner/homework share one local journal. Serialize the
// read/check/write interval so another mounted screen cannot replace an ID
// between a conditional clear's read and remove. Other keys remain independent.
const pendingQueues = new Map<string, Promise<void>>();
function withPendingKey<T>(key: string, work: () => Promise<T>): Promise<T> {
  const result = (pendingQueues.get(key) ?? Promise.resolve()).then(work);
  const settled = result.then(() => undefined, () => undefined);
  pendingQueues.set(key, settled);
  void settled.then(() => {
    if (pendingQueues.get(key) === settled) pendingQueues.delete(key);
  });
  return result;
}
async function readPendingValue(key: string): Promise<string | null> {
  const value = await AsyncStorage.getItem(key);
  if (value !== null && !isTronClassOperationId(value))
    throw new Error('INVALID_PENDING_OPERATION');
  return value;
}
export async function readNativeTronClassPending(
  owner: string,
  courseId: number,
  homeworkId: number,
): Promise<string | null> {
  const key = pendingKey(owner, courseId, homeworkId);
  return withPendingKey(key, () => readPendingValue(key));
}
export async function saveNativeTronClassPending(
  owner: string,
  courseId: number,
  homeworkId: number,
  operationId: string,
): Promise<void> {
  if (!isTronClassOperationId(operationId)) throw new Error('INVALID_PENDING_OPERATION');
  const key = pendingKey(owner, courseId, homeworkId);
  await withPendingKey(key, async () => {
    const saved = await readPendingValue(key);
    if (saved !== null && saved !== operationId) throw new Error('PENDING_OPERATION_CONFLICT');
    if (saved !== operationId) await AsyncStorage.setItem(key, operationId);
  });
}
export async function clearNativeTronClassPending(
  owner: string,
  courseId: number,
  homeworkId: number,
  expectedOperationId: string,
): Promise<void> {
  if (!isTronClassOperationId(expectedOperationId)) throw new Error('INVALID_PENDING_OPERATION');
  const key = pendingKey(owner, courseId, homeworkId);
  await withPendingKey(key, async () => {
    const saved = await readPendingValue(key);
    if (saved === null) return;
    if (saved !== expectedOperationId) throw new Error('PENDING_OPERATION_CONFLICT');
    await AsyncStorage.removeItem(key);
  });
}
