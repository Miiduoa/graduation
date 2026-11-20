'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { CampusIcon } from '@/components/CampusIcon';
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
import styles from '../storefront.module.css';

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
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void loadStorefront(context.schoolId, id).then(
      (value) => {
        if (active) setShop(value);
      },
      () => {
        if (active) {
          setShop(null);
          setError(true);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, context.schoolId, id]);
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
  const backHref = `/cafeteria/${encodeURIComponent(id)}?schoolId=${encodeURIComponent(context.schoolId)}`;
  return (
    <SiteShell
      title="前往店家訂餐"
      subtitle="確認店家後，在店家網站完成訂餐。"
      schoolName={context.schoolName}
      compactHeading
    >
      <div className={styles.page}>
        <Link className={styles.back} href={backHref}>
          <CampusIcon name="arrow" size={18} />
          返回店面
        </Link>
        {shop === undefined ? (
          <p role="status" className={styles.muted}>
            正在確認店家連結…
          </p>
        ) : error ? (
          <section className={styles.empty} role="alert">
            <h2>暫時無法確認店家連結</h2>
            <p>店家資料沒有載入成功，請再試一次。</p>
            <button
              className="btn"
              type="button"
              onClick={() => {
                setError(false);
                setShop(undefined);
                setAttempt((value) => value + 1);
              }}
            >
              再試一次
            </button>
          </section>
        ) : !shop || action.kind !== 'showcase' ? (
          <section className={styles.empty}>
            <h2>{shop ? '這間店還沒有可打開的訂餐連結' : '目前沒有可使用的店家訂餐連結'}</h2>
            <p>可以回店面查看菜單與營業資訊，或到店向店家詢問。</p>
          </section>
        ) : (
          <section className={styles.handoff} aria-labelledby="order-shop-name">
            <h2 id="order-shop-name">{shop.name}</h2>
            <p>{EXTERNAL_ORDER_HONEST_TEXT}</p>
            <div className={styles.destination}>
              <CampusIcon name="cafeteria" size={24} />
              <div>
                <span>即將在新分頁開啟</span>
                <strong>{new URL(tagged).hostname}</strong>
              </div>
            </div>
            {notice ? <p role="status">{notice}</p> : null}
            <div className={styles.handoffActions}>
              <a
                className={styles.primaryAction}
                href={tagged}
                rel="noopener noreferrer"
                target="_blank"
                onClick={() => {
                  setNotice('店家網站會在新分頁開啟，完成後可回這裡繼續瀏覽。');
                  if (!user) return;
                  void recordExternalOrderClick({
                    uid: user.uid,
                    schoolId: context.schoolId,
                    cafeteriaId: id,
                    orderingUrl: shop.orderingUrl!,
                  }).catch(() => {
                    /* 瀏覽紀錄失敗不影響開啟店家網站。 */
                  });
                }}
              >
                {SHOWCASE_ORDER_BUTTON_TEXT}
                <CampusIcon name="arrow" size={18} />
              </a>
              <Link className="btn" href={backHref}>
                再看看菜單
              </Link>
            </div>
            <p className={styles.caption}>{SHOWCASE_ORDER_CAPTION}</p>
          </section>
        )}
      </div>
    </SiteShell>
  );
}
