'use client';

import { useEffect, useRef, useState } from 'react';
import {
  NuniError,
  nuniErrorMessage,
  type NuniAssignment,
  type NuniSubmission,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import {
  assignmentReceiptStatusLabel,
  assignmentSubmissionLate,
  assignmentCanRevise,
} from '@campus/shared/src/assignmentFiles';
import {
  awaitingFeedbackPosition,
  feedbackQueueLabel,
  matchesFeedbackQueueFilter,
  needsFeedbackReview,
  nextAwaitingFeedbackReview,
  sortFeedbackQueue,
  type FeedbackQueueFilter,
} from '@campus/shared/src/lmsReviewQueue';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import { MutationForm, useClasses, type MutationFormIntent } from './CourseUI';
import { CourseText } from './CourseMaterials';
import { useNuniSession } from './Session';
import {
  AssignmentFilePicker,
  AssignmentLateBanner,
  SubmittedFileList,
  uploadAndSubmitFiles,
  type AssignmentUploadProgress,
  type LocalAssignmentFile,
} from './AssignmentFileFields';
import shared from './NuniApp.module.css';
import styles from './CourseLearning.module.css';

type Props = {
  item: NuniAssignment;
  workspace: NuniWorkspace;
  reload: () => void;
  onConfirmed?: (assignment: NuniAssignment) => void;
};

/** Scoped so parallel mounted assignments never collide on platformAccountId alone. */
export function assignmentReceiptDomId(
  workspaceId: string,
  assignmentId: string,
  platformAccountId: string,
): string {
  return `assignment-receipt-${workspaceId}-${assignmentId}-${platformAccountId}`;
}

function feedbackMatchesSubmitted(
  receipt: { teacherFeedback: string | null },
  submitted: string,
): boolean {
  return (receipt.teacherFeedback ?? '').trim() === submitted.trim();
}

function latestAssignment(
  item: NuniAssignment,
  saved: NuniAssignment | null,
  withdrawnAt: string | null,
): NuniAssignment {
  if (!saved) return item;
  if (!saved.mySubmission && withdrawnAt !== null) {
    if (item.mySubmission && item.mySubmission.submittedAt !== withdrawnAt) return item;
    return { ...item, mySubmission: null, submissionCount: saved.submissionCount };
  }
  const incoming = item.mySubmission;
  const confirmed = saved.mySubmission;
  const keepSubmission =
    confirmed &&
    (!incoming ||
      Date.parse(confirmed.submittedAt) > Date.parse(incoming.submittedAt) ||
      (confirmed.submittedAt === incoming.submittedAt &&
        Date.parse(confirmed.reviewedAt ?? confirmed.submittedAt) >=
          Date.parse(incoming.reviewedAt ?? incoming.submittedAt)));
  return {
    ...item,
    submissionCount: saved.submissionCount ?? item.submissionCount,
    ...(saved.state === 'closed' ? { state: 'closed', closedAt: saved.closedAt } : {}),
    mySubmission: keepSubmission ? confirmed : incoming,
  };
}

export function AssignmentCard(props: Props) {
  const { session, pendingLogout } = useNuniSession();
  if (!session || pendingLogout) return null;
  const { workspace, item } = props;
  return (
    <Assignment
      key={`${session.context}:${workspace.id}:${workspace.memberRole}:${workspace.state}:${item.id}`}
      {...props}
    />
  );
}

function Assignment({ item, workspace, onConfirmed }: Props) {
  const { session } = useNuniSession();
  const classes = useClasses();
  const fileSubmit = session?.assignmentFileSubmit === true;
  const [withdrawNotice, setWithdrawNotice] = useState('');
  const [withdrawnAt, setWithdrawnAt] = useState<string | null>(null);
  const [saved, setSaved] = useState<NuniAssignment | null>(null);
  const [localFiles, setLocalFiles] = useState<LocalAssignmentFile[]>([]);
  const [progress, setProgress] = useState<AssignmentUploadProgress | null>(null);
  const assignment = latestAssignment(item, saved, withdrawnAt);
  const [submissions, setSubmissions] = useState<NuniSubmission[] | null>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closeNotice, setCloseNotice] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const [feedbackFilter, setFeedbackFilter] = useState<FeedbackQueueFilter>('needs_feedback');
  const [focusReceiptId, setFocusReceiptId] = useState<string | null>(null);
  const [queueNotice, setQueueNotice] = useState('');
  const mounted = useRef(true);
  const request = useRef(0);
  const submissionsRef = useRef<NuniSubmission[] | null>(null);
  const receiptNodes = useRef(new Map<string, HTMLElement | null>());
  const FEEDBACK_FILTERS: FeedbackQueueFilter[] = ['all', 'needs_feedback', 'reviewed'];
  const orderedSubmissions = submissions === null ? null : sortFeedbackQueue(submissions);
  const visibleCount =
    orderedSubmissions?.filter((entry) => matchesFeedbackQueueFilter(entry, feedbackFilter))
      .length ?? 0;
  useEffect(() => {
    submissionsRef.current = submissions;
  }, [submissions]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!focusReceiptId) return;
    const node = receiptNodes.current.get(focusReceiptId);
    if (!node) return;
    if (typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    const focusTarget =
      node.querySelector<HTMLElement>('textarea[name="feedback"]') ??
      node.querySelector<HTMLElement>('summary');
    focusTarget?.focus({ preventScroll: true });
  }, [focusReceiptId, orderedSubmissions, feedbackFilter]);
  const student = workspace.memberRole === 'student';
  const active = workspace.state === 'active';
  const open = assignment.state === 'open';
  const canRevise = assignmentCanRevise(assignment.dueAt);

  async function readSubmissions() {
    const run = ++request.current;
    setError('');
    setReading(true);
    try {
      const result = await classes.submissions(workspace.id, item.id);
      if (mounted.current && run === request.current) {
        setSubmissions(result);
        setFeedbackFilter(
          result.some((entry) => needsFeedbackReview(entry)) ? 'needs_feedback' : 'all',
        );
      }
    } catch (failure) {
      if (mounted.current && run === request.current) {
        if (failure instanceof NuniError && [403, 404].includes(failure.status)) {
          setSubmissions(null);
          setConfirmClose(false);
          setAccessDenied(true);
        }
        setError(nuniErrorMessage(failure));
      }
    } finally {
      if (mounted.current && run === request.current) setReading(false);
    }
  }

  async function closeAssignment() {
    let result: NuniAssignment;
    try {
      result = await classes.closeAssignment(workspace.id, item.id);
    } catch (failure) {
      if (!mounted.current) throw new NuniError(409, 'SESSION_CHANGED');
      const uncertain = !(failure instanceof NuniError) || failure.status >= 500;
      const alreadyClosed = failure instanceof NuniError && failure.status === 409;
      if (!uncertain && !alreadyClosed) throw failure;
      const fresh = await classes.assignments(workspace.id);
      const confirmed = fresh.find((entry) => entry.id === item.id);
      if (!confirmed || confirmed.state !== 'closed') throw failure;
      result = confirmed;
    }
    if (!mounted.current) throw new NuniError(409, 'SESSION_CHANGED');
    setSaved(result);
    onConfirmed?.(result);
    setConfirmClose(false);
    setCloseNotice('目前已停止收件，已繳交的內容與老師回饋仍會保留。');
  }

  if (accessDenied)
    return (
      <article className={shared.panel}>
        <h3>{item.title}</h3>
        <p role="alert" className={shared.notice}>
          {error}
        </p>
      </article>
    );

  return (
    <article
      className={`${shared.panel} ${shared.courseWorkTarget}`}
      id={`assignment-${item.id}`}
      tabIndex={-1}
      aria-labelledby={`assignment-title-${item.id}`}
    >
      <div className={styles.heading}>
        <h3 id={`assignment-title-${item.id}`}>{assignment.title}</h3>
        <span className={styles.badge}>
          {!active ? '課程已封存' : open ? '開放繳交' : '已停止收件'}
        </span>
      </div>
      <p className={shared.muted}>
        {assignment.dueAt ? (
          <>
            參考期限：
            <time dateTime={assignment.dueAt}>{formatTaipeiDateTime(assignment.dueAt, { seconds: false })}</time>
          </>
        ) : (
          '未設定參考期限'
        )}
      </p>
      {assignment.dueAt && active && open && (
        <p className={styles.note}>目前仍開放繳交；實際收件狀態以老師是否停止收件為準。</p>
      )}
      {fileSubmit ? (
        <AssignmentLateBanner
          dueAt={assignment.dueAt}
          state={assignment.state}
          workspaceState={workspace.state}
        />
      ) : null}
      <CourseText text={assignment.instructions} />
      {!active && <p className={styles.note}>課程已封存，目前只能查看已保留的作業資料。</p>}
      {assignment.mySubmission && (
        <section className={shared.receipt} aria-label="我的繳交紀錄">
          <strong>
            {assignmentReceiptStatusLabel(
              assignment.mySubmission.late === true ||
                assignmentSubmissionLate(assignment.dueAt, assignment.mySubmission.submittedAt),
            )}
          </strong>
          <p>
            <time dateTime={assignment.mySubmission.submittedAt}>
              {formatTaipeiDateTime(assignment.mySubmission.submittedAt)}
            </time>
          </p>
          {assignment.mySubmission.files?.length ? (
            <SubmittedFileList files={assignment.mySubmission.files} />
          ) : null}
          <CourseText text={assignment.mySubmission.body} />
          {assignment.mySubmission.teacherFeedback ? (
            <div className={styles.feedback}>
              <h4>老師回饋</h4>
              <CourseText text={assignment.mySubmission.teacherFeedback} />
              {assignment.mySubmission.reviewedAt &&
                needsFeedbackReview(assignment.mySubmission) && (
                  <p className={styles.note}>這則回饋早於最近一次繳交，請老師確認是否仍適用。</p>
                )}
              {assignment.mySubmission.reviewedAt && (
                <p className={shared.muted}>
                  <time dateTime={assignment.mySubmission.reviewedAt}>
                    {formatTaipeiDateTime(assignment.mySubmission.reviewedAt)}
                  </time>
                </p>
              )}
            </div>
          ) : (
            <p className={shared.muted}>老師尚未留下回饋。</p>
          )}
        </section>
      )}
      {withdrawNotice && <p role="status">{withdrawNotice}</p>}
      {student && fileSubmit && assignment.mySubmission && active && open && canRevise && (
        <MutationForm label="撤回繳交" success="已撤回，截止前可以重新繳交。" submit={async (_data, key) => {
          const result = await classes.withdrawAssignment(workspace.id, item.id, assignment.mySubmission!.submittedAt, key);
          if (!mounted.current) throw new NuniError(409, 'SESSION_CHANGED');
          setWithdrawnAt(assignment.mySubmission!.submittedAt);
          setSaved(result);
          setWithdrawNotice('已撤回，截止前可以重新繳交。');
          onConfirmed?.(result);
        }}>
          <p>撤回後，老師就看不到這份繳交內容。</p>
        </MutationForm>
      )}
      {student && assignment.mySubmission && !canRevise && <p>已過截止時間，這份繳交不能再修改或撤回。</p>}
      {student && active && open && (!fileSubmit || !assignment.mySubmission || canRevise) && (
        <details open={!assignment.mySubmission} className={`${shared.compose} ${styles.compose}`}>
          <summary>{assignment.mySubmission ? '修改繳交內容' : '繳交這份作業'}</summary>
          <MutationForm
            label={assignment.mySubmission ? '更新繳交內容' : '繳交作業'}
            success="繳交內容已儲存，老師現在可以查看。"
            submit={async (data, key) => {
              const body = String(data.get('body') ?? '');
              try {
                const result =
                  fileSubmit && localFiles.length
                    ? await uploadAndSubmitFiles(
                        classes,
                        workspace.id,
                        item.id,
                        body,
                        localFiles,
                        key,
                        setProgress,
                      )
                    : fileSubmit
                      ? await classes.submitFiles(workspace.id, item.id, { body, fileIds: [], idempotencyKey: key })
                      : await classes.submit(workspace.id, item.id, body, key);
                if (!mounted.current) throw new NuniError(409, 'SESSION_CHANGED');
                setSaved(result);
                setWithdrawNotice('');
                setLocalFiles([]);
                setProgress(null);
                onConfirmed?.(result);
              } finally {
                if (mounted.current) setProgress(null);
              }
            }}
          >
            {progress ? (
              <p role="status">
                上傳中 {progress.completed}/{progress.total}，請保持網路連線。
              </p>
            ) : null}
            {fileSubmit && assignment.mySubmission?.files?.length ? (
              <p>重新送出會取代這次繳交；沒有選檔就改交純文字。</p>
            ) : null}
            {fileSubmit ? (
              <AssignmentFilePicker files={localFiles} onChange={setLocalFiles} />
            ) : null}
            <label>
              作業內容
              <textarea
                name="body"
                required={!fileSubmit || localFiles.length === 0}
                maxLength={8000}
                defaultValue={assignment.mySubmission?.body ?? ''}
                placeholder={
                  fileSubmit
                    ? '可寫說明；或直接拍照／選檔後送出。'
                    : '填寫內容，或附上作品連結。'
                }
              />
            </label>
          </MutationForm>
        </details>
      )}
      {!student && (
        <>
          <div className={styles.toolbar}>
            <span className={shared.muted}>
              {submissions?.length ?? assignment.submissionCount} 份繳交
            </span>
            {active && (
              <button
                type="button"
                className={`${shared.button} ${shared.secondary}`}
                disabled={reading}
                onClick={() => void readSubmissions()}
              >
                {reading ? '讀取中…' : submissions === null ? '查看繳交內容' : '更新繳交內容'}
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className={shared.notice}>
              {error}
            </p>
          )}
          {submissions !== null &&
            (submissions.length ? (
              <div>
                <div className={shared.filters} role="group" aria-label="篩選回饋狀態">
                  {FEEDBACK_FILTERS.map((value) => {
                    const count = submissions.filter((entry) =>
                      matchesFeedbackQueueFilter(entry, value),
                    ).length;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={feedbackFilter === value}
                        onClick={() => setFeedbackFilter(value)}
                      >
                        {feedbackQueueLabel(value)} {count}
                      </button>
                    );
                  })}
                </div>
                <p className={styles.note}>
                  預設先看尚未回饋的繳交。儲存後，學生才看得到。
                </p>
                {queueNotice ? (
                  <p role="status" className={shared.receipt}>
                    {queueNotice}
                  </p>
                ) : null}
                {visibleCount === 0 ? (
                  <p role="status" className={shared.muted}>
                    「{feedbackQueueLabel(feedbackFilter)}」目前沒有繳交。可改選「全部」查看其他狀態。
                  </p>
                ) : null}
                <ul className={`${shared.list} ${styles.submissions}`}>
                  {/* Keep each row mounted so filter switches cannot discard unsaved editor state. */}
                  {(orderedSubmissions ?? []).map((entry) => (
                    <li
                      key={entry.platformAccountId}
                      hidden={!matchesFeedbackQueueFilter(entry, feedbackFilter)}
                      id={assignmentReceiptDomId(workspace.id, item.id, entry.platformAccountId)}
                      ref={(node) => {
                        if (node) receiptNodes.current.set(entry.platformAccountId, node);
                        else receiptNodes.current.delete(entry.platformAccountId);
                      }}
                    >
                      <FeedbackRow
                        entry={entry}
                        dueAt={assignment.dueAt}
                        queue={orderedSubmissions ?? []}
                        expanded={focusReceiptId === entry.platformAccountId}
                        save={async (feedback, key, intent) => {
                          const receipt = await classes.assignmentFeedback(
                            workspace.id,
                            item.id,
                            entry.platformAccountId,
                            feedback,
                            key,
                          );
                          if (!mounted.current) throw new NuniError(409, 'SESSION_CHANGED');
                          ++request.current;
                          setReading(false);
                          const latest =
                            (submissionsRef.current ?? []).map((value) =>
                              value.platformAccountId === receipt.platformAccountId
                                ? receipt
                                : value,
                            );
                          const nextList = latest.length ? latest : [receipt];
                          submissionsRef.current = nextList;
                          setSubmissions(nextList);
                          const matched = feedbackMatchesSubmitted(receipt, feedback);
                          if (intent === 'secondary') {
                            // Authoritative replay may differ after a lost response; never advance then.
                            if (!matched) {
                              setFocusReceiptId(entry.platformAccountId);
                              setFeedbackFilter((current) =>
                                matchesFeedbackQueueFilter(receipt, current) ? current : 'all',
                              );
                              setQueueNotice('');
                              return receipt;
                            }
                            const next = nextAwaitingFeedbackReview(
                              nextList,
                              receipt.platformAccountId,
                            );
                            if (!next) {
                              setFocusReceiptId(null);
                              setFeedbackFilter((current) =>
                                matchesFeedbackQueueFilter(receipt, current) ? current : 'all',
                              );
                              setQueueNotice('回饋已儲存。目前沒有下一份尚未回饋的繳交。');
                            } else {
                              setFeedbackFilter('needs_feedback');
                              setFocusReceiptId(next.platformAccountId);
                              setQueueNotice(
                                `回饋已儲存。已移到 ${next.displayName || '下一位同學'} 的繳交。`,
                              );
                            }
                            return receipt;
                          }
                          setQueueNotice('');
                          setFocusReceiptId(null);
                          setFeedbackFilter((current) =>
                            matchesFeedbackQueueFilter(receipt, current) ? current : 'all',
                          );
                          return receipt;
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className={shared.muted}>尚未收到作業。</p>
            ))}
          {closeNotice && (
            <p role="status" className={shared.receipt}>
              {closeNotice}
            </p>
          )}
          {active && open && (
            <div className={styles.closeArea}>
              {confirmClose ? (
                <section aria-label="確認停止收件" className={styles.confirmation}>
                  <h4>停止收取這份作業？</h4>
                  <p>
                    學生將無法新增或修改繳交內容。已收的作業會保留，你仍可以留下回饋；目前不提供重新開放收件。
                  </p>
                  <MutationForm
                    label="確認停止收件"
                    submit={async (data) => {
                      if (data.get('confirmed') !== 'on')
                        throw new NuniError(422, 'CONFIRMATION_REQUIRED');
                      await closeAssignment();
                    }}
                  >
                    <label className={styles.checkbox}>
                      <input type="checkbox" name="confirmed" required />
                      我了解學生將無法再繳交或修改作業
                    </label>
                  </MutationForm>
                </section>
              ) : (
                <button
                  type="button"
                  className={`${shared.button} ${shared.secondary}`}
                  onClick={() => setConfirmClose(true)}
                >
                  停止收件
                </button>
              )}
            </div>
          )}
        </>
      )}
    </article>
  );
}

function FeedbackRow({
  entry,
  dueAt,
  queue,
  expanded,
  save,
}: {
  entry: NuniSubmission;
  dueAt: string | null;
  queue: NuniSubmission[];
  expanded: boolean;
  save: (
    feedback: string,
    key: string,
    intent: MutationFormIntent,
  ) => Promise<NuniSubmission>;
}) {
  const [notice, setNotice] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const detailsOpen = expanded || manualOpen;
  const currentText = entry.teacherFeedback ?? '';
  const version = JSON.stringify([
    entry.body,
    entry.submittedAt,
    entry.teacherFeedback,
    entry.reviewedAt,
  ]);
  const [editor, setEditor] = useState({ version, original: currentText, text: currentText });
  const pristine = editor.text === editor.original;
  const draft = pristine ? currentText : editor.text;
  const changed = !pristine && editor.version !== version;
  const dispatched = useRef<string | null>(null);
  const mounted = useRef(true);
  const position = awaitingFeedbackPosition(queue, entry.platformAccountId);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <article aria-label={`${entry.displayName || '課程成員'}的繳交`}>
      <div className={styles.heading}>
        <h4>{entry.displayName || '課程成員'}</h4>
        <span className={styles.metadata}>
          <strong>
            {assignmentReceiptStatusLabel(
              entry.late === true || assignmentSubmissionLate(dueAt, entry.submittedAt),
            )}
          </strong>
          <time dateTime={entry.submittedAt}>{formatTaipeiDateTime(entry.submittedAt)}</time>
        </span>
      </div>
      {position ? (
        <p className={styles.note}>
          待回饋第 {position.index}／{position.total} 份
          {expanded ? ' · 目前批改這一份' : ''}
        </p>
      ) : expanded ? (
        <p className={styles.note}>目前批改這一份</p>
      ) : null}
      {entry.files?.length ? <SubmittedFileList files={entry.files} /> : null}
      <CourseText text={entry.body} />
      {entry.teacherFeedback && (
        <section className={styles.feedback} aria-label="目前老師回饋">
          <h5>目前回饋</h5>
          <CourseText text={entry.teacherFeedback} />
          {entry.reviewedAt && needsFeedbackReview(entry) && (
            <p className={styles.note}>這則回饋早於最近一次繳交，請老師確認是否仍適用。</p>
          )}
        </section>
      )}
      {notice && (
        <p role="status" className={shared.receipt}>
          {notice}
        </p>
      )}
      <details
        className={`${shared.compose} ${styles.compose}`}
        open={detailsOpen}
        onToggle={(event) => {
          if (expanded) {
            event.currentTarget.open = true;
            return;
          }
          setManualOpen(event.currentTarget.open);
        }}
      >
        <summary>{entry.teacherFeedback ? '編輯回饋' : '留下回饋'}</summary>
          <MutationForm
            label="儲存回饋"
            secondaryLabel="儲存回饋並查看下一份"
            submit={async (data, key, intent) => {
              if (changed && dispatched.current !== key)
                throw new NuniError(409, 'FEEDBACK_CHANGED');
              setNotice('');
              const feedback = String(data.get('feedback') ?? '');
              dispatched.current = key;
              const receipt = await save(feedback, key, intent);
              if (!mounted.current) throw new NuniError(409, 'SESSION_CHANGED');
              const text = receipt.teacherFeedback ?? '';
              setEditor({
                version: JSON.stringify([
                  receipt.body,
                  receipt.submittedAt,
                  receipt.teacherFeedback,
                  receipt.reviewedAt,
                ]),
                original: text,
                text,
              });
              const matched = feedbackMatchesSubmitted(receipt, feedback);
              if (intent === 'secondary' && matched) {
                setNotice('');
                return;
              }
              setNotice(
                matched
                  ? '回饋已儲存，學生現在可以查看。'
                  : '這份回饋已有新的內容，上方顯示目前儲存的版本。',
              );
            }}
          >
            {changed && (
              <section className={styles.confirmation} aria-label="回饋內容已更新">
                <p role="alert">
                  學生內容或老師回饋已有更新。你的草稿尚未儲存，請先核對新內容，再選擇接下來要編輯的內容。
                </p>
                <div className={styles.toolbar}>
                  <button
                    type="button"
                    className={`${shared.button} ${shared.secondary}`}
                    onClick={() => {
                      setEditor({ version, original: currentText, text: currentText });
                      setNotice('');
                    }}
                  >
                    改用目前回饋
                  </button>
                  <button
                    type="button"
                    className={`${shared.button} ${shared.secondary}`}
                    onClick={() => setEditor({ version, original: currentText, text: draft })}
                  >
                    保留草稿，儲存時覆寫
                  </button>
                </div>
              </section>
            )}
            <label>
              給{entry.displayName || '這位同學'}的回饋
              <textarea
                name="feedback"
                required
                maxLength={4000}
                value={draft}
                onChange={(event) => {
                  setEditor({
                    version: pristine ? version : editor.version,
                    original: pristine ? currentText : editor.original,
                    text: event.target.value,
                  });
                  setNotice('');
                }}
                placeholder="指出完成的部分，再說明可以如何改進。"
              />
            </label>
          </MutationForm>
        </details>
      </article>
  );
}
