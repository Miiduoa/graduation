import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { googleAccountManagementEnabled } from '@/lib/nuni/googleAccountLink';
import { GoogleLinkEntry } from './GoogleLinkEntry';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Google 登入方式',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function GoogleLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  if (!googleAccountManagementEnabled()) notFound();
  const params = await searchParams;
  return (
    <SiteShell title="管理登入方式" subtitle="查看已連結的登入方式，並管理 Google 帳號連結。">
      <GoogleLinkEntry result={typeof params.result === 'string' ? params.result : ''} />
    </SiteShell>
  );
}
