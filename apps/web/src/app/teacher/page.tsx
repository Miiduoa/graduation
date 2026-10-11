'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { APPEAL_STATUS_COPY, appealTimeValue, type AppealStatus, type CourseAppeal } from '@campus/shared';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { useSelectedSchool } from '@/components/SelectedSchoolProvider';
import { decideCourseAppeal, listSchoolAppeals } from '@/lib/timetable/store';
import styles from '@/components/academic/academic.module.css';

export default function TeacherDeskPage() {
  const { user } = useAuth();
  const school = useSelectedSchool();
  const schoolId = school.selectedSchoolId || 'pu';
  const [items, setItems] = useState<CourseAppeal[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const rows = (await listSchoolAppeals(schoolId)) as CourseAppeal[];
      rows.sort((a, b) => appealTimeValue(b.updatedAt || b.createdAt) - appealTimeValue(a.updatedAt || a.createdAt));
      setItems(rows);
      setDenied(false);
    } catch {
      setDenied(true);
    }
  }, [user, schoolId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) {
    return (
      <SiteShell title="老師工作台" subtitle="看學生的課程申訴，核准或不核准。">
        <p className={styles.notice}>
          請先 <Link href="/login?returnUrl=/teacher">登入</Link>。
        </p>
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
      setNotice(status === 'approved' ? '已核准，學生那邊會看到「老師已核准。」' : '已標成不核准。');
      await load();
    } catch {
      setNotice('這次沒有存成，請稍後再試。');
    } finally {
      setBusyId('');
    }
  };

  const open = (items || []).filter((item) => item.status === 'pending' || item.status === 'reviewing');
  const done = (items || []).filter((item) => item.status === 'approved' || item.status === 'rejected');

  return (
    <SiteShell title="老師工作台" subtitle="看學生的課程申訴，核准或不核准。">
      {notice && (
        <p className={styles.note} role="status">
          {notice}
        </p>
      )}
      <section className={styles.panel} aria-label="待處理申訴">
        <h2>待處理申訴</h2>
        {items === null ? (
          <p className={styles.notice}>讀取中…</p>
        ) : open.length === 0 ? (
          <p className={styles.notice}>現在沒有待處理的申訴。</p>
        ) : (
          <ul className={styles.list}>
            {open.map((item) => (
              <li key={item.id}>
                <div>
                  <h3>
                    {item.courseName} · {item.title}
                  </h3>
                  <p>{item.body}</p>
                  <label className={styles.field}>
                    給學生的話（可不填）
                    <input
                      value={notes[item.id] || ''}
                      onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
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
                  <h3>
                    {item.courseName} · {item.title}
                  </h3>
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
