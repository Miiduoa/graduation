'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useAuth } from './AuthGuard';

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
        <Link href="/#courses">返回課程</Link>
      </section>
    );
  return (
    <section className="card" style={{ padding: 24 }}>
      <h2>教學管理尚未完成帳號連結</h2>
      <p>
        這個管理服務尚未與目前的校園帳號完成安全連結，暫時無法開啟。你的課程與點名仍可從課程頁使用。
      </p>
      <button className="btn" disabled={ending} onClick={() => void clearSession()}>
        {ending ? '正在清除…' : '清除先前的教學服務登入'}
      </button>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      <p>
        <Link href="/#courses">返回課程</Link>
      </p>
    </section>
  );
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  void children;
  const { user, loading } = useAuth();
  if (loading) return <p role="status">確認校園帳號…</p>;
  if (!user)
    return (
      <section className="card" style={{ padding: 24 }}>
        <h2>請先登入校園帳號</h2>
        <p>登入後才能確認教學服務是否已開放。</p>
        <Link href="/login">登入帳號</Link>
      </section>
    );
  // No verified identity binding exists. Do not read another identity store or mount its readers.
  return <TeachingAccess key={user.uid} />;
}

export default RequireAdmin;
