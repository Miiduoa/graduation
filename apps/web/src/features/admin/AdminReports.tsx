'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Select, Textarea } from '@/components/ui/Input';
import { nuniRecord } from '@campus/shared/src/nuni';
import { parseReports, type AdminReport } from './api';
import { useAdminMutation, useAdminResource } from './hooks';
import styles from './Admin.module.css';

const reasonLabels: Record<AdminReport['reason'], string> = {
  harassment: '騷擾',
  spam: '垃圾訊息',
  privacy: '隱私侵害',
  hate: '仇恨內容',
  violence: '暴力內容',
  other: '其他',
};
const stateLabels: Record<AdminReport['state'], string> = {
  open: '待處理',
  hidden: '已隱藏貼文',
  dismissed: '已駁回',
};

export function AdminReports({ context, suspended }: { context: string; suspended: boolean }) {
  const [state, setState] = useState<AdminReport['state']>('open');
  const resource = useAdminResource(`reports?state=${state}`, context, parseReports, !suspended);
  return (
    <section className={styles.panel}>
      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <h2>社群檢舉</h2>
          <Button disabled={resource.loading} onClick={resource.reload}>
            重新讀取檢舉
          </Button>
        </div>
        <p className={styles.muted}>
          依檢舉當時的公開貼文快照判斷。處理原因會保留，隱藏貼文後內容將停止公開。
        </p>
        <Select
          label="檢舉狀態"
          value={state}
          onChange={(event) => setState(event.target.value as AdminReport['state'])}
          options={Object.entries(stateLabels).map(([value, label]) => ({ value, label }))}
        />
        {resource.loading && <p role="status">正在讀取檢舉…</p>}
        {resource.error && (
          <p role="alert" className={styles.error}>
            {resource.error}
          </p>
        )}
        {resource.value?.length === 0 && (
          <p className={styles.muted}>目前沒有{stateLabels[state]}的檢舉。</p>
        )}
        {resource.value?.map((report) => (
          <Report
            key={`${report.id}:${report.version}`}
            report={report}
            context={context}
            enabled={!suspended}
            onChanged={resource.reload}
          />
        ))}
      </div>
    </section>
  );
}

function Report({
  report,
  context,
  enabled,
  onChanged,
}: {
  report: AdminReport;
  context: string;
  enabled: boolean;
  onChanged: () => void;
}) {
  const [decision, setDecision] = useState<'hide' | 'dismiss' | null>(null);
  const [reason, setReason] = useState('');
  const [complete, setComplete] = useState(false);
  const [responseError, setResponseError] = useState('');
  const mutation = useAdminMutation(context, enabled && !complete);
  const canDecide = report.state === 'open' && report.canDecide;
  async function submit() {
    if (!canDecide || !decision || reason.trim().length < 5 || complete) return;
    setResponseError('');
    const result = await mutation.run(`reports/${encodeURIComponent(report.id)}/decision`, {
      decision,
      reason: reason.trim(),
      expectedVersion: report.version,
    });
    if (result === undefined) return;
    try {
      const updated = nuniRecord(result);
      if (
        updated.id !== report.id ||
        updated.tenantId !== report.tenantId ||
        updated.postId !== report.postId ||
        updated.state !== (decision === 'hide' ? 'hidden' : 'dismissed') ||
        typeof updated.version !== 'number' ||
        updated.version <= report.version
      )
        throw new Error('Unexpected report response');
      setComplete(true);
      onChanged();
    } catch {
      setResponseError('無法確認檢舉處理結果，請重新讀取後確認。');
    }
  }
  return (
    <article className={styles.report} aria-label={`檢舉：${report.snapshot.communityName}`}>
      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <h3>
            {reasonLabels[report.reason]} · {report.snapshot.communityName}
          </h3>
          <span className={styles.badge}>{stateLabels[report.state]}</span>
        </div>
        <p className={styles.muted}>
          {report.snapshot.tenantName} · {report.snapshot.author.displayName} · 檢舉於{' '}
          <time dateTime={report.createdAt}>
            {new Date(report.createdAt).toLocaleString('zh-TW')}
          </time>
        </p>
        <blockquote className={styles.snapshot}>{report.snapshot.text}</blockquote>
        {report.detail && <p className={styles.muted}>檢舉補充：{report.detail}</p>}
        {report.decisionReason && <p className={styles.muted}>處理原因：{report.decisionReason}</p>}
        {mutation.error || responseError ? (
          <p role="alert" className={styles.error}>
            {mutation.error || responseError}
          </p>
        ) : null}
        {complete ? (
          <p role="status" className={styles.success}>
            檢舉已處理，正在更新列表。
          </p>
        ) : canDecide ? (
          decision ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <p className={styles.notice}>
                {decision === 'hide'
                  ? '確認隱藏這則貼文？公開社群將不再顯示此內容。'
                  : '確認駁回這筆檢舉？原貼文會維持目前狀態。'}
              </p>
              <Textarea
                label="處理原因"
                required
                minLength={5}
                maxLength={2000}
                hint="至少 5 字，請說明判斷依據。"
                value={reason}
                disabled={mutation.busy}
                onChange={(event) => setReason(event.target.value)}
              />
              <div className={styles.actions}>
                <Button
                  type="submit"
                  variant={decision === 'hide' ? 'danger' : 'primary'}
                  disabled={mutation.busy || reason.trim().length < 5}
                >
                  確認{decision === 'hide' ? '隱藏貼文' : '駁回檢舉'}
                </Button>
                <Button
                  disabled={mutation.busy}
                  onClick={() => {
                    setDecision(null);
                    setReason('');
                  }}
                >
                  取消
                </Button>
              </div>
            </form>
          ) : (
            <div className={styles.actions}>
              <Button variant="danger" onClick={() => setDecision('hide')}>
                隱藏貼文
              </Button>
              <Button onClick={() => setDecision('dismiss')}>駁回檢舉</Button>
            </div>
          )
        ) : report.state === 'open' ? (
          <p className={styles.muted}>這筆檢舉目前無法由你的帳號處理。</p>
        ) : null}
      </div>
    </article>
  );
}
