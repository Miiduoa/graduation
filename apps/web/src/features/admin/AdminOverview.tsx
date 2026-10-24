'use client';

import { Button } from '@/components/ui/Button';
import { parseReports, parseSchools } from './api';
import { useAdminResource } from './hooks';
import type { AdminSection } from './adminNav';
import { AdminResponsibilities } from './AdminResponsibilities';
import styles from './Admin.module.css';

export function AdminOverview({
  context,
  suspended,
  onNavigate,
}: {
  context: string;
  suspended: boolean;
  onNavigate: (section: AdminSection) => void;
}) {
  const schools = useAdminResource('schools', context, parseSchools, !suspended);
  const reports = useAdminResource('reports?state=open', context, parseReports, !suspended);
  const pending = schools.value?.filter((school) => school.lifecycle === 'pending');
  const provisioned = schools.value?.filter((school) => school.lifecycle === 'provisioned');
  return (
    <div className={styles.stack}>
      <section className={styles.panel} aria-labelledby="admin-work-heading">
        <div className={styles.toolbar}>
          <div className={styles.sectionIntro}>
            <h2 id="admin-work-heading">待處理事項</h2>
            <p className={styles.muted}>數字僅反映本次成功載入的資料範圍。</p>
          </div>
          <Button
            disabled={schools.loading || reports.loading}
            onClick={() => {
              schools.reload();
              reports.reload();
            }}
          >
            更新待辦
          </Button>
        </div>
        <ul className={styles.actionQueue}>
          <li>
            <div className={styles.actionBody}>
              <h3>學校接入</h3>
              {schools.loading ? (
                <p role="status">正在讀取學校申請…</p>
              ) : schools.error ? (
                <p role="alert">{schools.error}</p>
              ) : (
                <>
                  <p className={styles.muted}>
                    {pending?.length || 0} 件申請待審核；{provisioned?.length || 0}{' '}
                    所學校已建檔、尚未開通。
                  </p>
                  {!!pending?.length && (
                    <ul className={styles.compactList}>
                      {pending.slice(0, 5).map((school) => (
                        <li key={school.applicationId}>{school.displayName}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
            {!schools.loading && !schools.error && (
              <div className={styles.actions}>
                <a className={styles.link} href="/auth/platform/school-review">
                  前往審核申請
                </a>
                <Button onClick={() => onNavigate('schools')}>檢查學校開通狀態</Button>
              </div>
            )}
          </li>
          <li>
            <div className={styles.actionBody}>
              <h3>公開交流檢舉</h3>
              {reports.loading ? (
                <p role="status">正在讀取待處理檢舉…</p>
              ) : reports.error ? (
                <p role="alert">{reports.error}</p>
              ) : (
                <>
                  <p className={styles.muted}>
                    本次列出 {reports.value?.length || 0} 件待處理檢舉，最多顯示最近 50 件。
                  </p>
                  <p className={styles.muted}>
                    先閱讀被檢舉內容及原因，再決定隱藏貼文或駁回。每次處理都會留下理由。
                  </p>
                </>
              )}
            </div>
            {!reports.loading && !reports.error && (
              <div className={styles.actions}>
                <Button onClick={() => onNavigate('reports')}>處理社群檢舉</Button>
              </div>
            )}
          </li>
        </ul>
      </section>

      <AdminResponsibilities onNavigate={onNavigate} />
    </div>
  );
}
