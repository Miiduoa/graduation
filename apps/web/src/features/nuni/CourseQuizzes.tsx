'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  NuniError,
  nuniErrorMessage,
  type NuniQuiz,
  type NuniQuizResponse,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import { MutationForm, useClasses } from './CourseUI';
import { useNuniSession } from './Session';
import styles from './NuniApp.module.css';
import quizStyles from './CourseQuizzes.module.css';

function dateLabel(value: string) {
  return new Date(value).toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' });
}

export function CourseQuizzes({ workspace }: { workspace: NuniWorkspace }) {
  const { session } = useNuniSession();
  if (!session) return <p role="status">請先登入，再查看課程測驗。</p>;
  return (
    <QuizList
      key={`${session.context}:${workspace.id}:${workspace.memberRole}:${workspace.state}`}
      workspace={workspace}
      accountId={session.platformAccountId}
    />
  );
}

function QuizList({ workspace, accountId }: { workspace: NuniWorkspace; accountId: string }) {
  const classes = useClasses();
  const readClasses = useRef(classes);
  const { refresh } = useNuniSession();
  const headingId = useId();
  const [items, setItems] = useState<NuniQuiz[] | null>(null);
  const [reading, setReading] = useState(true);
  const [error, setError] = useState('');
  const [epoch, setEpoch] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);
  const readGeneration = useRef(0);
  const teacher = workspace.memberRole === 'owner-teacher' || workspace.memberRole === 'co-teacher';
  const writable = workspace.state === 'active';
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const validateOwnResponse = useCallback(
    (item: NuniQuiz) => {
      if (item.myResponse && item.myResponse.platformAccountId !== accountId) {
        throw new NuniError(502, 'INVALID_RESPONSE');
      }
    },
    [accountId],
  );
  useEffect(() => {
    let active = true;
    const run = ++readGeneration.current;
    void readClasses.current
      .quizzes(workspace.id)
      .then((result) => {
        if (!active || !mounted.current || run !== readGeneration.current) return;
        result.forEach(validateOwnResponse);
        setItems(result);
      })
      .catch((failure) => {
        if (!active || !mounted.current || run !== readGeneration.current) return;
        setError(nuniErrorMessage(failure));
        if (
          failure instanceof NuniError &&
          (failure.status === 401 || failure.code === 'SESSION_CHANGED')
        )
          void refresh();
      })
      .finally(() => {
        if (active && mounted.current && run === readGeneration.current) setReading(false);
      });
    return () => {
      active = false;
    };
    // Session, role and workspace changes remount this view; refresh preserves pending forms.
  }, [epoch, refresh, validateOwnResponse, workspace.id]);

  const reload = () => {
    setReading(true);
    setError('');
    setEpoch((value) => value + 1);
  };

  const acceptQuiz = (item: NuniQuiz) => {
    if (!mounted.current) return;
    validateOwnResponse(item);
    ++readGeneration.current;
    setReading(false);
    setError('');
    setItems((previous) =>
      previous?.some((entry) => entry.id === item.id)
        ? previous.map((entry) => (entry.id === item.id ? item : entry))
        : [item, ...(previous || [])],
    );
  };

  return (
    <section aria-labelledby={headingId}>
      <div className={quizStyles.heading}>
        <div>
          <h2 id={headingId}>測驗</h2>
          <p className={styles.muted}>
            {teacher
              ? '發布文字題目，查看學生作答並留下回饋。'
              : '閱讀題目、整理想法，送出後在這裡查看老師回饋。'}
          </p>
        </div>
        <button
          className={`${styles.button} ${styles.secondary}`}
          disabled={reading}
          onClick={reload}
        >
          {reading ? '讀取中…' : '更新測驗'}
        </button>
      </div>
      {!writable && (
        <p className={styles.note}>課程已封存，這裡僅供查看已發布的測驗與自己的作答。</p>
      )}
      {error && (
        <div className={styles.notice} role="alert">
          {error}
          <button
            className={`${styles.button} ${styles.secondary}`}
            disabled={reading}
            onClick={reload}
          >
            重新讀取測驗
          </button>
        </div>
      )}
      {reading && <p role="status">正在讀取測驗…</p>}
      {items?.length === 0 && (
        <div className={styles.panel}>
          <p className={styles.muted}>
            {teacher ? '還沒有測驗。可以先發布一個文字題目。' : '老師還沒有發布測驗。'}
          </p>
        </div>
      )}
      {items?.map((item) => (
        <Quiz key={item.id} item={item} workspace={workspace} acceptQuiz={acceptQuiz} now={now} />
      ))}
      {teacher && writable && items !== null && (
        <details className={`${styles.panel} ${styles.compose}`}>
          <summary>發布文字測驗</summary>
          <MutationForm
            label="發布測驗"
            success="測驗已發布。"
            submit={async (form, key) => {
              const due = String(form.get('dueAt') || '');
              if (due && !Number.isFinite(Date.parse(due)))
                throw new NuniError(422, 'INVALID_DUE_DATE');
              const item = await classes.createQuiz(workspace.id, {
                title: String(form.get('title') || '').trim(),
                prompt: String(form.get('prompt') || '').trim(),
                dueAt: due ? new Date(due).toISOString() : null,
                idempotencyKey: key,
              });
              acceptQuiz(item);
            }}
          >
            <label>
              測驗名稱
              <input name="title" required maxLength={160} />
            </label>
            <label>
              題目
              <textarea
                name="prompt"
                required
                maxLength={4000}
                placeholder="寫下希望學生回答的問題，以及需要說明的重點。"
              />
            </label>
            <label>
              建議完成時間（選填）
              <input name="dueAt" type="datetime-local" />
            </label>
            <p className={styles.muted}>
              時間依目前裝置時區顯示。時間到了仍可作答；需要停止收件時，請使用「結束測驗」。
            </p>
          </MutationForm>
        </details>
      )}
    </section>
  );
}

