'use client';

import { Button } from '@/components/ui/Button';
import { parseReports, parseSchools } from './api';
import { useAdminResource } from './hooks';
import type { AdminLocation, AdminSection } from './adminNav';
import { AdminResponsibilities } from './AdminResponsibilities';
import styles from './Admin.module.css';

export function AdminOverview({
  context,
  suspended,
  onNavigate,
}: {
  context: string;
  suspended: boolean;
  onNavigate: (section: AdminSection, patch?: Partial<AdminLocation>) => void;
}) {
  const schools = useAdminResource('schools', context, parseSchools, !suspended);
  const reports = useAdminResource('reports?state=open', context, parseReports, !suspended);
  const pending = schools.value?.filter((school) => school.lifecycle === 'pending');
  const provisioned = schools.value?.filter((school) => school.lifecycle === 'provisioned');
  const activeSchools = schools.value?.filter((school) => school.lifecycle === 'open');
  const schoolsReady = !schools.loading && !schools.error && !!schools.value;
  const reportsReady = !reports.loading && !reports.error && !!reports.value;
  return (
    <div className={styles.stack}>
      <section className={styles.overviewHero} aria-labelledby="admin-summary-heading">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>跨校營運 / 今日工作</p>
          <h2 id="admin-summary-heading">先處理需要決策的事情</h2>
          <p className={styles.muted}>
            把學校接入、服務開通與公開社群檢舉放在同一個工作台。
            各校的學籍、課程和個人資料仍依原有校方授權管理。
          </p>
        </div>
        <div className={styles.heroActions}>
          <a className={styles.link} href="/admin/school-review">審核學校申請</a>
          <Button onClick={() => onNavigate('people')}>查看管理授權</Button>
        </div>
      </section>
      <div className={styles.metricsGrid} aria-label="本次載入的營運摘要">
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>學校申請待審核</span>
          <strong className={styles.metricValue}>{schoolsReady ? pending!.length : '—'}</strong>
          <span className={styles.metricHint}>依本次已讀取的學校資料</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>已建檔待開通</span>
          <strong className={styles.metricValue}>{schoolsReady ? provisioned!.length : '—'}</strong>
          <span className={styles.metricHint}>尚未開放校方服務</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>公開社群待處理檢舉</span>
          <strong className={styles.metricValue}>{reportsReady ? reports.value!.length : '—'}</strong>
          <span className={styles.metricHint}>本次最多載入最近 50 件</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>已開通學校</span>
          <strong className={styles.metricValue}>{schoolsReady ? activeSchools!.length : '—'}</strong>
          <span className={styles.metricHint}>僅計入本次成功讀取的資料</span>
        </div>
      </div>
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
                <a className={styles.link} href="/admin/school-review">
                  前往審核申請
                </a>
                <Button onClick={() => onNavigate('schools', { schoolLifecycle: 'provisioned' })}>
                  檢查學校開通狀態
                </Button>
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

      <section className={styles.panel} aria-labelledby="admin-quick-heading">
        <div className={styles.stack}>
          <div className={styles.sectionIntro}>
            <h2 id="admin-quick-heading">常用營運作業</h2>
            <p className={styles.muted}>從工作進入管理流程；操作權限仍依登入身分與所屬學校檢查。</p>
          </div>
          <div className={styles.taskGrid}>
            <a className={styles.taskTile} href="/admin/ops?tab=people">
              <strong>校方成員與授權</strong>
              <span>先選學校，再新增管理員或職員。已開通學校需啟用限時代操作。</span>
            </a>
            <a className={styles.taskTile} href="/admin/ops?tab=merchants">
              <strong>店家申請審核</strong>
              <span>分別核對合作意向與店家進件，留下具體理由與確認紀錄。</span>
            </a>
            <a className={styles.taskTile} href="/admin/ops?tab=affiliation">
              <strong>課班掛靠</strong>
              <span>檢視申請課班、目標學校及理由後，再決定是否掛靠。</span>
            </a>
          </div>
        </div>
      </section>

      <AdminResponsibilities onNavigate={onNavigate} />
    </div>
  );
}
