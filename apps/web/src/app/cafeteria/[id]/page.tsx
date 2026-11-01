'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { PublicSourceNotice } from '@/components/PublicSourceNotice';
import { SiteShell } from '@/components/SiteShell';
import { CampusIcon } from '@/components/CampusIcon';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { useAuth } from '@/components/AuthGuard';
import { LoginRequiredLostFoundComments } from '@/components/LoginRequiredLostFoundComments';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import type { MenuItem } from '@/lib/firebase';
import {
  CAFETERIA_BACK_TO_LIST_TEXT,
  CAFETERIA_NOT_FOUND_TEXT,
  STOREFRONT_EMPTY_MENU_TEXT,
  cafeteriaListHref,
  cafeteriaReviewNotice,
  cafeteriaShowsMenuAvailability,
} from '@campus/shared/src/cafeteriaCatalog';
import {
  LOGIN_REQUIRED_COMMENTS_TEXT,
  isPermissionDeniedError,
} from '@campus/shared/src/signedInSocialReads';
import { SERVICE_PAUSED_TEXT } from '@campus/shared/src/loadFailureCopy';
import { fetchCafeteriaDetail, type CatalogCafeteria } from '@/lib/cafeteriaCatalog';
import {
  addStorefrontComment,
  followStorefront,
  isFollowingStorefront,
  loadStorefrontComments,
  loadStorefrontPosts,
  toggleStorefrontLike,
  type StorefrontComment,
  type StorefrontPost,
} from '@/lib/storefront';
import {
  MENU_STALE_TEXT,
  SHOWCASE_ORDER_BUTTON_TEXT,
  SHOWCASE_ORDER_CAPTION,
  isMenuStale,
  safeStorefrontUrl,
  studentCafeteriaAction,
} from '@campus/shared/src/merchantMode';
import styles from './storefront.module.css';

export default function StorefrontPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ schoolId?: string; school?: string; campus?: string }>;
}) {
  const { id } = use(props.params);
  const search = props.searchParams ? use(props.searchParams) : undefined;
  const context = useBrowsingSchoolPageContext(search);
  if (!context.ready) {
    return (
      <SiteShell title="餐廳">
        <SchoolScopePlaceholder />
      </SiteShell>
    );
  }
  return <StorefrontContent key={`${context.schoolId}:${id}`} id={id} context={context} />;
}

