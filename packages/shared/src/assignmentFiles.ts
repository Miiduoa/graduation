import { NuniError } from './nuni';
import { parseTaipeiInstant } from './taipeiTime';

export const ASSIGNMENT_FILE_SUBMIT_FLAG = 'ASSIGNMENT_FILE_SUBMIT_ENABLED';
export const MAX_ASSIGNMENT_IMAGES = 8;
export const MAX_ASSIGNMENT_DOCUMENTS = 2;
export const MAX_ASSIGNMENT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_ASSIGNMENT_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const ASSIGNMENT_FILE_URL_TTL_MS = 10 * 60 * 1000;
export const ASSIGNMENT_FILE_INTENT_TTL_MS = 30 * 60 * 1000;
export const FILE_ONLY_SUBMISSION_BODY = '（附檔繳交）';

export const ASSIGNMENT_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;
export const ASSIGNMENT_DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'application/zip',
] as const;

const IMAGE_EXTENSIONS: Record<string, (typeof ASSIGNMENT_IMAGE_TYPES)[number]> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};
const DOCUMENT_EXTENSIONS: Record<string, (typeof ASSIGNMENT_DOCUMENT_TYPES)[number]> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  zip: 'application/zip',
};

export type AssignmentFileKind = 'image' | 'file';
export type AssignmentSubmitStatus = 'submitted' | 'late';

function runtimeEnv(): Record<string, string | undefined> {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return runtime.process?.env ?? {};
}

export function assignmentFileSubmitEnabled(
  env: Record<string, string | undefined> = runtimeEnv(),
): boolean {
  return env[ASSIGNMENT_FILE_SUBMIT_FLAG] === 'true';
}

export function assignmentSubmissionLate(
  dueAt: string | null | undefined,
  submittedAt: string,
): boolean {
  if (!dueAt) return false;
  const due = parseTaipeiInstant(dueAt);
  const submitted = parseTaipeiInstant(submittedAt);
  return due !== null && submitted !== null && submitted > due;
}

export function assignmentFileIntentCountsTowardQuota(
  file: { uploadedAt: string | null; createdAt: string },
  now = Date.now(),
  ttlMs = ASSIGNMENT_FILE_INTENT_TTL_MS,
): boolean {
  if (file.uploadedAt) return true;
  const created = parseTaipeiInstant(file.createdAt);
  return created !== null && now - created <= ttlMs;
}

export function assignmentAcceptsSubmissions(state: 'open' | 'closed', workspaceState: string): boolean {
  return workspaceState === 'active' && state === 'open';
}

export function assignmentLateOpenLabel(
  dueAt: string | null | undefined,
  state: 'open' | 'closed',
  workspaceState: string,
  now = Date.now(),
): string | null {
  if (!assignmentAcceptsSubmissions(state, workspaceState) || !dueAt) return null;
  const due = parseTaipeiInstant(dueAt);
  if (due === null || due >= now) return null;
  return '已過截止時間，現在送出會標為遲交';
}

export function assignmentReceiptStatus(late: boolean): AssignmentSubmitStatus {
  return late ? 'late' : 'submitted';
}

export function assignmentReceiptStatusLabel(late: boolean): string {
  return late ? '遲交' : '準時';
}

export const MAX_ASSIGNMENT_IMAGE_EDGE = 2000;

export function assignmentImageTargetSize(
  width: number,
  height: number,
  maxEdge = MAX_ASSIGNMENT_IMAGE_EDGE,
): { width: number; height: number } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    Math.max(width, height) <= maxEdge
  ) {
    return { width, height };
  }
  const scale = maxEdge / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function assignmentFileContentQuery(exp: string, sig: string, download = false): string {
  const query = `exp=${encodeURIComponent(exp)}&sig=${encodeURIComponent(sig)}`;
  return download ? `${query}&download=1` : query;
}

export function moveAssignmentFile<T>(items: T[], from: number, delta: number): T[] {
  const to = from + delta;
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return items;
  next.splice(to, 0, item);
  return next;
}

function extensionOf(name: string): string {
  const base = name.trim().split(/[/\\]/).pop() ?? '';
  const index = base.lastIndexOf('.');
  return index > 0 ? base.slice(index + 1).toLowerCase() : '';
}

function stripControlCharacters(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) >= 32) result += value.charAt(index);
  }
  return result;
}

export function sanitizeAssignmentFileName(name: string): string {
  const trimmed = name.trim();
  if (
    !trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('..') ||
    trimmed.includes('/') ||
    trimmed.includes('\\')
  ) {
    throw new NuniError(422, 'ASSIGNMENT_FILE_NAME_INVALID');
  }
  const base = stripControlCharacters(trimmed);
  if (!base || base === '.' || base === '..' || base.length > 200 || base.includes('..')) {
    throw new NuniError(422, 'ASSIGNMENT_FILE_NAME_INVALID');
  }
  return base;
}

