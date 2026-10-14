'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { LoginRequiredLostFoundComments } from '@/components/LoginRequiredLostFoundComments';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import {
  categoryLabel,
  getLostFoundItem,
  statusLabel,
  type LostFoundItem,
} from '@/lib/lostFound';
import { isPermissionDeniedError } from '@campus/shared/src/signedInSocialReads';
import social from '@/features/social/Social.module.css';

function formatWhen(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}

export default function LostFoundDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ schoolId?: string; school?: string; campus?: string }>;
}) {
  const { id } = use(props.params);
  const search = props.searchParams ? use(props.searchParams) : undefined;
  const context = useBrowsingSchoolPageContext(search);
  if (!context.ready) {
    return <SiteShell title="失物招領"><p role="status">正在確認校園目錄…</p></SiteShell>;
  }
  return <LostFoundDetailPageContent key={`${context.schoolId}:${id}`} id={id} context={context} />;
}

function LostFoundDetailPageContent({ context, id }: {
  context: ReturnType<typeof useBrowsingSchoolPageContext>;
  id: string;
}) {
  const { user, loading: authLoading } = useAuth();
  const signedIn = Boolean(user?.uid);
  const loginReturnUrl = `/lost-found/${encodeURIComponent(id)}?schoolId=${encodeURIComponent(context.schoolId)}`;
  const [item, setItem] = useState<LostFoundItem | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [loginRequired, setLoginRequired] = useState(false);
  useEffect(() => {
    let active = true;
    setError('');
    if (authLoading) return () => {
      active = false;
    };
    if (!signedIn) {
      setItem(undefined);
      setLoginRequired(true);
      return () => {
        active = false;
      };
    }
    setLoginRequired(false);
    setItem(undefined);
    void getLostFoundItem(id, context.schoolId).then(
      (next) => {
        if (!active) return;
        setItem(next);
      },
      (reason) => {
        if (!active) return;
        if (isPermissionDeniedError(reason)) {
          setLoginRequired(true);
          return;
        }
        setError('暫時無法讀取物品，請稍後再試。');
      },
    );
    return () => {
      active = false;
    };
  }, [authLoading, context.schoolId, id, signedIn]);
  return (
    <SiteShell title="失物招領" schoolName={context.schoolName}>
      {authLoading ? (
        <p role="status">正在確認登入狀態…</p>
      ) : loginRequired || !signedIn ? (
        <section className={social.panel}>
          <LoginRequiredLostFoundComments returnUrl={loginReturnUrl} />
        </section>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : item === undefined ? (
        <p role="status">正在讀取物品…</p>
      ) : item === null ? (
        <p>找不到物品</p>
      ) : (
        <article className={social.panel}>
          <p className={social.muted}>
            {item.type === 'lost' ? '遺失' : '拾獲'} · {categoryLabel(item.category)} ·{' '}
            {statusLabel(item.status)}
          </p>
          <h2>{item.title}</h2>
          <p className={social.muted}>
            {item.location}
            {item.date ? ` · ${formatWhen(item.date)}` : ''}
          </p>
          <p>{item.description}</p>
          {item.contactInfo ? <p>聯絡方式：{item.contactInfo}</p> : null}
          <p className={social.actions}>
            <Link
              className="btn"
              href={`/lost-found?schoolId=${encodeURIComponent(context.schoolId)}`}
            >
              返回列表
            </Link>
          </p>
        </article>
      )}
    </SiteShell>
  );
}
