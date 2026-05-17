'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { getBrowserSupabase } from '@/lib/supabase-browser';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const supabase = getBrowserSupabase();
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signErr) {
      setError(signErr.message);
      return;
    }
    router.replace('/');
  }

  async function oauth(provider: 'google' | 'azure' | 'github') {
    setError(null);
    const supabase = getBrowserSupabase();
    const cb = `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`;
    const { error: oErr } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: cb },
    });
    if (oErr) setError(oErr.message);
  }

  return (
    <div style={{ maxWidth: 420, margin: '48px auto', padding: 24, background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb' }}>
      <h1 style={{ marginTop: 0 }}>後台登入</h1>
      <p style={{ color: '#6b7280', fontSize: 14 }}>
        需要資料庫 <code>profiles.role = admin</code>。請勿把 service_role key 放進前端。
      </p>
      <form onSubmit={signIn} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span>Email</span>
          <input
            style={{ padding: 10, borderRadius: 8, border: '1px solid #d1d5db' }}
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span>密碼</span>
          <input
            style={{ padding: 10, borderRadius: 8, border: '1px solid #d1d5db' }}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
          />
        </label>
        {error ? <p style={{ color: '#b91c1c', margin: 0 }}>{error}</p> : null}
        <button type="submit" style={{ padding: '12px 16px', borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 700 }}>
          登入
        </button>
      </form>

      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 13, color: '#6b7280' }}>或使用 OAuth（Dashboard 須啟用 Provider，並允許 Redirect：…/auth/callback）</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontWeight: 600 }} onClick={() => oauth('google')}>
            Google
          </button>
          <button type="button" style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontWeight: 600 }} onClick={() => oauth('azure')}>
            Microsoft
          </button>
          <button type="button" style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontWeight: 600 }} onClick={() => oauth('github')}>
            GitHub
          </button>
        </div>
      </div>

      <p style={{ marginTop: 16 }}>
        <Link href="/">返回總覽</Link>
      </p>
    </div>
  );
}
