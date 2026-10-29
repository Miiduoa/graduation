'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePersonalImportScope, usePersonalImports } from '@/lib/usePersonalImports';
import {
  IMPORT_CONFIRM_COPY,
  periodCount,
  periodProfileForSchool,
  personalTimetableTerms,
  samePersonalCourse,
  SchedulePlanner,
  studySlots,
  WEEKDAY_LABELS,
  analyzeImportDrafts,
  applyImport,
  cleanCourse,
  cleanMeta,
  meetupLabel,
  meetupStartOptions,
  meetupWindowLabel,
  meetupWindows,
  minutesLabel,
  type MeetupWindow,
  courseTimeLabel,
  findCourseConflicts,
  periodRangeLabel,
  type ImportDraft,
  type ImportMode,
  type PersonalCourse,
  type PlannerFriend,
  shareCopiedCopy,
} from '@campus/shared';
import { useAuth } from '@/components/AuthGuard';
import styles from '@/components/academic/academic.module.css';
import {
  createMeetup,
  createServerShare,
  listMyMeetups,
  respondMeetup,
  loadFriendTimetable,
  loadPersonalTimetable,
  savePersonalTimetable,
  TIMETABLE_DEVICE_ONLY_STORED_COPY,
  TIMETABLE_DEVICE_ONLY_SUBMIT_COPY,
  TimetableCloudSaveError,
  type StoredTimetable,
} from '@/lib/timetable/store';
import { isFunctionsUnconfiguredError } from '@/lib/functionsUrl';
import { loginHref } from '@/lib/navigation';
import { useSignInOptions } from '@/lib/signInOptions';
import { listAcceptedFriends } from '@/lib/timetable/friends';
import { useAcademicRecords } from '@/lib/useAcademicRecords';
import { OFFICIAL_COURSES_UNAVAILABLE_COPY } from '@campus/shared/src/schoolLogin';
import type { AcademicCourse } from '@/lib/academicRecords';
import { CourseEditor as EditableCourseDialog } from './CourseEditor';
import { TimetableGrid, UnscheduledCourses } from './TimetableGrid';
import { validateCourseDraft } from './courseEditorModel';
import { planningReadiness } from './timetableMovement';
import movement from './timetableMovement.module.css';

export const SHARE_NEEDS_SCHOOL_LOGIN_COPY =
  '登入學校帳號後就能分享課表連結；目前課表先存在這台瀏覽器。';
export const SHARE_SCHOOL_LOGIN_UNAVAILABLE_COPY =
  '分享課表要用學校帳號登入，網站的學校帳號登入還沒開放；課表先存在這台瀏覽器。';

type TimetableView = 'grid' | 'week' | 'day';
const compactTimetableQuery = '(max-width: 600px)';

function subscribeToCompactLayout(onChange: () => void) {
  const query = window.matchMedia?.(compactTimetableQuery);
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
}

function compactLayout() {
  return window.matchMedia?.(compactTimetableQuery).matches ?? false;
}

const serverLayout = () => false;

function ShareNeedsSchoolAccountNotice({ schoolId }: { schoolId: string }) {
  const options = useSignInOptions();
  if (options.loading || options.error || !options.studentId) {
    return <p className={styles.notice}>{SHARE_SCHOOL_LOGIN_UNAVAILABLE_COPY}</p>;
  }
  return (
    <p className={styles.notice}>
      {SHARE_NEEDS_SCHOOL_LOGIN_COPY}{' '}
      <Link href={loginHref(`/timetable?campus=${encodeURIComponent(schoolId)}`)}>
        登入學校帳號
      </Link>
    </p>
  );
}

function FriendTimetableAccessNotice({
  schoolId,
  onViewOwnFree,
  busy,
}: {
  schoolId: string;
  onViewOwnFree?: () => void;
  busy: boolean;
}) {
  const options = useSignInOptions();
  return (
    <>
      <p
        className={styles.notice}
        role={options.loading ? 'status' : options.error ? 'alert' : undefined}
      >
        {options.loading
          ? '正在確認學校帳號登入狀態…'
          : options.error
            ? '暫時無法確認學校帳號登入方式，自己的課表與空堂仍可使用。'
            : options.studentId
              ? '登入學校帳號，並與好友互相開放課表後，就能比較共同空堂。'
              : '目前尚未開放學校帳號登入，暫時無法讀取好友課表。'}
      </p>
      <div className={`${styles.toolbar} ${movement.toolbar}`}>
        {options.error ? (
          <button type="button" className="btn" onClick={options.retry}>
            重新確認
          </button>
        ) : !options.loading && options.studentId ? (
          <Link
            className="btn"
            href={loginHref(`/timetable?campus=${encodeURIComponent(schoolId)}`)}
          >
            登入查看好友
          </Link>
        ) : null}
        {onViewOwnFree ? (
          <button type="button" className="btn" disabled={busy} onClick={onViewOwnFree}>
            查看自己的空堂
          </button>
        ) : (
          <Link
            className="btn"
            href={`/import?kind=timetable&campus=${encodeURIComponent(schoolId)}`}
          >
            匯入自己的課表
          </Link>
        )}
      </div>
    </>
  );
}

