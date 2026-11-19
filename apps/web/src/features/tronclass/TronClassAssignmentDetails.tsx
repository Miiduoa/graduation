import { useId } from 'react';
import type { TronClassAssignmentDetails as AssignmentDetails } from '@/lib/tronClassIntegrationTypes';
import { tronClassTime } from './TronClassSource';
import styles from './tronclass.module.css';

const UNKNOWN = '校方未提供';

function attemptsLabel(attempts: Extract<AssignmentDetails, { status: 'available' }>['attempts']): string {
  if (attempts.unlimited === true) return '不限制次數';
  if (attempts.remaining !== null) return `剩餘 ${attempts.remaining} 次`;
  return '剩餘次數待確認';
}

export function TronClassAssignmentDetails({ details, onRetry, retryDisabled = false }: {
  details: AssignmentDetails;
  onRetry: () => void;
  retryDisabled?: boolean;
}) {
  const headingId = useId();
  if (details.status === 'unavailable') {
    return (
      <div className={styles.notice}>
        <p role="status">暫時無法讀取校方作業設定，已取得的作業內容仍可查看。</p>
        <button className="btn" disabled={retryDisabled} onClick={onRetry}>重新讀取作業設定</button>
      </div>
    );
  }

  const status = details.isClosed === true && details.isInProgress === true
    ? '狀態待確認'
    : details.isClosed === true ? '已關閉'
      : details.isInProgress === true ? '進行中'
        : details.isInProgress === false ? '目前未進行' : UNKNOWN;
  const facts = [
    ['繳交方式', details.submissionType === 'individual' ? '個人繳交' : details.submissionType === 'group' ? '小組繳交' : UNKNOWN],
    ['作業形式', details.mode === 'normal' ? '一般作業' : details.mode === 'multiple' ? '選題式作業' : UNKNOWN],
    ['開放時間', details.opensAt ? tronClassTime(details.opensAt) : UNKNOWN],
    ['截止時間', details.deadline ? tronClassTime(details.deadline) : UNKNOWN],
    ['校方狀態', status],
    ['繳交次數', attemptsLabel(details.attempts)],
    ['重交設定', details.resubmissionOpen === null ? UNKNOWN : details.resubmissionOpen ? '已開放重交' : '未開放重交'],
    ['撤回設定', details.retractAllowed === null ? UNKNOWN : details.retractAllowed ? '允許撤回' : '不允許撤回'],
  ];

  return (
    <section className={styles.assignmentSettings} aria-labelledby={headingId}>
      <div className={styles.settingsHeading}>
        <h3 id={headingId}>校方作業設定</h3>
        <p className={styles.muted}>更新於 {tronClassTime(details.fetchedAt)}</p>
      </div>
      <dl className={styles.settingsGrid}>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}
              {label === '繳交次數' && (details.attempts.used !== null || details.attempts.limit !== null) && (
                <span className={styles.settingsDetail}>
                  {[
                    details.attempts.used !== null ? `已繳交 ${details.attempts.used} 次` : null,
                    details.attempts.limit !== null && details.attempts.unlimited !== true ? `上限 ${details.attempts.limit} 次` : null,
                  ].filter(Boolean).join(' · ')}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className={styles.muted}>繳交與重交仍需符合這份作業當下的開放條件。</p>
    </section>
  );
}
