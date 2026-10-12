'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { fetchMenus, type MenuItem } from '@/lib/firebase';
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
  isMenuStale,
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
  const { user } = useAuth();
  const [shop, setShop] = useState<Cafeteria | null | undefined>(undefined);
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [posts, setPosts] = useState<StorefrontPost[]>([]);
  const [following, setFollowing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    Promise.all([
      loadStorefront(context.schoolId, id),
      fetchMenus(context.schoolId),
      loadStorefrontPosts(context.schoolId, id, user?.uid),
      user?.uid ? isFollowingStorefront(context.schoolId, id, user.uid) : Promise.resolve(false),
    ]).then(
      ([nextShop, nextMenus, nextPosts, nextFollowing]) => {
        if (!active) return;
        setShop(nextShop);
        setMenus(nextMenus.filter((item) => item.cafeteriaId === id));
        setPosts(nextPosts);
        setFollowing(nextFollowing);
      },
      () => {
        if (active) setError('暫時讀不到這間店。');
      },
    );
    return () => {
      active = false;
    };
  }, [context.schoolId, id, user?.uid]);
  const action = studentCafeteriaAction({
    merchantMode: shop?.merchantMode,
    orderingEnabled: shop?.orderingEnabled,
    onlineOrderingEnabled: false,
    orderingUrl: shop?.orderingUrl,
  });
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
              {[shop.location, shop.openingHours].filter(Boolean).join(' · ') || '位置與營業時間尚未提供'}
            </p>
            {shop.websiteUrl && (
              <p>
                <a className={social.link} href={shop.websiteUrl} rel="noreferrer" target="_blank">
                  店家網站
                </a>
              </p>
            )}
            <div className={social.actions}>
              <Link className="btn" href={`/cafeteria?schoolId=${encodeURIComponent(context.schoolId)}`}>
                返回餐廳列表
              </Link>
              {action.kind === 'showcase' && (
                <Link
                  className="btn primary"
                  href={`/cafeteria/${encodeURIComponent(id)}/order?schoolId=${encodeURIComponent(context.schoolId)}`}
                >
                  去訂餐
                </Link>
              )}
              {action.kind === 'native_closed' && <p className={social.muted}>{action.label}</p>}
              {user && (
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
              )}
            </div>
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
                post={post}
              />
            ))}
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
  post,
}: {
  schoolId: string;
  cafeteriaId: string;
  uid?: string;
  post: StorefrontPost;
}) {
  const [liked, setLiked] = useState(post.liked);
  const [comments, setComments] = useState<StorefrontComment[]>([]);
  const [draft, setDraft] = useState('');
  useEffect(() => {
    void loadStorefrontComments(schoolId, cafeteriaId, post.id).then(setComments, () => undefined);
  }, [schoolId, cafeteriaId, post.id]);
  return (
    <article className={`${social.panel} ${social.post}`} aria-label={post.title || '店家貼文'}>
      <div className={social.metadata}>
        <strong>{post.title || '店家消息'}</strong>
        <span className={social.muted}>{post.kind === 'promo' ? '優惠' : post.kind === 'announcement' ? '公告' : '貼文'}</span>
      </div>
      <p className={social.postText}>{post.text}</p>
      {uid && (
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
      )}
      {comments.map((comment) => (
        <p key={comment.id} className={social.muted}>
          {comment.text}
        </p>
      ))}
      {uid && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim()) return;
            void addStorefrontComment(schoolId, cafeteriaId, post.id, uid, draft).then(() => {
              setComments((current) => [...current, { id: `local-${Date.now()}`, authorId: uid, text: draft }]);
              setDraft('');
            });
          }}
        >
          <label>
            留言
            <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} />
          </label>
          <button className="btn" type="submit">
            送出留言
          </button>
        </form>
      )}
    </article>
  );
}
