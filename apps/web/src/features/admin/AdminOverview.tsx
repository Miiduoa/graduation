'use client';

import { Button } from '@/components/ui/Button';
import { parseReports, parseSchools } from './api';
import { isMerchantApplicationReviewable, parseOversightMerchants } from './oversightApi';
import { parseAffiliationApplications, parseSchoolApplications } from './reviewApi';
import { useAdminResource } from './hooks';
import type { AdminLocation, AdminSection } from './adminNav';
import { AdminResponsibilities } from './AdminResponsibilities';
import styles from './Admin.module.css';

type QueueItem = {
  id: string;
  title: string;
  detail: string;
  date?: string;
  open: () => void;
};

type QueueResource = {
  value?: unknown;
  loading: boolean;
  error?: string;
  reload: () => void;
};

function TaskQueue({
  id,
  title,
  description,
  action,
  empty,
  resource,
  items,
  limit,
  onOpen,
}: {
  id: string;
  title: string;
  description: string;
  action: string;
  empty: string;
  resource: QueueResource;
  items: QueueItem[];
  limit?: string;
  onOpen: () => void;
}) {
  const ready = !resource.loading && !resource.error && resource.value !== undefined;
  return (
    <section className={styles.taskQueue} aria-labelledby={`queue-${id}`}>
      <div className={styles.queueHeading}>
        <div className={styles.sectionIntro}>
          <h3 id={`queue-${id}`}>{title}</h3>
          <p className={styles.muted}>{description}</p>
        </div>
        <span
          className={styles.queueCount}
          aria-label={ready ? `已載入 ${items.length} 件` : '件數尚未確認'}
        >
          {ready ? items.length : '—'}
        </span>
      </div>
      {resource.loading ? (
        <p role="status" className={styles.queueMessage}>
          正在讀取{title}…
        </p>
      ) : null}
      {resource.error ? (
        <div className={styles.queueFailure}>
          <p role="alert">{resource.error}</p>
          <Button onClick={resource.reload}>重試{title}</Button>
        </div>
      ) : null}
      {ready && items.length === 0 ? <p className={styles.queueMessage}>{empty}</p> : null}
      {ready && items.length > 0 ? (
        <ul className={styles.queueRows}>
          {items.slice(0, 2).map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={styles.queueRow}
                onClick={item.open}
                aria-label={`${action}：${item.title}`}
              >
                <span className={styles.queueRowBody}>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                  {item.date ? (
                    <time dateTime={item.date}>
                      {new Date(item.date).toLocaleDateString('zh-TW', {
                        timeZone: 'Asia/Taipei',
                        month: 'numeric',
                        day: 'numeric',
                      })}{' '}
                      送件
                    </time>
                  ) : null}
                </span>
                <span aria-hidden="true" className={styles.queueArrow}>
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.queueFooter}>
        <span>
          {limit || '依本次成功載入的待辦'}
          {ready && items.length > 2 ? ` · 還有 ${items.length - 2} 件` : ''}
        </span>
        <button type="button" className={styles.linkButton} onClick={onOpen}>
          {action}
        </button>
      </div>
    </section>
  );
}

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
  const applications = useAdminResource(
    'school-applications?scope=pending',
    context,
    parseSchoolApplications,
    !suspended,
  );
  const merchants = useAdminResource('merchants', context, parseOversightMerchants, !suspended);
  const affiliations = useAdminResource(
    'class-workspace-affiliation-applications',
    context,
    parseAffiliationApplications,
    !suspended,
  );
  const reports = useAdminResource('reports?state=open', context, parseReports, !suspended);
  const resources = [schools, applications, merchants, affiliations, reports];
  const refreshing = resources.some((resource) => resource.loading);
  const provisioned = schools.value?.filter((school) => school.lifecycle === 'provisioned') ?? [];
  const schoolsReady = !schools.loading && !schools.error && !!schools.value;
  const schoolNames = new Map(
    schoolsReady ? schools.value!.map((school) => [school.tenantId, school.displayName]) : [],
  );
  const pendingSchools: QueueItem[] = (applications.value ?? [])
    .filter((row) => row.state === 'pending')
    .map((row) => ({
      id: row.id,
      title: row.displayName,
      detail: row.contactName + ' · ' + row.proposedEmailDomain,
      date: row.createdAt,
      open: () => onNavigate('school-review', { reviewId: row.id }),
    }));
  const pendingMerchants: QueueItem[] = [
    ...(merchants.value?.interest ?? [])
      .filter((row) => row.state === 'submitted')
      .map((row) => ({
        id: 'interest:' + row.id,
        title: row.brandName,
        detail: '合作意向 · ' + row.schoolName,
        date: row.createdAt,
        open: () => onNavigate('merchants', { reviewId: 'interest:' + row.id }),
      })),
    ...(merchants.value?.applications ?? [])
      .filter((row) => isMerchantApplicationReviewable(row.state))
      .map((row) => ({
        id: 'application:' + row.tenantId + ':' + row.applicationId,
        title: row.brandName + '／' + row.locationName,
        detail: '進駐申請 · ' + row.tenantName,
        date: row.submittedAt,
        open: () =>
          onNavigate('merchants', {
            reviewId: 'application:' + row.tenantId + ':' + row.applicationId,
          }),
      })),
  ].sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
  const pendingAffiliations: QueueItem[] = (affiliations.value ?? [])
    .filter((row) => row.state === 'pending')
    .map((row) => ({
      id: row.id,
      title: row.workspaceTitle,
      detail: schoolNames.get(row.tenantId) || '目標學校：' + row.tenantId,
      date: row.createdAt,
      open: () => onNavigate('affiliation', { reviewId: row.id }),
    }));
  const pendingReports: QueueItem[] = (reports.value ?? []).map((row) => ({
    id: row.id,
    title: row.snapshot.communityName,
    detail: row.snapshot.tenantName + ' · ' + (row.detail || '查看檢舉原因與內容'),
    date: row.createdAt,
    open: () => onNavigate('reports', { reportState: 'open', reportId: row.id }),
  }));

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div className={styles.sectionIntro}>
          <h2 className={styles.overviewHeading}>需要處理的工作</h2>
          <p className={styles.muted}>選擇案件即可處理；完成後回到這裡查看最新待辦。</p>
        </div>
        <Button
          disabled={refreshing}
          onClick={() => resources.forEach((resource) => resource.reload())}
        >
          {refreshing ? '更新中…' : '更新待辦'}
        </Button>
      </div>
      <div className={styles.reviewQueueGrid}>
        <TaskQueue
          id="schools"
          title="學校申請"
          description="確認校方聯絡人與接入資料"
          action="查看學校申請"
          empty="目前沒有待審核的學校申請。"
          resource={applications}
          items={pendingSchools}
          onOpen={() => onNavigate('school-review')}
        />
        <TaskQueue
          id="merchants"
          title="店家申請"
          description="區分合作意向與正式進駐"
          action="查看店家申請"
          empty="目前沒有待審核的店家申請。"
          resource={merchants}
          items={pendingMerchants}
          onOpen={() => onNavigate('merchants')}
        />
        <TaskQueue
          id="affiliation"
          title="課班掛靠"
          description="核對課班與目標學校的關係"
          action="查看掛靠申請"
          empty="目前沒有待審核的掛靠申請。"
          resource={affiliations}
          items={pendingAffiliations}
          onOpen={() => onNavigate('affiliation')}
        />
        <TaskQueue
          id="reports"
          title="社群檢舉"
          description="閱讀原始內容與檢舉原因"
          action="處理社群檢舉"
          empty="目前沒有待處理的社群檢舉。"
          resource={reports}
          items={pendingReports}
          limit="本次最多載入最近 50 件"
          onOpen={() => onNavigate('reports', { reportState: 'open', reportId: null })}
        />
      </div>
      <section className={styles.panel} aria-labelledby="school-setup-heading">
        <div className={styles.stack}>
          <div className={styles.toolbar}>
            <div className={styles.sectionIntro}>
              <h2 id="school-setup-heading">學校開通進度</h2>
              <p className={styles.muted}>申請核准後，仍須完成管理員授權與服務設定。</p>
            </div>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() =>
                onNavigate('schools', {
                  schoolLifecycle: 'provisioned',
                  schoolId: null,
                  schoolQuery: '',
                })
              }
            >
              查看待開通學校
            </button>
          </div>
          <ol className={styles.setupSteps} aria-label="學校開通順序">
            <li>
              <span>1</span>審核申請
            </li>
            <li>
              <span>2</span>指定管理員
            </li>
            <li>
              <span>3</span>檢查服務設定
            </li>
            <li>
              <span>4</span>確認開通
            </li>
          </ol>
          {schools.loading ? <p role="status">正在讀取學校開通狀態…</p> : null}
          {schools.error ? (
            <div className={styles.queueFailure}>
              <p role="alert">{schools.error}</p>
              <Button onClick={schools.reload}>重試學校狀態</Button>
            </div>
          ) : null}
          {schoolsReady && provisioned.length === 0 ? (
            <p className={styles.muted}>本次載入沒有已建檔、待開通的學校。</p>
          ) : null}
          {schoolsReady && provisioned.length > 0 ? (
            <ul className={styles.setupSchools}>
              {provisioned.slice(0, 5).map((school) => (
                <li key={school.tenantId}>
                  <div>
                    <strong>{school.displayName}</strong>
                    <span className={styles.badge}>已建檔 · 待開通</span>
                  </div>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => onNavigate('people', { schoolId: school.tenantId })}
                      aria-label={`確認管理員：${school.displayName}`}
                    >
                      確認管理員
                    </button>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() =>
                        onNavigate('schools', {
                          schoolId: school.tenantId,
                          schoolLifecycle: 'all',
                          schoolQuery: '',
                        })
                      }
                      aria-label={`檢查服務與開通：${school.displayName}`}
                    >
                      檢查服務與開通
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {schoolsReady && provisioned.length > 5 ? (
            <p className={styles.muted}>另有 {provisioned.length - 5} 所學校，請開啟待開通清單。</p>
          ) : null}
        </div>
      </section>
      <div className={styles.quickActions} aria-label="常用管理作業">
        <button type="button" className={styles.linkButton} onClick={() => onNavigate('people')}>
          校方成員與授權
        </button>
        <button type="button" className={styles.linkButton} onClick={() => onNavigate('audit')}>
          查閱操作紀錄
        </button>
      </div>
      <AdminResponsibilities onNavigate={onNavigate} />
    </div>
  );
}
