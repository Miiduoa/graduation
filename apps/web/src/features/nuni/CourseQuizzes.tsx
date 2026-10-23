'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  NuniError,
  nuniErrorMessage,
  type NuniQuiz,
  type NuniQuizResponse,
  type NuniUnit,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import {
  COURSE_WORK_MISSING_QUIZ,
  courseWorkElementId,
  landOnCourseWork,
  parseCourseWorkHash,
} from '@/lib/courseWorkLanding';
import { useLocationHash } from '@/lib/useLocationHash';
import { MutationForm, useClasses, type MutationFormIntent } from './CourseUI';
import { CourseUnitSelect } from './CourseUnitSelect';
import { selectCourseUnit } from './courseOutline';
import { CourseText } from './CourseMaterials';
import { matchesQuizFilter, quizStatus, type QuizFilter } from './courseTasks';
import {
  awaitingFeedbackPosition,
  feedbackQueueLabel,
  matchesFeedbackQueueFilter,
  needsFeedbackReview,
  nextAwaitingFeedbackReview,
  sortFeedbackQueue,
  type FeedbackQueueFilter,
} from '@campus/shared/src/lmsReviewQueue';
import {
  formatTaipeiDateTime,
  parseTaipeiInstant,
  taipeiWallTimeToIso,
} from '@campus/shared/src/taipeiTime';
import { useNuniSession } from './Session';
import styles from './NuniApp.module.css';
import quizStyles from './CourseQuizzes.module.css';

function dateLabel(value: string) {
  return formatTaipeiDateTime(value, { seconds: false });
}

/** Scoped so parallel mounted quizzes never collide on platformAccountId alone. */
export function quizReceiptDomId(
  workspaceId: string,
  quizId: string,
  platformAccountId: string,
): string {
  return `quiz-receipt-${workspaceId}-${quizId}-${platformAccountId}`;
}

function feedbackMatchesSubmitted(
  receipt: { teacherFeedback: string | null },
  submitted: string,
): boolean {
  return (receipt.teacherFeedback ?? '').trim() === submitted.trim();
}

export function CourseQuizzes({ workspace, units, onChanged }: { workspace: NuniWorkspace; units?: NuniUnit[] | null; onChanged?: () => void }) {
  const { session } = useNuniSession();
  if (!session) return <p role="status">請先登入，再查看課程測驗。</p>;
  return (
    <QuizList
      key={`${session.context}:${workspace.id}:${workspace.memberRole}:${workspace.state}`}
      workspace={workspace}
      units={units}
      onChanged={onChanged}
      accountId={session.platformAccountId}
    />
  );
}

