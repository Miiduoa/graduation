'use client';

import { use, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { findSchoolById, findSchoolsByCode } from '@campus/shared/src/schools';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { joinByCode, leaveMemberGroup, loadMyGroups, type MemberGroup } from './groupService';
import styles from './groups.module.css';

type Mode = 'groups' | 'clubs';
type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; groups: MemberGroup[] };
const typeLabels = { course: '課程', club: '社團', study: '讀書會', other: '其他' };
const roles: Record<string, string> = {
  owner: '擁有者',
  admin: '管理員',
  instructor: '授課教師',
  moderator: '協作管理員',
  member: '成員',
};

function MemberDirectory({ uid, schoolId, mode }: { uid: string; schoolId: string; mode: Mode }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [mustRefresh, setMustRefresh] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const actionLock = useRef(false);
  const load = useCallback(() => {
    const request = ++generation.current;
    return loadMyGroups(uid, schoolId).then(
      (groups) => {
        if (mounted.current && request === generation.current) {
          setState({ status: 'ready', groups });
          setMustRefresh(false);
        }
      },
      () => {
        if (mounted.current && request === generation.current) setState({ status: 'error' });
      },
    );
  }, [uid, schoolId]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [load]);

  function refresh() {
    if (actionLock.current) return;
    setState({ status: 'loading' });
    setConfirmLeave(null);
    setNotice(null);
    void load();
  }
  async function changeMembership(action: 'join' | 'leave', group?: MemberGroup) {
    if (actionLock.current || mustRefresh || state.status !== 'ready') return;
    actionLock.current = true;
    setPending(group?.id ?? 'join');
    setNotice(null);
    const request = generation.current;
    const current = () => mounted.current && request === generation.current;
    try {
      if (action === 'join') {
        const joined = await joinByCode(uid, schoolId, code, current);
        if (!current()) return;
        setState((previous) =>
          previous.status === 'ready'
            ? {
                status: 'ready',
                groups: [...previous.groups.filter((item) => item.id !== joined.id), joined],
              }
            : previous,
        );
        setCode('');
        setNotice({ text: `已加入「${joined.name}」。`, error: false });
      } else if (group) {
        await leaveMemberGroup(uid, schoolId, group.id, current);
        if (!current()) return;
        setState((previous) =>
          previous.status === 'ready'
            ? { status: 'ready', groups: previous.groups.filter((item) => item.id !== group.id) }
            : previous,
        );
        setConfirmLeave(null);
        setNotice({ text: `已退出「${group.name}」。`, error: false });
      }
    } catch {
      if (current()) {
        setMustRefresh(true);
        setNotice({
          text: '未能確認操作結果。請先更新列表確認成員狀態，再決定是否重試。',
          error: true,
        });
      }
    } finally {
      actionLock.current = false;
      if (current()) setPending(null);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (code.trim()) void changeMembership('join');
  }

  if (state.status === 'loading')
    return (
      <p className={styles.status} role="status">
        正在確認群組與成員資格…
      </p>
    );
  if (state.status === 'error')
    return (
      <section className={styles.status} role="alert">
        <h2>暫時無法讀取你的群組</h2>
        <p>請確認連線與學校帳號後再試一次。</p>
        <button className="btn primary" onClick={refresh}>
          重新讀取
        </button>
      </section>
    );
  const groups = state.groups.filter((group) => mode !== 'clubs' || group.type === 'club');
  const needle = search.trim().toLocaleLowerCase('zh-TW');
  const filtered = groups.filter(
    (group) =>
      (type === 'all' || group.type === type) &&
      `${group.name} ${group.description}`.toLocaleLowerCase('zh-TW').includes(needle),
  );
  return (
    <div className={styles.page}>
      <div className={styles.source}>
        <p>
          目前已加入 {groups.length} 個{mode === 'clubs' ? '社團' : '群組'}
        </p>
        <button className="btn" disabled={pending !== null} onClick={refresh}>
          更新列表
        </button>
      </div>
      <form className={styles.join} onSubmit={submit}>
        <div>
          <h2>以邀請碼加入</h2>
          <p>輸入課程或社團提供的邀請碼。加入後可在「我的群組」查看。</p>
        </div>
        <label className={styles.field}>
          邀請碼
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={64}
            disabled={pending !== null || mustRefresh}
          />
        </label>
        <button
          className="btn primary"
          disabled={!code.trim() || pending !== null || mustRefresh}
          type="submit"
        >
          {pending === 'join' ? '正在確認…' : '加入群組'}
        </button>
      </form>
      {notice && (
        <p role={notice.error ? 'alert' : 'status'} className={styles.notice}>
          {notice.text}
        </p>
      )}
      <div className={styles.toolbar}>
        <label className={styles.field}>
          搜尋{mode === 'clubs' ? '社團' : '群組'}
          <input
            type="search"
            placeholder="名稱或介紹"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {mode === 'groups' && (
          <label className={styles.field}>
            類型
            <select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="all">全部</option>
              {Object.entries(typeLabels).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {filtered.length === 0 ? (
        <section className={styles.status}>
          <h2>
            {groups.length ? '沒有符合條件的結果' : `尚未加入${mode === 'clubs' ? '社團' : '群組'}`}
          </h2>
          <p>
            {groups.length ? '試試其他關鍵字或類型。' : '向授課教師或社團取得邀請碼後，即可加入。'}
          </p>
        </section>
      ) : (
        <div className={styles.list}>
          {filtered.map((group) => (
            <article key={group.id} className={styles.group}>
              <div className={styles.meta}>
                <span>{typeLabels[group.type]}</span>
                <span>{roles[group.role] ?? '成員'}</span>
                {group.memberCount !== null && <span>{group.memberCount} 位成員</span>}
              </div>
              <h2>
                {group.type === 'course' ? (
                  <Link
                    href={`/course/${encodeURIComponent(group.id)}?schoolId=${encodeURIComponent(schoolId)}`}
                  >
                    {group.name} ↗
                  </Link>
                ) : (
                  group.name
                )}
              </h2>
              {group.description && <p className={styles.description}>{group.description}</p>}
              <div className={styles.actions}>
                {group.type === 'course' ? (
                  <Link
                    className="btn"
                    href={`/course/${encodeURIComponent(group.id)}?schoolId=${encodeURIComponent(schoolId)}`}
                  >
                    查看課程
                  </Link>
                ) : (
                  <p>網頁版討論尚未開放。</p>
                )}
                {group.role === 'owner' ? (
                  <p>擁有者需先移轉管理權，才能退出。</p>
                ) : confirmLeave === group.id ? (
                  <div className={styles.confirm}>
                    <p>確定退出「{group.name}」？再次加入需要邀請碼。</p>
                    <button
                      className="btn"
                      disabled={pending !== null || mustRefresh}
                      onClick={() => void changeMembership('leave', group)}
                    >
                      {pending === group.id ? '正在確認…' : '確認退出'}
                    </button>
                    <button
                      className="btn"
                      disabled={pending !== null}
                      onClick={() => setConfirmLeave(null)}
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn"
                    disabled={pending !== null || mustRefresh}
                    onClick={() => setConfirmLeave(group.id)}
                  >
                    退出群組
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function GroupDirectory({
  mode,
  searchParams,
}: {
  mode: Mode;
  searchParams?: Promise<{ school?: string; schoolId?: string }>;
}) {
  const params = searchParams ? use(searchParams) : undefined;
  const matches = findSchoolsByCode(params?.school);
  const school =
    findSchoolById(params?.schoolId) ??
    (matches.length === 1 ? matches[0] : resolveSchoolPageContext().school);
  const { user, loading } = useAuth();
  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title={mode === 'clubs' ? '我的社團' : '我的群組'}
      subtitle={
        mode === 'clubs'
          ? '查看已加入的社團，透過邀請碼連結新夥伴。'
          : '課程、社團與讀書會，都從你已加入的群組開始。'
      }
    >
      <nav className={styles.navigation} aria-label="校園群組">
        <Link
          href={`/groups?schoolId=${encodeURIComponent(school.id)}`}
          aria-current={mode === 'groups' ? 'page' : undefined}
        >
          我的群組
        </Link>
        <Link
          href={`/clubs?schoolId=${encodeURIComponent(school.id)}`}
          aria-current={mode === 'clubs' ? 'page' : undefined}
        >
          我的社團
        </Link>
      </nav>
      {mode === 'clubs' && (
        <p className={styles.availability}>
          社團公開列表尚未開放。想認識新社團，可向社團取得邀請碼。
        </p>
      )}
      {loading ? (
        <p className={styles.status} role="status">
          正在確認帳號…
        </p>
      ) : !user ? (
        <section className={styles.status}>
          <h2>登入後查看已加入的{mode === 'clubs' ? '社團' : '群組'}</h2>
          <p>使用你的學校帳號，查看成員資格與加入紀錄。</p>
          <Link
            className="btn primary"
            href={`/login?returnUrl=${encodeURIComponent(`/${mode}?schoolId=${school.id}`)}`}
          >
            登入學校帳號
          </Link>
        </section>
      ) : (
        <MemberDirectory
          key={JSON.stringify([user.uid, school.id, mode])}
          uid={user.uid}
          schoolId={school.id}
          mode={mode}
        />
      )}
    </SiteShell>
  );
}
