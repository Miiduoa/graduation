'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { SchoolAccountRequired } from '@/components/SchoolAccountRequired';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { useAuth } from '@/components/AuthGuard';
import { useSelectedSchool } from '@/components/SelectedSchoolProvider';
import { useDemoRole } from '@/lib/demoRole';
import { isLeaveBackendAvailable } from '@/lib/leaveWebApi';
import {
  LEAVE_COPY,
  initialLeavePageView,
  leavePageFailureFromError,
  leavePageSuccess,
  withLeaveLoadTimeout,
  type LeavePageView,
} from '@/lib/leavePageState';
import {
  LEAVE_PERIODS, LEAVE_REVIEWS, LEAVE_STATUSES, countLeaveReviews,
  formatLeaveRange, leaveKindLabel, leaveRequestError,
  listLeaveReviewQueue, reviewLeaveRequest, type LeaveReviewRow,
} from '@/lib/leaveRequests';
import { LeaveStatusPanel } from '../LeaveStatusPanel';
import styles from '../leave.module.css';

type ReviewFilter = 'pending' | 'all' | 'reviewed';

export default function LeaveReviewPage() {
  const { user, loading: authLoading } = useAuth();
  const school = useSelectedSchool();
  const [demoRole] = useDemoRole();
  if (authLoading) {
    return <SiteShell title="請假核閱"><p role="status">正在確認學校帳號…</p></SiteShell>;
  }
  if (school.loading || !school.selectedSchoolId) {
    return <SiteShell title="請假核閱"><SchoolScopePlaceholder /></SiteShell>;
  }
  if (!user) {
    return (
      <SiteShell title="請假核閱" schoolName={school.selectedSchool?.name}>
        <SchoolAccountRequired
          returnUrl="/leave/review"
          alternative="此處只提供已獲校方指派課程之教師或學校管理者使用。"
        />
      </SiteShell>
    );
  }
  return (
    <ReviewWorkspace
      key={user.uid + ':' + school.selectedSchoolId + ':' + demoRole}
      uid={user.uid}
      schoolId={school.selectedSchoolId}
      schoolName={school.selectedSchool?.name || '目前學校'}
    />
  );
}

