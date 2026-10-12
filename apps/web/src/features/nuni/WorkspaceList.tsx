'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { NuniError, nuniErrorMessage, type NuniWorkspace } from '@campus/shared/src/nuni';
import { MutationForm, useClasses } from './CourseUI';
import { useNuniSession } from './Session';
import { courseRoleLabels } from './courseTasks';
import styles from './NuniApp.module.css';

function CourseList({ title, items }: { title: string; items: NuniWorkspace[] }) {
  if (!items.length) return null;
  return (
    <section className={styles.panel} aria-label={title}>
      <h2>
        {title} <span className={styles.muted}>{items.length}</span>
      </h2>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.id}>
            <Link className={styles.row} href={`/classroom/course/${item.id}`}>
              <span>
                <strong>{item.title}</strong>
                <small>{courseRoleLabels[item.memberRole]}</small>
              </span>
              <span aria-hidden>→</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WorkspaceList() {
  const classes = useClasses();
  const { refresh: refreshSession } = useNuniSession();
  const router = useRouter();
  const [items, setItems] = useState<NuniWorkspace[] | null>(null);
  const [error, setError] = useState('');
  const [epoch, setEpoch] = useState(0);
  const [action, setAction] = useState<'join' | 'create' | null>(null);
  useEffect(() => {
    let active = true;
    setError('');
    setItems(null);
    void classes
      .list()
      .then((result) => {
        if (active) setItems(result);
      })
      .catch((failure) => {
        if (!active) return;
        setError(nuniErrorMessage(failure));
        if (
          failure instanceof NuniError &&
          (failure.status === 401 || failure.code === 'SESSION_CHANGED')
        )
          void refreshSession();
      });
    return () => {
      active = false;
    };
    // The parent keys this view by the verified account session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);
  const open = (workspace: NuniWorkspace) => router.push(`/classroom/course/${workspace.id}`);
  const studying =
    items?.filter((item) => item.state === 'active' && item.memberRole === 'student') ?? [];
  const teaching =
    items?.filter((item) => item.state === 'active' && item.memberRole !== 'student') ?? [];
  const archived = items?.filter((item) => item.state !== 'active') ?? [];

  return (
    <>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>課程空間</p>
          <h1>我的課程</h1>
          <p className={styles.muted}>選一門課，接著完成作業、查看教材或處理學生繳交。</p>
        </div>
        <button
          className={`${styles.button} ${styles.secondary}`}
          onClick={() => setEpoch((value) => value + 1)}
        >
          更新課程
        </button>
      </div>
      <div className={styles.grid}>
        <div>
          {error ? (
            <p className={styles.notice} role="alert">
              {error}
            </p>
          ) : !items ? (
            <p role="status">正在讀取課程…</p>
          ) : items.length ? (
            <>
              <CourseList title="我修的課" items={studying} />
              <CourseList title="我教的課" items={teaching} />
              {archived.length > 0 && (
                <details className={styles.compose}>
                  <summary>已封存課程 {archived.length}</summary>
                  <CourseList title="已封存的課程" items={archived} />
                </details>
              )}
            </>
          ) : (
            <section className={styles.panel}>
              <h2>先加入你的第一門課</h2>
              <p className={styles.muted}>
                拿到老師的邀請碼後，選擇「加入課程」。如果你要負責授課，選擇「建立課程」。
              </p>
            </section>
          )}
        </div>
        <aside>
          <section className={styles.panel}>
            <h2>新增一門課</h2>
            <div className={styles.actions} role="group" aria-label="選擇課程操作">
              <button
                className={`${styles.button} ${action === 'join' ? '' : styles.secondary}`}
                type="button"
                aria-expanded={action === 'join'}
                aria-controls="join-course-form"
                onClick={() => setAction(action === 'join' ? null : 'join')}
              >
                加入課程
              </button>
              <button
                className={`${styles.button} ${action === 'create' ? '' : styles.secondary}`}
                type="button"
                aria-expanded={action === 'create'}
                aria-controls="create-course-form"
                onClick={() => setAction(action === 'create' ? null : 'create')}
              >
                建立課程
              </button>
            </div>
            <div id="join-course-form" hidden={action !== 'join'} className={styles.nextForm}>
              <p className={styles.muted}>輸入授課老師提供的邀請碼，你會以修課學生身分加入。</p>
              <MutationForm
                label="確認加入"
                submit={async (data, key) =>
                  open(
                    await classes.join(
                      String(data.get('code'))
                        .trim()
                        .toUpperCase()
                        .replace(/[\s-]+/g, ''),
                      key,
                    ),
                  )
                }
              >
                <label>
                  邀請碼
                  <input
                    name="code"
                    required
                    minLength={6}
                    maxLength={24}
                    autoCapitalize="characters"
                    autoComplete="off"
                    placeholder="輸入老師提供的代碼"
                  />
                </label>
              </MutationForm>
            </div>
            <div id="create-course-form" hidden={action !== 'create'} className={styles.nextForm}>
              <p className={styles.muted}>
                你將成為這門課的負責老師，可以邀請學生、發布教材與作業。這只影響這一門課的權限。
              </p>
              <MutationForm
                label="確認建立課程"
                submit={async (data, key) =>
                  open(await classes.create(String(data.get('title')), key))
                }
              >
                <label>
                  課程名稱
                  <input
                    name="title"
                    required
                    minLength={2}
                    maxLength={120}
                    placeholder="例如：設計專題"
                  />
                </label>
              </MutationForm>
            </div>
          </section>
          <p className={styles.note}>
            每門課的身分分開管理。建立或加入課程，不會取得學校的正式學籍、成績或管理權限。
          </p>
        </aside>
      </div>
    </>
  );
}
