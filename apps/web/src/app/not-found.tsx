import { SiteShell } from '@/components/SiteShell';
import { PageRecovery } from '@/components/PageRecovery';

export default function NotFound() {
  return (
    <SiteShell>
      <PageRecovery kind="missing" />
    </SiteShell>
  );
}
