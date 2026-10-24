'use client';

import { use, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import {
  canEditPost,
  createGroupDiscussionPost,
  createPublicationIntentId,
  deleteGroupDiscussionPost,
  loadGroupDiscussionPage,
  updateGroupDiscussionPost,
  type GroupDiscussionPost,
} from './groupDiscussionService';
import type { MemberGroup } from './groupService';
import styles from './groups.module.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      group: MemberGroup;
      posts: GroupDiscussionPost[];
      hasMore: boolean;
    };

/** 送出前凍結的發布意圖；未確認成功前不可被草稿編輯覆寫。 */
type PublicationIntent = {
  postId: string;
  title: string;
  body: string;
  kind: 'post' | 'question';
};

type StoredCompose = {
  /** 可自由編輯的草稿（僅在無鎖定意圖時寫回）。 */
  draft?: { title: string; body: string; kind: 'post' | 'question' };
  /** 已送出或衝突中的不可變意圖。 */
  intent?: PublicationIntent;
  phase?: 'idle' | 'uncertain' | 'conflict';
};

const kindLabels = { post: '討論', question: '提問', announcement: '公告' };

function readStoredCompose(key: string): StoredCompose | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCompose & {
      title?: string;
      body?: string;
      kind?: string;
      postId?: string;
    };
    // 相容舊草稿格式。
    if (!parsed.intent && !parsed.draft && (parsed.title || parsed.body || parsed.postId)) {
      const postId =
        typeof parsed.postId === 'string' && parsed.postId && !parsed.postId.includes('/')
          ? parsed.postId
          : createPublicationIntentId();
      const draft = {
        title: typeof parsed.title === 'string' ? parsed.title : '',
        body: typeof parsed.body === 'string' ? parsed.body : '',
        kind: (parsed.kind === 'question' ? 'question' : 'post') as 'post' | 'question',
      };
      return {
        draft,
        intent: parsed.phase === 'uncertain' || parsed.phase === 'conflict'
          ? { ...draft, postId }
          : undefined,
        phase: parsed.phase === 'conflict' || parsed.phase === 'uncertain' ? parsed.phase : 'idle',
      };
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredCompose(key: string, value: StoredCompose | null) {
  try {
    if (!value || (!value.draft && !value.intent)) {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, JSON.stringify(value));
    }
    return true;
  } catch {
    return false;
  }
}