function Quiz({
  item,
  workspace,
  acceptQuiz,
  now,
}: {
  item: NuniQuiz;
  workspace: NuniWorkspace;
  acceptQuiz: (item: NuniQuiz) => void;
  now: number;
}) {
  const classes = useClasses();
  const [responses, setResponses] = useState<NuniQuizResponse[] | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const readGeneration = useRef(0);
  const readLocked = useRef(false);
  const closeAttempts = useRef(new Set<string>());
  const teacher = workspace.memberRole === 'owner-teacher' || workspace.memberRole === 'co-teacher';
  const writable = workspace.state === 'active';
  const student = workspace.memberRole === 'student';
  const passedDue = item.dueAt !== null && Date.parse(item.dueAt) < now;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const readResponses = async () => {
    if (readLocked.current) return;
    readLocked.current = true;
    const run = ++readGeneration.current;
    setReading(true);
    setError('');
    try {
      const result = await classes.quizResponses(workspace.id, item.id);
      if (mounted.current && run === readGeneration.current) setResponses(result);
    } catch (failure) {
      if (mounted.current && run === readGeneration.current) setError(nuniErrorMessage(failure));
    } finally {
      readLocked.current = false;
      if (mounted.current && run === readGeneration.current) setReading(false);
    }
  };
  const updateResponse = (entry: NuniQuizResponse) => {
    if (!mounted.current) return;
    ++readGeneration.current;
    setReading(false);
    setResponses(
      (previous) =>
        previous?.map((row) => (row.platformAccountId === entry.platformAccountId ? entry : row)) ||
        null,
    );
  };
  const findClosed = async () => {
    const latest = await classes.quizzes(workspace.id);
    if (!mounted.current) return true;
    const quiz = latest.find((candidate) => candidate.id === item.id);
    if (!quiz) throw new NuniError(404, 'QUIZ_NOT_FOUND');
    if (quiz.state === 'closed') {
      acceptQuiz(quiz);
      return true;
    }
    return false;
  };

  return (
    <article className={styles.panel} aria-label={`測驗：${item.title}`}>
      <div className={quizStyles.title}>
        <h3>{item.title}</h3>
        <span className={quizStyles.state}>{item.state === 'closed' ? '已結束' : '開放作答'}</span>
      </div>
      {item.unitTitle && <p className={styles.muted}>章節：{item.unitTitle}</p>}
      <p className={styles.muted}>
        {item.dueAt ? (
          <>
            建議完成時間：<time dateTime={item.dueAt}>{dateLabel(item.dueAt)}</time>
            {passedDue && '（已過時間）'}
          </>
        ) : (
          '未設定建議完成時間'
        )}
      </p>
      <p className={styles.prose}>{item.prompt}</p>
      {student && item.myResponse && (
        <div className={styles.receipt}>
          <strong>已送出作答</strong>
          <p>
            <time dateTime={item.myResponse.submittedAt}>
              {dateLabel(item.myResponse.submittedAt)}
            </time>
          </p>
          <p className={styles.prose}>{item.myResponse.answer}</p>
          {item.myResponse.teacherFeedback ? (
            <>
              <h4>老師回饋</h4>
              <p className={styles.prose}>{item.myResponse.teacherFeedback}</p>
              {item.myResponse.reviewedAt && (
                <p className={styles.muted}>
                  回饋時間：
                  <time dateTime={item.myResponse.reviewedAt}>
                    {dateLabel(item.myResponse.reviewedAt)}
                  </time>
                </p>
              )}
            </>
          ) : (
            <p className={styles.muted}>老師尚未留下回饋。</p>
          )}
        </div>
      )}
      {student && !item.myResponse && item.state === 'closed' && (
        <p className={styles.note}>這份測驗已結束，沒有你的作答紀錄。</p>
      )}
      {student && writable && item.state === 'open' && !item.myResponse && (
        <>
          {passedDue && (
            <p className={styles.note}>已過建議完成時間，老師尚未結束測驗，目前仍可送出作答。</p>
          )}
          <MutationForm
            label="送出作答"
            submit={async (form, key) => {
              if (form.get('confirm') !== 'yes') throw new NuniError(422, 'CONFIRMATION_REQUIRED');
              const result = await classes.submitQuiz(
                workspace.id,
                item.id,
                String(form.get('answer') || '').trim(),
                key,
              );
              if (mounted.current) acceptQuiz(result);
            }}
          >
            <label>
              你的回答
              <textarea name="answer" required maxLength={2000} />
            </label>
            <label className={quizStyles.confirmation}>
              <input name="confirm" type="checkbox" value="yes" required />
              <span>我已檢查回答，確認送出。送出後此頁會保留紀錄，不再提供編輯。</span>
            </label>
          </MutationForm>
        </>
      )}
      {teacher && (
        <>
          <div className={styles.actions}>
            <span className={styles.muted}>{item.responseCount} 份作答</span>
            {writable && (
              <button
                className={`${styles.button} ${styles.secondary}`}
                disabled={reading}
                onClick={() => void readResponses()}
              >
                {reading ? '讀取作答中…' : responses ? '更新作答' : '查看作答'}
              </button>
            )}
          </div>
          {!writable && (
            <p className={styles.muted}>
              封存課程目前不提供作答名單；如需查閱，請先由課程管理者確認課程狀態。
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {reading && <p role="status">正在讀取學生作答…</p>}
          {responses &&
            (responses.length ? (
              <ul className={styles.list}>
                {responses.map((entry) => (
                  <QuizFeedbackRow
                    key={entry.platformAccountId}
                    entry={entry}
                    writable={writable}
                    save={async (feedback, key) => {
                      const updated = await classes.quizFeedback(
                        workspace.id,
                        item.id,
                        entry.platformAccountId,
                        feedback,
                        key,
                      );
                      if (!mounted.current) throw new NuniError(409, 'SESSION_CHANGED');
                      updateResponse(updated);
                      return updated;
                    }}
                  />
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>尚未收到作答。</p>
            ))}
          {writable && item.state === 'open' && (
            <details className={quizStyles.close}>
              <summary>結束測驗</summary>
              <MutationForm
                label="確認結束測驗"
                submit={async (form, key) => {
                  if (form.get('confirmClose') !== 'yes')
                    throw new NuniError(422, 'CONFIRMATION_REQUIRED');
                  if (closeAttempts.current.has(key) && (await findClosed())) return;
                  if (!mounted.current) return;
                  closeAttempts.current.add(key);
                  try {
                    const result = await classes.closeQuiz(workspace.id, item.id);
                    if (mounted.current) acceptQuiz(result);
                  } catch (failure) {
                    if (
                      failure instanceof NuniError &&
                      failure.status === 409 &&
                      (await findClosed())
                    )
                      return;
                    throw failure;
                  }
                }}
              >
                <p className={styles.muted}>
                  結束後學生無法再送出作答。已送出的內容會保留，老師仍可查看並留下回饋。
                </p>
                <label className={quizStyles.confirmation}>
                  <input name="confirmClose" type="checkbox" value="yes" required />
                  <span>我確認結束這份測驗。</span>
                </label>
              </MutationForm>
            </details>
          )}
        </>
      )}
    </article>
  );
}

function QuizFeedbackRow({
  entry,
  writable,
  save,
}: {
  entry: NuniQuizResponse;
  writable: boolean;
  save: (feedback: string, key: string) => Promise<NuniQuizResponse>;
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
    <li className={quizStyles.response}>
      <p>
        <strong>{entry.displayName || '課程成員'}</strong> ·{' '}
        <time dateTime={entry.submittedAt}>{dateLabel(entry.submittedAt)}</time>
      </p>
      <p className={styles.prose}>{entry.answer}</p>
      {entry.teacherFeedback && (
        <div className={styles.receipt}>
          <strong>已儲存的回饋</strong>
          <p className={styles.prose}>{entry.teacherFeedback}</p>
        </div>
      )}
      {notice && (
        <p role="status" className={styles.receipt}>
          {notice}
        </p>
      )}
      {writable && (
        <details className={quizStyles.feedback}>
          <summary>{entry.teacherFeedback ? '修改回饋' : '填寫回饋'}</summary>
          <MutationForm
            label="儲存回饋"
            submit={async (form, key) => {
              if (changed && dispatched.current !== key)
                throw new NuniError(409, 'FEEDBACK_CHANGED');
              setNotice('');
              const feedback = String(form.get('feedback') || '').trim();
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
                receipt.teacherFeedback === feedback
                  ? '回饋已儲存，學生現在可以查看。'
                  : '這份回饋已有新的內容，上方顯示目前儲存的版本。',
              );
            }}
          >
            {changed && (
              <section className={styles.note} aria-label="回饋內容已更新">
                <p role="alert">
                  這份回饋已有新的內容。你的草稿尚未儲存，請選擇接下來要編輯的內容。
                </p>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.secondary}`}
                    onClick={() => {
                      setEditor({ version, original: currentText, text: currentText });
                      setNotice('');
                    }}
                  >
                    改用目前回饋
                  </button>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.secondary}`}
                    onClick={() => setEditor({ version, original: currentText, text: draft })}
                  >
                    保留草稿，儲存時覆寫
                  </button>
                </div>
              </section>
            )}
            <label>
              給 {entry.displayName || '課程成員'} 的回饋
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
              />
            </label>
          </MutationForm>
        </details>
      )}
    </li>
  );
}
