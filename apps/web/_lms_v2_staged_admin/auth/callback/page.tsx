'use client';

import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { getBrowserSupabase } from '@/lib/supabase-browser';

function CallbackInner() {
  const router = useRouter();
  const [msg, setMsg] = useState('正在完成登入…');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getBrowserSupabase();
      const hash = typeof window !== 'undefined' ? window.location.hash : '';
      const search = typeof window !== 'undefined' ? window.location.search : '';

      const qp = new URLSearchParams(search);
      const code = qp.get('code');

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (error) {
          setMsg(`登入失敗：${error.message}`);
          return;
        }
        router.replace('/');
        return;
      }

      if (hash && hash.includes('access_token')) {
        const hp = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
        const access_token = hp.get('access_token');
        const refresh_token = hp.get('refresh_token');
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (cancelled) return;
          if (error) {
            setMsg(`登入失敗：${error.message}`);
            return;
          }
          router.replace('/');
          return;
        }
      }

      setMsg('未取得授權碼；請確認 Supabase Redirect URL 包含 /auth/callback');
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div style={{ padding: 48, maxWidth: 480, margin: '0 auto' }}>
      <p style={{ margin: 0 }}>{msg}</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div style={{ padding: 48 }}>載入中…</div>}>
      <CallbackInner />
    </Suspense>
  );
}
