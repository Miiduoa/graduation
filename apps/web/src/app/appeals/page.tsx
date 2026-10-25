'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  APPEAL_NEED_COURSE_COPY,
  APPEAL_STATUS_COPY,
  appealStatusDetail,
  appealSubmittedCopy,
  appealTimeValue,
  appealTopCard,
  courseOfferingId,
  type AppealTeacherMap,
  courseTimeLabel,
  type AppealStatus,
  type CourseAppeal,
  type PersonalCourse,
} from '@campus/shared';
import { SiteShell } from '@/components/SiteShell';
import { SchoolAccountRequired } from '@/components/SchoolAccountRequired';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { useAuth } from '@/components/AuthGuard';
import { useSelectedSchool } from '@/components/SelectedSchoolProvider';
import { useDemoRole } from '@/lib/demoRole';
import {
  appealOfferingId,
  createCourseAppeal,
  listCourseAppeals,
  loadAppealTeacherStatus,
  loadPersonalTimetable,
  withdrawCourseAppeal,
} from '@/lib/timetable/store';
import styles from '@/components/academic/academic.module.css';

function newRequestId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `appeal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export default function AppealsPage() {
  const { user, loading: authLoading } = useAuth();
  const school = useSelectedSchool();
  const [demoRole] = useDemoRole();
  const schoolId = school.selectedSchoolId;

  if (authLoading) {
    return (
      <SiteShell title="課程申訴" subtitle="送出後可以在這裡看老師處理到哪。">
        <p role="status">正在確認登入狀態…</p>
      </SiteShell>
    );
  }

  if (school.loading || !schoolId) {
    return (
      <SiteShell title="課程申訴" subtitle="送出後可以在這裡看老師處理到哪。">
        <SchoolScopePlaceholder />
      </SiteShell>
    );
  }

  if (!user) {
    return (
      <SiteShell title="課程申訴" subtitle="送出後可以在這裡看老師處理到哪。">
        <SchoolAccountRequired returnUrl="/appeals" alternative="申訴請先向授課老師或系辦反映。" />
      </SiteShell>
    );
  }

  return (
    <AppealsContent
      key={`${user.uid}:${schoolId}:${demoRole}`}
      schoolId={schoolId}
      uid={user.uid}
    />
  );
}

function AppealsContent({ schoolId, uid }: { schoolId: string; uid: string }) {
  const [items, setItems] = useState<CourseAppeal[]>([]);
  const [courses, setCourses] = useState<PersonalCourse[] | null>(null);
  const [courseId, setCourseId] = useState('');
  const [assigned, setAssigned] = useState<AppealTeacherMap>({});
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(newRequestId());
  const mounted = useRef(false);
  const generation = useRef(0);
  const opLock = useRef(false);

  const load = useCallback(async () => {
    if (!mounted.current) return null;
    const run = ++generation.current;
    try {
      const [rows, timetable] = await Promise.all([
        listCourseAppeals(schoolId, uid),
        loadPersonalTimetable(uid, schoolId),
      ]);
      if (!mounted.current || run !== generation.current) return null;
      const list = rows as CourseAppeal[];
      const usable = timetable.courses.filter((course) => course.name.trim());
      const offeringIds = [
        ...new Set([
          ...usable.map((course) => courseOfferingId(course)),
          ...list.map((item) => item.offeringId || '').filter(Boolean),
        ]),
      ];
      const status = await loadAppealTeacherStatus(schoolId, offeringIds);
      if (!mounted.current || run !== generation.current) return null;
      setItems(list);
      setCourses(usable);
      setAssigned(status);
      return status;
    } catch {
      if (mounted.current && run === generation.current) {
        setNotice('現在讀不到申訴，請稍後再試。');
      }
      return null;
    }
  }, [uid, schoolId]);

  useLayoutEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(load);
    return () => {
      mounted.current = false;
      generation.current += 1;
      opLock.current = false;
    };
  }, [load]);

  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          appealTimeValue(b.updatedAt || b.createdAt) - appealTimeValue(a.updatedAt || a.createdAt),
      ),
    [items],
  );

  const top = appealTopCard(items, assigned);
  const noCourses = courses !== null && courses.length === 0;
  const picked = courses?.find((course) => course.id === courseId);

  const submit = async () => {
    if (opLock.current || !mounted.current) return;
    if (!picked) {
      setNotice(noCourses ? APPEAL_NEED_COURSE_COPY : '請先選要申訴的課。');
      return;
    }
    if (title.trim().length < 4 || body.trim().length < 8) {
      setNotice('主旨至少四個字、說明至少八個字。');
      return;
    }
    const duplicate = items.some(
      (item) =>
        item.courseId === picked.id &&
        item.title.trim() === title.trim() &&
        (item.status === 'pending' || item.status === 'reviewing'),
    );
    if (duplicate) {
      setNotice('這門課已經有一樣主旨的申訴還沒處理完。');
      return;
    }
    opLock.current = true;
    setBusy(true);
    const offeringId = appealOfferingId(picked);
    try {
      await createCourseAppeal(
        {
          schoolId,
          studentUid: uid,
          courseId: picked.id,
          courseName: picked.name,
          offeringId,
          title: title.trim(),
          body: body.trim(),
        },
        requestId.current,
        courses || undefined,
      );
      if (!mounted.current) return;
      requestId.current = newRequestId();
      setTitle('');
      setBody('');
      setCourseId('');
    } catch {
      if (mounted.current) {
        setNotice('這次沒有送出，請稍後再試。');
        setBusy(false);
      }
      opLock.current = false;
      return;
    }
    // 送出成功（包括連按時第一下已經送到）：看這門課有沒有對應老師再決定怎麼說
    const latest = await load().catch(() => null);
    if (!mounted.current) return;
    setNotice(appealSubmittedCopy(offeringId, latest || assigned));
    setBusy(false);
    opLock.current = false;
  };

  const withdraw = async (id: string) => {
    if (opLock.current || !mounted.current) return;
    opLock.current = true;
    setBusy(true);
    try {
      await withdrawCourseAppeal(id);
      if (!mounted.current) return;
      setNotice('已撤回。');
      await load();
    } catch {
      if (mounted.current) setNotice('這次沒有撤回，請稍後再試。');
    } finally {
      if (mounted.current) {
        setBusy(false);
        opLock.current = false;
      }
    }
  };

  return (
    <SiteShell title="課程申訴" subtitle="送出後可以在這裡看老師處理到哪。">
      <section className={styles.panel} aria-label="目前狀態">
        <h2>{top.title}</h2>
        <p className={styles.notice}>{top.body}</p>
      </section>
      {notice && (
        <p className={styles.note} role="status">
          {notice}
        </p>
      )}
      <section className={styles.panel} aria-label="新增申訴">
        <h2>新增申訴</h2>
        {noCourses ? (
          <>
            <p className={styles.notice}>{APPEAL_NEED_COURSE_COPY}</p>
            <Link href="/timetable" className="btn primary">
              去我的課表
            </Link>
          </>
        ) : (
          <>
            <label className={styles.field}>
              課程
              <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
                <option value="">從我的課表選一門課</option>
                {(courses || []).map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                    {course.day ? `（${courseTimeLabel(course)}）` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              主旨
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className={styles.field}>
              說明
              <textarea rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
            </label>
            <button
              type="button"
              className="btn primary"
              disabled={busy || !courseId}
              onClick={() => void submit()}
            >
              {busy ? '送出中…' : '送出'}
            </button>
          </>
        )}
      </section>
      <ul className={styles.list}>
        {sorted.map((item) => {
          const copy = APPEAL_STATUS_COPY[(item.status as AppealStatus) || 'pending'];
          return (
            <li key={item.id}>
              <div>
                <h3>
                  {item.courseName} · {copy.label}
                </h3>
                <p>{item.title}</p>
                <p>{appealStatusDetail(item, assigned)}</p>
                {item.teacherNote ? <p>老師說：{item.teacherNote}</p> : null}
              </div>
              {item.status === 'pending' && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void withdraw(item.id)}
                >
                  撤回
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </SiteShell>
  );
}
