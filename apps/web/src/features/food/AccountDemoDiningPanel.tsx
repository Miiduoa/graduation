'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { ACCOUNT_DEMO_MEAL } from '@campus/shared/src/accountDemo';
import { AccountDemoScope, type AccountDemoController } from '@/components/AccountDemoState';
import { ConfirmModal } from '@/components/ui/Modal';
import { AccountDemoDining } from './AccountDemoDining';
import styles from '@/features/merchant/MerchantWorkspace.module.css';

function DiningContent({
  controller,
  view,
}: {
  controller: AccountDemoController;
  view: 'student' | 'merchant';
}) {
  const [pending, setPending] = useState<'createOrder' | 'readyOrder' | null>(null);
  const { demo, blocked, busy, error, mutate } = controller;
  const confirmed = pending === 'createOrder' ? demo.state.createOrder : demo.state.readyOrder;
  return (
    <>
      <AccountDemoDining demo={demo} blocked={blocked} onAction={setPending} view={view} />
      <ConfirmModal
        isOpen={pending !== null && !error && !confirmed}
        onClose={() => setPending(null)}
        title={pending === 'readyOrder' ? '確認餐點已備妥' : '確認訂餐'}
        message={
          pending === 'readyOrder'
            ? '確認這份香煎雞腿飯已備妥後，學生取餐單會更新為可取餐。'
            : `${ACCOUNT_DEMO_MEAL.merchant}：${ACCOUNT_DEMO_MEAL.name} × ${ACCOUNT_DEMO_MEAL.quantity}，展示金額 NT$${ACCOUNT_DEMO_MEAL.price}，${ACCOUNT_DEMO_MEAL.pickup} 取餐。這筆合成資料不會扣款或送往實際店家。`
        }
        confirmText="確認並儲存"
        loading={busy}
        onConfirm={async () => {
          if (!pending || blocked) return;
          if (await mutate({ action: pending })) setPending(null);
        }}
      />
    </>
  );
}

/** Presents the account's data inside the original feature route; ordinary accounts keep their page. */
export function AccountDemoDiningPanel({
  view,
  fallback,
  entryOnly = false,
}: {
  view: 'student' | 'merchant';
  fallback: ReactNode;
  entryOnly?: boolean;
}) {
  return (
    <AccountDemoScope fallback={fallback}>
      {(controller) =>
        entryOnly ? (
          <section className={styles.panel} aria-label="我的門市">
            <h2>{ACCOUNT_DEMO_MEAL.merchant}</h2>
            <p>
              {controller.demo.profile.schoolName} · {ACCOUNT_DEMO_MEAL.place}
            </p>
            <p>本人帳號的合成示範資料。進入門市工作台查看收到的訂單與備餐進度。</p>
            <Link
              className="btn primary"
              href={`/merchant/workspace?campus=${encodeURIComponent(controller.demo.profile.schoolId)}`}
            >
              管理門市與訂單
            </Link>
          </section>
        ) : (
          <DiningContent
            key={`${controller.demo.accountId}:${view}`}
            controller={controller}
            view={view}
          />
        )
      }
    </AccountDemoScope>
  );
}
