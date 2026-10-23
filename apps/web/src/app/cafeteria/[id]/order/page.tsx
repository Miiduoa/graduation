'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { useAuth } from '@/components/AuthGuard';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import { loadStorefront, recordExternalOrderClick } from '@/lib/storefront';
import {
  EXTERNAL_ORDER_HONEST_TEXT,
  SHOWCASE_ORDER_BUTTON_TEXT,
  SHOWCASE_ORDER_CAPTION,
  buildShowcaseOrderingUrl,
  isHttpsOrderingUrl,
  studentCafeteriaAction,
} from '@campus/shared/src/merchantMode';
import type { Cafeteria } from '@/lib/firebase';

export default function HonestOrderPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ schoolId?: string; school?: string; campus?: string }>;
}) {
  const { id } = use(props.params);
  const search = props.searchParams ? use(props.searchParams) : undefined;
  const context = useBrowsingSchoolPageContext(search);
  if (!context.ready) {
    return (
      <SiteShell title="餐廳">
        <SchoolScopePlaceholder />
      </SiteShell>
    );
  }
  return <OrderContent key={`${context.schoolId}:${id}`} id={id} context={context} />;
}

function OrderContent({
  id,
  context,
}: {
  id: string;
  context: ReturnType<typeof useBrowsingSchoolPageContext>;
}) {
  const { user } = useAuth();
  const [shop, setShop] = useState<Cafeteria | null | undefined>(undefined);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    void loadStorefront(context.schoolId, id).then(
      (value) => {
        if (active) setShop(value);
      },
      () => {
        if (active) setShop(null);
      },
    );
    return () => {
      active = false;
    };
  }, [context.schoolId, id]);
  const action = studentCafeteriaAction({
    merchantMode: shop?.merchantMode,
    orderingEnabled: shop?.orderingEnabled,
    onlineOrderingEnabled: false,
    orderingUrl: shop?.orderingUrl,
  });
  const tagged =
    shop && isHttpsOrderingUrl(shop.orderingUrl)
      ? buildShowcaseOrderingUrl(shop.orderingUrl, context.schoolId, id)
      : '';
  return (
    <SiteShell
      title={SHOWCASE_ORDER_BUTTON_TEXT}
      subtitle="訂單在店家系統，不走我們的結帳。"
      schoolName={context.schoolName}
    >
      {shop === undefined && <p role="status">正在確認店家連結…</p>}
      {shop === null && (
        <section>
          <h2>目前沒有可使用的店家訂餐連結</h2>
          <p>此店家可能尚未提供訂餐資訊，請回店面查看其他服務。</p>
          <Link
            className="btn"
            href={`/cafeteria/${encodeURIComponent(id)}?schoolId=${encodeURIComponent(context.schoolId)}`}
          >
            返回店面
          </Link>
        </section>
      )}
      {shop && action.kind !== 'showcase' && (
        <section>
          <h2>這間店還沒有可打開的訂餐連結</h2>
          <p>沒串接的店可以先上架成只有連結；目前這間還沒提供 https 訂餐網址。</p>
          <Link
            className="btn"
            href={`/cafeteria/${encodeURIComponent(id)}?schoolId=${encodeURIComponent(context.schoolId)}`}
          >
            返回店面
          </Link>
        </section>
      )}
      {shop && action.kind === 'showcase' && (
        <section>
          <h2>{shop.name}</h2>
          <p>{EXTERNAL_ORDER_HONEST_TEXT}</p>
          {notice && <p role="status">{notice}</p>}
          <p>
            <a
              className="btn primary"
              href={tagged}
              rel="noopener noreferrer"
              target="_blank"
              onClick={() => {
                if (!user) return;
                void recordExternalOrderClick({
                  uid: user.uid,
                  schoolId: context.schoolId,
                  cafeteriaId: id,
                  orderingUrl: shop.orderingUrl!,
                }).then(
                  () => setNotice('已記下你離開的時間。訂單請到店家查看。'),
                  () => setNotice(EXTERNAL_ORDER_HONEST_TEXT),
                );
              }}
            >
              {SHOWCASE_ORDER_BUTTON_TEXT}
            </a>
          </p>
          <p>{SHOWCASE_ORDER_CAPTION}</p>
          <Link
            className="btn"
            href={`/cafeteria/${encodeURIComponent(id)}?schoolId=${encodeURIComponent(context.schoolId)}`}
          >
            返回店面
          </Link>
        </section>
      )}
    </SiteShell>
  );
}
