'use client';

import { useEffect, useState } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { useSelectedSchool } from '@/components/SelectedSchoolProvider';
import { APPEAL_STATUS_COPY, appealTopCard, type AppealStatus, type CourseAppeal } from '@campus/shared';
import { createCourseAppeal, listCourseAppeals, withdrawCourseAppeal } from '@/lib/timetable/store';
import styles from '@/components/academic/academic.module.css';
import Link from 'next/link';

export default function AppealsPage() {
  const { user } = useAuth();
  const school = useSelectedSchool();
  const schoolId = school.selectedSchoolId || 'pu';
  const [items, setItems] = useState<CourseAppeal[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [courseName, setCourseName] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    if (!user) return;
    const rows = (await listCourseAppeals(schoolId, user.uid)) as CourseAppeal[];
    setItems(rows);
  };

  useEffect(() => {
    void load().catch(() => setNotice('現在讀不到申訴資料。沒有案件時不會顯示進度。'));
  }, [user, schoolId]);

  if (!user) {
    return (
      <SiteShell title="課程申訴" subtitle="頂卡只跟真實案件走，沒有案件就沒有進度。">
        <p className={styles.notice}>
          請先 <Link href="/login?returnUrl=/appeals">登入</Link>。
        </p>
      </SiteShell>
    );
  }

  const top = appealTopCard(items);

  return (
    <SiteShell title="課程申訴" subtitle="送出後會記在本站，頂卡顯示目前案件的真實狀態。">
      <section className={styles.panel} aria-label="目前狀態">
        <h2>{top.title}</h2>
        <p className={styles.notice}>{top.body}</p>
      </section>
      {notice && (
        <p className={styles.note} role="status">
          {notice}
        </p>
      )}
      <section className={styles.panel}>
        <h2>新增申訴</h2>
        <label className={styles.field}>
          課程
          <input value={courseName} onChange={(event) => setCourseName(event.target.value)} />
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
          onClick={() => {
            if (title.trim().length < 4 || body.trim().length < 8 || !courseName.trim()) {
              setNotice('請填課程、主旨與至少八個字的說明。沒有填完不會送出。');
              return;
            }
            void createCourseAppeal({
              schoolId,
              studentUid: user.uid,
              courseId: courseName.trim(),
              courseName: courseName.trim(),
              title: title.trim(),
              body: body.trim(),
            })
              .then(async () => {
                setTitle('');
                setBody('');
                setCourseName('');
                setNotice('已記在本站，等待教師查看。');
                await load();
              })
              .catch(() => setNotice('這次沒有送出。請確認你屬於這所學校後再試。'));
          }}
        >
          送出
        </button>
      </section>
      <ul className={styles.list}>
        {items.map((item) => {
          const copy = APPEAL_STATUS_COPY[(item.status as AppealStatus) || 'pending'];
          return (
            <li key={item.id}>
              <div>
                <h3>
                  {copy.label} · {item.courseName}
                </h3>
                <p>{item.title}</p>
                <p>{copy.detail}</p>
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
