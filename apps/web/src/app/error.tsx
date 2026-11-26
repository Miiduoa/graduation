'use client';

import { SiteShell } from '@/components/SiteShell';
import { PageRecovery } from '@/components/PageRecovery';

export default function PageError({ reset }: { reset: () => void }) {
  return (
    <SiteShell>
      <PageRecovery kind="error" onRetry={reset} />
    </SiteShell>
  );
}
