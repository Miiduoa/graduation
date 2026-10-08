'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  PROVIDENCE_UNIVERSITY_SCHOOL_CODE,
  PROVIDENCE_UNIVERSITY_SCHOOL_ID,
} from '@campus/shared/src';

import { completeWebSSOCallback, signInWithCustomAuthToken } from '@/features/auth/client';
import { appendSchoolContext, sanitizeInternalPath } from '@/lib/navigation';
import { SiteShell } from '@/components/SiteShell';
import home from '../home.module.css';
import {
  buildCurrentSsoRedirectUri,
  clearPendingWebSsoTransaction,
  consumePendingSamlResponse,
  consumePendingWebSsoTransaction,
  getSsoTransactionState,
  readWebSsoCallbackParams,
} from '@/lib/sso';

type CallbackStatus = 'loading' | 'success' | 'error';

function SSOCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<CallbackStatus>('loading');
  const [message, setMessage] = useState('正在確認登入資訊…');

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const school = PROVIDENCE_UNIVERSITY_SCHOOL_CODE;
      const schoolId = PROVIDENCE_UNIVERSITY_SCHOOL_ID;
      const returnUrl = sanitizeInternalPath(searchParams.get('returnUrl'));
      const authError = searchParams.get('error');
      const callbackParams = readWebSsoCallbackParams(searchParams);
      const transactionState = getSsoTransactionState(searchParams);

      if (authError) {
        if (transactionState) {
          clearPendingWebSsoTransaction(transactionState);
        }
        if (!cancelled) {
          setStatus('error');
          setMessage(decodeURIComponent(authError.replace(/\+/g, ' ')));
        }
        return;
      }

      if (!callbackParams.provider || !transactionState) {
        if (!cancelled) {
          setStatus('error');
          setMessage('缺少登入方式或交易狀態，請重新從登入頁發起');
        }
        return;
      }

      try {
        setMessage('正在確認學校帳號…');
        const pendingTransaction = consumePendingWebSsoTransaction(transactionState);
        if (!pendingTransaction?.transactionId) {
          throw new Error('登入交易已失效，請重新發起學校登入');
        }

        const redirectUri = buildCurrentSsoRedirectUri(new URL(window.location.href));
        const samlResponse =
          callbackParams.samlResponse ||
          (callbackParams.provider === 'saml' ? consumePendingSamlResponse(redirectUri) : null);

        if (!callbackParams.code && !callbackParams.ticket && !samlResponse) {
          throw new Error('缺少驗證資料，請重新嘗試登入');
        }

        const result = await completeWebSSOCallback({
          provider: callbackParams.provider,
          schoolId,
          redirectUri,
          transactionId: pendingTransaction.transactionId,
          state: transactionState,
          codeVerifier: pendingTransaction.codeVerifier,
          code: callbackParams.code ?? undefined,
          ticket: callbackParams.ticket ?? undefined,
          samlResponse: samlResponse ?? undefined,
        });

        setMessage('正在完成登入…');
        await signInWithCustomAuthToken(result.customToken);

        if (cancelled) return;

        setStatus('success');
        setMessage('已登入，正在返回原本瀏覽的頁面…');

        const target = appendSchoolContext(returnUrl, { code: school, id: schoolId });

        window.setTimeout(() => {
          if (!cancelled) {
            router.replace(target);
          }
        }, 900);
      } catch (error) {
        if (!cancelled) {
          setStatus('error');
          setMessage(error instanceof Error ? error.message : '登入失敗，請稍後再試');
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  const loginQuery = new URLSearchParams();
  const returnUrl = searchParams.get('returnUrl');

  loginQuery.set('school', PROVIDENCE_UNIVERSITY_SCHOOL_CODE);
  loginQuery.set('schoolId', PROVIDENCE_UNIVERSITY_SCHOOL_ID);
  if (returnUrl) loginQuery.set('returnUrl', returnUrl);
  const loginQueryString = loginQuery.toString();

  return (
    <section
      className="card"
      aria-labelledby="callback-status"
      style={{ maxWidth: 560, margin: '0 auto', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
    >
      <h2 id="callback-status" style={{ margin: '0 0 12px', fontSize: 22 }}>
        {status === 'loading' ? '正在確認學校帳號' : status === 'success' ? '已完成登入' : '無法完成登入'}
      </h2>
      <p role={status === 'error' ? 'alert' : 'status'} style={{ margin: 0, lineHeight: 1.8, overflowWrap: 'anywhere', color: status === 'error' ? 'var(--danger)' : 'var(--muted)' }}>
        {message}
      </p>
      {status === 'loading' && <p className={home.intro} style={{ marginTop: 18 }}>確認完成後，會自動返回你原本瀏覽的頁面。</p>}
      {status === 'error' && <button
        className={home.primary}
        style={{ marginTop: 24, border: 0, cursor: 'pointer', font: 'inherit' }}
        onClick={() => router.push(`/login${loginQueryString ? `?${loginQueryString}` : ''}`)}
      >返回登入頁</button>}
    </section>
  );
}

export default function SSOCallbackPage() {
  return (
    <SiteShell title="學校帳號登入" subtitle="確認你的身分後，繼續使用校園服務。">
      <Suspense fallback={<p role="status">正在載入登入資訊…</p>}>
        <SSOCallbackContent />
      </Suspense>
    </SiteShell>
  );
}