function ReviewWorkspace({ uid, schoolId, schoolName }: {
  uid: string; schoolId: string; schoolName: string;
}) {
  const [view, setView] = useState<LeavePageView<LeaveReviewRow[]>>(() =>
    initialLeavePageView(isLeaveBackendAvailable()),
  );
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<ReviewFilter>('pending');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState('');
  const currentRef = useRef(true);
  const lockedRef = useRef(false);

  const load = useCallback(async () => {
    if (!isLeaveBackendAvailable()) {
      setView({ status: 'unavailable' });
      return;
    }
    setView((current) =>
      current.status === 'empty' || current.status === 'ready' ? current : { status: 'loading' },
    );
    try {
      const result = await withLeaveLoadTimeout(listLeaveReviewQueue(uid, schoolId));
      if (!currentRef.current) return;
      setView(leavePageSuccess(result, result.length === 0));
    } catch (cause) {
      if (currentRef.current) setView(leavePageFailureFromError(cause));
    }
  }, [uid, schoolId]);

  useEffect(() => {
    currentRef.current = true;
    if (isLeaveBackendAvailable()) void Promise.resolve().then(load);
    return () => { currentRef.current = false; };
  }, [load]);

  const rows = view.status === 'empty' || view.status === 'ready' ? view.data : [];
  const showQueue = view.status === 'empty' || view.status === 'ready';
  const pending = rows.reduce(
    (total, row) => total + row.courses.filter((course) => course.reviewStatus === 'pending').length,
    0,
  );
  const reviewed = rows.reduce(
    (total, row) => total + countLeaveReviews(row.courses).approved + countLeaveReviews(row.courses).rejected,
    0,
  );
  const filtered = rows.filter((row) => {
    if (filter === 'pending') return row.status !== 'withdrawn' &&
      row.courses.some((course) => course.reviewStatus === 'pending');
    if (filter === 'reviewed') return row.courses.some((course) => course.reviewStatus !== 'pending');
    return true;
  });

  async function decide(
    requestId: string, courseId: string, decision: 'approved' | 'rejected',
  ) {
    if (lockedRef.current) return;
    const key = requestId + ':' + courseId;
    const note = (notes[key] || '').trim();
    if (decision === 'rejected' && note.length < 2) {
      setNotice('不同意時，請先填寫至少兩個字的原因，讓學生清楚知道下一步。');
      return;
    }
    lockedRef.current = true;
    setBusyKey(key);
    setNotice('');
    try {
      await reviewLeaveRequest(uid, requestId, courseId, decision, note);
      if (!currentRef.current) return;
      setNotes((prev) => { const next = { ...prev }; delete next[key]; return next; });
      setNotice(decision === 'approved' ? '已記錄這門課的站內核閱同意。' : '已記錄這門課的站內不同意結果及說明。');
      await load();
    } catch (cause) {
      if (currentRef.current) setNotice(leaveRequestError(cause));
    } finally {
      if (currentRef.current) {
        lockedRef.current = false;
        setBusyKey('');
      }
    }
  }

  return (
    <SiteShell title="請假核閱" schoolName={schoolName} subtitle="依授課權限逐門處理，不會代替學校正式請假審核。">
      <div className={styles.workspace}>
        <section className={styles.intro}>
          <div>
            <p className={styles.kicker}>REVIEW DESK</p>
            <h2>只處理自己負責的課。</h2>
            <p>學生跨多門課提出的申請，會拆成各門課的獨立核閱。你只能查看被指派課程的內容；所有操作都會留下時間與處理人紀錄。</p>
          </div>
          <div className={styles.official}>
            <span>操作範圍</span>
            <strong>Campus One 站內課程核閱</strong>
            <Link href="/leave">返回學生請假頁 ↗</Link>
          </div>
        </section>

        <LeaveStatusPanel
          kind="review"
          view={view}
          loginHref={'/login?returnUrl=' + encodeURIComponent('/leave/review')}
          onRetry={() => void load()}
        />

        {showQueue && (
          <>
            <div className={styles.stats} aria-label="請假核閱概況">
              <div><span>待核閱課程</span><strong>{pending}</strong></div>
              <div><span>已核閱課程</span><strong>{reviewed}</strong></div>
              <div><span>可見假單</span><strong>{rows.length}</strong></div>
            </div>
            {notice && <p className={styles.notice} role="status" aria-live="polite">{notice}</p>}
            <section className={styles.reviewPanel} aria-labelledby="review-queue-title">
              <div className={styles.sectionHead}>
                <div>
                  <p className={styles.kicker}>COURSE REQUESTS</p>
                  <h2 id="review-queue-title">待辦與核閱紀錄</h2>
                </div>
                <button className={styles.refresh} type="button" disabled={Boolean(busyKey)} onClick={() => void load()}>更新清單</button>
              </div>
              <div className={styles.filters} role="group" aria-label="篩選請假核閱">
                {([['pending', '待處理'], ['all', '全部'], ['reviewed', '已核閱']] as const).map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
                ))}
              </div>
              {filtered.length === 0 ? (
                <div className={styles.empty}>
                  <strong>{view.status === 'empty' || filter === 'pending' ? LEAVE_COPY.emptyReview : '這個狀態沒有紀錄'}</strong>
                  <p>{LEAVE_COPY.emptyReviewHint}</p>
                </div>
              ) : (
                <div className={styles.reviewGrid}>
                  {filtered.map((request) => (
                    <article className={styles.reviewCard} key={request.id}>
                      <div className={styles.requestHead}>
                        <span className={request.status === 'withdrawn' ? styles.mutedBadge : styles.statusBadge}>{LEAVE_STATUSES[request.status] || '處理中'}</span>
                        <span>{request.createdAt ? new Date(request.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '待確認送出時間'}</span>
                      </div>
                      <h3>{request.studentName} · {leaveKindLabel(request.kind)} · {formatLeaveRange(request.startDate, request.endDate)}</h3>
                      <div className={styles.reviewMeta}>
                        <span>{LEAVE_PERIODS.find((item) => item.id === request.period)?.label || '全天'}</span>
                        <span>{request.courses.length} 門可核閱課程</span>
                      </div>
                      {request.detail && <p className={styles.reviewReason}>{request.detail}</p>}
                      {request.courses.map((course) => {
                        const key = request.id + ':' + course.courseId;
                        const editable = course.reviewStatus === 'pending' && request.status !== 'withdrawn';
                        return (
                          <div className={styles.reviewCourse} key={course.courseId}>
                            <div><strong>{course.courseName}</strong><span>{LEAVE_REVIEWS[course.reviewStatus]}</span></div>
                            {course.reviewerNote && <p className={styles.help}>先前回覆：{course.reviewerNote}</p>}
                            {editable && (
                              <>
                                <label className={styles.field}>回覆學生
                                  <textarea className={styles.reviewNote} maxLength={500} rows={2}
                                    value={notes[key] || ''}
                                    onChange={(event) => setNotes((current) => ({ ...current, [key]: event.target.value }))}
                                    placeholder="同意可選填；不同意請說明原因" />
                                </label>
                                <div className={styles.reviewActions}>
                                  <button type="button" className={styles.primary} disabled={Boolean(busyKey)}
                                    onClick={() => void decide(request.id, course.courseId, 'approved')}>
                                    {busyKey === key ? '儲存中…' : '同意這門課'}
                                  </button>
                                  <button type="button" className={styles.secondary} disabled={Boolean(busyKey)}
                                    onClick={() => void decide(request.id, course.courseId, 'rejected')}>
                                    不同意
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </SiteShell>
  );
}