function DiscussionBoard({
  uid,
  schoolId,
  groupId,
  displayName,
}: {
  uid: string;
  schoolId: string;
  groupId: string;
  displayName?: string | null;
}) {
  const draftKey = `campus-one:group-draft:${schoolId}:${groupId}:${uid}`;
  const initial = readStoredCompose(draftKey);
  const initialForm = initial?.intent ?? initial?.draft;
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [title, setTitle] = useState(initialForm?.title ?? '');
  const [body, setBody] = useState(initialForm?.body ?? '');
  const [kind, setKind] = useState<'post' | 'question'>(initialForm?.kind ?? 'post');
  /** 鎖定中的發布意圖；有值時表單編輯不得覆寫其內容。 */
  const [lockedIntent, setLockedIntent] = useState<PublicationIntent | null>(initial?.intent ?? null);
  const [phase, setPhase] = useState<'idle' | 'uncertain' | 'conflict'>(
    initial?.phase === 'conflict' || initial?.phase === 'uncertain' ? initial.phase : 'idle',
  );
  const [pending, setPending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const intentLocked = phase === 'uncertain' || phase === 'conflict';
  const draftSaved = Boolean(title.trim() || body.trim() || lockedIntent);
  const mounted = useRef(false);
  const generation = useRef(0);
  const cursorRef = useRef<Awaited<
    ReturnType<typeof loadGroupDiscussionPage>
  >['page']['cursor']>(null);

  const load = useCallback(
    (mode: 'replace' | 'append' = 'replace') => {
      const request = ++generation.current;
      const current = () => mounted.current && request === generation.current;
      if (mode === 'replace') {
        cursorRef.current = null;
        setState({ status: 'loading' });
      } else {
        setLoadingMore(true);
      }
      return loadGroupDiscussionPage(
        uid,
        schoolId,
        groupId,
        current,
        mode === 'append' ? cursorRef.current : null,
      ).then(
        ({ group, page }) => {
          if (!current()) return;
          cursorRef.current = page.cursor;
          setState((previous) => {
            if (mode === 'append' && previous.status === 'ready') {
              const seen = new Set(previous.posts.map((row) => row.id));
              return {
                status: 'ready',
                group,
                posts: [...previous.posts, ...page.posts.filter((row) => !seen.has(row.id))],
                hasMore: page.hasMore,
              };
            }
            return {
              status: 'ready',
              group,
              posts: page.posts,
              hasMore: page.hasMore,
            };
          });
          setLoadingMore(false);
          setNotice(null);
        },
        (failure: unknown) => {
          if (!current()) return;
          setLoadingMore(false);
          setState({
            status: 'error',
            message:
              failure instanceof Error && failure.message
                ? failure.message
                : '暫時無法讀取討論。請確認學校帳號與成員資格後再試。',
          });
        },
      );
    },
    [uid, schoolId, groupId],
  );

  useEffect(() => {
    mounted.current = true;
    void load('replace');
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (lockedIntent) {
      // 不確定／衝突期間：只持久化不可變意圖，表單暫改不得覆寫 intent 內容。
      writeStoredCompose(draftKey, {
        intent: lockedIntent,
        phase: phase === 'conflict' ? 'conflict' : 'uncertain',
      });
      return;
    }
    if (!title.trim() && !body.trim()) {
      writeStoredCompose(draftKey, null);
      return;
    }
    const saved = writeStoredCompose(draftKey, {
      draft: { title, body, kind },
      phase: 'idle',
    });
    if (!saved) setNotice({ text: '無法在這台裝置保留草稿，請先複製內容備份，再重試。', error: true });
  }, [title, body, kind, draftKey, phase, lockedIntent]);

  function beginNewPublication() {
    setLockedIntent(null);
    setPhase('idle');
    setTitle('');
    setBody('');
    setKind('post');
    setNotice(null);
    writeStoredCompose(draftKey, null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || state.status !== 'ready') return;
    const request = generation.current;
    const current = () => mounted.current && request === generation.current;

    // 已有鎖定意圖：只能用該意圖重試，絕不可因衝突自動換 ID。
    const intent: PublicationIntent = lockedIntent ?? {
      postId: createPublicationIntentId(),
      title: title.trim(),
      body: body.trim(),
      kind,
    };
    if (!intent.title || !intent.body) return;

    if (!writeStoredCompose(draftKey, { intent, phase: 'uncertain' })) {
      setNotice({ text: '無法保留這次的發布記錄，尚未送出貼文。請先複製內容備份，再重試。', error: true });
      return;
    }

    setLockedIntent(intent);
    setPhase('uncertain');
    setTitle(intent.title);
    setBody(intent.body);
    setKind(intent.kind);
    setPending(true);
    setNotice(null);

    try {
      const created = await createGroupDiscussionPost(
        uid,
        schoolId,
        groupId,
        {
          title: intent.title,
          body: intent.body,
          kind: intent.kind,
          postId: intent.postId,
        },
        current,
        displayName,
      );
      // 離開後即使伺服器已成功，也不更新舊畫面；意圖保留供 remount 重試確認。
      if (!current()) return;
      setState((previous) =>
        previous.status === 'ready'
          ? { ...previous, posts: [created, ...previous.posts.filter((row) => row.id !== created.id)] }
          : previous,
      );
      setLockedIntent(null);
      setPhase('idle');
      setTitle('');
      setBody('');
      setKind('post');
      writeStoredCompose(draftKey, null);
      setNotice({ text: '已發布貼文。', error: false });
    } catch (failure) {
      if (!current()) return;
      // 不論衝突或連線不確定，都保留「同一」嘗試過的意圖。
      setLockedIntent(intent);
      setTitle(intent.title);
      setBody(intent.body);
      setKind(intent.kind);
      if (failure instanceof Error && failure.message === 'Post intent conflict') {
        setPhase('conflict');
        writeStoredCompose(draftKey, { intent, phase: 'conflict' });
        setNotice({
          text: '先前送出的貼文已有不同內容。請先查看討論列表，再重試確認或開始新貼文。',
          error: true,
        });
      } else {
        setPhase('uncertain');
        writeStoredCompose(draftKey, { intent, phase: 'uncertain' });
        setNotice({
          text: '發布結果尚未確認，原稿已保留。重試會先確認是否發布成功，避免重複貼文。',
          error: true,
        });
      }
    } finally {
      if (current()) setPending(false);
    }
  }

  async function saveEdit(post: GroupDiscussionPost) {
    if (pending || state.status !== 'ready') return;
    setPending(true);
    setNotice(null);
    const request = generation.current;
    const current = () => mounted.current && request === generation.current;
    try {
      await updateGroupDiscussionPost(
        uid,
        schoolId,
        groupId,
        post.id,
        { title: editTitle, body: editBody },
        current,
        post,
      );
      if (!current()) return;
      setState((previous) =>
        previous.status === 'ready'
          ? {
              ...previous,
              posts: previous.posts.map((row) =>
                row.id === post.id
                  ? { ...row, title: editTitle.trim(), body: editBody.trim() }
                  : row,
              ),
            }
          : previous,
      );
      setEditingId(null);
      setNotice({ text: '已更新貼文。', error: false });
    } catch {
      if (current()) {
        setNotice({ text: '更新未能確認，內容仍保留在編輯欄。', error: true });
      }
    } finally {
      if (current()) setPending(false);
    }
  }

  async function removePost(post: GroupDiscussionPost) {
    if (pending || state.status !== 'ready') return;
    setPending(true);
    setNotice(null);
    const request = generation.current;
    const current = () => mounted.current && request === generation.current;
    try {
      await deleteGroupDiscussionPost(uid, schoolId, groupId, post.id, current, post);
      if (!current()) return;
      setState((previous) =>
        previous.status === 'ready'
          ? { ...previous, posts: previous.posts.filter((row) => row.id !== post.id) }
          : previous,
      );
      setConfirmDelete(null);
      setNotice({ text: '已刪除貼文。', error: false });
    } catch {
      if (current()) {
        setNotice({ text: '刪除未能確認，請更新列表後再決定是否重試。', error: true });
      }
    } finally {
      if (current()) setPending(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <p className={styles.status} role="status">
        正在確認成員資格並載入討論…
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <section className={styles.status} role="alert">
        <h2>無法開啟討論</h2>
        <p>{state.message}</p>
        <button className="btn primary" onClick={() => void load('replace')}>
          重新讀取
        </button>
      </section>
    );
  }

  const { group, posts, hasMore } = state;
  return (
    <div className={styles.page}>
      <div className={styles.source}>
        <div>
          <p>
            {group.name} · {group.role === 'owner' ? '擁有者' : '成員'}
          </p>
          <p className={styles.availability}>
            此討論僅供已取得學校資格的群組成員使用。
          </p>
        </div>
        <button className="btn" disabled={pending || loadingMore} onClick={() => void load('replace')}>
          更新討論
        </button>
      </div>

      <form className={styles.compose} onSubmit={submit}>
        <div>
          <h2>發布討論</h2>
          <p>
            {phase === 'conflict'
              ? '先前送出的貼文已有不同內容，請先查看列表。'
              : phase === 'uncertain'
                ? '這篇貼文的發布結果尚未確認。可以重試確認；開始新貼文前，請先查看列表是否已發布。'
                : draftSaved
                  ? '標題與內容會寫入目前群組；已在此裝置保留草稿。'
                  : '標題與內容會寫入目前群組。'}
          </p>
        </div>
        <label className={styles.field}>
          類型
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as 'post' | 'question')}
            disabled={pending || intentLocked}
          >
            <option value="post">討論</option>
            <option value="question">提問</option>
          </select>
        </label>
        <label className={styles.field}>
          標題
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            disabled={pending || intentLocked}
            required
          />
        </label>
        <label className={styles.field}>
          內容
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={8000}
            rows={5}
            disabled={pending || intentLocked}
            required
          />
        </label>
        <div className={styles.actions}>
          <button
            className="btn primary"
            type="submit"
            disabled={pending || !title.trim() || !body.trim()}
          >
            {pending ? '正在確認…' : intentLocked ? '重試確認' : '發布'}
          </button>
          {intentLocked ? (
            <button className="btn" type="button" disabled={pending} onClick={beginNewPublication}>
              開始新貼文
            </button>
          ) : null}
        </div>
      </form>

      {notice && (
        <p role={notice.error ? 'alert' : 'status'} className={styles.notice}>
          {notice.text}
        </p>
      )}

      {posts.length === 0 ? (
        <section className={styles.status}>
          <h2>尚無貼文</h2>
          <p>成為第一位在此群組發起討論的人。</p>
        </section>
      ) : (
        <div className={styles.list}>
          {posts.map((post) => (
            <article key={post.id} className={styles.group}>
              <div className={styles.meta}>
                <span>{kindLabels[post.kind]}</span>
                <span>{post.authorName || post.authorId}</span>
              </div>
              {editingId === post.id ? (
                <div className={styles.compose}>
                  <label className={styles.field}>
                    標題
                    <input
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      maxLength={120}
                      disabled={pending}
                    />
                  </label>
                  <label className={styles.field}>
                    內容
                    <textarea
                      value={editBody}
                      onChange={(event) => setEditBody(event.target.value)}
                      maxLength={8000}
                      rows={4}
                      disabled={pending}
                    />
                  </label>
                  <div className={styles.actions}>
                    <button
                      className="btn primary"
                      type="button"
                      disabled={pending}
                      onClick={() => void saveEdit(post)}
                    >
                      儲存
                    </button>
                    <button className="btn" type="button" disabled={pending} onClick={() => setEditingId(null)}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <h2>{post.title}</h2>
                  <p className={styles.description}>{post.body}</p>
                  {canEditPost(group.role, post.authorId, uid) && (
                    <div className={styles.actions}>
                      <button
                        className="btn"
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setEditingId(post.id);
                          setEditTitle(post.title);
                          setEditBody(post.body);
                          setConfirmDelete(null);
                        }}
                      >
                        編輯
                      </button>
                      {confirmDelete === post.id ? (
                        <div className={styles.confirm}>
                          <p>確定刪除「{post.title}」？</p>
                          <button
                            className="btn"
                            type="button"
                            disabled={pending}
                            onClick={() => void removePost(post)}
                          >
                            確認刪除
                          </button>
                          <button
                            className="btn"
                            type="button"
                            disabled={pending}
                            onClick={() => setConfirmDelete(null)}
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn"
                          type="button"
                          disabled={pending}
                          onClick={() => setConfirmDelete(post.id)}
                        >
                          刪除
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </article>
          ))}
        </div>
      )}

      {hasMore && (
        <div className={styles.actions}>
          <button
            className="btn"
            type="button"
            disabled={pending || loadingMore}
            onClick={() => void load('append')}
          >
            {loadingMore ? '載入中…' : '載入更早的貼文'}
          </button>
        </div>
      )}

      {group.role === 'owner' && (
        <p className={styles.availability}>
          擁有者需先完成交接，才能退出群組。
        </p>
      )}
    </div>
  );
}

export function GroupDiscussion({
  groupId,
  searchParams,
}: {
  groupId: string;
  searchParams?: Promise<{ school?: string; schoolId?: string; campus?: string }>;
}) {
  const params = searchParams ? use(searchParams) : undefined;
  const { school, ready } = useBrowsingSchoolPageContext(params);
  const { user, loading } = useAuth();
  if (!ready) {
    return (
      <SiteShell title="群組討論">
        <SchoolScopePlaceholder />
      </SiteShell>
    );
  }
  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title="群組討論"
      subtitle="僅限目前學校帳號下、仍有效的群組成員讀寫。"
    >
      <nav className={styles.navigation} aria-label="校園群組">
        <Link href={`/groups?schoolId=${encodeURIComponent(school.id)}`}>我的群組</Link>
        <Link href={`/clubs?schoolId=${encodeURIComponent(school.id)}`}>我的社團</Link>
      </nav>
      {loading ? (
        <p className={styles.status} role="status">
          正在確認帳號…
        </p>
      ) : !user ? (
        <section className={styles.status}>
          <h2>登入學校帳號後開啟討論</h2>
          <p>請先登入已開通的學校帳號。平台帳號仍需另外取得學校與群組資格。</p>
          <Link
            className="btn primary"
            href={`/login?returnUrl=${encodeURIComponent(`/groups/${encodeURIComponent(groupId)}?schoolId=${school.id}`)}`}
          >
            登入學校帳號
          </Link>
        </section>
      ) : (
        <DiscussionBoard
          key={JSON.stringify([user.uid, school.id, groupId])}
          uid={user.uid}
          schoolId={school.id}
          groupId={groupId}
          displayName={user.displayName}
        />
      )}
    </SiteShell>
  );
}
