'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { LoginRequiredLostFoundComments } from '@/components/LoginRequiredLostFoundComments';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import {
  categoryLabel,
  listLostFoundItems,
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

export default function LostFoundPage(props: {
  searchParams?: Promise<{ schoolId?: string; school?: string; campus?: string }>;
}) {
  const search = props.searchParams ? use(props.searchParams) : undefined;
  const context = useBrowsingSchoolPageContext(search);
  if (!context.ready) {
    return <SiteShell title="失物招領"><p role="status">正在確認校園目錄…</p></SiteShell>;
  }
  return <LostFoundPageContent key={`${context.schoolId}`} context={context} />;
}

function LostFoundPageContent({ context }: {
  context: ReturnType<typeof useBrowsingSchoolPageContext>;
  
}) {
  const { user, loading: authLoading } = useAuth();
  const signedIn = Boolean(user?.uid);
  const loginReturnUrl = `/lost-found?schoolId=${encodeURIComponent(context.schoolId)}`;
  const [items, setItems] = useState<LostFoundItem[] | undefined>(undefined);
  const [error, setError] = useState('');
  const [loginRequired, setLoginRequired] = useState(false);
  useEffect(() => {
    let active = true;
    setError('');
    if (authLoading) return () => {
      active = false;
    };
    if (!signedIn) {
      setItems(undefined);
      setLoginRequired(true);
      return () => {
        active = false;
      };
    }
    setLoginRequired(false);
    setItems(undefined);
    void listLostFoundItems(context.schoolId).then(
      (next) => {
        if (!active) return;
        setItems(next);
      },
      (reason) => {
        if (!active) return;
        if (isPermissionDeniedError(reason)) {
          setLoginRequired(true);
          return;
        }
        setError('暫時無法讀取失物招領，請稍後再試。');
      },
    );
    return () => {
      active = false;
    };
  }, [authLoading, context.schoolId, signedIn]);
  return (
    <SiteShell
      title="失物招領"
      subtitle="找回遺失的物品，或替拾獲物尋找主人。"
      schoolName={context.schoolName}
    >
      {authLoading ? (
        <p role="status">正在確認登入狀態…</p>
      ) : loginRequired || !signedIn ? (
        <section className={social.panel}>
          <LoginRequiredLostFoundComments returnUrl={loginReturnUrl} />
        </section>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : items === undefined ? (
        <p role="status">正在讀取失物招領…</p>
      ) : items.length === 0 ? (
        <p>目前沒有本校刊登資訊</p>
      ) : (
        <ul className={social.stack}>
          {items.map((item) => (
            <li key={item.id} className={social.panel}>
              <p className={social.muted}>
                {item.type === 'lost' ? '遺失' : '拾獲'} · {categoryLabel(item.category)} ·{' '}
                {statusLabel(item.status)}
              </p>
              <h2>
                <Link
                  className={social.link}
                  href={`/lost-found/${encodeURIComponent(item.id)}?schoolId=${encodeURIComponent(context.schoolId)}`}
                >
                  {item.title}
                </Link>
              </h2>
              <p className={social.muted}>
                {item.location}
                {item.date ? ` · ${formatWhen(item.date)}` : ''}
              </p>
              <p>{item.description}</p>
            </li>
          ))}
        </ul>
      )}
    </SiteShell>
  );
}