function QuizList({ workspace, accountId, units, onChanged }: { workspace: NuniWorkspace; accountId: string; units?: NuniUnit[] | null; onChanged?: () => void }) {
  const classes = useClasses();
  const readClasses = useRef(classes);
  const { refresh } = useNuniSession();
  const headingId = useId();
  const [items, setItems] = useState<NuniQuiz[] | null>(null);
  const [reading, setReading] = useState(true);
  const [error, setError] = useState('');
  const [epoch, setEpoch] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<QuizFilter>('all');
  const hash = useLocationHash();
  const revealed = useRef('');
  const mounted = useRef(true);
  const readGeneration = useRef(0);
  const teacher = workspace.memberRole === 'owner-teacher' || workspace.memberRole === 'co-teacher';
  const writable = workspace.state === 'active';
  const filters: [QuizFilter, string][] = teacher
    ? [
        ['all', '全部'],
        ['received', '已收到作答'],
        ['open', '開放作答'],
      ]
    : [
        ['all', '全部'],
        ['pending', '待作答'],
        ['answered', '已作答'],
        ['feedback', '老師回饋'],
      ];
  const shown = items?.filter((item) => matchesQuizFilter(item, workspace, filter));
  useEffect(() => {
    const revealLinkedQuiz = () => {
      if (window.location.hash.startsWith('#quiz-')) setFilter('all');
    };
    window.addEventListener('hashchange', revealLinkedQuiz);
    return () => window.removeEventListener('hashchange', revealLinkedQuiz);
  }, []);
  const linked = parseCourseWorkHash(hash);
  const missingLinked =
    items !== null &&
    linked?.kind === 'quiz' &&
    !items.some((item) => item.id === linked.id);
  useEffect(() => {
    if (!linked || linked.kind !== 'quiz') return;
    const target = courseWorkElementId(linked.kind, linked.id);
    if (
      filter !== 'all' ||
      revealed.current === target ||
      !items?.some((item) => item.id === linked.id)
    )
      return;
    const frame = window.requestAnimationFrame(() => {
      if (landOnCourseWork(target)) revealed.current = target;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [filter, items, linked?.id, linked?.kind]);
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
    if (!teacher && item.myResponse && filter === 'pending') setFilter('answered');
    if (teacher && !items?.some((entry) => entry.id === item.id)) setFilter('all');
    onChanged?.();
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
              ? '查看學生作答與回饋。作答份數包含已回饋的內容。'
              : '選擇待作答的測驗；送出後可查看回答與老師回饋。'}
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
      {missingLinked ? (
        <p role="status" className={styles.notice}>
          {COURSE_WORK_MISSING_QUIZ}
        </p>
      ) : null}
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
      {items !== null && items.length > 0 && (
        <div className={styles.taskSummary}>
          <div className={styles.filters} role="group" aria-label="篩選測驗">
            {filters.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label} {items.filter((item) => matchesQuizFilter(item, workspace, value)).length}
              </button>
            ))}
          </div>
          {shown && shown.length > 0 ? (
            <nav aria-label="跳到測驗" className={styles.assignmentIndex}>
              {shown.map((item) => (
                <a key={item.id} href={`#quiz-${item.id}`}>
                  <span>{item.title}</span>
                  <small>{quizStatus(item, workspace)}</small>
                </a>
              ))}
            </nav>
          ) : (
            <p role="status" className={styles.note}>
              這個分類目前沒有測驗。選擇「全部」可查看其他內容。
            </p>
          )}
        </div>
      )}
      {items?.length === 0 && (
        <div className={styles.panel}>
          <p className={styles.muted}>
            {teacher ? '還沒有測驗。可以先發布一個文字題目。' : '老師還沒有發布測驗。'}
          </p>
        </div>
      )}
      {items?.map((item) => (
        // Keep drafts and uncertain submissions mounted when switching task filters.
        <div key={item.id} hidden={!matchesQuizFilter(item, workspace, filter)}>
          <Quiz item={item} workspace={workspace} acceptQuiz={acceptQuiz} now={now} />
        </div>
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
                dueAt: taipeiWallTimeToIso(due),
                unitId: units === undefined ? undefined : selectCourseUnit(form, units),
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
            {units !== undefined && <CourseUnitSelect units={units} />}
            <label>
              建議完成時間（選填）
              <input name="dueAt" type="datetime-local" />
            </label>
            <p className={styles.muted}>
              時間依台北時間顯示。時間到了仍可作答；需要停止收件時，請使用「結束測驗」。
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
  const [feedbackFilter, setFeedbackFilter] = useState<FeedbackQueueFilter>('needs_feedback');
  const [focusReceiptId, setFocusReceiptId] = useState<string | null>(null);
  const [queueNotice, setQueueNotice] = useState('');
  const mounted = useRef(true);
  const readGeneration = useRef(0);
  const readLocked = useRef(false);
  const responsesRef = useRef<NuniQuizResponse[] | null>(null);
  const receiptNodes = useRef(new Map<string, HTMLElement | null>());
  const closeAttempts = useRef(new Set<string>());
  const currentAnswer = item.myResponse?.answer ?? '';
  const answerVersion = JSON.stringify([item.myResponse?.answer, item.myResponse?.submittedAt]);
  const [answerEditor, setAnswerEditor] = useState({
    version: answerVersion,
    original: currentAnswer,
    text: currentAnswer,
  });
  const answerPristine = answerEditor.text === answerEditor.original;
  const answerDraft = answerPristine ? currentAnswer : answerEditor.text;
  const answerChanged = !answerPristine && answerEditor.version !== answerVersion;
  const answerDispatched = useRef<string | null>(null);
  const [answerNotice, setAnswerNotice] = useState('');
  const teacher = workspace.memberRole === 'owner-teacher' || workspace.memberRole === 'co-teacher';
  const writable = workspace.state === 'active';
  const student = workspace.memberRole === 'student';
  const dueAtMs = item.dueAt ? parseTaipeiInstant(item.dueAt) : null;
  const passedDue = dueAtMs !== null && dueAtMs < now;
  const FEEDBACK_FILTERS: FeedbackQueueFilter[] = ['all', 'needs_feedback', 'reviewed'];
  const orderedResponses = responses === null ? null : sortFeedbackQueue(responses);
  const visibleResponseCount =
    orderedResponses?.filter((entry) => matchesFeedbackQueueFilter(entry, feedbackFilter)).length ??
    0;
  useEffect(() => {
    responsesRef.current = responses;
  }, [responses]);
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
  }, [focusReceiptId, orderedResponses, feedbackFilter]);

  const readResponses = async () => {
    if (readLocked.current) return;
    readLocked.current = true;
    const run = ++readGeneration.current;
    setReading(true);
    setError('');
    try {
      const result = await classes.quizResponses(workspace.id, item.id);
      if (mounted.current && run === readGeneration.current) {
        setResponses(result);
        setFeedbackFilter(
          result.some((entry) => needsFeedbackReview(entry)) ? 'needs_feedback' : 'all',
        );
      }
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
    <article
      className={`${styles.panel} ${styles.courseWorkTarget}`}
      id={`quiz-${item.id}`}
      tabIndex={-1}
      aria-label={`測驗：${item.title}`}
    >
      <div className={quizStyles.title}>
        <h3>{item.title}</h3>
        <span className={quizStyles.state}>
          {!writable ? '課程已封存' : item.state === 'closed' ? '已結束' : '開放作答'}
        </span>
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
      <CourseText text={item.prompt} />
      {student && item.myResponse && (
        <div className={styles.receipt}>
          <strong>已送出作答</strong>
          <p>
            <time dateTime={item.myResponse.submittedAt}>
              {dateLabel(item.myResponse.submittedAt)}
            </time>
          </p>
          <CourseText text={item.myResponse.answer} />
          {item.myResponse.teacherFeedback ? (
            <>
              <h4>老師回饋</h4>
              <CourseText text={item.myResponse.teacherFeedback} />
              {item.myResponse.reviewedAt &&
                needsFeedbackReview(item.myResponse) && (
                  <p className={styles.note}>這則回饋早於最近一次繳交，請老師確認是否仍適用。</p>
                )}
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
      {answerNotice && (
        <p role="status" className={styles.receipt}>
          {answerNotice}
        </p>
      )}
      {student && writable && item.state === 'open' && (
        <>
          {passedDue && (
            <p className={styles.note}>已過建議完成時間，老師尚未結束測驗，目前仍可送出作答。</p>
          )}
          <MutationForm
            label={item.myResponse ? '更新回答' : '送出作答'}
            submit={async (form, key) => {
              if (form.get('confirm') !== 'yes') throw new NuniError(422, 'CONFIRMATION_REQUIRED');
              if (answerChanged && answerDispatched.current !== key)
                throw new NuniError(409, 'ANSWER_CHANGED');
              setAnswerNotice('');
              const submitted = String(form.get('answer') || '').trim();
              const updating = !!item.myResponse;
              answerDispatched.current = key;
              const result = await classes.submitQuiz(workspace.id, item.id, submitted, key);
              if (!mounted.current) return;
              const receipt = result.myResponse!;
              setAnswerEditor({
                version: JSON.stringify([receipt.answer, receipt.submittedAt]),
                original: receipt.answer,
                text: receipt.answer,
              });
              setAnswerNotice(
                receipt.answer !== submitted
                  ? '已確認送出結果，上方顯示目前儲存的回答。'
                  : updating
                    ? '回答已更新。'
                    : '作答已送出。',
              );
              acceptQuiz(result);
            }}
          >
            {answerChanged && (
              <section className={styles.note} aria-label="回答內容已更新">
                <p role="alert">回答已有新的內容。你的草稿尚未送出，請選擇接下來要編輯的內容。</p>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.secondary}`}
                    onClick={() =>
                      setAnswerEditor({
                        version: answerVersion,
                        original: currentAnswer,
                        text: currentAnswer,
                      })
                    }
                  >
                    改用目前回答
                  </button>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.secondary}`}
                    onClick={() =>
                      setAnswerEditor({
                        version: answerVersion,
                        original: currentAnswer,
                        text: answerDraft,
                      })
                    }
                  >
                    保留草稿，送出時取代
                  </button>
                </div>
              </section>
            )}
            <label>
              你的回答
              <textarea
                name="answer"
                required
                maxLength={2000}
                value={answerDraft}
                onChange={(event) => {
                  setAnswerEditor({
                    version: answerPristine ? answerVersion : answerEditor.version,
                    original: answerPristine ? currentAnswer : answerEditor.original,
                    text: event.target.value,
                  });
                  setAnswerNotice('');
                }}
              />
            </label>
            <p className={styles.muted}>老師結束測驗前，可以更新回答。更新會取代目前儲存的內容。</p>
            <label className={quizStyles.confirmation}>
              <input name="confirm" type="checkbox" value="yes" required />
              <span>我已檢查回答，確認送出這份內容。</span>
            </label>
          </MutationForm>
        </>
      )}
      {teacher && (
        <>
          <div className={styles.actions}>
            <span className={styles.muted}>{responses?.length ?? item.responseCount} 份作答</span>
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
              <div>
                <div className={styles.filters} role="group" aria-label="篩選回饋狀態">
                  {FEEDBACK_FILTERS.map((value) => {
                    const count = responses.filter((entry) =>
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
                <p className={styles.muted}>
                  預設先看尚未回饋的作答。儲存後，學生才看得到。
                </p>
                {queueNotice ? (
                  <p role="status" className={styles.receipt}>
                    {queueNotice}
                  </p>
                ) : null}
                {visibleResponseCount === 0 ? (
                  <p role="status" className={styles.muted}>
                    「{feedbackQueueLabel(feedbackFilter)}」目前沒有作答。可改選「全部」查看其他狀態。
                  </p>
                ) : null}
                <ul className={styles.list}>
                  {(orderedResponses ?? []).map((entry) => (
                    <QuizFeedbackRow
                      key={entry.platformAccountId}
                      entry={entry}
                      workspaceId={workspace.id}
                      quizId={item.id}
                      queue={orderedResponses ?? []}
                      expanded={focusReceiptId === entry.platformAccountId}
                      hidden={!matchesFeedbackQueueFilter(entry, feedbackFilter)}
                      writable={writable}
                      rowRef={(node) => {
                        if (node) receiptNodes.current.set(entry.platformAccountId, node);
                        else receiptNodes.current.delete(entry.platformAccountId);
                      }}
                      save={async (feedback, key, intent) => {
                        const updated = await classes.quizFeedback(
                          workspace.id,
                          item.id,
                          entry.platformAccountId,
                          feedback,
                          key,
                        );
                        if (!mounted.current) throw new NuniError(409, 'SESSION_CHANGED');
                        const latest = (responsesRef.current ?? []).map((row) =>
                          row.platformAccountId === updated.platformAccountId ? updated : row,
                        );
                        const nextList = latest.length ? latest : [updated];
                        responsesRef.current = nextList;
                        updateResponse(updated);
                        setResponses(nextList);
                        const matched = feedbackMatchesSubmitted(updated, feedback);
                        if (intent === 'secondary') {
                          if (!matched) {
                            setFocusReceiptId(entry.platformAccountId);
                            setFeedbackFilter((current) =>
                              matchesFeedbackQueueFilter(updated, current) ? current : 'all',
                            );
                            setQueueNotice('');
                            return updated;
                          }
                          const next = nextAwaitingFeedbackReview(
                            nextList,
                            updated.platformAccountId,
                          );
                          if (!next) {
                            setFocusReceiptId(null);
                            setFeedbackFilter((current) =>
                              matchesFeedbackQueueFilter(updated, current) ? current : 'all',
                            );
                            setQueueNotice('回饋已儲存。目前沒有下一份尚未回饋的作答。');
                          } else {
                            setFeedbackFilter('needs_feedback');
                            setFocusReceiptId(next.platformAccountId);
                            setQueueNotice(
                              `回饋已儲存。已移到 ${next.displayName || '下一位同學'} 的作答。`,
                            );
                          }
                          return updated;
                        }
                        setQueueNotice('');
                        setFocusReceiptId(null);
                        setFeedbackFilter((current) =>
                          matchesFeedbackQueueFilter(updated, current) ? current : 'all',
                        );
                        return updated;
                      }}
                    />
                  ))}
                </ul>
              </div>
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
  workspaceId,
  quizId,
  queue,
  expanded,
  hidden,
  writable,
  rowRef,
  save,
}: {
  entry: NuniQuizResponse;
  workspaceId: string;
  quizId: string;
  queue: NuniQuizResponse[];
  expanded: boolean;
  hidden: boolean;
  writable: boolean;
  rowRef: (node: HTMLLIElement | null) => void;
  save: (
    feedback: string,
    key: string,
    intent: MutationFormIntent,
  ) => Promise<NuniQuizResponse>;
}) {
  const [notice, setNotice] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const detailsOpen = expanded || manualOpen;
  const currentText = entry.teacherFeedback ?? '';
  const version = JSON.stringify([
    entry.answer,
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
    <li
      className={quizStyles.response}
      hidden={hidden}
      id={quizReceiptDomId(workspaceId, quizId, entry.platformAccountId)}
      ref={rowRef}
    >
      <p>
        <strong>{entry.displayName || '課程成員'}</strong> ·{' '}
        <time dateTime={entry.submittedAt}>{dateLabel(entry.submittedAt)}</time>
      </p>
      {position ? (
        <p className={styles.muted}>
          待回饋第 {position.index}／{position.total} 份
          {expanded ? ' · 目前批改這一份' : ''}
        </p>
      ) : expanded ? (
        <p className={styles.muted}>目前批改這一份</p>
      ) : null}
      <CourseText text={entry.answer} />
      {entry.teacherFeedback && (
        <div className={styles.receipt}>
          <strong>已儲存的回饋</strong>
          <CourseText text={entry.teacherFeedback} />
          {entry.reviewedAt && needsFeedbackReview(entry) && (
            <p className={styles.note}>這則回饋早於最近一次繳交，請老師確認是否仍適用。</p>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className={styles.receipt}>
          {notice}
        </p>
      )}
      {writable && (
        <details
          className={quizStyles.feedback}
          open={detailsOpen}
          onToggle={(event) => {
            if (expanded) {
              event.currentTarget.open = true;
              return;
            }
            setManualOpen(event.currentTarget.open);
          }}
        >
          <summary>{entry.teacherFeedback ? '修改回饋' : '填寫回饋'}</summary>
          <MutationForm
            label="儲存回饋"
            secondaryLabel="儲存回饋並查看下一份"
            submit={async (form, key, intent) => {
              if (changed && dispatched.current !== key)
                throw new NuniError(409, 'FEEDBACK_CHANGED');
              setNotice('');
              const feedback = String(form.get('feedback') || '').trim();
              dispatched.current = key;
              const receipt = await save(feedback, key, intent);
              if (!mounted.current) throw new NuniError(409, 'SESSION_CHANGED');
              const text = receipt.teacherFeedback ?? '';
              setEditor({
                version: JSON.stringify([
                  receipt.answer,
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
              <section className={styles.note} aria-label="回饋內容已更新">
                <p role="alert">
                  學生回答或老師回饋已有更新。你的草稿尚未儲存，請先核對新內容，再選擇接下來要編輯的內容。
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
