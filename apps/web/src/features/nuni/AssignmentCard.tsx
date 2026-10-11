'use client';

import { useEffect, useRef, useState } from 'react';
import {
  NuniError,
  nuniErrorMessage,
  type NuniAssignment,
  type NuniSubmission,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import { MutationForm, useClasses } from './CourseUI';
import { CourseText } from './CourseMaterials';
import { useNuniSession } from './Session';
import shared from './NuniApp.module.css';
import styles from './CourseLearning.module.css';

type Props = {
  item: NuniAssignment;
  workspace: NuniWorkspace;
  reload: () => void;
  onConfirmed?: (assignment: NuniAssignment) => void;
};

function latestAssignment(item: NuniAssignment, saved: NuniAssignment | null): NuniAssignment {
  if (!saved) return item;
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

function Assignment({ item, workspace, reload, onConfirmed }: Props) {
  const classes = useClasses();
  const [saved, setSaved] = useState<NuniAssignment | null>(null);
  const assignment = latestAssignment(item, saved);
  const [submissions, setSubmissions] = useState<NuniSubmission[] | null>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closeNotice, setCloseNotice] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const mounted = useRef(true);
  const request = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const student = workspace.memberRole === 'student';
  const active = workspace.state === 'active';
  const open = assignment.state === 'open';

  async function readSubmissions() {
    const run = ++request.current;
    setError('');
    setReading(true);
    try {
      const result = await classes.submissions(workspace.id, item.id);
      if (mounted.current && run === request.current) setSubmissions(result);
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
      className={shared.panel}
      id={`assignment-${item.id}`}
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
            <time dateTime={assignment.dueAt}>
              {new Date(assignment.dueAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
            </time>
          </>
        ) : (
          '未設定參考期限'
        )}
      </p>
      {assignment.dueAt && active && open && (
        <p className={styles.note}>目前仍開放繳交；實際收件狀態以老師是否停止收件為準。</p>
      )}
      <CourseText text={assignment.instructions} />
      {!active && <p className={styles.note}>課程已封存，目前只能查看已保留的作業資料。</p>}
      {assignment.mySubmission && (
        <section className={shared.receipt} aria-label="我的繳交紀錄">
          <strong>已繳交</strong>
          <p>
            <time dateTime={assignment.mySubmission.submittedAt}>
              {new Date(assignment.mySubmission.submittedAt).toLocaleString('zh-TW', {
                timeZone: 'Asia/Taipei',
              })}
            </time>
          </p>
          <CourseText text={assignment.mySubmission.body} />
          {assignment.mySubmission.teacherFeedback ? (
            <div className={styles.feedback}>
              <h4>老師回饋</h4>
              <CourseText text={assignment.mySubmission.teacherFeedback} />
              {assignment.mySubmission.reviewedAt && (
                <p className={shared.muted}>
                  <time dateTime={assignment.mySubmission.reviewedAt}>
                    {new Date(assignment.mySubmission.reviewedAt).toLocaleString('zh-TW', {
                      timeZone: 'Asia/Taipei',
                    })}
                  </time>
                </p>
              )}
            </div>
          ) : (
            <p className={shared.muted}>老師尚未留下回饋。</p>
          )}
        </section>
      )}
      {student && active && open && (
        <details open={!assignment.mySubmission} className={`${shared.compose} ${styles.compose}`}>
          <summary>{assignment.mySubmission ? '修改繳交內容' : '繳交這份作業'}</summary>
          <MutationForm
            label={assignment.mySubmission ? '更新繳交內容' : '繳交作業'}
            success="繳交內容已儲存，老師現在可以查看。"
            submit={async (data, key) => {
              const result = await classes.submit(
                workspace.id,
                item.id,
                String(data.get('body') ?? ''),
                key,
              );
              if (!mounted.current) throw new NuniError(409, 'SESSION_CHANGED');
              setSaved(result);
              onConfirmed?.(result);
              reload();
            }}
          >
            <label>
              作業內容
              <textarea
                name="body"
                required
                maxLength={8000}
                defaultValue={assignment.mySubmission?.body ?? ''}
                placeholder="填寫內容，或附上作品連結。"
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
              <ul className={`${shared.list} ${styles.submissions}`}>
                {submissions.map((entry) => (
                  <FeedbackRow
                    key={entry.platformAccountId}
                    entry={entry}
                    save={async (feedback, key) => {
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
                      setSubmissions(
                        (previous) =>
                          previous?.map((value) =>
                            value.platformAccountId === receipt.platformAccountId ? receipt : value,
                          ) ?? [receipt],
                      );
                      return receipt;
                    }}
                  />
                ))}
              </ul>
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
  save,
}: {
  entry: NuniSubmission;
  save: (feedback: string, key: string) => Promise<NuniSubmission>;
}) {
  const [notice, setNotice] = useState('');
  const currentText = entry.teacherFeedback ?? '';
  const version = JSON.stringify([entry.teacherFeedback, entry.reviewedAt]);
  const [editor, setEditor] = useState({ version, original: currentText, text: currentText });
  const pristine = editor.text === editor.original;
  const draft = pristine ? currentText : editor.text;
  const changed = !pristine && editor.version !== version;
  const dispatched = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <li>
      <article aria-label={`${entry.displayName || '課程成員'}的繳交`}>
        <div className={styles.heading}>
          <h4>{entry.displayName || '課程成員'}</h4>
          <time className={styles.metadata} dateTime={entry.submittedAt}>
            {new Date(entry.submittedAt).toLocaleString('zh-TW')}
          </time>
        </div>
        <CourseText text={entry.body} />
        {entry.teacherFeedback && (
          <section className={styles.feedback} aria-label="目前老師回饋">
            <h5>目前回饋</h5>
            <CourseText text={entry.teacherFeedback} />
          </section>
        )}
        {notice && (
          <p role="status" className={shared.receipt}>
            {notice}
          </p>
        )}
        <details className={`${shared.compose} ${styles.compose}`}>
          <summary>{entry.teacherFeedback ? '編輯回饋' : '留下回饋'}</summary>
          <MutationForm
            label="儲存回饋"
            submit={async (data, key) => {
              if (changed && dispatched.current !== key)
                throw new NuniError(409, 'FEEDBACK_CHANGED');
              setNotice('');
              const feedback = String(data.get('feedback') ?? '');
              dispatched.current = key;
              const receipt = await save(feedback, key);
              if (!mounted.current) throw new NuniError(409, 'SESSION_CHANGED');
              const text = receipt.teacherFeedback ?? '';
              setEditor({
                version: JSON.stringify([receipt.teacherFeedback, receipt.reviewedAt]),
                original: text,
                text,
              });
              setNotice(
                receipt.teacherFeedback === feedback.trim()
                  ? '回饋已儲存，學生現在可以查看。'
                  : '這份回饋已有新的內容，上方顯示目前儲存的版本。',
              );
            }}
          >
            {changed && (
              <section className={styles.confirmation} aria-label="回饋內容已更新">
                <p role="alert">
                  這份回饋已有新的內容。你的草稿尚未儲存，請選擇接下來要編輯的內容。
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
    </li>
  );
}
