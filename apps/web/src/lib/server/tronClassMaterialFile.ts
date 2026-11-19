import { isTronClassSourceVisible } from './tronClassSourceVisibility';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** The official ordinary-file blob route uses upload.id, not its storage key. */
export function tronClassMaterialUploadKey(value: unknown): string | null {
  const file = record(value);
  if (!file) return null;
  // An invalid supplied ID must not silently select a different legacy key.
  if (file.id !== undefined) {
    return typeof file.id === 'number' && Number.isSafeInteger(file.id) && file.id > 0
      ? String(file.id) : null;
  }
  // Preserve the existing key-only response contract for older source adapters.
  const key = file.key || file.file_key || file.upload_id;
  return typeof key === 'string' && /^[A-Za-z0-9._-]{1,200}$/.test(key) && key !== '.' && key !== '..'
    ? key : null;
}

/** Only ordinary, visible attachments use the fixed upload blob route. */
export function isTronClassMaterialDownloadAllowed(value: unknown): boolean {
  const file = record(value);
  if (!file || !isTronClassSourceVisible(file)) return false;
  // The official preview/attachment templates use separate destinations for
  // references, project files, external providers and generated marking PDFs.
  return file.allow_download === true &&
    [undefined, null, 0].includes(file.reference_id as undefined | null | number) &&
    [undefined, null, ''].includes(file.source as undefined | null | string) &&
    [undefined, null, '', 'agree'].includes(file.audit_status as undefined | null | string) &&
    [undefined, false, 0].includes(file.deleted as undefined | boolean | number) &&
    [undefined, false, 0].includes(file.is_deleted as undefined | boolean | number) &&
    [undefined, false, 0].includes(file.from_project as undefined | boolean | number) &&
    [undefined, false, 0].includes(file.isFromKnowledgeGraph as undefined | boolean | number) &&
    (file.type === undefined || file.type === null || (typeof file.type === 'string' && file.type !== 'link')) &&
    (file.status === undefined || file.status === null ||
      (typeof file.status === 'string' && !['cliping', 'clip_failed', 'uploading', 'failed'].includes(file.status)));
}
