'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MAX_ASSIGNMENT_DOCUMENTS,
  MAX_ASSIGNMENT_IMAGES,
  assignmentLateOpenLabel,
  assignmentReceiptStatusLabel,
  classifyAssignmentFile,
  formatAssignmentFileSize,
} from '@campus/shared/src/assignmentFiles';
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
      key: `${file.name}:${file.size}:${file.lastModified}:${next.length}`,
      file,
      kind,
      previewUrl: kind === 'image' ? URL.createObjectURL(file) : undefined,
    });
  }
  return next;
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

export function AssignmentFilePreview({ files }: { files: LocalAssignmentFile[] }) {
  if (!files.length) return null;
  return (
    <ul className={styles.filePreview} aria-label="即將繳交的檔案">
      {files.map((item) => (
        <li key={item.key}>
          {item.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.previewUrl} alt={item.file.name} />
          ) : (
            <span className={styles.fileGlyph} aria-hidden="true">
              檔
            </span>
          )}
          <span>
            <strong>{item.file.name}</strong>
            <small>{formatAssignmentFileSize(item.file.size)}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SubmittedFileList({ files }: { files: NuniSubmissionFile[] }) {
  if (!files.length) return null;
  return (
    <ul className={styles.filePreview} aria-label="已繳交檔案">
      {files.map((file) => {
        const href = `/api/nuni/${file.downloadPath}?exp=${encodeURIComponent(file.downloadExp)}&sig=${encodeURIComponent(file.downloadSig)}`;
        return (
          <li key={file.id}>
            {file.kind === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={href} alt={file.originalName} />
            ) : (
              <span className={styles.fileGlyph} aria-hidden="true">
                檔
              </span>
            )}
            <span>
              <a href={href}>{file.originalName}</a>
              <small>{formatAssignmentFileSize(file.byteSize)}</small>
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
  const late = submission.late === true || (dueAt ? Date.parse(submission.submittedAt) > Date.parse(dueAt) : false);
  return (
    <section className={shared.receipt} aria-label="我的繳交紀錄">
      <strong>{assignmentReceiptStatusLabel(late)}</strong>
      <p>
        <time dateTime={submission.submittedAt}>
          {new Date(submission.submittedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
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
  const camera = useRef<HTMLInputElement>(null);
  const album = useRef<HTMLInputElement>(null);
  const docs = useRef<HTMLInputElement>(null);
  useEffect(() => {
    return () => {
      for (const item of files) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    };
  }, [files]);
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
      <AssignmentFilePreview files={files} />
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
): Promise<NuniAssignment> {
  if (!files.length && !body.trim()) throw new NuniError(422, 'ASSIGNMENT_FILE_REQUIRED');
  const fileIds: string[] = [];
  for (const [index, item] of files.entries()) {
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    const intent = await classes.createAssignmentFileIntent(workspaceId, assignmentId, {
      originalName: item.file.name,
      contentType: item.file.type || (item.kind === 'image' ? 'image/jpeg' : 'application/octet-stream'),
      byteSize: bytes.byteLength,
      idempotencyKey: `${key}:file:${index}`,
    });
    await classes.uploadAssignmentFile(intent.uploadPath, bytes, intent.contentType);
    fileIds.push(intent.id);
  }
  return classes.submitFiles(workspaceId, assignmentId, {
    body: body.trim() || undefined,
    fileIds,
    idempotencyKey: key,
  });
}
