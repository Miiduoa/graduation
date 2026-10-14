'use client';

import { use } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { LoginRequiredLostFoundComments } from '@/components/LoginRequiredLostFoundComments';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import social from '@/features/social/Social.module.css';

export default function LostFoundPostPage(props: {
  searchParams?: Promise<{ schoolId?: string; school?: string; campus?: string }>;
}) {
  const search = props.searchParams ? use(props.searchParams) : undefined;
  const context = useBrowsingSchoolPageContext(search);
  const { user, loading: authLoading } = useAuth();
  const loginReturnUrl = `/lost-found/post?schoolId=${encodeURIComponent(context.schoolId)}`;
  return (
    <SiteShell title="發布失物招領" schoolName={context.schoolName}>
      {!context.ready ? (
        <p role="status">正在確認校園目錄…</p>
      ) : authLoading ? (
        <p role="status">正在確認登入狀態…</p>
      ) : !user ? (
        <section className={social.panel}>
          <LoginRequiredLostFoundComments returnUrl={loginReturnUrl} />
        </section>
      ) : (
        <section className={social.panel}>
          <p>目前請從 Campus One App 刊登遺失或拾獲資訊。</p>
          <p className={social.actions}>
            <Link
              className="btn"
              href={`/lost-found?schoolId=${encodeURIComponent(context.schoolId)}`}
            >
              返回列表
            </Link>
          </p>
        </section>
      )}
    </SiteShell>
  );
}
