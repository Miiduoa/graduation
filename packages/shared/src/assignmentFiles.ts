import { NuniError } from './nuni';

export const ASSIGNMENT_FILE_SUBMIT_FLAG = 'ASSIGNMENT_FILE_SUBMIT_ENABLED';
export const MAX_ASSIGNMENT_IMAGES = 8;
export const MAX_ASSIGNMENT_DOCUMENTS = 2;
export const MAX_ASSIGNMENT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_ASSIGNMENT_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const ASSIGNMENT_FILE_URL_TTL_MS = 10 * 60 * 1000;
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

export function assignmentFileSubmitEnabled(
  env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env,
): boolean {
  return env[ASSIGNMENT_FILE_SUBMIT_FLAG] === 'true';
}

export function assignmentSubmissionLate(
  dueAt: string | null | undefined,
  submittedAt: string,
): boolean {
  if (!dueAt) return false;
  const due = Date.parse(dueAt);
  const submitted = Date.parse(submittedAt);
  return Number.isFinite(due) && Number.isFinite(submitted) && submitted > due;
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
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due) || due >= now) return null;
  return '遲交、仍可繳';
}

export function assignmentReceiptStatus(late: boolean): AssignmentSubmitStatus {
  return late ? 'late' : 'submitted';
}

export function assignmentReceiptStatusLabel(late: boolean): string {
  return late ? '遲交' : '已繳';
}

function extensionOf(name: string): string {
  const base = name.trim().split(/[/\\]/).pop() ?? '';
  const index = base.lastIndexOf('.');
  return index > 0 ? base.slice(index + 1).toLowerCase() : '';
}

export function sanitizeAssignmentFileName(name: string): string {
  const base = name.trim().split(/[/\\]/).pop()?.replace(/[\u0000-\u001f]/g, '') ?? '';
  if (!base || base === '.' || base === '..' || base.length > 200) {
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
  if (
    (contentType === 'image/heic' || contentType === 'image/heif') &&
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  )
    return;
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
