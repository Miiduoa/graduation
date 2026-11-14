'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { loadMyGroups, type MemberGroup } from './groupService';
import styles from './groups.module.css';

export function ClubDirectory({ uid, schoolId }: { uid: string; schoolId: string }) {
  const [segment, setSegment] = useState<'mine' | 'discover'>('mine');
  const [search, setSearch] = useState('');
  const [groups, setGroups] = useState<MemberGroup[] | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setGroups(null);
    setError(false);
    loadMyGroups(uid, schoolId).then(
      (data) => {
        if (active) setGroups(data.filter((group) => group.type === 'club'));
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [uid, schoolId, revision]);
  const visible = groups?.filter((group) =>
    `${group.name} ${group.description}`
      .toLocaleLowerCase('zh-TW')
      .includes(search.trim().toLocaleLowerCase('zh-TW')),
  );
  return (
    <div className={styles.page}>
      <div role="group" aria-label="社團分段" className={styles.actions}>
        <button
          className="btn"
          aria-pressed={segment === 'mine'}
          onClick={() => {
            setSegment('mine');
            setSearch('');
          }}
        >
          我的社團
        </button>
        <button
          className="btn"
          aria-pressed={segment === 'discover'}
          onClick={() => {
            setSegment('discover');
            setSearch('');
          }}
        >
          找社團
        </button>
      </div>
      <label className={styles.field}>
        {segment === 'mine' ? '搜尋我的社團' : '搜尋學校社團'}
        <input
          type="search"
          placeholder="名稱或介紹"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {segment === 'discover' ? (
        <section className={styles.status}>
          <h2>學校還沒提供社團名單。</h2>
          <p>尚未串接課外組核可名單，因此這裡不列出一般群組，也不提供入社或申請。</p>
        </section>
      ) : error ? (
        <section role="alert">
          <p>暫時無法讀取你的社團，請確認連線後重試。</p>
          <button className="btn" onClick={() => setRevision((v) => v + 1)}>
            重新讀取
          </button>
        </section>
      ) : !groups ? (
        <p role="status">正在確認社團與成員資格…</p>
      ) : !groups.length ? (
        <p>還沒加入社團，可以到「找社團」看看。</p>
      ) : !visible?.length ? (
        <p>沒有符合條件的結果</p>
      ) : (
        <div className={styles.list}>
          {visible.map((group) => (
            <article className={styles.group} key={group.id}>
              <h2>{group.name}</h2>
              <p>
                已加入 ·{' '}
                {group.memberCount === null ? '社員數未提供' : `${group.memberCount} 位社員`}
              </p>
              <p>{group.description || '社團尚未提供介紹。'}</p>
              <p>下一場活動尚未串接 · 未讀公告數未提供</p>
              <Link
                className="btn"
                href={`/groups/${encodeURIComponent(group.id)}/club/overview?schoolId=${encodeURIComponent(schoolId)}`}
              >
                查看社團
              </Link>
            </article>
          ))}
        </div>
      )}
      <p className={styles.availability}>
        「我的社團」列出已加入的群組，是否為正式社團仍以課外組名單為準。
      </p>
      <p>這所學校還沒開放社團管理。</p>
    </div>
  );
}
