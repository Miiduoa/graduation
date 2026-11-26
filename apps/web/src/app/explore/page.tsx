import { Suspense } from 'react';
import { ExploreExperiences } from '@/components/ExploreExperiences';
import { SiteShell } from '@/components/SiteShell';

export default function ExplorePage() {
  return (
    <SiteShell title="探索" subtitle="從一件想完成的事開始。">
      <Suspense fallback={<p role="status">正在準備探索內容…</p>}>
        <ExploreExperiences />
      </Suspense>
    </SiteShell>
  );
}
