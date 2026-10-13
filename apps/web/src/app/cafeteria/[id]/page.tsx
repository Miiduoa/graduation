'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { LoginRequiredLostFoundComments } from '@/components/LoginRequiredLostFoundComments';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { fetchMenus, type MenuItem } from '@/lib/firebase';
import {
  LOGIN_REQUIRED_COMMENTS_TEXT,
  isPermissionDeniedError,
} from '@campus/shared/src/signedInSocialReads';
import {
  addStorefrontComment,
  followStorefront,
  isFollowingStorefront,
  loadStorefront,
  loadStorefrontComments,
  loadStorefrontPosts,
  toggleStorefrontLike,
  type StorefrontComment,
  type StorefrontPost,
} from '@/lib/storefront';
import {
  MENU_STALE_TEXT,
  PRICE_DISCLAIMER,
  SHOWCASE_ORDER_BUTTON_TEXT,
  SHOWCASE_ORDER_CAPTION,
  isMenuStale,
  safeStorefrontUrl,
  studentCafeteriaAction,
} from '@campus/shared/src/merchantMode';
import social from '@/features/social/Social.module.css';
import type { Cafeteria } from '@/lib/firebase';

export default function StorefrontPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ schoolId?: string; school?: string }>;
}) {
  const { id } = use(props.params);
  const search = props.searchParams ? use(props.searchParams) : undefined;
  const context = resolveSchoolPageContext(search);
  const { user, loading: authLoading } = useAuth();
  const signedIn = Boolean(user?.uid);
  const loginReturnUrl = `/cafeteria/${encodeURIComponent(id)}?schoolId=${encodeURIComponent(context.schoolId)}`;
  const [shop, setShop] = useState<Cafeteria | null | undefined>(undefined);
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [posts, setPosts] = useState<StorefrontPost[]>([]);
  const [following, setFollowing] = useState(false);
  const [socialBlocked, setSocialBlocked] = useState(false);
  const [error, setError] = useState('');
  const canReadSocial = signedIn && !socialBlocked;
  const onSocialDenied = useCallback(() => setSocialBlocked(true), []);
  useEffect(() => {
    let active = true;
    setError('');
    setSocialBlocked(!authLoading && !signedIn);
    void loadStorefront(context.schoolId, id).then(
      (nextShop) => {
        if (active) setShop(nextShop);
      },
      () => {
        if (active) setError('暫時讀不到這間店。');
      },
    );
    void fetchMenus(context.schoolId).then(
      (nextMenus) => {
        if (active) setMenus(nextMenus.filter((item) => item.cafeteriaId === id));
      },
      () => {
        if (active) setMenus([]);
      },
    );
    void loadStorefrontPosts(context.schoolId, id, signedIn ? user?.uid : undefined).then(
      (nextPosts) => {
        if (active) setPosts(nextPosts);
      },
      (reason) => {
        if (!active) return;
        if (isPermissionDeniedError(reason)) setSocialBlocked(true);
      },
    );
    if (signedIn && user?.uid) {
      isFollowingStorefront(context.schoolId, id, user.uid).then(
        (nextFollowing) => {
          if (active) setFollowing(nextFollowing);
        },
        (reason) => {
          if (!active) return;
          if (isPermissionDeniedError(reason)) onSocialDenied();
        },
      );
    } else {
      setFollowing(false);
    }
    return () => {
      active = false;
    };
  }, [authLoading, context.schoolId, id, onSocialDenied, signedIn, user?.uid]);
  const action = studentCafeteriaAction({
    merchantMode: shop?.merchantMode,
    orderingEnabled: shop?.orderingEnabled,
    onlineOrderingEnabled: false,
    orderingUrl: shop?.orderingUrl,
  });
  const websiteUrl = safeStorefrontUrl(shop?.websiteUrl);
  return (
    <SiteShell
      title={shop?.name || '店面'}
      subtitle="店家自己的主頁。一般帳號即可查看、追蹤與留言。"
      schoolName={context.schoolName}
    >
      {error && <p role="alert">{error}</p>}
      {shop === undefined && !error && <p role="status">正在讀取店面…</p>}
      {shop === null && <p>找不到這間店。</p>}
      {shop && (
        <div className={social.stack}>
          <section className={social.panel}>
            <h2>{shop.name}</h2>
            {shop.intro && <p>{shop.intro}</p>}
            <p className={social.muted}>
              {[shop.location, shop.openingHours].filter(Boolean).join(' · ') ||
                '位置與營業時間尚未提供'}
            </p>
            {websiteUrl && (
              <p>
                <a
                  className={social.link}
                  href={websiteUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  店家網站
                </a>
              </p>
            )}
            <div className={social.actions}>
              <Link
                className="btn"
                href={`/cafeteria?schoolId=${encodeURIComponent(context.schoolId)}`}
              >
                返回餐廳列表
              </Link>
              {action.kind === 'showcase' && (
                <Link
                  className="btn primary"
                  href={`/cafeteria/${encodeURIComponent(id)}/order?schoolId=${encodeURIComponent(context.schoolId)}`}
                >
                  {SHOWCASE_ORDER_BUTTON_TEXT}
                </Link>
              )}
              {action.kind === 'native_closed' && <p className={social.muted}>{action.label}</p>}
              {canReadSocial && user ? (
                <button
                  className="btn"
                  onClick={() =>
                    void followStorefront(context.schoolId, id, user.uid, !following).then(() =>
                      setFollowing(!following),
                    )
                  }
                >
                  {following ? '取消追蹤' : '追蹤店家'}
                </button>
              ) : null}
            </div>
            {action.kind === 'showcase' && <p className={social.muted}>{SHOWCASE_ORDER_CAPTION}</p>}
            <p className={social.muted}>{PRICE_DISCLAIMER}</p>
          </section>
          <section className={social.panel} aria-label="菜單">
            <h2>菜單</h2>
            {isMenuStale(shop.menuSyncedAt) && menus.length > 0 && (
              <p className={social.muted}>{MENU_STALE_TEXT}</p>
            )}
            {menus.length === 0 ? (
              <p className={social.muted}>還沒有菜單。沒串接的店也可以只放訂餐連結。</p>
            ) : (
              <ul>
                {menus.map((item) => (
                  <li key={item.id}>
                    {item.name}
                    {typeof item.price === 'number' ? ` · NT$${item.price}` : ''}
                    {item.soldOut ? '（售完）' : ''}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={social.stack} aria-label="店家貼文">
            <h2>店家貼文</h2>
            {posts.length === 0 && <p className={social.muted}>還沒有貼文或優惠公告。</p>}
            {posts.map((post) => (
              <StorefrontPostCard
                key={post.id}
                schoolId={context.schoolId}
                cafeteriaId={id}
                uid={user?.uid}
                canReadSocial={canReadSocial}
                post={post}
                onSocialDenied={onSocialDenied}
              />
            ))}
            {!canReadSocial && !authLoading ? (
              <section className={social.panel} aria-label="評論">
                <LoginRequiredLostFoundComments
                  returnUrl={loginReturnUrl}
                  text={LOGIN_REQUIRED_COMMENTS_TEXT}
                />
              </section>
            ) : null}
          </section>
        </div>
      )}
    </SiteShell>
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
  useEffect(() => {
    if (!canReadSocial) return;
    void loadStorefrontComments(schoolId, cafeteriaId, post.id).then(setComments, (reason) => {
      if (isPermissionDeniedError(reason)) onSocialDenied();
    });
  }, [canReadSocial, onSocialDenied, schoolId, cafeteriaId, post.id]);
  return (
    <article className={`${social.panel} ${social.post}`} aria-label={post.title || '店家貼文'}>
      <div className={social.metadata}>
        <strong>{post.title || '店家消息'}</strong>
        <span className={social.muted}>
          {post.kind === 'promo' ? '優惠' : post.kind === 'announcement' ? '公告' : '貼文'}
        </span>
      </div>
      <p className={social.postText}>{post.text}</p>
      {canReadSocial && uid ? (
        <div className={social.actions}>
          <button
            className="btn"
            onClick={() =>
              void toggleStorefrontLike(schoolId, cafeteriaId, post.id, uid, liked).then(() =>
                setLiked(!liked),
              )
            }
          >
            {liked ? '收回讚' : '讚'}
          </button>
        </div>
      ) : null}
      {canReadSocial
        ? comments.map((comment) => (
            <p key={comment.id} className={social.muted}>
              {comment.text}
            </p>
          ))
        : null}
      {canReadSocial && uid && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim()) return;
            void addStorefrontComment(schoolId, cafeteriaId, post.id, uid, draft).then(() => {
              setComments((current) => [
                ...current,
                { id: `local-${Date.now()}`, authorId: uid, text: draft },
              ]);
              setDraft('');
            });
          }}
        >
          <label>
            留言
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={2000}
            />
          </label>
          <button className="btn" type="submit">
            送出留言
          </button>
        </form>
      )}
    </article>
  );
}