function StorefrontContent({
  id,
  context,
}: {
  id: string;
  context: ReturnType<typeof useBrowsingSchoolPageContext>;
}) {
  const { user, loading: authLoading } = useAuth();
  const [shop, setShop] = useState<CatalogCafeteria | null | undefined>(undefined);
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void fetchCafeteriaDetail(context.schoolId, id).then(
      (detail) => {
        if (!active) return;
        setShop(detail.cafeteria);
        setMenus(detail.menus);
      },
      () => {
        if (!active) return;
        setShop(null);
        setMenus([]);
        setError(SERVICE_PAUSED_TEXT);
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, context.schoolId, id]);

  const action = studentCafeteriaAction({
    merchantMode: shop?.merchantMode,
    orderingEnabled: shop?.orderingEnabled,
    onlineOrderingEnabled: false,
    orderingUrl: shop?.orderingUrl,
  });
  const websiteUrl = safeStorefrontUrl(shop?.websiteUrl);
  return (
    <SiteShell
      title={shop?.name || '餐廳資訊'}
      subtitle="菜單與店家資訊"
      schoolName={context.schoolName}
      compactHeading
    >
      <div className={styles.page}>
        <Link className={styles.back} href={cafeteriaListHref(context.schoolId)}>
          <CampusIcon name="arrow" size={18} />
          {CAFETERIA_BACK_TO_LIST_TEXT}
        </Link>
        {error ? (
          <section className={styles.empty} role="alert">
            <h2>暫時讀不到這間店</h2>
            <p>{error}</p>
            <button
              className="btn"
              type="button"
              onClick={() => {
                setError('');
                setShop(undefined);
                setAttempt((value) => value + 1);
              }}
            >
              再試一次
            </button>
          </section>
        ) : shop === undefined ? (
          <div className={styles.loading} role="status" aria-live="polite">
            <span>正在讀取店面…</span>
            <div className={styles.skeleton} aria-hidden="true" />
            <div className={styles.skeleton} aria-hidden="true" />
            <div className={styles.skeleton} aria-hidden="true" />
          </div>
        ) : shop === null ? (
          <section className={styles.empty}>
            <h2>{CAFETERIA_NOT_FOUND_TEXT}</h2>
            <p>店家可能已下架，回餐廳列表看看其他選擇。</p>
          </section>
        ) : (
          <>
            <div className={styles.quickActions}>
              <nav className={styles.sectionLinks} aria-label="店面內容">
                <a href="#shop-menu">菜單</a>
                <a href="#shop-info">店家資訊</a>
                <a href="#shop-updates">最新消息</a>
              </nav>
              {action.kind === 'showcase' ? (
                <Link
                  className={styles.primaryAction}
                  href={`/cafeteria/${encodeURIComponent(id)}/order?schoolId=${encodeURIComponent(context.schoolId)}`}
                >
                  {SHOWCASE_ORDER_BUTTON_TEXT}
                  <CampusIcon name="arrow" size={18} />
                </Link>
              ) : null}
            </div>
            <div className={styles.layout}>
              <StorefrontMenu menus={menus} shop={shop} />
              <aside id="shop-info" className={styles.infoPanel} aria-labelledby="shop-info-title">
                <div className={styles.sectionHeading}>
                  <CampusIcon name="cafeteria" size={20} />
                  <h2 id="shop-info-title">店家資訊</h2>
                </div>
                {shop.intro ? <p className={styles.intro}>{shop.intro}</p> : null}
                <dl className={styles.infoList}>
                  <div>
                    <dt>位置</dt>
                    <dd>{shop.location || '店家尚未提供位置'}</dd>
                  </div>
                  <div>
                    <dt>營業時間</dt>
                    <dd>{shop.openingHours || '請向店家確認營業時間'}</dd>
                  </div>
                </dl>
                <PublicSourceNotice
                  sourceLabel={shop.sourceLabel}
                  confirmedAt={shop.menuSyncedAt}
                  timeLabel="最後確認（菜單同步）"
                  expired={isMenuStale(shop.menuSyncedAt)}
                  officialUrl={websiteUrl}
                  officialLabel="店家網站"
                >
                  <p>菜單同步時間不代表位置、營業時間或價格已經店家核對；出發前請再確認。</p>
                </PublicSourceNotice>
                {action.kind === 'showcase' ? (
                  <p className={styles.caption}>{SHOWCASE_ORDER_CAPTION}</p>
                ) : (
                  <p className={styles.caption}>目前提供菜單瀏覽，訂餐請向店家確認。</p>
                )}
                {cafeteriaReviewNotice(shop.reviewStatus) ? (
                  <p
                    role="status"
                    className={styles.reviewNotice}
                    data-testid="cafeteria-review-notice"
                  >
                    {cafeteriaReviewNotice(shop.reviewStatus)}
                  </p>
                ) : null}
              </aside>
            </div>
            <StorefrontCommunity
              key={`${context.schoolId}:${id}:${user?.uid ?? 'guest'}`}
              schoolId={context.schoolId}
              cafeteriaId={id}
              uid={user?.uid}
              authLoading={authLoading}
            />
          </>
        )}
      </div>
    </SiteShell>
  );
}

