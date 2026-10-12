'use client';

import { use, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { loadStorefront, saveShopStorefront } from '@/lib/storefront';
import { storefrontUrlIssue } from '@campus/shared/src/merchantMode';
import social from '@/features/social/Social.module.css';

export default function ShopStorefrontEditPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ schoolId?: string; school?: string }>;
}) {
  const { id } = use(props.params);
  const search = props.searchParams ? use(props.searchParams) : undefined;
  const context = resolveSchoolPageContext(search);
  const { user } = useAuth();
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [orderingUrl, setOrderingUrl] = useState('');
  const [openingHours, setOpeningHours] = useState('');
  const [location, setLocation] = useState('');
  const [intro, setIntro] = useState('');
  const [merchantMode, setMerchantMode] = useState<'showcase_link' | 'info_only'>('info_only');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void loadStorefront(context.schoolId, id).then(
      (shop) => {
        if (!shop) {
          setError('找不到這間店。');
          return;
        }
        setWebsiteUrl(shop.websiteUrl || '');
        setOrderingUrl(shop.orderingUrl || '');
        setOpeningHours(shop.openingHours || '');
        setLocation(shop.location || '');
        setIntro(shop.intro || '');
        setMerchantMode(shop.merchantMode === 'showcase_link' ? 'showcase_link' : 'info_only');
        setReady(true);
      },
      () => setError('暫時讀不到這間店。'),
    );
  }, [context.schoolId, id]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const websiteIssue = storefrontUrlIssue(websiteUrl);
    const orderingIssue = storefrontUrlIssue(orderingUrl);
    if (websiteIssue || orderingIssue) {
      setError(websiteIssue || orderingIssue || '');
      setNotice('');
      return;
    }
    if (!user) {
      setError('請先登入再儲存店面。');
      return;
    }
    setError('');
    void saveShopStorefront({
      schoolId: context.schoolId,
      cafeteriaId: id,
      websiteUrl,
      orderingUrl,
      openingHours,
      location,
      intro,
      merchantMode,
    }).then(
      () => {
        setNotice('店面資料已更新。');
        setWebsiteUrl((current) => current.trim());
        setOrderingUrl((current) => current.trim());
      },
      (reason) => {
        setNotice('');
        setError(reason instanceof Error && reason.message ? reason.message : '這次沒寫成。');
      },
    );
  }

  return (
    <SiteShell
      title="編輯店面"
      subtitle="外連訂餐與店家網站會先去掉前後空白再檢查。訂單和付款仍由店家處理。"
      schoolName={context.schoolName}
    >
      {!ready && !error && <p role="status">正在讀取店面…</p>}
      {error && <p role="alert">{error}</p>}
      {ready && (
        <form className={social.stack} onSubmit={submit}>
          <section className={social.panel}>
            <h2>店家網站與外連訂餐</h2>
            <p className={social.muted}>
              沒有外連的店可以只填營業時間和地點。貼網址時前後空白會自動去掉，不會當成錯誤。
            </p>
            <label>
              店家網站
              <input
                value={websiteUrl}
                onChange={(event) => setWebsiteUrl(event.target.value)}
                autoCapitalize="none"
                inputMode="url"
              />
            </label>
            <label>
              外連訂餐網址
              <input
                value={orderingUrl}
                onChange={(event) => setOrderingUrl(event.target.value)}
                autoCapitalize="none"
                inputMode="url"
              />
            </label>
            <label>
              營業時間
              <input value={openingHours} onChange={(event) => setOpeningHours(event.target.value)} />
            </label>
            <label>
              地點
              <input value={location} onChange={(event) => setLocation(event.target.value)} />
            </label>
            <label>
              店面介紹
              <textarea value={intro} onChange={(event) => setIntro(event.target.value)} rows={3} />
            </label>
            <label>
              <input
                type="checkbox"
                checked={merchantMode === 'showcase_link'}
                onChange={(event) =>
                  setMerchantMode(event.target.checked ? 'showcase_link' : 'info_only')
                }
              />
              設為外連訂餐
            </label>
            {notice && <p role="status">{notice}</p>}
            <div className={social.actions}>
              <button className="btn primary" type="submit">
                儲存店面
              </button>
              <Link
                className="btn"
                href={`/cafeteria/${encodeURIComponent(id)}?schoolId=${encodeURIComponent(context.schoolId)}`}
              >
                返回店面
              </Link>
            </div>
          </section>
        </form>
      )}
    </SiteShell>
  );
}
