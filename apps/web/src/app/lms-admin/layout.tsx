import { RequireAdmin } from '@/components/RequireAdmin';
import { SiteShell } from '@/components/SiteShell';
import styles from './workbench.module.css';

export default function TeachingLayout({ children }: { children: React.ReactNode }) {
  return (
    <SiteShell title="教學管理">
      <div className={styles.workspace}><RequireAdmin>{children}</RequireAdmin></div>
    </SiteShell>
  );
}
