'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { SchoolSelector } from '@/components/SchoolSelector';
import { useSelectedSchool } from '@/components/SelectedSchoolProvider';
import { Button } from '@/components/ui/Button';
import { Select, Textarea } from '@/components/ui/Input';
import { useNuniSession } from '@/features/nuni/Session';
import { NuniError, nuniRecord } from '@campus/shared/src/nuni';
import {
  parseBlocks,
  parseBoards,
  parseFeed,
  parsePost,
  parseReport,
  parseReports,
  reportReasons,
  type PublicBoard,
  type PublicPost,
} from './api';
import { useSocialMutation, useSocialResource } from './hooks';
import styles from './Social.module.css';

type Client = { context: string; enabled: boolean; onExpired: () => void };
const reportState = { open: '待處理', hidden: '已隱藏貼文', dismissed: '已結案，未隱藏貼文' };
function date(value: string) {
  return new Date(value).toLocaleString('zh-TW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
function parseAction(value: unknown) {
  const row = nuniRecord(value);
  if (typeof row.id !== 'string' || typeof row.version !== 'number')
    throw new NuniError(502, 'INVALID_RESPONSE');
  return row;
}

export function SocialWorkspace() {
  const auth = useNuniSession();
  const params = useSearchParams();
  const schools = useSelectedSchool();
  const campus = params.get('campus') ?? schools.selectedSchoolId;
  const browseQuery = new URLSearchParams();
  if (campus && (campus === 'all' || /^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/.test(campus)))
    browseQuery.set('campus', campus);
  // Only this page and its browsing preference survive sign-in; URL return targets are ignored.
  const returnUrl = `/social${browseQuery.size ? `?${browseQuery}` : ''}`;
  const loginHref = `/classroom/login?returnUrl=${encodeURIComponent(returnUrl)}`;
  return (
    <SiteShell title="跨校公開交流" subtitle="從一個想法、一個問題，開始和不同校園的人交流。">
      {auth.session ? (
        <Workspace
          key={`${auth.session.platformAccountId}:${auth.session.context}`}
          context={auth.session.context}
          suspended={auth.loading || auth.pendingLogout}
          loginHref={loginHref}
        />
      ) : auth.loading ? (
        <p role="status">正在確認登入狀態…</p>
      ) : (
        <section className={styles.panel}>
          <h2>登入後參與公開交流</h2>
          <p>{auth.error || '使用 Campus One 帳號，閱讀與發表跨校公開貼文。'}</p>
          <div className={styles.actions}>
            <Link className={styles.link} href={loginHref}>
              登入帳號
            </Link>
            <Link className={styles.link} href="/community">
              前往校內交流
            </Link>
            {auth.error && <Button onClick={() => void auth.refresh()}>重新確認</Button>}
          </div>
        </section>
      )}
    </SiteShell>
  );
}

function Workspace({
  context,
  suspended,
  loginHref,
}: {
  context: string;
  suspended: boolean;
  loginHref: string;
}) {
  const [expired, setExpired] = useState(false);
  const onExpired = useCallback(() => setExpired(true), []);
  const client = { context, enabled: !suspended && !expired, onExpired };
  const [tab, setTab] = useState<'feed' | 'safety'>('feed');
  const [revision, setRevision] = useState(0);
  const schools = useSelectedSchool();
  const boards = useSocialResource('boards', context, parseBoards, client.enabled, onExpired);
  const visibleBoards =
    boards.value?.filter(
      (board) => !schools.selectedSchoolId || board.tenantId === schools.selectedSchoolId,
    ) ?? [];
  if (expired)
    return (
      <section className={styles.panel}>
        <h2>請重新確認登入</h2>
        <p role="alert">登入已失效或帳號已變更，這個頁面的資料已清除。</p>
        <Link className={styles.link} href={loginHref}>
          回到登入頁
        </Link>
      </section>
    );
  const filter = schools.selectedSchoolId
    ? `?tenantId=${encodeURIComponent(schools.selectedSchoolId)}`
    : '';
  return (
    <div className={styles.stack}>
      {suspended && <p role="status">正在重新確認登入狀態…</p>}
      <div hidden={suspended} className={styles.stack}>
        <nav className={styles.tabs} aria-label="公開交流分類">
          <Button
            variant={tab === 'feed' ? 'primary' : 'default'}
            aria-pressed={tab === 'feed'}
            onClick={() => setTab('feed')}
          >
            公開動態
          </Button>
          <Button
            variant={tab === 'safety' ? 'primary' : 'default'}
            aria-pressed={tab === 'safety'}
            onClick={() => setTab('safety')}
          >
            封鎖與檢舉
          </Button>
          <Link className={styles.link} href="/community">
            校內交流
          </Link>
        </nav>
        {tab === 'feed' ? (
          <div className={styles.layout}>
            <div className={styles.stack}>
              <Composer
                {...client}
                boards={visibleBoards}
                loading={boards.loading}
                error={boards.error}
                onRetry={boards.reload}
                onSaved={() => setRevision((value) => value + 1)}
              />
              <Feed
                key={`${filter}:${revision}`}
                {...client}
                filter={filter}
                onChanged={() => setRevision((value) => value + 1)}
              />
            </div>
            <aside className={styles.stack}>
              <section className={styles.panel}>
                <h2>看看其他校園</h2>
                <SchoolSelector />
                <p className={styles.muted}>選校只會篩選公開看板，不會取得校籍或校務權限。</p>
              </section>
              <section className={`${styles.panel} ${styles.stack}`}>
                <h2>公開發表前</h2>
                <p className={styles.muted}>
                  這裡的內容可由不同校園的帳號閱讀。不要分享學號、電話或他人的私人資料。
                </p>
                <p className={styles.muted}>
                  這裡分享你主動公開的貼文。校內交流仍保留原本的學校權限。
                </p>
              </section>
            </aside>
          </div>
        ) : (
          <Safety {...client} />
        )}
      </div>
    </div>
  );
}

function Composer({
  boards,
  loading,
  error,
  onRetry,
  onSaved,
  ...client
}: Client & {
  boards: PublicBoard[];
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onSaved: () => void;
}) {
  const [boardKey, setBoardKey] = useState(''),
    [text, setText] = useState(''),
    [success, setSuccess] = useState('');
  const mutation = useSocialMutation(client.context, client.enabled, client.onExpired);
  const selected = boards.find(
    (board) => `${board.tenantId}/${board.id}` === boardKey && board.canPost,
  );
  return (
    <section className={styles.panel}>
      <h2>分享近況或提出問題</h2>
      {loading ? (
        <p role="status">正在載入公開看板…</p>
      ) : error ? (
        <>
          <p role="alert" className={styles.error}>
            {error}
          </p>
          <Button onClick={onRetry}>重新載入看板</Button>
        </>
      ) : boards.length === 0 ? (
        <p className={styles.muted}>目前範圍還沒有公開看板。可以切換校園，或選擇「不限校園」。</p>
      ) : !boards.some((board) => board.canPost) ? (
        <p className={styles.muted}>這些公開看板可供閱讀；發表需要既有成員或管理員資格。</p>
      ) : (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (!selected || !text.trim()) return;
            void mutation
              .run(
                'posts',
                { tenantId: selected.tenantId, communityId: selected.id, text: text.trim() },
                parsePost,
              )
              .then((result) => {
                if (result) {
                  setText('');
                  setSuccess('已公開發表。');
                  onSaved();
                }
              });
          }}
        >
          <Select
            label="發表看板"
            value={selected ? boardKey : ''}
            required
            disabled={mutation.busy || !client.enabled}
            onChange={(event) => {
              setBoardKey(event.target.value);
              setSuccess('');
            }}
            options={[
              { value: '', label: '請選擇公開看板' },
              ...boards
                .filter((board) => board.canPost)
                .map((board) => ({
                  value: `${board.tenantId}/${board.id}`,
                  label: `${board.tenantName} · ${board.name}`,
                })),
            ]}
          />
          <Textarea
            label="貼文內容"
            rows={4}
            maxLength={10000}
            required
            value={text}
            disabled={mutation.busy || !client.enabled}
            onChange={(event) => {
              setText(event.target.value);
              setSuccess('');
            }}
            hint="此貼文會公開給跨校讀者。首次發表會加入所選的公開看板。"
          />
          <Button
            type="submit"
            variant="primary"
            loading={mutation.busy}
            disabled={!selected || !text.trim() || !client.enabled}
          >
            公開發表
          </Button>
        </form>
      )}
      {mutation.error && (
        <p className={styles.error} role="alert">
          {mutation.error}
        </p>
      )}
      {success && (
        <p className={styles.success} role="status">
          {success}
        </p>
      )}
    </section>
  );
}

