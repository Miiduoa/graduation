import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';

export default function NotFound() {
  return (
    <SiteShell title="找不到這個頁面" subtitle="連結可能已變更，或這項內容已移除。">
      <Link href="/" className="btn primary">
        返回首頁
      </Link>
    </SiteShell>
  );
}
