'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePersonalImportScope, usePersonalImports } from '@/lib/usePersonalImports';
import {
  IMPORT_CONFIRM_COPY,
  PERIOD_TIMES,
  SchedulePlanner,
  studySlots,
  WEEKDAY_LABELS,
  analyzeImportDrafts,
  applyImport,
  cleanCourse,
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
import { useSelectedSchool } from '@/components/SelectedSchoolProvider';
import styles from '@/components/academic/academic.module.css';
import {
  createMeetup,
  createServerShare,
  listMyMeetups,
  respondMeetup,
  loadFriendTimetable,
  loadPersonalTimetable,
  savePersonalTimetable,
  CLOUD_NOT_READY_COPY,
  TIMETABLE_DEVICE_ONLY_STORED_COPY,
  TIMETABLE_DEVICE_ONLY_SUBMIT_COPY,
  TimetableCloudSaveError,
  type StoredTimetable,
} from '@/lib/timetable/store';
import { SchoolAccountRequired } from '@/components/SchoolAccountRequired';
import { listAcceptedFriends } from '@/lib/timetable/friends';
import { useAcademicRecords } from '@/lib/useAcademicRecords';
import type { AcademicCourse } from '@/lib/academicRecords';

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

export function PersonalTimetable() {
  const context = usePersonalImportScope();
  if (context.loading) return <p role="status">正在確認課表…</p>;
  return <TimetableWorkspace key={context.scopeKey} />;
}

function TimetableWorkspace() {
  const { user } = useAuth();
  const school = useSelectedSchool();
  const schoolId = school.selectedSchoolId || 'pu';
  const [timetable, setTimetable] = useState<StoredTimetable | null>(null);
  const [view, setView] = useState<'grid' | 'week' | 'day'>('grid');
  const [day, setDay] = useState(() => {
    const today = new Date().getDay();
    return today >= 1 && today <= 5 ? today : 1;
  });
  const [editing, setEditing] = useState<PersonalCourse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [planResult, setPlanResult] = useState<{ title: string; lines: string[] } | null>(null);
  const [studyDay, setStudyDay] = useState(() => {
    const today = new Date().getDay();
    return today >= 1 && today <= 5 ? today : 1;
  });
  const [studyHours, setStudyHours] = useState(2);
  const [friends, setFriends] = useState<Array<PlannerFriend & { username?: string }>>([]);
  const [selectedFriend, setSelectedFriend] = useState<string | null>(null);
  const [meetupBusy, setMeetupBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const schoolRecords = useAcademicRecords('courses');

  const uid = user?.uid || null;
  const router = useRouter();
  const importScope = usePersonalImportScope();
  const imported = usePersonalImports(importScope.scope, !importScope.loading);
  const [importTerm, setImportTerm] = useState('');
  const terms = [
    ...new Set(
      imported.records
        .filter((row) => row.kind === 'timetable')
        .map((row) => `${row.academicYear}|${row.semester}`),
    ),
  ];
  const latestTerm = [...imported.records].reverse().find((row) => row.kind === 'timetable');
  const activeTerm =
    importTerm === 'manual'
      ? 'manual'
      : terms.includes(importTerm)
        ? importTerm
        : latestTerm
          ? `${latestTerm.academicYear}|${latestTerm.semester}`
          : '';
  const importedCourses: PersonalCourse[] = imported.records
    .filter(
      (row) =>
        row.kind === 'timetable' &&
        row.schoolId === 'pu' &&
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
  const visibleCourses = [...legacyCourses, ...importedCourses];
  const openCourse = (course: PersonalCourse) => {
    if (course.id.startsWith('import:')) router.push('/import?kind=timetable');
    else setEditing(course);
  };
  const planner = new SchedulePlanner(visibleCourses, friends, selectedFriend);

  const refresh = useCallback(async () => {
    const next = await loadPersonalTimetable(uid, schoolId, importScope.scope.owner);
    setTimetable(next);
  }, [uid, schoolId, importScope.scope.owner]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!uid) {
      setFriends([]);
      return;
    }
    void listAcceptedFriends(schoolId, uid)
      .then(async (rows) => {
        const loaded: Array<PlannerFriend & { username?: string }> = [];
        for (const row of rows) {
          const theirs = await loadFriendTimetable(row.uid).catch(() => null);
          loaded.push({
            id: row.uid,
            name: row.name || '好友',
            courses: theirs?.courses || [],
          });
        }
        setFriends(loaded);
        const wanted = new URLSearchParams(window.location.search).get('friend');
        if (wanted && loaded.some((friend) => friend.id === wanted)) setSelectedFriend(wanted);
      })
      .catch(() => setFriends([]));
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
  ) => {
    setBusy(true);
    try {
      await savePersonalTimetable(uid, { ...next, schoolId }, importScope.scope.owner);
      setTimetable({ ...next, schoolId });
      setNotice(options?.deviceOnly ? TIMETABLE_DEVICE_ONLY_STORED_COPY : message);
    } catch (error) {
      if (error instanceof TimetableCloudSaveError) {
        setTimetable({ ...next, schoolId });
        setNotice(options?.deviceOnly ? TIMETABLE_DEVICE_ONLY_STORED_COPY : message);
      } else {
        setNotice('這次沒有存成。課表還停在你看到的這一版，請稍後再試。');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!timetable) {
    return (
      <p className={styles.notice} role="status">
        正在讀取你的課表…
      </p>
    );
  }

  const conflicts = findCourseConflicts(visibleCourses);
  const selected = friends.find((friend) => friend.id === selectedFriend);
  const windows = selected ? meetupWindows(visibleCourses, selected.courses) : [];
  const sendMeetup = async (kind: 'meal' | 'study', day: number, startMinute: number) => {
    if (!uid || !selected || meetupBusy) return;
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
    const cleaned = cleanCourse(course);
    const next = timetable.courses.some((item) => item.id === cleaned.id)
      ? timetable.courses.map((item) => (item.id === cleaned.id ? cleaned : item))
      : [...timetable.courses, cleaned];
    await persist({ ...timetable, courses: next }, '課程已更新。');
    setEditing(null);
  };

  const removeCourse = async (id: string) => {
    await persist(
      { ...timetable, courses: timetable.courses.filter((item) => item.id !== id) },
      '已從課表拿掉這門課。',
    );
    setEditing(null);
  };

  const confirmImport = async () => {
    const next = applyImport(timetable.courses, analyzed, importMode);
    await persist({ ...timetable, courses: next }, TIMETABLE_DEVICE_ONLY_STORED_COPY, {
      deviceOnly: true,
    });
    setDrafts([]);
  };

  const copyShare = async () => {
    if (!uid) return;
    try {
      const server = await createServerShare(schoolId, timetable.meta.title || '我的課表');
      const url = `${window.location.origin}${server.path}`;
      await navigator.clipboard.writeText(url).catch(() => undefined);
      setShareUrl(url);
      setNotice(shareCopiedCopy(server.expiresAt));
    } catch {
      setShareUrl('');
      setNotice('現在產生不了分享連結，登入學校帳號並連上網路後再試。');
    }
  };

  const runPlan = (title: string, query: string) => {
    const answer = planner.ask(query) || '這份課表算不出結果，先確認課有排上星期和節次。';
    setPlanResult({
      title,
      lines: answer
        .split(/\n|；/)
        .map((line) => line.trim())
        .filter(Boolean),
    });
  };

  const todayFree = () => {
    const today = new Date().getDay();
    if (today < 1 || today > 5) {
      setPlanResult({ title: '今天空堂', lines: ['今天是週末，課表上沒有排課。'] });
      return;
    }
    runPlan('今天空堂', '今天空堂');
  };

  const bringSchool = async () => {
    const records = schoolRecords.state?.snapshot?.records;
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
    <>
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
                <div className={styles.toolbar}>
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
      <p className={styles.notice}>
        {TIMETABLE_DEVICE_ONLY_STORED_COPY}
        {uid ? '' : ` ${CLOUD_NOT_READY_COPY}`}
      </p>
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
      <div className={styles.toolbar}>
        <div className={styles.segment} aria-label="課表顯示方式">
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
        <button
          type="button"
          className="btn"
          onClick={() => setEditing(cleanCourse({ day, start: 1, end: 1 }))}
        >
          新增課程
        </button>
        {uid ? (
          <button
            type="button"
            className="btn"
            onClick={() => void copyShare()}
            disabled={busy || !timetable.courses.length}
          >
            複製分享連結
          </button>
        ) : null}
      </div>
      {!uid && (
        <p className={styles.notice}>
          這個功能還沒接通。分享連結要等學校帳號接上才能用，課表仍可先在這台瀏覽器整理。
        </p>
      )}
      {shareUrl && <p className={styles.notice}>{shareUrl}</p>}

      {imported.error && (
        <p role="alert" className={styles.notice}>
          {imported.error}
        </p>
      )}
      {terms.length > 0 && (
        <div className={styles.toolbar}>
          <label className={styles.field}>
            顯示自行匯入的學期
            <select value={activeTerm} onChange={(event) => setImportTerm(event.target.value)}>
              <option value="manual">原本的手動課表</option>
              {terms.map((term) => (
                <option key={term} value={term}>
                  {term.replace('|', ' 學年度 ')} 學期
                </option>
              ))}
            </select>
          </label>
          <p className={styles.notice}>
            自行匯入 {importedCourses.length}{' '}
            筆。原有手動課表只有在學期相符時一起顯示，也可切換查看。點選可回到匯入頁修改；其他學校與週末課程請查看
            <Link href="/import?kind=timetable">個人紀錄</Link>。
          </p>
        </div>
      )}
      {view === 'grid' ? (
        <div className={styles.grid} role="table" aria-label="一週格子課表">
          <div className={styles.gridTime}>節次</div>
          {WEEKDAY_LABELS.map((label) => (
            <div className={styles.gridHead} key={label}>
              {label}
            </div>
          ))}
          {PERIOD_TIMES.map((time, index) => {
            const period = index + 1;
            return (
              <FragmentRow
                key={period}
                period={period}
                time={time}
                courses={visibleCourses}
                onEdit={openCourse}
              />
            );
          })}
        </div>
      ) : view === 'week' ? (
        <div className={styles.week}>
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
                      className={styles.course}
                      key={course.id}
                      onClick={() => openCourse(course)}
                    >
                      <time>{courseTimeLabel(course)}</time>
                      <h4>{course.name}</h4>
                      <p>{course.room || '教室未填'}</p>
                    </button>
                  ))
                ) : (
                  <p className={styles.empty}>無課</p>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <ul className={styles.list}>
          {visibleCourses
            .filter((course) => course.day === day)
            .sort((a, b) => a.start - b.start)
            .map((course) => (
              <li key={course.id}>
                <button type="button" className={styles.course} onClick={() => openCourse(course)}>
                  <time>{periodRangeLabel(course.start, course.end)}</time>
                  <h4>{course.name}</h4>
                  <p>
                    {course.teacher || '教師未填'} · {course.room || '教室未填'}
                  </p>
                </button>
              </li>
            ))}
        </ul>
      )}

      {editing && (
        <CourseEditor
          course={editing}
          busy={busy}
          onChange={setEditing}
          onSave={() => void saveCourse(editing)}
          onRemove={() => void removeCourse(editing.id)}
          onCancel={() => setEditing(null)}
        />
      )}

      <section className={styles.panel} aria-label="匯入課表">
        <h2>匯入課表</h2>
        <p className={styles.notice}>截圖、文字與檔案都可以先整理成草稿，再逐筆確認。</p>
        <div className={styles.toolbar}>
          <Link className="btn primary" href="/import?kind=timetable">
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
                  {courseTimeLabel(draft)} · {draft.teacher} · {draft.room}
                </p>
                {draft.flags?.map((flag) => (
                  <span key={flag.label}>{flag.label} </span>
                ))}
              </label>
            ))}
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void confirmImport()}
            >
              {TIMETABLE_DEVICE_ONLY_SUBMIT_COPY}
            </button>
          </div>
        )}
      </section>

      <section className={styles.panel} aria-label="幫我安排">
        <h2>幫我安排</h2>
        <p className={styles.notice}>用你現在這份課表算。</p>
        <div className={styles.toolbar}>
          <button type="button" className="btn" onClick={() => runPlan('下一堂', '下一堂')}>
            下一堂
          </button>
          <button type="button" className="btn" onClick={todayFree}>
            今天空堂
          </button>
        </div>
        <div className={styles.toolbar}>
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
            onClick={() => {
              const slots = studySlots(visibleCourses, studyDay, studyHours);
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
          <>
            <SchoolAccountRequired
              returnUrl="/timetable"
              headingLevel={3}
              alternative="空堂可以先看自己這台瀏覽器上的課表。"
            />
            <p className={styles.notice}>
              加好友後才看得到對方課表，沒加好友不會露出任何人的時間。
            </p>
          </>
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
            {selected && selected.courses.length > 0 && windows.length === 0 && (
              <p className={styles.notice}>這週找不到兩個人都沒課、有一小時的時段。</p>
            )}
            {selected && !selected.courses.length && (
              <p className={styles.notice}>這位朋友還沒有開放課表，或課表仍是空的。</p>
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
    </>
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
    <div className={styles.toolbar}>
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

function FragmentRow({
  period,
  time,
  courses,
  onEdit,
}: {
  period: number;
  time: readonly [string, string];
  courses: PersonalCourse[];
  onEdit: (course: PersonalCourse) => void;
}) {
  return (
    <>
      <div className={styles.gridTime}>
        {period}
        <br />
        {time[0]}
      </div>
      {WEEKDAY_LABELS.map((_, dayIndex) => {
        const hit = courses.find(
          (course) => course.day === dayIndex + 1 && period >= course.start && period <= course.end,
        );
        return (
          <div className={styles.gridCell} key={`${period}-${dayIndex}`}>
            {hit && period === hit.start ? (
              <button type="button" className={styles.gridCourse} onClick={() => onEdit(hit)}>
                <strong>{hit.name}</strong>
                <div>{hit.room}</div>
              </button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function CourseEditor({
  course,
  busy,
  onChange,
  onSave,
  onRemove,
  onCancel,
}: {
  course: PersonalCourse;
  busy: boolean;
  onChange: (course: PersonalCourse) => void;
  onSave: () => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  return (
    <section className={styles.panel} aria-label="編輯課程">
      <h2>編輯課程</h2>
      <label className={styles.field}>
        課名
        <input
          value={course.name}
          onChange={(event) => onChange({ ...course, name: event.target.value })}
        />
      </label>
      <label className={styles.field}>
        星期
        <select
          value={course.day}
          onChange={(event) => onChange({ ...course, day: Number(event.target.value) })}
        >
          <option value={0}>未排定</option>
          {WEEKDAY_LABELS.map((label, index) => (
            <option value={index + 1} key={label}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        開始節次
        <input
          type="number"
          min={1}
          max={13}
          value={course.start || 1}
          onChange={(event) => onChange({ ...course, start: Number(event.target.value) })}
        />
      </label>
      <label className={styles.field}>
        結束節次
        <input
          type="number"
          min={1}
          max={13}
          value={course.end || course.start || 1}
          onChange={(event) => onChange({ ...course, end: Number(event.target.value) })}
        />
      </label>
      <label className={styles.field}>
        老師
        <input
          value={course.teacher}
          onChange={(event) => onChange({ ...course, teacher: event.target.value })}
        />
      </label>
      <label className={styles.field}>
        教室
        <input
          value={course.room}
          onChange={(event) => onChange({ ...course, room: event.target.value })}
        />
      </label>
      <div className={styles.toolbar}>
        <button type="button" className="btn primary" disabled={busy} onClick={onSave}>
          儲存
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onRemove}>
          刪除
        </button>
      </div>
    </section>
  );
}