function Feed({
  filter,
  onChanged,
  ...client
}: Client & { filter: string; onChanged: () => void }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [earlier, setEarlier] = useState<PublicPost[]>([]);
  const path = `feed${filter}${cursor ? `${filter ? '&' : '?'}cursor=${encodeURIComponent(cursor)}` : ''}`;
  const resource = useSocialResource(
    path,
    client.context,
    parseFeed,
    client.enabled,
    client.onExpired,
  );
  const items = [...earlier, ...(resource.value?.items ?? [])];
  return (
    <section className={styles.stack} aria-label="公開貼文">
      <div className={styles.metadata}>
        <h2>最新公開動態</h2>
        <Button onClick={onChanged} disabled={resource.loading}>
          更新動態
        </Button>
      </div>
      {items.map((post) => (
        <Post key={`${post.tenantId}/${post.id}`} {...client} post={post} onChanged={onChanged} />
      ))}
      {resource.loading && <p role="status">正在載入公開動態…</p>}
      {resource.error && (
        <div className={styles.panel}>
          <p className={styles.error} role="alert">
            {resource.error}
          </p>
          <Button onClick={resource.reload}>重新載入動態</Button>
        </div>
      )}
      {resource.value && items.length === 0 && (
        <div className={styles.panel}>
          <h3>還沒有公開貼文</h3>
          <p className={styles.muted}>有適合跨校分享的消息或問題，可以選一個公開看板開始交流。</p>
        </div>
      )}
      {resource.value?.nextCursor && (
        <Button
          onClick={() => {
            setEarlier(items);
            setCursor(resource.value!.nextCursor);
          }}
        >
          載入更早的貼文
        </Button>
      )}
    </section>
  );
}