export function classifyAssignmentFile(
  name: string,
  contentType: string,
): { kind: AssignmentFileKind; contentType: string } {
  const fileName = sanitizeAssignmentFileName(name);
  const extension = extensionOf(fileName);
  const declared = contentType.trim().toLowerCase();
  const imageType = IMAGE_EXTENSIONS[extension];
  const documentType = DOCUMENT_EXTENSIONS[extension];
  if (imageType) {
    if (declared && declared !== imageType && declared !== 'image/jpg') {
      throw new NuniError(422, 'ASSIGNMENT_FILE_TYPE_REJECTED');
    }
    return { kind: 'image', contentType: imageType };
  }
  if (documentType) {
    if (declared && declared !== documentType) {
      throw new NuniError(422, 'ASSIGNMENT_FILE_TYPE_REJECTED');
    }
    return { kind: 'file', contentType: documentType };
  }
  throw new NuniError(422, 'ASSIGNMENT_FILE_TYPE_REJECTED');
}

export function assertAssignmentFileSize(kind: AssignmentFileKind, byteSize: number): void {
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
    throw new NuniError(422, 'ASSIGNMENT_FILE_SIZE_REJECTED');
  }
  const limit = kind === 'image' ? MAX_ASSIGNMENT_IMAGE_BYTES : MAX_ASSIGNMENT_DOCUMENT_BYTES;
  if (byteSize > limit) throw new NuniError(422, 'ASSIGNMENT_FILE_TOO_LARGE');
}

export function assertAssignmentFileCounts(images: number, documents: number): void {
  if (images > MAX_ASSIGNMENT_IMAGES || documents > MAX_ASSIGNMENT_DOCUMENTS) {
    throw new NuniError(422, 'ASSIGNMENT_FILE_LIMIT');
  }
  if (images + documents <= 0) throw new NuniError(422, 'ASSIGNMENT_FILE_REQUIRED');
}

export function assertAssignmentFileBudget(images: number, documents: number): void {
  if (
    images < 0 ||
    documents < 0 ||
    images > MAX_ASSIGNMENT_IMAGES ||
    documents > MAX_ASSIGNMENT_DOCUMENTS
  ) {
    throw new NuniError(422, 'ASSIGNMENT_FILE_LIMIT');
  }
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.length <= bytes.length && signature.every((value, index) => bytes[index] === value);
}

const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
  'miaf',
]);

function isoBrands(bytes: Uint8Array): string[] {
  if (
    bytes.length < 12 ||
    bytes[4] !== 0x66 ||
    bytes[5] !== 0x74 ||
    bytes[6] !== 0x79 ||
    bytes[7] !== 0x70
  ) {
    return [];
  }
  const size = ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
  const end = Math.min(bytes.length, size > 8 ? size : bytes.length);
  const brands = [String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0)];
  for (let index = 16; index + 4 <= end; index += 4) {
    brands.push(
      String.fromCharCode(bytes[index] ?? 0, bytes[index + 1] ?? 0, bytes[index + 2] ?? 0, bytes[index + 3] ?? 0),
    );
  }
  return brands;
}

function isHeifContainer(bytes: Uint8Array): boolean {
  return isoBrands(bytes).some((brand) => HEIF_BRANDS.has(brand));
}

export function assertAssignmentFileMagic(kind: AssignmentFileKind, contentType: string, bytes: Uint8Array): void {
  if (bytes.length === 0) throw new NuniError(422, 'ASSIGNMENT_FILE_SIZE_REJECTED');
  if (contentType === 'image/jpeg' && startsWith(bytes, [0xff, 0xd8, 0xff])) return;
  if (contentType === 'image/png' && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return;
  if (
    contentType === 'image/webp' &&
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return;
  if ((contentType === 'image/heic' || contentType === 'image/heif') && isHeifContainer(bytes)) return;
  if (contentType === 'application/pdf' && startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return;
  if (contentType === 'application/zip' && startsWith(bytes, [0x50, 0x4b])) return;
  if (
    contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
    startsWith(bytes, [0x50, 0x4b])
  )
    return;
  if (contentType === 'application/msword' && startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return;
  if (contentType === 'text/plain') {
    const sample = bytes.subarray(0, Math.min(bytes.length, 1024));
    if (sample.every((value) => value !== 0)) return;
  }
  throw new NuniError(422, 'ASSIGNMENT_FILE_TYPE_REJECTED');
}

export function formatAssignmentFileSize(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

export function assignmentCanRevise(dueAt: string | null | undefined, now = Date.now()): boolean {
  if (!dueAt) return true;
  const due = parseTaipeiInstant(dueAt);
  return due !== null && now <= due;
}