function StorefrontMenu({ menus, shop }: { menus: MenuItem[]; shop: CatalogCafeteria }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const categories = useMemo(
    () => Array.from(new Set(menus.map((item) => item.category?.trim() || '其他餐點'))),
    [menus],
  );
  const needle = query.trim().toLocaleLowerCase('zh-TW');
  const filtered = menus.filter((item) => {
    const group = item.category?.trim() || '其他餐點';
    return (
      (!category || category === group) &&
      (!needle ||
        [item.name, item.description, item.category, ...(item.tags ?? [])]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase('zh-TW')
          .includes(needle))
    );
  });
  const groups = categories
    .map((name) => ({
      name,
      items: filtered.filter((item) => (item.category?.trim() || '其他餐點') === name),
    }))
    .filter((group) => group.items.length);
  const showAvailability = cafeteriaShowsMenuAvailability(shop.reviewStatus);
  return (
    <section id="shop-menu" className={styles.menuPanel} aria-labelledby="shop-menu-title">
      <header className={styles.menuHeader}>
        <h2 id="shop-menu-title">菜單</h2>
        <span>{menus.length} 道餐點</span>
      </header>
      {menus.length ? (
        <>
          <label className={styles.search}>
            <span className={styles.srOnly}>搜尋這間店的餐點</span>
            <CampusIcon name="search" size={20} />
            <input
              type="search"
              value={query}
              placeholder="搜尋餐點或關鍵字"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {categories.length > 1 ? (
            <div className={styles.categories} role="group" aria-label="餐點分類">
              <button type="button" aria-pressed={!category} onClick={() => setCategory('')}>
                全部
              </button>
              {categories.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={category === name}
                  onClick={() => setCategory(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          ) : null}
          {isMenuStale(shop.menuSyncedAt) ? (
            <p className={styles.menuNote}>{MENU_STALE_TEXT}</p>
          ) : null}
          <p className={styles.resultCount} role="status" aria-live="polite">
            {needle || category ? `找到 ${filtered.length} 道餐點` : '價格與供應依店家現場為準'}
          </p>
          {filtered.length ? (
            groups.map((group) => (
              <section key={group.name} className={styles.menuGroup} aria-label={group.name}>
                <h3>
                  {group.name}
                  <span>{group.items.length}</span>
                </h3>
                <ul className={styles.menuList}>
                  {group.items.map((item) => (
                    <li key={item.id} className={styles.menuItem}>
                      <div className={styles.itemBody}>
                        <div className={styles.itemHeading}>
                          <h4>{item.name}</h4>
                          {showAvailability && (item.soldOut || item.available === false) ? (
                            <span className={styles.unavailable}>
                              {item.soldOut ? '已售完' : '暫停供應'}
                            </span>
                          ) : null}
                        </div>
                        {item.description ? <p>{item.description}</p> : null}
                        {item.tags?.length ? (
                          <span className={styles.tags}>{item.tags.join(' · ')}</span>
                        ) : null}
                      </div>
                      <span className={styles.price}>
                        {typeof item.price === 'number' &&
                        Number.isFinite(item.price) &&
                        item.price >= 0
                          ? `NT$${item.price.toLocaleString('zh-TW')}`
                          : '價格洽店家'}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <div className={styles.empty}>
              <h3>沒有符合的餐點</h3>
              <p>換個關鍵字，或查看這間店的全部菜單。</p>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setQuery('');
                  setCategory('');
                }}
              >
                清除篩選
              </button>
            </div>
          )}
        </>
      ) : (
        <div className={styles.emptyMenu}>
          <CampusIcon name="cafeteria" size={30} />
          <h3>{STOREFRONT_EMPTY_MENU_TEXT}</h3>
          <p>可以先查看營業資訊，餐點與價格請向店家確認。</p>
        </div>
      )}
    </section>
  );
}

function StorefrontCommunity({
  schoolId,
  cafeteriaId,
  uid,
  authLoading,
}: {
  schoolId: string;
  cafeteriaId: string;
  uid?: string;
  authLoading?: boolean;
}) {
  const [posts, setPosts] = useState<StorefrontPost[]>([]);
  const [following, setFollowing] = useState(false);
  const [followingReady, setFollowingReady] = useState(false);
  const [followReadError, setFollowReadError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [postsError, setPostsError] = useState('');
  const [followError, setFollowError] = useState('');
  const [followBusy, setFollowBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const active = useRef(true);
  const followLock = useRef(false);
  const canReadSocial = Boolean(uid) && !authLoading && !blocked;
  const onSocialDenied = useCallback(() => setBlocked(true), []);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (authLoading) return;
    let current = true;
    void loadStorefrontPosts(schoolId, cafeteriaId, uid)
      .then(
        (next) => {
          if (current) setPosts(next);
        },
        (reason) => {
          if (!current) return;
          if (isPermissionDeniedError(reason)) setBlocked(true);
          else setPostsError('暫時讀不到店家消息，菜單仍可正常查看。');
        },
      )
      .finally(() => {
        if (current) setLoading(false);
      });
    if (uid) {
      void isFollowingStorefront(schoolId, cafeteriaId, uid).then(
        (next) => {
          if (current) {
            setFollowing(next);
            setFollowingReady(true);
          }
        },
        (reason) => {
          if (!current) return;
          if (isPermissionDeniedError(reason)) setBlocked(true);
          else setFollowReadError('暫時無法確認追蹤狀態。');
        },
      );
    }
    return () => {
      current = false;
    };
  }, [attempt, authLoading, cafeteriaId, schoolId, uid]);

  function retryCommunity() {
    if (followLock.current) return;
    setLoading(true);
    setPostsError('');
    setFollowReadError('');
    setFollowingReady(false);
    setAttempt((value) => value + 1);
  }

  async function toggleFollow() {
    if (!uid || !canReadSocial || !followingReady || followLock.current) return;
    followLock.current = true;
    setFollowBusy(true);
    setFollowError('');
    try {
      await followStorefront(schoolId, cafeteriaId, uid, !following);
      if (active.current) setFollowing((value) => !value);
    } catch (reason) {
      if (!active.current) return;
      if (isPermissionDeniedError(reason)) setBlocked(true);
      else setFollowError('沒有更新追蹤狀態，請再試一次。');
    } finally {
      followLock.current = false;
      if (active.current) setFollowBusy(false);
    }
  }

  return (
    <section id="shop-updates" className={styles.updates} aria-label="店家貼文">
      <header className={styles.updatesHeader}>
        <div>
          <h2>店家消息</h2>
          <p>優惠、公告與最新動態</p>
        </div>
        {canReadSocial ? (
          <button
            type="button"
            className="btn"
            aria-pressed={following}
            disabled={followBusy || !followingReady}
            onClick={() => void toggleFollow()}
          >
            {followBusy
              ? '更新中…'
              : !followingReady
                ? '確認追蹤狀態'
                : following
                  ? '取消追蹤'
                  : '追蹤店家'}
          </button>
        ) : null}
      </header>
      {followReadError && canReadSocial ? (
        <div className={styles.inlineNotice} role="alert">
          <p>{followReadError}</p>
          <button type="button" className="btn" onClick={retryCommunity}>
            重新確認追蹤
          </button>
        </div>
      ) : null}
      {followError ? (
        <p role="alert" className={styles.error}>
          {followError}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className={styles.muted}>
          正在讀取店家消息…
        </p>
      ) : null}
      {postsError ? (
        <div className={styles.inlineNotice} role="alert">
          <p>{postsError}</p>
          <button type="button" className="btn" onClick={retryCommunity}>
            重新讀取消息
          </button>
        </div>
      ) : null}
      {!loading && !postsError && !posts.length ? (
        <p className={styles.muted}>還沒有貼文或優惠公告。</p>
      ) : null}
      {posts.length ? (
        <div className={styles.postGrid}>
          {posts.map((post) => (
            <StorefrontPostCard
              key={post.id}
              schoolId={schoolId}
              cafeteriaId={cafeteriaId}
              uid={uid}
              canReadSocial={canReadSocial}
              post={post}
              onSocialDenied={onSocialDenied}
            />
          ))}
        </div>
      ) : null}
      {!canReadSocial && !authLoading ? (
        <section className={styles.loginNote} aria-label="評論">
          <LoginRequiredLostFoundComments
            returnUrl={`/cafeteria/${encodeURIComponent(cafeteriaId)}?schoolId=${encodeURIComponent(schoolId)}`}
            text={LOGIN_REQUIRED_COMMENTS_TEXT}
          />
        </section>
      ) : null}
    </section>
  );
}

function StorefrontPostCard({
  schoolId,
  cafeteriaId,
  uid,
  canReadSocial,
  post,
  onSocialDenied,
}: {
  schoolId: string;
  cafeteriaId: string;
  uid?: string;
  canReadSocial: boolean;
  post: StorefrontPost;
  onSocialDenied: () => void;
}) {
  const [liked, setLiked] = useState(post.liked);
  const [comments, setComments] = useState<StorefrontComment[]>([]);
  const [draft, setDraft] = useState('');
  const [likeBusy, setLikeBusy] = useState(false);
  const [commentBusy, setCommentBusy] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [commentError, setCommentError] = useState('');
  const [commentsAttempt, setCommentsAttempt] = useState(0);
  const likeLock = useRef(false);
  const commentLock = useRef(false);
  const commentsRevision = useRef(0);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!canReadSocial) return;
    let current = true;
    const revision = commentsRevision.current;
    void loadStorefrontComments(schoolId, cafeteriaId, post.id).then(
      (next) => {
        if (current && revision === commentsRevision.current) setComments(next);
      },
      (reason) => {
        if (!current) return;
        if (isPermissionDeniedError(reason)) onSocialDenied();
        else setCommentError('留言暫時無法載入。');
      },
    );
    return () => {
      current = false;
    };
  }, [canReadSocial, commentsAttempt, onSocialDenied, schoolId, cafeteriaId, post.id]);

  async function toggleLike() {
    if (!uid || !canReadSocial || likeLock.current) return;
    likeLock.current = true;
    setLikeBusy(true);
    setMutationError('');
    try {
      await toggleStorefrontLike(schoolId, cafeteriaId, post.id, uid, liked);
      if (active.current) setLiked((value) => !value);
    } catch (reason) {
      if (!active.current) return;
      if (isPermissionDeniedError(reason)) onSocialDenied();
      else setMutationError('沒有更新按讚狀態，請再試一次。');
    } finally {
      likeLock.current = false;
      if (active.current) setLikeBusy(false);
    }
  }

  async function submitComment() {
    const text = draft.trim();
    if (!text || !uid || !canReadSocial || commentLock.current) return;
    commentLock.current = true;
    setCommentBusy(true);
    setMutationError('');
    try {
      await addStorefrontComment(schoolId, cafeteriaId, post.id, uid, text);
      if (!active.current) return;
      commentsRevision.current += 1;
      setComments((current) => [...current, { id: `local-${Date.now()}`, authorId: uid, text }]);
      setDraft('');
    } catch (reason) {
      if (!active.current) return;
      if (isPermissionDeniedError(reason)) onSocialDenied();
      else setMutationError('留言沒有送出，內容已保留，請再試一次。');
    } finally {
      commentLock.current = false;
      if (active.current) setCommentBusy(false);
    }
  }

  return (
    <article className={styles.post} aria-label={post.title || '店家貼文'}>
      <div className={styles.postHeader}>
        <h3>{post.title || '店家消息'}</h3>
        <span>
          {post.kind === 'promo' ? '優惠' : post.kind === 'announcement' ? '公告' : '貼文'}
        </span>
      </div>
      <p className={styles.postText}>{post.text}</p>
      {canReadSocial && uid ? (
        <button
          className="btn"
          type="button"
          aria-pressed={liked}
          disabled={likeBusy}
          onClick={() => void toggleLike()}
        >
          {likeBusy ? '更新中…' : liked ? '收回讚' : '讚'}
        </button>
      ) : null}
      {canReadSocial ? (
        <>
          {commentError ? (
            <div className={styles.inlineNotice} role="alert">
              <p>{commentError}</p>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setCommentError('');
                  setCommentsAttempt((value) => value + 1);
                }}
              >
                重新載入留言
              </button>
            </div>
          ) : null}
          {comments.length ? (
            <div className={styles.comments}>
              {comments.map((comment) => (
                <p key={comment.id}>{comment.text}</p>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {mutationError ? (
        <p role="alert" className={styles.error}>
          {mutationError}
        </p>
      ) : null}
      {canReadSocial && uid ? (
        <form
          className={styles.commentForm}
          onSubmit={(event) => {
            event.preventDefault();
            void submitComment();
          }}
        >
          <label>
            留言
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={2000}
              rows={2}
              disabled={commentBusy}
              placeholder="寫下想問店家的事"
            />
          </label>
          <button className="btn" type="submit" disabled={!draft.trim() || commentBusy}>
            {commentBusy ? '送出中…' : '送出留言'}
          </button>
        </form>
      ) : null}
    </article>
  );
}
