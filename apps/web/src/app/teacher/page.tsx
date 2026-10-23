'use client';

import { useCallback, useEffect, useState } from 'react';
import { APPEAL_STATUS_COPY, type AppealStatus } from '@campus/shared';
import { SiteShell } from '@/components/SiteShell';
import { SchoolAccountRequired } from '@/components/SchoolAccountRequired';
import { useAuth } from '@/components/AuthGuard';
import { useSelectedSchool } from '@/components/SelectedSchoolProvider';
import {
  decideCourseAppeal,
  listTeacherAppeals,
  type TeacherAppealRow,
} from '@/lib/timetable/store';
import styles from '@/components/academic/academic.module.css';

/** 「測試學生甲（S0000001）· 資料庫 · 期中考成績」 */
function appealHeading(item: TeacherAppealRow) {
  const who = item.studentNumber
    ? `${item.studentName}（${item.studentNumber}）`
    : item.studentName;
  return `${who} · ${item.courseName} · ${item.title}`;
}

/** 「10 月 12 日 10:00 送出」，台北時間 */
function submittedAt(item: TeacherAppealRow) {
  if (!item.createdAt) return '';
  const when = new Date(item.createdAt);
  const parts = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(when);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('month')} 月 ${get('day')} 日 ${get('hour')}:${get('minute')} 送出`;
}

export default function TeacherDeskPage() {
  const { user } = useAuth();
  const school = useSelectedSchool();
  const schoolId = school.selectedSchoolId || 'pu';
  const [items, setItems] = useState<TeacherAppealRow[] | null>(null);
  const [courses, setCourses] = useState<string[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const result = await listTeacherAppeals(schoolId);
      const rows = [...result.rows];
      setCourses(result.courses);
      rows.sort(
        (a, b) =>
          Date.parse(b.updatedAt || b.createdAt || '') -
          Date.parse(a.updatedAt || a.createdAt || ''),
      );
      setItems(rows);
      setDenied(false);
      setLoadError(false);
    } catch (error) {
      const code = (error as { code?: string })?.code || '';
      if (code.includes('permission-denied')) setDenied(true);
      else setLoadError(true);
    }
  }, [user, schoolId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) {
    return (
      <SiteShell title="老師工作台" subtitle="看學生的課程申訴，核准或不核准。">
        <SchoolAccountRequired
          returnUrl="/teacher"
          alternative="授課請先到課程空間，從你負責的那門課進去。"
        />
      </SiteShell>
    );
  }

  if (denied) {
    return (
      <SiteShell title="老師工作台" subtitle="看學生的課程申訴，核准或不核准。">
        <p className={styles.notice}>這頁給老師用。你的帳號在這所學校不是老師身分。</p>
      </SiteShell>
    );
  }

  const decide = async (id: string, status: 'approved' | 'rejected') => {
    if (busyId) return;
    setBusyId(id);
    try {
      await decideCourseAppeal(id, status, notes[id] || '');
      setNotice(
        status === 'approved' ? '已核准，學生那邊會看到「老師已核准。」' : '已標成不核准。',
      );
      await load();
    } catch {
      setNotice('這次沒有存成，請稍後再試。');
    } finally {
      setBusyId('');
    }
  };

  const open = (items || []).filter(
    (item) => item.status === 'pending' || item.status === 'reviewing',
  );
  const done = (items || []).filter(
    (item) => item.status === 'approved' || item.status === 'rejected',
  );

  return (
    <SiteShell title="老師工作台" subtitle="看學生的課程申訴，核准或不核准。">
      {notice && (
        <p className={styles.note} role="status">
          {notice}
        </p>
      )}
      <section className={styles.panel} aria-label="待處理申訴">
        <h2>待處理申訴</h2>
        {courses && courses.length > 0 && (
          <p className={styles.notice}>你教的課：{courses.join('、')}</p>
        )}
        {loadError ? (
          <p className={styles.notice}>現在讀不到申訴，請稍後再試。</p>
        ) : items === null ? (
          <p className={styles.notice}>讀取中…</p>
        ) : courses && courses.length === 0 ? (
          <p className={styles.notice}>
            你還沒有對應到任何一門課，所以看不到申訴。請學校管理者把你加到你教的課。
          </p>
        ) : items === null ? (
          <p className={styles.notice}>讀取中…</p>
        ) : open.length === 0 ? (
          <p className={styles.notice}>現在沒有待處理的申訴。</p>
        ) : (
          <ul className={styles.list}>
            {open.map((item) => (
              <li key={item.id}>
                <div>
                  <h3>{appealHeading(item)}</h3>
                  <p>
                    <time dateTime={item.createdAt || undefined}>{submittedAt(item)}</time>
                  </p>
                  <p>{item.body}</p>
                  <label className={styles.field}>
                    給學生的話（可不填）
                    <input
                      value={notes[item.id] || ''}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [item.id]: event.target.value }))
                      }
                    />
                  </label>
                </div>
                <div className={styles.toolbar}>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busyId === item.id}
                    onClick={() => void decide(item.id, 'approved')}
                  >
                    核准
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busyId === item.id}
                    onClick={() => void decide(item.id, 'rejected')}
                  >
                    不核准
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {done.length > 0 && (
        <section className={styles.panel} aria-label="處理過的申訴">
          <h2>處理過的申訴</h2>
          <ul className={styles.list}>
            {done.map((item) => (
              <li key={item.id}>
                <div>
                  <h3>{appealHeading(item)}</h3>
                  <p>{submittedAt(item)}</p>
                  <p>{APPEAL_STATUS_COPY[item.status as AppealStatus]?.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </SiteShell>
  );
}
