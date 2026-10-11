'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  APPEAL_NEED_COURSE_COPY,
  APPEAL_STATUS_COPY,
  appealTimeValue,
  appealTopCard,
  courseTimeLabel,
  type AppealStatus,
  type CourseAppeal,
  type PersonalCourse,
} from '@campus/shared';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { useSelectedSchool } from '@/components/SelectedSchoolProvider';
import {
  createCourseAppeal,
  listCourseAppeals,
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
  const { user } = useAuth();
  const school = useSelectedSchool();
  const schoolId = school.selectedSchoolId || 'pu';
  const [items, setItems] = useState<CourseAppeal[]>([]);
  const [courses, setCourses] = useState<PersonalCourse[] | null>(null);
  const [courseId, setCourseId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(newRequestId());

  const load = useCallback(async () => {
    if (!user) return;
    const [rows, timetable] = await Promise.all([
      listCourseAppeals(schoolId, user.uid),
      loadPersonalTimetable(user.uid, schoolId),
    ]);
    setItems(rows as CourseAppeal[]);
    setCourses(timetable.courses.filter((course) => course.name.trim()));
  }, [user, schoolId]);

  useEffect(() => {
    void load().catch(() => setNotice('現在讀不到申訴，請稍後再試。'));
  }, [load]);

  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) => appealTimeValue(b.updatedAt || b.createdAt) - appealTimeValue(a.updatedAt || a.createdAt),
      ),
    [items],
  );

  if (!user) {
    return (
      <SiteShell title="課程申訴" subtitle="送出後可以在這裡看老師處理到哪。">
        <p className={styles.notice}>
          請先 <Link href="/login?returnUrl=/appeals">登入</Link>。
        </p>
      </SiteShell>
    );
  }

  const top = appealTopCard(items);
  const noCourses = courses !== null && courses.length === 0;
  const picked = courses?.find((course) => course.id === courseId);

  const submit = async () => {
    if (busy) return;
    if (!picked) {
      setNotice(noCourses ? APPEAL_NEED_COURSE_COPY : '請先選要申訴的課。');
      return;
    }
    if (title.trim().length < 4 || body.trim().length < 8) {
      setNotice('主旨至少四個字、說明至少八個字。');
      return;
    }
    setBusy(true);
    try {
      await createCourseAppeal(
        {
          schoolId,
          studentUid: user.uid,
          courseId: picked.id,
          courseName: picked.name,
          title: title.trim(),
          body: body.trim(),
        },
        requestId.current,
      );
      requestId.current = newRequestId();
      setTitle('');
      setBody('');
      setCourseId('');
      setNotice('已送出，等老師看。');
      await load();
    } catch {
      setNotice('這次沒有送出，請稍後再試。');
    } finally {
      setBusy(false);
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
          <p className={styles.notice}>
            {APPEAL_NEED_COURSE_COPY} <Link href="/timetable">我的課表 →</Link>
          </p>
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
                <p>{copy.detail}</p>
                {item.teacherNote ? <p>老師說：{item.teacherNote}</p> : null}
              </div>
              {item.status === 'pending' && (
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    void withdrawCourseAppeal(item.id).then(async () => {
                      setNotice('已撤回。');
                      await load();
                    })
                  }
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
