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
  assertAssignmentFileBudget,
  assertAssignmentFileSize,
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
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PhotoPdfEditor } from './PhotoPdfEditor';
import { useClasses } from './CourseUI';
import shared from './NuniApp.module.css';
import styles from './CourseLearning.module.css';
import fileStyles from './AssignmentFileFields.module.css';

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

type AssignmentFileSelection = {
  files: LocalAssignmentFile[];
  added: number;
  rejected: { name: string; reason: string }[];
};

function localAssignmentFileType(file: File) {
  const classified = classifyAssignmentFile(file.name, file.type);
  // Preserve the picker quota when the browser supplies no MIME.
  const kind = file.type ? classified.kind : 'file';
  return { kind, contentType: kind === classified.kind ? classified.contentType : null };
}

export function collectLocalFileSelection(
  current: LocalAssignmentFile[],
  incoming: FileList | File[],
): AssignmentFileSelection {
  const next = [...current];
  const rejected: AssignmentFileSelection['rejected'] = [];
  for (const file of Array.from(incoming)) {
    let kind: LocalAssignmentFile['kind'];
    try {
      ({ kind } = localAssignmentFileType(file));
    } catch (cause) {
      rejected.push({
        name: file.name,
        reason:
          cause instanceof NuniError && cause.code === 'ASSIGNMENT_FILE_NAME_INVALID'
            ? '檔名無法使用，請重新命名後再選。'
            : '格式不支援，或副檔名與檔案格式不一致。',
      });
      continue;
    }
    const used = next.filter((item) => item.kind === kind).length;
    const limit = kind === 'image' ? MAX_ASSIGNMENT_IMAGES : MAX_ASSIGNMENT_DOCUMENTS;
    if (used >= limit) {
      rejected.push({
        name: file.name,
        reason:
          kind === 'image'
            ? `照片最多 ${limit} 張，請先刪除不需要的照片。`
            : `文件最多 ${limit} 個，請先刪除不需要的文件。`,
      });
      continue;
    }
    next.push({
      key: `${file.name}:${file.size}:${file.lastModified}:${next.length}:${Math.random().toString(36).slice(2, 8)}`,
      file,
      kind,
      previewUrl: kind === 'image' ? URL.createObjectURL(file) : undefined,
    });
  }
  return { files: next, added: next.length - current.length, rejected };
}

export function collectLocalFiles(
  current: LocalAssignmentFile[],
  incoming: FileList | File[],
): LocalAssignmentFile[] {
  return collectLocalFileSelection(current, incoming).files;
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

export function useAssignmentFilePreviews(files: LocalAssignmentFile[]) {
  const previews = useRef<LocalAssignmentFile[]>([]);
  const mounted = useRef(false);
  useEffect(() => {
    revokeUnusedAssignmentPreviews(previews.current, files);
    previews.current = files;
  }, [files]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Strict Mode replays effects while the same previews remain visible.
      queueMicrotask(() => {
        if (mounted.current) return;
        revokeUnusedAssignmentPreviews(previews.current, []);
        previews.current = [];
      });
    };
  }, []);
}

