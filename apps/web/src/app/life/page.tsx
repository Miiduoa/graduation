'use client';

import { Suspense } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { ServiceDirectory } from '@/components/ServiceDirectory';

export default function LifePage() {
  return (
    <SiteShell title="生活" subtitle="出門、吃飯、住宿，需要的校園服務放在一起。">
      <Suspense fallback={<p role="status">正在載入生活服務…</p>}>
        <ServiceDirectory journey="life" />
      </Suspense>
    </SiteShell>
  );
}
