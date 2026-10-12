'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { parseReports, parseSchools } from './api';
import { useAdminResource } from './hooks';
import styles from './Admin.module.css';

export function AdminOverview({
  context,
  suspended,
  onNavigate,
}: {
  context: string;
  suspended: boolean;
  onNavigate: (section: 'schools' | 'reports' | 'audit') => void;
}) {
  const schools = useAdminResource('schools', context, parseSchools, !suspended);
  const reports = useAdminResource('reports?state=open', context, parseReports, !suspended);
  const pending = schools.value?.filter((school) => school.lifecycle === 'pending');
  const provisioned = schools.value?.filter((school) => school.lifecycle === 'provisioned');
  return (
    <div className={styles.stack}>
      <section className={styles.panel} aria-labelledby="admin-work-heading">
        <div className={styles.toolbar}>
          <h2 id="admin-work-heading">待處理事項</h2>
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
        <div className={styles.split}>
          <div className={styles.stack}>
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
                  <ul>
                    {pending.slice(0, 5).map((school) => (
                      <li key={school.applicationId}>{school.displayName}</li>
                    ))}
                  </ul>
                )}
                <div className={styles.actions}>
                  <a className={styles.link} href="/auth/platform/school-review">
                    前往審核申請
                  </a>
                  <Button onClick={() => onNavigate('schools')}>檢查學校開通狀態</Button>
                </div>
              </>
            )}
          </div>
          <div className={styles.stack}>
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
                <Button onClick={() => onNavigate('reports')}>處理社群檢舉</Button>
              </>
            )}
          </div>
        </div>
      </section>
      <section className={styles.panel} aria-labelledby="responsibilities-heading">
        <h2 id="responsibilities-heading">誰負責哪件事</h2>
        <p className={styles.muted}>
          平台、學校與課程各有管理範圍。同一個人在不同課程可以有不同身分，瀏覽校園不會改變任何權限。
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">角色</th>
                <th scope="col">負責事項</th>
                <th scope="col">權限範圍</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">平台管理員</th>
                <td>學校接入、服務開關、公開看板、跨校檢舉與操作紀錄</td>
                <td>已開通學校的設定預設唯讀；協助修改需開始限時代操作。</td>
              </tr>
              <tr>
                <th scope="row">校方管理員</th>
                <td>所屬學校的人員與校務服務</td>
                <td>由校方核發；不因建立課程或選校而取得。</td>
              </tr>
              <tr>
                <th scope="row">課程負責老師</th>
                <td>建立課程、邀請學生、發布教材與作業、查看繳交並回饋</td>
                <td>限本人負責的課程，不代表校方認證的教職員身分。</td>
              </tr>
              <tr>
                <th scope="row">共同授課老師</th>
                <td>協助指定課程的教材、作業與回饋</td>
                <td>限被授予的課程；學生邀請碼由課程負責老師管理。</td>
              </tr>
              <tr>
                <th scope="row">修課學生</th>
                <td>查看已加入課程、繳交作業、作答、確認自己的收件與回饋</td>
                <td>不能查看其他學生的私人作答或修改授課設定。</td>
              </tr>
              <tr>
                <th scope="row">訪客與公開交流使用者</th>
                <td>瀏覽公開內容；登入後依看板規則參與交流</td>
                <td>校務資料與私人課程內容需另有資格。</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className={styles.actions}>
          <a className={styles.link} href="/auth/platform/ops">
            管理學校人員與店家
          </a>
          <Button onClick={() => onNavigate('audit')}>查看權限與設定操作紀錄</Button>
          <Link className={styles.link} href="/classroom">
            前往本人課程
          </Link>
        </div>
        <p className={styles.muted}>
          課程交接與共同授課指派尚未提供自助操作。平台管理身分不會自動加入私人課程。
        </p>
      </section>
    </div>
  );
}