export async function compressAssignmentImageFile(file: File): Promise<File> {
  if (
    !file.type.startsWith('image/') ||
    /heic|heif/i.test(file.type) ||
    typeof document === 'undefined'
  )
    return file;
  const bitmapFn = globalThis.createImageBitmap;
  if (typeof bitmapFn !== 'function') return file;
  try {
    const bitmap = await bitmapFn(file);
    const size = assignmentImageTargetSize(bitmap.width, bitmap.height);
    const skip =
      size.width === bitmap.width &&
      size.height === bitmap.height &&
      file.size <= 1.5 * 1024 * 1024;
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
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82),
    );
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
  const [openedKey, setOpenedKey] = useState<string | null>(null);
  const opened = files.find((item) => item.key === openedKey);
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
                onClick={() => setOpenedKey(item.key)}
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
        <Modal
          isOpen
          onClose={() => setOpenedKey(null)}
          title={opened.file.name}
          description={formatAssignmentFileSize(opened.file.size)}
          size="xl"
          footer={
            <Button type="button" variant="outline" onClick={() => setOpenedKey(null)}>
              關閉預覽
            </Button>
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={fileStyles.previewImage} src={opened.previewUrl} alt={opened.file.name} />
        </Modal>
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
                {formatAssignmentFileSize(file.byteSize)} ·{' '}
                {file.kind === 'image' ? '照片' : '檔案'}
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
        <time dateTime={submission.submittedAt}>
          {formatTaipeiDateTime(submission.submittedAt)}
        </time>
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
  const [pdfOpen, setPdfOpen] = useState(false);
  const [selection, setSelection] = useState<Omit<AssignmentFileSelection, 'files'> | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const album = useRef<HTMLInputElement>(null);
  const docs = useRef<HTMLInputElement>(null);
  function add(list: FileList | File[] | null) {
    if (!list?.length) return;
    const result = collectLocalFileSelection(files, list);
    setSelection({ added: result.added, rejected: result.rejected });
    if (result.added) onChange(result.files);
  }
  return (
    <div className={styles.fileActions}>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        disabled={disabled || pdfOpen}
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
        disabled={disabled || pdfOpen}
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
        disabled={disabled || pdfOpen}
        onChange={(event) => {
          add(event.target.files);
          event.target.value = '';
        }}
      />
      <button
        type="button"
        className={`${shared.button} ${shared.secondary}`}
        disabled={disabled || pdfOpen}
        onClick={() => camera.current?.click()}
      >
        拍照
      </button>
      <button
        type="button"
        className={`${shared.button} ${shared.secondary}`}
        disabled={disabled || pdfOpen}
        onClick={() => album.current?.click()}
      >
        相簿
      </button>
      <button
        type="button"
        className={`${shared.button} ${shared.secondary}`}
        disabled={disabled || pdfOpen}
        onClick={() => docs.current?.click()}
      >
        檔案
      </button>
      <button
        type="button"
        className={`${shared.button} ${shared.secondary}`}
        disabled={
          disabled ||
          files.filter((file) => file.kind === 'file').length >= MAX_ASSIGNMENT_DOCUMENTS
        }
        onClick={() => setPdfOpen(true)}
      >
        照片轉 PDF
      </button>
      {pdfOpen && !disabled ? (
        <PhotoPdfEditor
          onCancel={() => setPdfOpen(false)}
          onConfirm={(file) => {
            add([file]);
            setPdfOpen(false);
          }}
        />
      ) : null}
      <p className={fileStyles.limits}>
        照片 {files.filter((file) => file.kind === 'image').length}/{MAX_ASSIGNMENT_IMAGES} 張 ·
        文件 {files.filter((file) => file.kind === 'file').length}/{MAX_ASSIGNMENT_DOCUMENTS} 個
      </p>
      {selection ? (
        <div className={fileStyles.selection} role="status" aria-live="polite" aria-atomic="true">
          <p>
            {selection.added ? `已加入 ${selection.added} 個檔案。` : '這次沒有加入檔案。'}
            {selection.rejected.length
              ? ` ${selection.rejected.length} 個未加入，請確認下方原因。`
              : null}
          </p>
          {selection.rejected.length ? (
            <ul aria-label="未加入的檔案">
              {selection.rejected.map((item, index) => (
                <li key={`${index}:${item.name}`}>
                  <strong>{item.name}</strong>：{item.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <p className={styles.note}>
        網路不穩時再送一次，不會重複交。選好的照片可以刪除或調整順序後再送出。
      </p>
      {files.some(({ file }) => !localAssignmentFileType(file).contentType) ? (
        <p role="status" className={styles.note}>
          有照片缺少檔案類型，無法繳交。請刪除該檔案，再選擇有檔案類型的照片。
        </p>
      ) : null}
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
    if (files.some(({ file }) => !localAssignmentFileType(file).contentType)) {
      throw new NuniError(422, 'ASSIGNMENT_FILE_TYPE_REJECTED');
    }
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
  if (!operation.intents) {
    let images = 0;
    let documents = 0;
    // Validate the entire batch before the server reserves any staged quota.
    const requests = prepared.map(({ file }, index) => {
      const { kind, contentType } = localAssignmentFileType(file);
      if (!contentType) throw new NuniError(422, 'ASSIGNMENT_FILE_TYPE_REJECTED');
      assertAssignmentFileSize(kind, file.size);
      if (kind === 'image') images += 1;
      else documents += 1;
      return {
        originalName: file.name,
        contentType,
        byteSize: file.size,
        idempotencyKey: `${key}:file:${index}`,
      };
    });
    assertAssignmentFileBudget(images, documents);
    operation.intents = requests.length
      ? await classes.createAssignmentFileIntents(workspaceId, assignmentId, {
          idempotencyKey: `${key}:intents`,
          files: requests,
        })
      : [];
  }
  const intents = operation.intents;
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