function Post({
  post,
  onChanged,
  ...client
}: Client & { post: PublicPost; onChanged: () => void }) {
  const [action, setAction] = useState<'report' | 'block' | null>(null),
    [reason, setReason] = useState('harassment'),
    [detail, setDetail] = useState(''),
    [reported, setReported] = useState(false);
  const mutation = useSocialMutation(client.context, client.enabled, client.onExpired);
  return (
    <article
      className={`${styles.panel} ${styles.post}`}
      aria-label={`${post.author.displayName}的公開貼文`}
    >
      <div>
        <div className={styles.metadata}>
          <strong>
            {post.author.displayName}
            {post.author.isSelf ? ' · 你' : ''}
          </strong>
          <time className={styles.muted} dateTime={post.publishedAt}>
            {date(post.publishedAt)}
          </time>
        </div>
        <p className={styles.muted}>
          {post.tenantName} · {post.communityName}
        </p>
      </div>
      <p className={styles.postText}>{post.text}</p>
      {!post.author.isSelf && (
        <>
          <div className={styles.actions}>
            <Button
              aria-expanded={action === 'report'}
              disabled={mutation.busy || reported}
              onClick={() => setAction(action === 'report' ? null : 'report')}
            >
              {reported ? '已送出檢舉' : '檢舉'}
            </Button>
            <Button
              aria-expanded={action === 'block'}
              disabled={mutation.busy}
              onClick={() => setAction(action === 'block' ? null : 'block')}
            >
              封鎖作者
            </Button>
          </div>
          {action === 'report' && (
            <form
              className={`${styles.form} ${styles.notice}`}
              onSubmit={(event) => {
                event.preventDefault();
                void mutation
                  .run(
                    'reports',
                    { tenantId: post.tenantId, postId: post.id, reason, detail: detail.trim() },
                    parseReport,
                  )
                  .then((result) => {
                    if (result) {
                      setReported(true);
                      setAction(null);
                      setDetail('');
                    }
                  });
              }}
            >
              <Select
                label="檢舉原因"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                options={reportReasons}
                disabled={mutation.busy}
              />
              <Textarea
                label="補充說明（選填）"
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                maxLength={2000}
                rows={3}
                disabled={mutation.busy}
              />
              <Button type="submit" loading={mutation.busy}>
                送出檢舉
              </Button>
            </form>
          )}
          {action === 'block' && (
            <div className={styles.notice}>
              <p>封鎖後，你們的貼文將不再出現在彼此的公開動態。可以在「封鎖與檢舉」解除。</p>
              <div className={styles.actions}>
                <Button
                  variant="danger"
                  loading={mutation.busy}
                  onClick={() =>
                    void mutation
                      .run('blocks', { tenantId: post.tenantId, postId: post.id }, parseAction)
                      .then((result) => {
                        if (result) onChanged();
                      })
                  }
                >
                  確認封鎖
                </Button>
                <Button disabled={mutation.busy} onClick={() => setAction(null)}>
                  取消
                </Button>
              </div>
            </div>
          )}
          {reported && (
            <p role="status" className={styles.success}>
              已記錄你的檢舉。處理狀態可在「封鎖與檢舉」查看。
            </p>
          )}
        </>
      )}
      {mutation.error && (
        <p role="alert" className={styles.error}>
          {mutation.error}
        </p>
      )}
    </article>
  );
}

