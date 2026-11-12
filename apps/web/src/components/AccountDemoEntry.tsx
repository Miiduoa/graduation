'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useNuniSession } from '@/features/nuni/Session';
import { readAccountDemo } from '@/lib/accountDemoClient';
import styles from './AccountDemoEntry.module.css';

const destinations = {
  account: {
    title: '你的展示資料已備妥',
    description: '開啟學生證、課表與校園生活流程，管理每一項展示權限。',
    anchor: '',
    label: '開啟我的展示工作區',
  },
  merchant: {
    title: '用展示店家走一次接單流程',
    description: '這個帳號已備妥示範菜單；從學生下單，到店家備餐與學生取餐單，都能接著操作。',
    anchor: '#merchant-demo',
    label: '開啟我的店家展示',
  },
  food: {
    title: '你的展示午餐已備妥',
    description: '開啟示範菜單、確認訂餐，再切換店家端查看同一筆訂單。',
    anchor: '#account-dining',
    label: '開啟我的點餐展示',
  },
} as const;
type Destination = keyof typeof destinations;
type EntryGrant = {
  schoolId: string;
  food: boolean;
  administration: boolean;
};

function Entry({
  accountId,
  context,
  destination,
}: {
  accountId: string;
  context: string;
  destination: Destination;
}) {
  const [grant, setGrant] = useState<EntryGrant | null>(null);
  useEffect(() => {
    let active = true;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    void readAccountDemo(context, accountId)
      .then((demo) => {
        if (!active || !demo) return;
        setGrant({
          schoolId: demo.profile.schoolId,
          food: demo.permissions.food,
          administration: demo.permissions.administration,
        });
        expiry = setTimeout(
          () => setGrant(null),
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
  if (!grant) return null;
  const entry = destinations[destination];
  const requiredPermissions = [
    !grant.food ? '「訂餐」' : null,
    !grant.administration ? '「管理展示」' : null,
  ].filter(Boolean);
  const description =
    destination !== 'account' && requiredPermissions.length
      ? `展示資料已備妥；請先在展示權限開啟${requiredPermissions.join('與')}，再完成學生訂餐與店家備餐流程。`
      : entry.description;
  const href = `/demo/account?campus=${encodeURIComponent(grant.schoolId)}${entry.anchor}`;
  return (
    <aside aria-label="帳號展示資料" className={styles.entry}>
      <div>
        <span className={styles.label}>本人帳號 · 展示資料</span>
        <h3>{entry.title}</h3>
        <p>{description}</p>
      </div>
      <Link href={href}>
        {entry.label}
        <span aria-hidden="true"> ↗</span>
      </Link>
    </aside>
  );
}

export function AccountDemoEntry({ destination = 'account' }: { destination?: Destination } = {}) {
  const auth = useNuniSession();
  if (!auth?.session || auth.loading || auth.pendingLogout || auth.error) return null;
  const { platformAccountId, context } = auth.session;
  return (
    <Entry
      key={`${platformAccountId}:${context}`}
      accountId={platformAccountId}
      context={context}
      destination={destination}
    />
  );
}
