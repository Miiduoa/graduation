'use client';

import { useId } from 'react';
import type {
  TronClassSubmissionHistory as History,
  TronClassSubmissionHistoryEntry,
} from '@campus/shared/src/tronClassSubmissionHistory';
import { SourceLink, tronClassTime } from './TronClassSource';
import type { TronClassClient } from '@/lib/tronClassIntegrationClient';
import { TronClassSubmissionAttachmentDownload } from './TronClassSubmissionAttachmentDownload';
import styles from './tronclass.module.css';

const stateLabels: Record<TronClassSubmissionHistoryEntry['state'], string> = {
  submitted: '已繳交',
  draft: '草稿',
  returned: '退回重做',
  'teacher-marked': '教師標記已繳',
  unknown: '狀態待確認',
};

function fileSize(size: number | null): string {
  if (size === null) return '未提供大小';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** The school's read-only history is separate from a verified nuni send receipt. */
export function TronClassSubmissionHistory({
  history,
  sourceHref,
  onRetry,
  retryDisabled = false,
  attachmentDownload,
}: {
  history: History;
  sourceHref: string;
  onRetry: () => void;
  retryDisabled?: boolean;
  attachmentDownload?: {
    revision: string;
    download: TronClassClient['downloadSubmissionAttachment'];
    onConnectionChanged?: (reason?: unknown) => void;
  };
}) {
  const headingId = useId();
  const latest = history.entries.find((entry) => entry.isLatest && entry.id === history.latestId);

  return (
    <section className={styles.assignmentBrief} aria-labelledby={headingId}>
      <h3 id={headingId}>TronClass 繳交紀錄</h3>
      <p className={styles.muted}>查詢時間：{tronClassTime(history.fetchedAt)}</p>
      {history.state === 'unavailable' ? (
        <div className={styles.notice}>
          <p>暫時無法讀取歷次繳交內容。</p>
          <button className="btn" type="button" disabled={retryDisabled} onClick={onRetry}>
            重新讀取繳交紀錄
          </button>
        </div>
      ) : history.state === 'group-unsupported' ? (
        <p className={styles.muted}>
          這份作業採小組繳交，請開啟 TronClass 原作業查看小組紀錄。
        </p>
      ) : history.entries.length === 0 ? (
        <p className={styles.muted}>目前未取得這份作業的繳交紀錄。</p>
      ) : (
        <>
          {latest ? (
            <p>校方標示的目前版本：<strong>{stateLabels[latest.state]}</strong></p>
          ) : (
            <p className={styles.muted}>校方未標示目前版本，可逐筆查看歷次內容。</p>
          )}
          <ul className={styles.list} aria-label="歷次繳交內容">
            {history.entries.map((entry) => {
              const isCurrent = entry.id === latest?.id;
              return (
                <li key={entry.id}>
                  <details className={styles.previous} open={isCurrent}>
                    <summary>
                      {isCurrent ? '目前版本' : '歷次紀錄'} · {stateLabels[entry.state]}
                      {' · '}紀錄時間：{tronClassTime(entry.createdAt)}
                    </summary>
                    {entry.state === 'draft' && <p className={styles.muted}>這筆內容仍是草稿，尚未正式繳交。</p>}
                    {entry.state === 'returned' && <p className={styles.muted}>這個版本已退回重做，請查看原作業的要求。</p>}
                    {entry.state === 'teacher-marked' && <p className={styles.muted}>教師已標記繳交狀態，此紀錄未提供作業內容。</p>}
                    {entry.state === 'unknown' && <p className={styles.muted}>校方尚未提供可確認的狀態，請開啟原作業核對。</p>}
                    {entry.content && <p className={styles.bodyText}>{entry.content}</p>}
                    {entry.contentTruncated && <p className={styles.muted}>這裡只顯示部分文字，可到原作業查看完整內容。</p>}
                    {entry.attachments.length > 0 && (
                      <ul className={styles.fileLinks} aria-label="這筆紀錄的附件">
                        {entry.attachments.map((file, index) => (
                          <li key={`${index}:${file.name}`}>
                            {file.name} · {fileSize(file.size)}
                            {file.download && attachmentDownload && !retryDisabled && (
                              <TronClassSubmissionAttachmentDownload
                                key={`${attachmentDownload.revision}:${history.courseId}:${history.homeworkId}:${entry.id}:${file.download.uploadId}`}
                                download={attachmentDownload.download}
                                revision={attachmentDownload.revision}
                                courseId={history.courseId} homeworkId={history.homeworkId}
                                submissionId={entry.id} uploadId={file.download.uploadId} name={file.name}
                                onConnectionChanged={attachmentDownload.onConnectionChanged}
                              />
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {entry.hasOtherResources && <p className={styles.muted}>這筆紀錄還有其他資源，請到原作業查看。</p>}
                  </details>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <SourceLink href={sourceHref}>查看 TronClass 原作業</SourceLink>
    </section>
  );
}
