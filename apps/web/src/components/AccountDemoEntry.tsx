'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useNuniSession } from '@/features/nuni/Session';
import { readAccountDemo } from '@/lib/accountDemoClient';

function Entry({ accountId, context }: { accountId: string; context: string }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    void readAccountDemo(context, accountId)
      .then((demo) => {
        if (!active || !demo) return;
        setAvailable(true);
        expiry = setTimeout(
          () => setAvailable(false),
          Math.min(2_147_483_647, Date.parse(demo.expiresAt) - Date.now()),
        );
      })
      .catch(() => {
        /* An optional entry must not interrupt ordinary settings. */
      });
    return () => {
      active = false;
      clearTimeout(expiry);
    };
  }, [accountId, context]);
  if (!available) return null;
  return (
    <aside aria-label="帳號展示資料">
      <h3>你的展示資料已備妥</h3>
      <p>開啟學生證、課表與校園生活流程，管理每一項展示權限。</p>
      <Link href="/demo/account">開啟我的展示工作區</Link>
    </aside>
  );
}

export function AccountDemoEntry() {
  const auth = useNuniSession();
  if (!auth?.session || auth.loading || auth.pendingLogout) return null;
  const { platformAccountId, context } = auth.session;
  return (
    <Entry
      key={`${platformAccountId}:${context}`}
      accountId={platformAccountId}
      context={context}
    />
  );
}
