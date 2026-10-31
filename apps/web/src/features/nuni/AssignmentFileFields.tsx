'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MAX_ASSIGNMENT_DOCUMENTS,
  MAX_ASSIGNMENT_IMAGES,
  assignmentFileContentQuery,
  assignmentImageTargetSize,
  assignmentLateOpenLabel,
  assignmentReceiptStatusLabel,
  assignmentSubmissionLate,
  classifyAssignmentFile,
  formatAssignmentFileSize,
  moveAssignmentFile,
} from '@campus/shared/src/assignmentFiles';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import {
  NuniError,
  type NuniAssignment,
  type NuniSubmission,
  type NuniSubmissionFile,
} from '@campus/shared/src/nuni';
import { useClasses } from './CourseUI';
import shared from './NuniApp.module.css';
import styles from './CourseLearning.module.css';

export type LocalAssignmentFile = {
  key: string;
  file: File;
  kind: 'image' | 'file';
  previewUrl?: string;
};

export type AssignmentFileOperation = {
  key?: string;
  prepared?: LocalAssignmentFile[];
  intents?: { id: string; uploadPath: string; contentType: string }[];
  uploaded?: string[];
  submitting?: boolean;
  body?: string;
};

export type AssignmentUploadProgress = { completed: number; total: number };

function kindOf(file: File): 'image' | 'file' {
  return file.type.startsWith('image/') ? 'image' : 'file';
}

export function collectLocalFiles(current: LocalAssignmentFile[], incoming: FileList | File[]): LocalAssignmentFile[] {
  const next = [...current];
  for (const file of Array.from(incoming)) {
    try {
      classifyAssignmentFile(file.name, file.type);
    } catch {
      continue;
    }
    const kind = kindOf(file);
    const used = next.filter((item) => item.kind === kind).length;
    if (kind === 'image' && used >= MAX_ASSIGNMENT_IMAGES) continue;
    if (kind === 'file' && used >= MAX_ASSIGNMENT_DOCUMENTS) continue;
    next.push({
      key: `${file.name}:${file.size}:${file.lastModified}:${next.length}:${Math.random().toString(36).slice(2, 8)}`,
      file,
      kind,
      previewUrl: kind === 'image' ? URL.createObjectURL(file) : undefined,
    });
  }
  return next;
}

export function revokeUnusedAssignmentPreviews(
  previous: LocalAssignmentFile[],
  next: LocalAssignmentFile[],
) {
  const kept = new Set(next.map((item) => item.previewUrl).filter(Boolean));
  for (const item of previous) {
    if (item.previewUrl && !kept.has(item.previewUrl)) URL.revokeObjectURL(item.previewUrl);
  }
}

export async function compressAssignmentImageFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || /heic|heif/i.test(file.type) || typeof document === 'undefined')
    return file;
  const bitmapFn = globalThis.createImageBitmap;
  if (typeof bitmapFn !== 'function') return file;
  try {
    const bitmap = await bitmapFn(file);
    const size = assignmentImageTargetSize(bitmap.width, bitmap.height);
    const skip =
      size.width === bitmap.width && size.height === bitmap.height && file.size <= 1.5 * 1024 * 1024;
    if (skip) {
      bitmap.close?.();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close?.();
      return file;
    }
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}

export function assignmentFileHref(file: NuniSubmissionFile, download = false) {
  return `/api/nuni/${file.downloadPath}?${assignmentFileContentQuery(file.downloadExp, file.downloadSig, download)}`;
}

export function AssignmentLateBanner({
  dueAt,
  state,
  workspaceState,
}: {
  dueAt: string | null;
  state: 'open' | 'closed';
  workspaceState: string;
}) {
  const label = assignmentLateOpenLabel(dueAt, state, workspaceState);
  if (!label) return null;
  return (
    <p role="status" className={styles.lateBanner}>
      {label}
    </p>
  );
}