function shareFailureCopy(error: unknown): string {
  if (isFunctionsUnconfiguredError(error)) return '課表分享尚未啟用';
  const message = error instanceof Error ? error.message.trim() : '';
  if (message === 'need-login') return '請先登入再建立分享連結。';
  if (message && /[\u4e00-\u9fff]/.test(message)) return message;
  return '現在產生不了分享連結，登入學校帳號並連上網路後再試。';
}

function fromSchoolCourse(course: AcademicCourse): PersonalCourse {
  const start = course.periods[0] || 0;
  const end = course.periods[course.periods.length - 1] || start;
  return cleanCourse({
    id: course.id,
    name: course.name,
    day: course.dayOfWeek && course.dayOfWeek <= 5 ? course.dayOfWeek : 0,
    start,
    end,
    teacher: course.teacherName,
    room: course.location,
  });
}

/** Strict HH:mm (00:00–23:59); returns minutes past midnight, or null. */
function clockMinutes(value: string | undefined): number | null {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

/** Known actual clock only when both ends are strict HH:mm and end > start. */
function actualClockLabel(
  startTime: string | undefined,
  endTime: string | undefined,
): string | null {
  const start = clockMinutes(startTime);
  const end = clockMinutes(endTime);
  if (start === null || end === null || end <= start || !startTime || !endTime) return null;
  return `${startTime}–${endTime}`;
}

export function PersonalTimetable() {
  const context = usePersonalImportScope();
  const { user } = useAuth();
  if (context.loading) return <p role="status">正在確認課表…</p>;
  if (context.scope.schoolId === 'personal')
    return <p role="status">請先選擇一所學校，再查看或編輯這所學校的課表。</p>;
  return (
    <TimetableWorkspace
      key={JSON.stringify([context.scopeKey, user?.uid ?? null])}
      schoolId={context.scope.schoolId}
    />
  );
}

function TimetableWorkspace({ schoolId }: { schoolId: string }) {
  const periodProfile = periodProfileForSchool(schoolId);
  const periodTotal = periodProfile ? periodCount(periodProfile) : 0;
  const { user } = useAuth();
  const [timetable, setTimetable] = useState<StoredTimetable | null>(null);
  const compact = useSyncExternalStore(subscribeToCompactLayout, compactLayout, serverLayout);
  const [selectedView, setView] = useState<TimetableView | null>(null);
  const view = selectedView ?? (compact ? 'week' : 'grid');
  const importHref = `/import?kind=timetable&campus=${encodeURIComponent(schoolId)}`;
  const [day, setDay] = useState(() => {
    const today = new Date().getDay();
    return today >= 1 && today <= 5 ? today : 1;
  });
  const [editing, setEditing] = useState<PersonalCourse | null>(null);
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);
  const activeRef = useRef(false);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [shareBusy, setShareBusy] = useState(false);
  const sharingRef = useRef(false);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);
  const [notice, setNotice] = useState('');
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [planResult, setPlanResult] = useState<{ title: string; lines: string[] } | null>(null);
  const planningPanel = useRef<HTMLElement>(null);
  const [studyDay, setStudyDay] = useState(() => {
    const today = new Date().getDay();
    return today >= 1 && today <= 5 ? today : 1;
  });
  const [studyHours, setStudyHours] = useState(2);
  const [friends, setFriends] = useState<Array<PlannerFriend & { username?: string }>>([]);
  const [selectedFriend, setSelectedFriend] = useState<string | null>(null);
  const [meetupBusy, setMeetupBusy] = useState(false);
  const [shareResult, setShareResult] = useState<{ key: string; url: string } | null>(null);
  const schoolRecords = useAcademicRecords('courses', schoolId === 'pu');

  const uid = user?.uid || null;
  const router = useRouter();
  const importScope = usePersonalImportScope();
  const imported = usePersonalImports(importScope.scope, !importScope.loading);
  const [importTerm, setImportTerm] = useState(() =>
    typeof window === 'undefined'
      ? ''
      : new URLSearchParams(window.location.search).get('term') || '',
  );
  const terms = personalTimetableTerms(imported.records, schoolId);
  const activeTerm =
    importTerm === 'manual'
      ? 'manual'
      : terms.some((term) => term.key === importTerm)
        ? importTerm
        : terms[0]?.key || '';
  const importedCourses: PersonalCourse[] = imported.records
    .filter(
      (row) =>
        row.kind === 'timetable' &&
        row.schoolId === schoolId &&
        `${row.academicYear}|${row.semester}` === activeTerm &&
        row.dayOfWeek &&
        row.dayOfWeek <= 5 &&
        row.startPeriod &&
        row.endPeriod,
    )
    .map((row) =>
      cleanCourse({
        id: `import:${row.id}`,
        name: row.title,
        day: row.dayOfWeek,
        start: row.startPeriod,
        end: row.endPeriod,
        teacher: row.teacher,
        room: row.location,
      }),
    );
  const legacyTerm =
    timetable?.meta.year && timetable.meta.semester
      ? `${timetable.meta.year}|${timetable.meta.semester}`
      : '';
  const legacyCourses =
    !terms.length || activeTerm === 'manual' || legacyTerm === activeTerm
      ? timetable?.courses || []
      : [];
  const schoolOverlayCourses =
    schoolRecords.state?.snapshot?.schoolId === schoolId
      ? schoolRecords.state.snapshot.records.courses
          .map((course) => fromSchoolCourse(course))
          .filter((course) => course.day >= 1 && course.day <= 5 && course.start > 0)
      : [];
  const visibleCourses = [
    ...legacyCourses,
    ...importedCourses.filter(
      (course) => !legacyCourses.some((manual) => samePersonalCourse(manual, course)),
    ),
    ...schoolOverlayCourses.filter(
      (course) =>
        !legacyCourses.some((manual) => samePersonalCourse(manual, course)) &&
        !importedCourses.some((imported) => samePersonalCourse(imported, course)),
    ),
  ];
  const missingImportTimes = imported.records.filter(
    (row) =>
      row.kind === 'timetable' &&
      row.schoolId === schoolId &&
      `${row.academicYear}|${row.semester}` === activeTerm &&
      !importedCourses.some((course) => course.id === `import:${row.id}`),
  );
  const selectedTerm = terms.find((term) => term.key === activeTerm);
  const shareMeta = selectedTerm
    ? cleanMeta({
        ...(legacyTerm === activeTerm ? timetable?.meta : {}),
        school: importScope.schoolName,
        year: selectedTerm.academicYear,
        semester: selectedTerm.semester,
        title: `${selectedTerm.academicYear} 學年度第 ${selectedTerm.semester} 學期課表`,
      })
    : (timetable?.meta ?? cleanMeta());
  const shareCourses = [
    ...visibleCourses,
    ...missingImportTimes.map((row) =>
      cleanCourse({
        id: `import:${row.id}`,
        name: row.title,
        day: 0,
        teacher: row.teacher,
        room: row.location,
      }),
    ),
  ];
  const shareViewKey = JSON.stringify([activeTerm, shareCourses, shareMeta]);
  const shareViewRef = useRef(shareViewKey);
  useEffect(() => {
    shareViewRef.current = shareViewKey;
  }, [shareViewKey]);
  const shareUrl = shareResult?.key === shareViewKey ? shareResult.url : '';
  const savesToManual = terms.length > 0 && activeTerm !== 'manual' && legacyTerm !== activeTerm;
  // Unscheduled imported rows cannot be treated as free time.
  const planningCourses = [
    ...visibleCourses,
    ...missingImportTimes.map((row) =>
      cleanCourse({ id: `unplaced-import:${row.id}`, name: row.title, day: 0 }),
    ),
  ];
  const planning = planningReadiness(planningCourses, periodTotal, WEEKDAY_LABELS.length);
  const openCourse = (course: PersonalCourse) => {
    if (busy || savingRef.current) return;
    if (course.id.startsWith('import:')) router.push(importHref);
    else {
      setNotice('');
      setEditing({ ...course });
    }
  };
  const planner = periodProfile
    ? new SchedulePlanner(visibleCourses, friends, selectedFriend, periodProfile)
    : null;

  const refresh = useCallback(async () => {
    try {
      const next = await loadPersonalTimetable(uid, schoolId, importScope.scope.owner);
      if (activeRef.current) {
        setTimetable(next);
        setLoadError('');
      }
    } catch {
      if (activeRef.current) setLoadError('目前無法讀取課表，請保留本機資料並重新讀取。');
    }
  }, [uid, schoolId, importScope.scope.owner]);

  useEffect(() => {
    void refresh();
  }, [refresh, loadAttempt]);

  useEffect(() => {
    let current = true;
    if (!uid) {
      setFriends([]);
      return;
    }
    void listAcceptedFriends(schoolId, uid)
      .then(async (rows) => {
        const loaded: Array<PlannerFriend & { username?: string }> = [];
        for (const row of rows) {
          const theirs = await loadFriendTimetable(row.uid, schoolId).catch(() => null);
          loaded.push({
            id: row.uid,
            name: row.name || '好友',
            courses: theirs?.schoolId === schoolId ? theirs.courses : [],
          });
        }
        if (!current) return;
        setFriends(loaded);
        const wanted = new URLSearchParams(window.location.search).get('friend');
        if (wanted && loaded.some((friend) => friend.id === wanted)) setSelectedFriend(wanted);
      })
      .catch(() => {
        if (current) setFriends([]);
      });
    return () => {
      current = false;
    };
  }, [uid, schoolId]);

  // 別人約我、還沒回覆的邀約，在課表頁也看得到
  const [invites, setInvites] = useState<
    Array<{
      id: string;
      creatorUid: string;
      kind: 'meal' | 'study';
      day: number;
      startMinute?: number;
      startPeriod?: number;
      endPeriod?: number;
    }>
  >([]);
  const loadInvites = useCallback(async () => {
    const rows = uid
      ? ((await listMyMeetups(schoolId, uid).catch(() => [])) as Array<Record<string, unknown>>)
      : [];
    setInvites(
      rows.filter(
        (row) => row.inviteeUid === uid && row.status === 'pending',
      ) as unknown as typeof invites,
    );
  }, [uid, schoolId]);
  useEffect(() => {
    void Promise.resolve().then(loadInvites);
  }, [loadInvites]);
  const answerInvite = async (id: string, status: 'accepted' | 'declined') => {
    try {
      await respondMeetup(id, status);
      setNotice(status === 'accepted' ? '已答應，對方會看到。' : '已婉拒。');
    } catch {
      setNotice('這次沒有回覆成功，請稍後再試。');
    }
    await loadInvites();
  };

  const persist = async (
    next: StoredTimetable,
    message: string,
    options?: { deviceOnly?: boolean },
  ): Promise<boolean> => {
    if (savingRef.current || !activeRef.current) return false;
    savingRef.current = true;
    setBusy(true);
    try {
      const result = await savePersonalTimetable(
        uid,
        { ...next, schoolId },
        importScope.scope.owner,
      );
      if (!activeRef.current) return false;
      setTimetable({ ...next, schoolId });
      setPlanResult(null);
      setShareResult(null);
      setNotice(
        options?.deviceOnly
          ? TIMETABLE_DEVICE_ONLY_STORED_COPY
          : result.stored === 'local' && next.shareWithFriends !== timetable?.shareWithFriends
            ? '已儲存於這台裝置，但好友可見狀態仍以雲端資料為準。'
            : result.stored === 'local'
              ? TIMETABLE_DEVICE_ONLY_STORED_COPY
              : message,
      );
      return true;
    } catch (error) {
      if (activeRef.current && error instanceof TimetableCloudSaveError) {
        setTimetable({ ...next, schoolId });
        setPlanResult(null);
        setShareResult(null);
        setNotice('已儲存於這台裝置，但雲端同步沒有成功；好友目前看到的仍是原先版本。');
        return true;
      }
      if (activeRef.current) setNotice('無法確認儲存結果，原編輯內容保留。請確認課表後再重試。');
      return false;
    } finally {
      savingRef.current = false;
      if (activeRef.current) setBusy(false);
    }
  };

  if (loadError) {
    return (
      <section className={styles.panel} aria-label="課表讀取失敗">
        <p role="alert">{loadError}</p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setLoadError('');
            setLoadAttempt((count) => count + 1);
          }}
        >
          重新讀取課表
        </button>
      </section>
    );
  }
  if (!timetable) {
    return (
      <p className={styles.notice} role="status">
        正在讀取你的課表…
      </p>
    );
  }

  if (!periodProfile) {
    return (
      <section className={styles.panel} aria-label="個人課表">
        <p role="status" className={styles.notice}>
          尚未取得這所學校的節次時間，暫不提供空堂與邀約。課程保留原始節次；可在個人紀錄填寫實際時間。
        </p>
        {imported.error && <p role="alert">{imported.error}</p>}
        {terms.length > 0 && (
          <label className={styles.field}>
            顯示自行匯入的學期
            <select value={activeTerm} onChange={(event) => setImportTerm(event.target.value)}>
              <option value="manual">原本的手動課表</option>
              {terms.map((term) => (
                <option key={term.key} value={term.key}>
                  {term.academicYear} 學年度 {term.semester} 學期
                </option>
              ))}
            </select>
          </label>
        )}
        <p>自行匯入 {importedCourses.length + missingImportTimes.length} 筆</p>
        <ul className={styles.list}>
          {visibleCourses.map((course) => {
            const importId = course.id.startsWith('import:')
              ? course.id.slice('import:'.length)
              : '';
            const source =
              importId &&
              imported.records.find(
                (row) =>
                  row.id === importId &&
                  row.kind === 'timetable' &&
                  row.schoolId === schoolId &&
                  `${row.academicYear}|${row.semester}` === activeTerm,
              );
            const clock = source ? actualClockLabel(source.startTime, source.endTime) : null;
            return (
              <li key={course.id}>
                <strong>{course.name}</strong>
                <p>
                  {WEEKDAY_LABELS[course.day - 1] || '星期未填'} ·{' '}
                  {clock
                    ? clock
                    : course.start > 0
                      ? `第 ${course.start}–${course.end} 節（時間未確認）`
                      : '時間未確認'}
                  {' · '}
                  {course.room || '教室未填'}
                </p>
              </li>
            );
          })}
          {missingImportTimes.map((record) => {
            const clock = actualClockLabel(record.startTime, record.endTime);
            return (
              <li key={`record:${record.id}`}>
                <strong>{record.title}</strong>
                <p>
                  {['', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'][
                    record.dayOfWeek || 0
                  ] || '星期未填'}
                  {' · '}
                  {clock || '時間未確認'}
                  {' · '}
                  {record.location || '教室未填'}
                </p>
              </li>
            );
          })}
        </ul>
        {!visibleCourses.length && !missingImportTimes.length && (
          <p>這所學校還沒有個人課程紀錄。</p>
        )}
        <Link className="btn" href={importHref}>
          整理個人紀錄
        </Link>
      </section>
    );
  }

  const conflicts = findCourseConflicts(visibleCourses);
  const selected = friends.find((friend) => friend.id === selectedFriend);
  const friendPlanning = selected
    ? planningReadiness(selected.courses, periodTotal, WEEKDAY_LABELS.length)
    : null;
  const windows =
    planning.ready && selected && friendPlanning?.ready
      ? meetupWindows(visibleCourses, selected.courses, periodProfile)
      : [];
  const sendMeetup = async (kind: 'meal' | 'study', day: number, startMinute: number) => {
    if (
      !uid ||
      !selected ||
      !planning.ready ||
      !friendPlanning?.ready ||
      meetupBusy ||
      savingRef.current
    )
      return;
    setMeetupBusy(true);
    const label = meetupLabel({ day, kind, startMinute });
    try {
      const result = await createMeetup({
        schoolId,
        creatorUid: uid,
        inviteeUid: selected.id,
        kind,
        day,
        startMinute,
        note: kind === 'meal' ? '約吃飯' : '約讀書',
      });
      setNotice(
        result === 'already'
          ? `「${label}」之前就約過了，不會再送一次。`
          : `已送出邀請：${label}。對方會在「找人」和「我的課表」看到。`,
      );
    } catch {
      setNotice('邀請沒有送出，請稍後再試。');
    } finally {
      setMeetupBusy(false);
    }
  };
  const analyzed = analyzeImportDrafts(timetable.courses, drafts, importMode);

  const saveCourse = async (course: PersonalCourse) => {
    if (course.id.startsWith('import:')) return;
    const issues = validateCourseDraft(course, periodTotal, WEEKDAY_LABELS.length);
    if (Object.keys(issues).length) {
      setNotice(Object.values(issues).join(' '));
      return;
    }
    const cleaned = cleanCourse(course);
    const next = timetable.courses.some((item) => item.id === cleaned.id)
      ? timetable.courses.map((item) => (item.id === cleaned.id ? cleaned : item))
      : [...timetable.courses, cleaned];
    if (await persist({ ...timetable, courses: next }, '課程已更新。')) {
      setEditing(null);
      if (savesToManual) {
        setImportTerm('manual');
        setNotice((message) => `${message} 已切換至手動課表。`);
      }
    }
  };

  const removeCourse = async (id: string) => {
    if (id.startsWith('import:')) return;
    if (
      await persist(
        { ...timetable, courses: timetable.courses.filter((item) => item.id !== id) },
        '已從課表拿掉這門課。',
      )
    )
      setEditing(null);
  };

  const confirmImport = async () => {
    const next = applyImport(timetable.courses, analyzed, importMode);
    if (!analyzed.some((item) => item.selected !== false) || savingRef.current) return;
    if (
      await persist({ ...timetable, courses: next }, TIMETABLE_DEVICE_ONLY_STORED_COPY, {
        deviceOnly: true,
      })
    ) {
      setDrafts([]);
      if (savesToManual) {
        setImportTerm('manual');
        setNotice((message) => `${message} 已切換至手動課表。`);
      }
    }
  };

  const copyShare = async () => {
    if (
      !uid ||
      busy ||
      sharingRef.current ||
      !activeRef.current ||
      imported.loading ||
      imported.error ||
      !shareCourses.length
    )
      return;
    const requestedView = shareViewKey;
    const isCurrentShare = () => activeRef.current && shareViewRef.current === requestedView;
    sharingRef.current = true;
    setShareBusy(true);
    setShareResult(null);
    try {
      const server = await createServerShare(schoolId, shareMeta.title || '我的課表', {
        courses: shareCourses,
        meta: shareMeta,
      });
      if (!isCurrentShare()) return;
      const parsed = new URL(server.path, window.location.origin);
      if (
        parsed.origin !== window.location.origin ||
        !/^\/timetable\/s\/[A-Za-z0-9_-]+$/.test(parsed.pathname)
      ) {
        throw new Error('invalid-timetable-share-path');
      }
      const url = parsed.toString();
      setShareResult({ key: requestedView, url });
      if (!navigator.clipboard?.writeText) {
        setNotice('瀏覽器無法自動複製。請手動複製下方連結。');
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        if (isCurrentShare()) setNotice(shareCopiedCopy(server.expiresAt));
      } catch {
        if (isCurrentShare()) setNotice('瀏覽器未完成複製，請手動複製下方連結。');
      }
    } catch (error) {
      if (isCurrentShare()) {
        setShareResult(null);
        setNotice(shareFailureCopy(error));
      }
    } finally {
      sharingRef.current = false;
      if (activeRef.current) setShareBusy(false);
    }
  };

  const runPlan = (title: string, query: string) => {
    if (!planning.ready) return;
    const answer = planner?.ask(query) || '這份課表算不出結果，先確認課有排上星期和節次。';
    setPlanResult({
      title,
      lines: answer
        .split(/\n|；/)
        .map((line) => line.trim())
        .filter(Boolean),
    });
  };

  const todayFree = () => {
    if (!planning.ready) return;
    const today = new Date().getDay();
    if (today < 1 || today > 5) {
      setPlanResult({ title: '今天空堂', lines: ['今天是週末，課表上沒有排課。'] });
      return;
    }
    runPlan('今天空堂', '今天空堂');
  };

  const bringSchool = async () => {
    const snapshot = schoolRecords.state?.snapshot;
    const records = snapshot?.schoolId === schoolId ? snapshot.records : null;
    if (schoolRecords.state?.reason === 'officialUnavailable') {
      setNotice(OFFICIAL_COURSES_UNAVAILABLE_COPY);
      return;
    }
    if (!records?.courses?.length) {
      setNotice('現在沒有學校選課紀錄可帶入。');
      return;
    }
    setDrafts(
      records.courses.map((course) => ({
        ...fromSchoolCourse(course),
        selected: true,
        confidence: 90,
      })),
    );
    setImportMode('merge');
    setNotice(IMPORT_CONFIRM_COPY);
  };

  return (
    <div className={movement.workspace}>
      {invites.length > 0 && (
        <section className={styles.panel} aria-label="邀約">
          <h2>有人約你</h2>
          <ul className={styles.list}>
            {invites.map((item) => (
              <li key={item.id}>
                <p>
                  {friends.find((friend) => friend.id === item.creatorUid)?.name || '同學'} 約你：
                  {meetupLabel(item)}
                </p>
                <div className={`${styles.toolbar} ${movement.toolbar}`}>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => void answerInvite(item.id, 'accepted')}
                  >
                    答應
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void answerInvite(item.id, 'declined')}
                  >
                    婉拒
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className={styles.notice}>{TIMETABLE_DEVICE_ONLY_STORED_COPY}</p>
      {uid ? (
        <label className={styles.field}>
          <input
            type="checkbox"
            checked={timetable.shareWithFriends !== false}
            onChange={(event) =>
              void persist(
                { ...timetable, shareWithFriends: event.target.checked },
                event.target.checked
                  ? '好友加完後看得到這份課表。'
                  : '已關掉好友課表。對方現在看不到。',
              )
            }
          />
          讓已接受的好友看這份課表
        </label>
      ) : null}
      {notice && (
        <p className={styles.note} role="status">
          {notice}
        </p>
      )}
      {conflicts.length > 0 && (
        <section className={styles.warning} aria-label="衝堂">
          有 {conflicts.length} 組課程時間重疊，仍可先留著，約人時會避開這些時段。
        </section>
      )}
      <div className={`${styles.toolbar} ${movement.toolbar}`}>
        <div className={styles.segment} role="group" aria-label="課表顯示方式">
          <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
            格子
          </button>
          <button type="button" aria-pressed={view === 'week'} onClick={() => setView('week')}>
            一週
          </button>
          <button type="button" aria-pressed={view === 'day'} onClick={() => setView('day')}>
            單日
          </button>
        </div>
        {view === 'day' && (
          <label className={styles.field}>
            上課日
            <select value={day} onChange={(event) => setDay(Number(event.target.value))}>
              {WEEKDAY_LABELS.map((label, index) => (
                <option value={index + 1} key={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => openCourse({ ...cleanCourse({ day, start: 1, end: 1 }), name: '' })}
        >
          新增課程
        </button>
        {uid ? (
          <button
            type="button"
            className="btn"
            onClick={() => void copyShare()}
            disabled={
              busy || shareBusy || imported.loading || !!imported.error || !shareCourses.length
            }
            aria-busy={shareBusy}
          >
            {shareBusy ? '正在產生連結…' : '複製分享連結'}
          </button>
        ) : null}
      </div>
      {shareUrl && (
        <label className={styles.field}>
          分享連結
          <input
            className="input"
            aria-label="分享連結"
            value={shareUrl}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}

      {imported.error && (
        <p role="alert" className={styles.notice}>
          {imported.error}
        </p>
      )}
      {terms.length > 0 && (
        <div className={`${styles.toolbar} ${movement.toolbar}`}>
          <label className={styles.field}>
            顯示自行匯入的學期
            <select value={activeTerm} onChange={(event) => setImportTerm(event.target.value)}>
              <option value="manual">原本的手動課表</option>
              {terms.map((term) => (
                <option key={term.key} value={term.key}>
                  {term.academicYear} 學年度 {term.semester} 學期
                </option>
              ))}
            </select>
          </label>
          <p className={styles.notice}>
            自行匯入 {importedCourses.length}{' '}
            筆。原有手動課表只有在學期相符時一起顯示，也可切換查看。點選可回到匯入頁修改；其他學校與週末課程請查看
            <Link href={importHref}>個人紀錄</Link>。
            {savesToManual ? ' 新增課程會儲存至手動課表，儲存後會自動切換。' : ''}
          </p>
        </div>
      )}
      {view === 'grid' ? (
        <TimetableGrid
          courses={visibleCourses}
          disabled={busy}
          onEdit={openCourse}
          periodProfile={periodProfile}
        />
      ) : view === 'week' ? (
        <div className={`${styles.week} ${movement.week}`} role="region" aria-label="一週課程">
          {WEEKDAY_LABELS.map((label, index) => {
            const entries = visibleCourses
              .filter((course) => course.day === index + 1)
              .sort((a, b) => a.start - b.start);
            return (
              <section className={styles.day} key={label}>
                <h3>{label}</h3>
                {entries.length ? (
                  entries.map((course) => (
                    <button
                      type="button"
                      className={`${styles.course} ${movement.courseCard}`}
                      key={course.id}
                      onClick={() => openCourse(course)}
                    >
                      <time>{courseTimeLabel(course, periodProfile)}</time>
                      <h4>{course.name}</h4>
                      <p>{course.room || '教室未填'}</p>
                    </button>
                  ))
                ) : (
                  <p className={styles.empty}>尚無已排課程</p>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <ul className={styles.list}>
          {visibleCourses.every((course) => course.day !== day) && (
            <li>
              <p className={styles.empty}>這天還沒有課程，可使用上方「新增課程」開始。</p>
            </li>
          )}
          {visibleCourses
            .filter((course) => course.day === day)
            .sort((a, b) => a.start - b.start)
            .map((course) => (
              <li key={course.id}>
                <button
                  type="button"
                  className={`${styles.course} ${movement.courseCard}`}
                  onClick={() => openCourse(course)}
                >
                  <time>{periodRangeLabel(course.start, course.end, periodProfile)}</time>
                  <h4>{course.name}</h4>
                  <p>
                    {course.teacher || '教師未填'} · {course.room || '教室未填'}
                  </p>
                </button>
              </li>
            ))}
        </ul>
      )}

      <UnscheduledCourses
        courses={legacyCourses}
        disabled={busy}
        onEdit={openCourse}
        periodProfile={periodProfile}
      />
      {!uid && <ShareNeedsSchoolAccountNotice schoolId={schoolId} />}
      {editing && (
        <EditableCourseDialog
          key={editing.id}
          course={editing}
          courses={timetable.courses}
          existing={timetable.courses.some((course) => course.id === editing.id)}
          busy={busy}
          feedback={notice}
          onChange={setEditing}
          onSave={() => void saveCourse(editing)}
          onRemove={() => void removeCourse(editing.id)}
          onCancel={() => {
            if (!savingRef.current) setEditing(null);
          }}
          periodProfile={periodProfile}
        />
      )}

      <section className={styles.panel} aria-label="匯入課表">
        <h2>匯入課表</h2>
        <p className={styles.notice}>截圖、文字與檔案都可以先整理成草稿，再逐筆確認。</p>
        {schoolRecords.state?.status === 'error' && schoolRecords.state.reason === 'officialUnavailable' ? (
          <p className={styles.notice} role="status">
            {OFFICIAL_COURSES_UNAVAILABLE_COPY}。可改看{' '}
            <Link href="/school-courses">WOW Class 課程清單</Link>
            ，或直接到 e 校園查詢。
          </p>
        ) : null}
        <div className={`${styles.toolbar} ${movement.toolbar}`}>
          <Link className="btn primary" href={importHref}>
            匯入截圖或檔案
          </Link>
          {uid && (
            <button type="button" className="btn" onClick={() => void bringSchool()}>
              從學校課表帶入
            </button>
          )}
        </div>
        {analyzed.length > 0 && (
          <div className={styles.draftList}>
            {analyzed.map((draft, index) => (
              <label key={draft.id} className={styles.course}>
                <input
                  type="checkbox"
                  checked={draft.selected !== false}
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, selected: event.target.checked } : item,
                      ),
                    )
                  }
                />
                <strong>{draft.name}</strong>
                <p>
                  {courseTimeLabel(draft, periodProfile)} · {draft.teacher} · {draft.room}
                </p>
                {draft.flags?.map((flag) => (
                  <span key={flag.label}>{flag.label} </span>
                ))}
              </label>
            ))}
            <button
              type="button"
              className="btn primary"
              disabled={busy || !analyzed.some((item) => item.selected !== false)}
              onClick={() => void confirmImport()}
            >
              {TIMETABLE_DEVICE_ONLY_SUBMIT_COPY}
            </button>
          </div>
        )}
      </section>

      <section className={styles.panel} aria-label="幫我安排" ref={planningPanel} tabIndex={-1}>
        <h2>幫我安排</h2>
        <p className={styles.notice}>
          {planning.ready
            ? '依目前選取學期的課表計算；尚未匯入的課程仍需自行核對。'
            : planning.message}
        </p>
        <div className={`${styles.toolbar} ${movement.toolbar}`}>
          <button
            type="button"
            className="btn"
            disabled={busy || !planning.ready}
            onClick={() => runPlan('下一堂', '下一堂')}
          >
            下一堂
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !planning.ready}
            onClick={todayFree}
          >
            今天空堂
          </button>
        </div>
        <div className={`${styles.toolbar} ${movement.toolbar}`}>
          <label className={styles.field}>
            星期
            <select value={studyDay} onChange={(event) => setStudyDay(Number(event.target.value))}>
              {WEEKDAY_LABELS.map((label, index) => (
                <option key={label} value={index + 1}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            時數
            <select
              value={studyHours}
              onChange={(event) => setStudyHours(Number(event.target.value))}
            >
              {[1, 2, 3, 4].map((hours) => (
                <option key={hours} value={hours}>
                  {hours} 小時
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            disabled={busy || !planning.ready}
            onClick={() => {
              if (!planning.ready || savingRef.current) return;
              const slots = studySlots(visibleCourses, studyDay, studyHours, periodProfile);
              setPlanResult({
                title: `${WEEKDAY_LABELS[studyDay - 1]}排 ${studyHours} 小時讀書`,
                lines: slots.length ? slots : ['這天的空堂都不夠長，換一天或少排一點。'],
              });
            }}
          >
            排讀書時間
          </button>
        </div>
        {planResult && (
          <div aria-live="polite">
            <h3>{planResult.title}</h3>
            <ul>
              {planResult.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className={styles.panel} aria-label="共同空堂">
        <h2>共同空堂</h2>
        {!uid ? (
          <FriendTimetableAccessNotice
            schoolId={schoolId}
            busy={busy}
            onViewOwnFree={
              planning.ready
                ? () => {
                    todayFree();
                    planningPanel.current?.focus();
                  }
                : undefined
            }
          />
        ) : friends.length === 0 ? (
          <p className={styles.notice}>
            目前沒有已接受的好友，或對方還沒把課表開放給好友。去 <a href="/friends">找人</a>{' '}
            送出邀請。
          </p>
        ) : (
          <>
            <label className={styles.field}>
              朋友
              <select
                value={selectedFriend || ''}
                onChange={(event) => setSelectedFriend(event.target.value || null)}
              >
                <option value="">選擇一位朋友</option>
                {friends.map((friend) => (
                  <option value={friend.id} key={friend.id}>
                    {friend.name}
                    {friend.courses.length ? '' : '（還沒有課表）'}
                  </option>
                ))}
              </select>
            </label>
            {selected && planning.ready && friendPlanning?.ready && windows.length === 0 && (
              <p className={styles.notice}>這週找不到兩個人都沒課、有一小時的時段。</p>
            )}
            {selected && !planning.ready && <p className={styles.notice}>{planning.message}</p>}
            {selected && selected.courses.length > 0 && !friendPlanning?.ready && (
              <p className={styles.notice}>
                好友課表仍有不完整的時間資料，暫不提供共同空堂與邀約。
              </p>
            )}
            {selected && !selected.courses.length && (
              <p className={styles.notice}>
                目前沒有可用的好友課表，不會把缺少資料誤判為整天空堂。
              </p>
            )}
            {selected &&
              windows
                .slice(0, 8)
                .map((window) => (
                  <MeetupWindowRow
                    key={`${window.day}-${window.start}`}
                    window={window}
                    busy={meetupBusy}
                    onSend={(kind, startMinute) => void sendMeetup(kind, window.day, startMinute)}
                  />
                ))}
          </>
        )}
      </section>
    </div>
  );
}

function MeetupWindowRow({
  window,
  busy,
  onSend,
}: {
  window: MeetupWindow;
  busy: boolean;
  onSend: (kind: 'meal' | 'study', startMinute: number) => void;
}) {
  const options = meetupStartOptions(window);
  const [start, setStart] = useState(options[0] ?? window.start);
  return (
    <div className={`${styles.toolbar} ${movement.toolbar}`}>
      <span>{meetupWindowLabel(window)}</span>
      <label className={styles.field}>
        開始
        <select value={start} onChange={(event) => setStart(Number(event.target.value))}>
          {options.map((at) => (
            <option value={at} key={at}>
              {minutesLabel(at)}
            </option>
          ))}
        </select>
      </label>
      <span>1 小時</span>
      <button type="button" className="btn" disabled={busy} onClick={() => onSend('meal', start)}>
        約吃飯
      </button>
      <button type="button" className="btn" disabled={busy} onClick={() => onSend('study', start)}>
        約讀書
      </button>
    </div>
  );
}
