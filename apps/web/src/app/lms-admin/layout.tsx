import { RequireAdmin } from '@/components/RequireAdmin';
import { SiteShell } from '@/components/SiteShell';

export default function TeachingLayout({ children }: { children: React.ReactNode }) {
  return <SiteShell title="教學管理"><RequireAdmin>{children}</RequireAdmin></SiteShell>;
}
