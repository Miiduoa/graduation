'use client';

import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';

export default function PageError({ reset }: { reset: () => void }) {
  return (
    <SiteShell title="目前無法開啟這個頁面" subtitle="請稍後重試，或返回首頁使用其他服務。">
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" className="btn primary" onClick={reset}>
          重新載入
        </button>
        <Link href="/" className="btn">
          返回首頁
        </Link>
      </div>
    </SiteShell>
  );
}
