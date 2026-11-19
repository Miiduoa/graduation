'use client';

import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import { schoolLoginHref } from '@/lib/navigation';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useAuth } from './AuthGuard';

function TeachingDestinations({ signedIn }: { signedIn: boolean }) {
  const params = useSearchParams();
  const campus = useCampusNavigationSearch(params);
  const classroomHref = campusServiceHref('/classroom', campus);
  const appealsHref = campusServiceHref('/teacher', campus);
  return (
    <nav aria-label="教學工作入口">
      <ul style={{ display: 'grid', gap: 16, paddingLeft: 20 }}>
        <li>
          <Link href={classroomHref}>前往授課課程</Link>
          <p>從你負責的課程查看教材、作業與點名；各門課依成員資格開放。</p>
        </li>
        <li>
          <Link href={signedIn ? appealsHref : schoolLoginHref(appealsHref)}>
            {signedIn ? '前往課務申訴審核' : '登入學校帳號後查看課務申訴'}
          </Link>
          <p>校方課務申訴需要學校帳號與該課程的審核權限。</p>
        </li>
      </ul>
    </nav>
  );
}

function TeachingRecoveryLinks({ signedIn }: { signedIn: boolean }) {
  return (
    <Suspense fallback={<p role="status">正在確認工作入口…</p>}>
      <TeachingDestinations signedIn={signedIn} />
    </Suspense>
  );
}

function TeachingAccess() {
  const client = getSupabaseClient();
  const [ending, setEnding] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function clearSession() {
    if (!client || ending) return;
    setEnding(true);
    setNotice('');
    setError('');
    try {
      const result = await client.auth.signOut({ scope: 'local' });
      if (result.error) throw result.error;
      if (mounted.current) setNotice('已清除這個瀏覽器的教學服務登入。');
    } catch {
      if (mounted.current) setError('先前的教學服務登入尚未清除，請重試。');
    } finally {
      if (mounted.current) setEnding(false);
    }
  }

  if (!client)
    return (
      <section className="card" style={{ padding: 24 }}>
        <h2>教學管理尚未開放</h2>
        <p>學校完成服務連結後，具備權限的教職員即可使用。</p>
        <TeachingRecoveryLinks signedIn />
      </section>
    );
  return (
    <section className="card" style={{ padding: 24 }}>
      <h2>教學管理尚未完成帳號連結</h2>
      <p>
        這個管理入口尚未開放。教材、作業與點名請從授課課程開啟；校方申訴另依授權處理。
      </p>
      <TeachingRecoveryLinks signedIn />
      <button className="btn" disabled={ending} onClick={() => void clearSession()}>
        {ending ? '正在清除…' : '清除先前的教學服務登入'}
      </button>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  void children;
  const { user, loading } = useAuth();
  if (loading) return <p role="status">確認學校帳號…</p>;
  if (!user)
    return (
      <section className="card" style={{ padding: 24 }}>
        <h2>選擇要處理的教學工作</h2>
        <p>這個教學管理入口尚未開放。授課課程與校方申訴各自確認所需帳號及權限。</p>
        <TeachingRecoveryLinks signedIn={false} />
      </section>
    );
  // No verified identity binding exists. Do not read another identity store or mount its readers.
  return <TeachingAccess key={user.uid} />;
}

export default RequireAdmin;