export function AssignmentFilePreview({
  files,
  onChange,
  disabled,
}: {
  files: LocalAssignmentFile[];
  onChange?: (files: LocalAssignmentFile[]) => void;
  disabled?: boolean;
}) {
  const [opened, setOpened] = useState<LocalAssignmentFile | null>(null);
  if (!files.length) return null;
  return (
    <>
      <ul className={styles.filePreview} aria-label="即將繳交的檔案">
        {files.map((item, index) => (
          <li key={item.key}>
            {item.previewUrl ? (
              <button
                type="button"
                className={styles.fileThumb}
                onClick={() => setOpened(item)}
                aria-label={`放大預覽 ${item.file.name}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.previewUrl} alt="" />
              </button>
            ) : (
              <span className={styles.fileGlyph} aria-hidden="true">
                檔
              </span>
            )}
            <span>
              <strong>{item.file.name}</strong>
              <small>{formatAssignmentFileSize(item.file.size)}</small>
              {onChange ? (
                <span className={styles.fileEdit}>
                  <button
                    type="button"
                    disabled={disabled || index === 0}
                    onClick={() => onChange(moveAssignmentFile(files, index, -1))}
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    disabled={disabled || index === files.length - 1}
                    onClick={() => onChange(moveAssignmentFile(files, index, 1))}
                  >
                    下移
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      const next = files.filter((_, current) => current !== index);
                      revokeUnusedAssignmentPreviews(files, next);
                      onChange(next);
                    }}
                  >
                    刪除
                  </button>
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {opened?.previewUrl ? (
        <div className={styles.lightbox} role="dialog" aria-modal="true" aria-label={opened.file.name}>
          <button type="button" onClick={() => setOpened(null)}>
            關閉
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={opened.previewUrl} alt={opened.file.name} />
        </div>
      ) : null}
    </>
  );
}

export function SubmittedFileList({ files }: { files: NuniSubmissionFile[] }) {
  if (!files.length) return null;
  return (
    <ul className={styles.filePreview} aria-label="已繳交檔案">
      {files.map((file) => {
        const view = assignmentFileHref(file);
        const download = assignmentFileHref(file, true);
        return (
          <li key={file.id}>
            {file.kind === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={view} alt={file.originalName} />
            ) : (
              <span className={styles.fileGlyph} aria-hidden="true">
                檔
              </span>
            )}
            <span>
              <strong>{file.originalName}</strong>
              <small>
                {formatAssignmentFileSize(file.byteSize)} · {file.kind === 'image' ? '照片' : '檔案'}
              </small>
              <span className={styles.fileEdit}>
                <a href={view}>查看</a>
                <a href={download}>下載</a>
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function SubmissionReceipt({
  submission,
  dueAt,
}: {
  submission: NuniSubmission;
  dueAt: string | null;
}) {
  const late = submission.late === true || assignmentSubmissionLate(dueAt, submission.submittedAt);
  return (
    <section className={shared.receipt} aria-label="我的繳交紀錄">
      <strong>{assignmentReceiptStatusLabel(late)}</strong>
      <p>
        <time dateTime={submission.submittedAt}>{formatTaipeiDateTime(submission.submittedAt)}</time>
      </p>
      {submission.files?.length ? <SubmittedFileList files={submission.files} /> : null}
    </section>
  );
}

export function AssignmentFilePicker({
  files,
  onChange,
  disabled,
}: {
  files: LocalAssignmentFile[];
  onChange: (files: LocalAssignmentFile[]) => void;
  disabled?: boolean;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const album = useRef<HTMLInputElement>(null);
  const docs = useRef<HTMLInputElement>(null);
  useEffect(() => {
    return () => {
      for (const item of files) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    };
    // Only revoke leftover object URLs when the picker unmounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function add(list: FileList | null) {
    if (!list?.length) return;
    onChange(collectLocalFiles(files, list));
  }
  return (
    <div className={styles.fileActions}>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        disabled={disabled}
        onChange={(event) => {
          add(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={album}
        type="file"
        accept="image/*"
        multiple
        hidden
        disabled={disabled}
        onChange={(event) => {
          add(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={docs}
        type="file"
        accept=".pdf,.doc,.docx,.txt,.zip,application/pdf,text/plain,application/zip"
        multiple
        hidden
        disabled={disabled}
        onChange={(event) => {
          add(event.target.files);
          event.target.value = '';
        }}
      />
      <button type="button" className={`${shared.button} ${shared.secondary}`} disabled={disabled} onClick={() => camera.current?.click()}>
        拍照
      </button>
      <button type="button" className={`${shared.button} ${shared.secondary}`} disabled={disabled} onClick={() => album.current?.click()}>
        相簿
      </button>
      <button type="button" className={`${shared.button} ${shared.secondary}`} disabled={disabled} onClick={() => docs.current?.click()}>
        檔案
      </button>
      <p className={styles.note}>網路不穩時再送一次，不會重複交。選好的照片可以刪除或調整順序後再送出。</p>
      <AssignmentFilePreview files={files} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export async function uploadAndSubmitFiles(
  classes: ReturnType<typeof useClasses>,
  workspaceId: string,
  assignmentId: string,
  body: string,
  files: LocalAssignmentFile[],
  key: string,
  onProgress?: (progress: AssignmentUploadProgress) => void,
  operation: AssignmentFileOperation = {},
): Promise<NuniAssignment> {
  if (operation.key !== key) {
    Object.assign(operation, {
      key,
      prepared: undefined,
      intents: undefined,
      uploaded: [],
      submitting: false,
      body: body.trim() || undefined,
    });
  }
  if (operation.submitting) {
    return classes.submitFiles(workspaceId, assignmentId, {
      body: operation.body,
      fileIds: operation.intents!.map((intent) => intent.id),
      idempotencyKey: key,
    });
  }
  if (!files.length && !body.trim()) throw new NuniError(422, 'ASSIGNMENT_FILE_REQUIRED');
  const prepared: LocalAssignmentFile[] = operation.prepared ?? [];
  if (!operation.prepared) {
    for (const item of files) {
      if (item.kind !== 'image') {
        prepared.push(item);
        continue;
      }
      const compressed = await compressAssignmentImageFile(item.file);
      prepared.push({ ...item, file: compressed, kind: 'image' });
    }
    operation.prepared = prepared;
  }
  onProgress?.({ completed: operation.uploaded?.length ?? 0, total: prepared.length });
  const intents =
    operation.intents ??
    (prepared.length
      ? await classes.createAssignmentFileIntents(workspaceId, assignmentId, {
          idempotencyKey: `${key}:intents`,
          files: prepared.map((item, index) => ({
            originalName: item.file.name,
            contentType:
              item.file.type || (item.kind === 'image' ? 'image/jpeg' : 'application/octet-stream'),
            byteSize: item.file.size,
            idempotencyKey: `${key}:file:${index}`,
          })),
        })
      : []);
  operation.intents = intents;
  let completed = operation.uploaded?.length ?? 0;
  const uploads = await Promise.allSettled(
    intents.map(async (intent, index) => {
      if (operation.uploaded?.includes(intent.id)) return;
      const item = prepared[index];
      if (!item) throw new NuniError(502, 'INVALID_RESPONSE');
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      await classes.uploadAssignmentFile(intent.uploadPath, bytes, intent.contentType);
      operation.uploaded!.push(intent.id);
      completed += 1;
      onProgress?.({ completed, total: prepared.length });
    }),
  );
  // Wait for every upload before allowing a retry to reuse this operation.
  const failed = uploads.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  operation.submitting = true;
  return classes.submitFiles(workspaceId, assignmentId, {
    body: operation.body,
    fileIds: intents.map((intent) => intent.id),
    idempotencyKey: key,
  });
}
