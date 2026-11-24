import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { googleAccountLinkEnabled } from '@/lib/nuni/googleAccountLink';
import { GoogleLinkEntry } from './GoogleLinkEntry';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Google 登入方式',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function GoogleLinkPage({
  searchParams,
}: { searchParams: Promise<{ result?: string | string[] }> }) {
  if (!googleAccountLinkEnabled()) notFound();
  const params = await searchParams;
  return (
    <SiteShell title="管理 Google 登入方式" subtitle="將登入方式連結到目前的 nuni 帳號，而不是建立新帳號。">
      <GoogleLinkEntry result={typeof params.result === 'string' ? params.result : ''} />
    </SiteShell>
  );
}