function Safety(client: Client) {
  const blocks = useSocialResource(
    'blocks',
    client.context,
    parseBlocks,
    client.enabled,
    client.onExpired,
  );
  const reports = useSocialResource(
    'reports',
    client.context,
    parseReports,
    client.enabled,
    client.onExpired,
  );
  const mutation = useSocialMutation(client.context, client.enabled, client.onExpired);
  return (
    <div className={styles.layout}>
      <section className={styles.panel}>
        <h2>我的檢舉</h2>
        <p className={styles.muted}>
          顯示最近 100 筆檢舉。待處理代表已收到，並不表示已有處理結果。
        </p>
        <div className={styles.actions}>
          <Button onClick={reports.reload} disabled={reports.loading}>
            更新處理狀態
          </Button>
        </div>
        {reports.loading && <p role="status">正在讀取檢舉…</p>}
        {reports.error && (
          <p role="alert" className={styles.error}>
            {reports.error}
          </p>
        )}
        {reports.value?.length === 0 && <p className={styles.muted}>目前沒有送出的檢舉。</p>}
        <ul className={styles.list}>
          {reports.value?.map((report) => (
            <li key={report.id}>
              <strong>
                {reportReasons.find((reason) => reason.value === report.reason)?.label ||
                  '內容檢舉'}{' '}
                · {reportState[report.state]}
              </strong>
              <p className={styles.muted}>{date(report.createdAt)}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className={styles.panel}>
        <h2>已封鎖的帳號</h2>
        <p className={styles.muted}>這裡只列出你封鎖的帳號。</p>
        {blocks.loading && <p role="status">正在讀取封鎖名單…</p>}
        {blocks.error && (
          <>
            <p role="alert" className={styles.error}>
              {blocks.error}
            </p>
            <Button onClick={blocks.reload}>重新載入封鎖名單</Button>
          </>
        )}
        {blocks.value?.length === 0 && <p className={styles.muted}>目前沒有封鎖任何帳號。</p>}
        <ul className={styles.list}>
          {blocks.value?.map((block) => (
            <li key={block.id}>
              <strong>{block.displayName}</strong>
              <div className={styles.actions}>
                <Button
                  disabled={mutation.busy}
                  onClick={() =>
                    void mutation
                      .run(
                        `blocks/${encodeURIComponent(block.id)}/revoke`,
                        { expectedVersion: block.version },
                        parseAction,
                      )
                      .then((result) => {
                        if (result) blocks.reload();
                      })
                  }
                >
                  解除封鎖 {block.displayName}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {mutation.error && (
          <p role="alert" className={styles.error}>
            {mutation.error}
          </p>
        )}
      </section>
    </div>
  );
}
