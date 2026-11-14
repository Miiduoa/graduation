'use client';

import { Suspense } from 'react';
import { useAuth } from '@/components/AuthGuard';
import { ServiceDirectory } from '@/components/ServiceDirectory';
import { SiteShell } from '@/components/SiteShell';
import { useOptionalNuniSession } from '@/features/nuni/Session';
import { useClientHydrated } from '@/lib/useClientHydrated';

function ConnectDirectory() {
  const auth = useAuth();
  const platform = useOptionalNuniSession();
  const hydrated = useClientHydrated();
  const schoolReady = hydrated && !auth.loading && !auth.error && Boolean(auth.user);
  const platformReady =
    hydrated &&
    !platform?.loading &&
    !platform?.error &&
    !platform?.pendingLogout &&
    Boolean(platform?.session);
  return (
    <ServiceDirectory
      journey="connect"
      recommendedHref={schoolReady ? '/community' : platformReady ? '/social' : undefined}
      introduction={
        schoolReady
          ? '校內話題、訊息與好友在這裡；也可以到跨校公開交流看看其他校園。'
          : platformReady
            ? '從跨校公開交流開始。校內話題、訊息與好友會另外確認學校帳號。'
            : '公告可直接閱讀；公開話題使用 Google 帳號，校內話題、訊息與好友使用學校帳號。'
      }
    />
  );
}

export default function ConnectPage() {
  return (
    <SiteShell title="交流" subtitle="看話題、找同學，接續你的對話與校園消息。">
      <Suspense fallback={<p role="status">正在載入交流服務…</p>}>
        <ConnectDirectory />
      </Suspense>
    </SiteShell>
  );
}
