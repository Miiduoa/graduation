'use client';

import { useCallback, useMemo } from 'react';
import { createNuniFoodClient } from '@campus/shared/src/nuniFood';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { Button } from '@/components/ui/Button';
import { FoodOrders } from '@/features/food/FoodOrders';
import { useFoodRead, type FoodDraftCache } from '@/features/food/foodState';
import { browserRequest } from '@/features/nuni/Session';
import styles from './orders.module.css';

export function PlatformOrders({
  accountId,
  context,
  schoolId,
  schoolName,
  tenant,
  orderId,
  cache,
}: {
  accountId: string;
  context: string;
  schoolId: string;
  schoolName: string;
  tenant: string | null;
  orderId: string | null;
  cache: FoodDraftCache;
}) {
  const client = useMemo(
    () =>
      createNuniFoodClient((path, input, query) =>
        browserRequest(path, context, input, undefined, query),
      ),
    [context],
  );
  const load = useCallback(() => client.listOrderRealms(), [client]);
  const realms = useFoodRead(load);
  const matching = realms.data?.filter(
    (realm) => toPublicSchoolId(realm.tenantId) === toPublicSchoolId(schoolId),
  );
  // Keep the selected campus. Never fall back to the first other school with orders.
  const onlyMatchingRealm = matching?.length === 1 ? matching[0] : undefined;
  const realm = tenant
    ? (matching?.find((item) => item.tenantId === tenant) ?? onlyMatchingRealm)
    : (matching?.find((item) => item.tenantId === schoolId) ?? onlyMatchingRealm);

  return (
    <section className={styles.list} aria-label="站內點餐訂單">
      <div className={styles.actions}>
        <Button disabled={realms.loading} onClick={() => void realms.reload()}>
          重新確認訂單校園
        </Button>
      </div>
      {realms.loading ? <p role="status">正在確認這個帳號的訂單校園…</p> : null}
      {realms.error ? <p role="alert">{realms.error}</p> : null}
      {realms.data && !realm ? (
        <p role="status">
          {orderId || tenant
            ? '找不到這個帳號在目前校園的訂單，請確認訂單連結及登入帳號。'
            : `這個 Google 帳號在${schoolName}目前沒有訂單紀錄。`}
        </p>
      ) : null}
      {realm ? (
        <FoodOrders
          key={`${realm.tenantId}:${orderId ?? ''}`}
          client={client}
          cache={cache}
          accountId={accountId}
          tenantId={realm.tenantId}
          initialOrder={orderId ?? ''}
          orderHref={(selectedOrder) => {
            const search = new URLSearchParams({ campus: schoolId, tenant: realm.tenantId });
            if (selectedOrder) search.set('order', selectedOrder);
            return `/orders?${search.toString()}`;
          }}
        />
      ) : null}
    </section>
  );
}
