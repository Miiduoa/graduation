'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import styles from './Platform.module.css';

export type ReviewDecision = 'approve' | 'reject';

export function ReviewControls({
  subject,
  approveLabel,
  disabled,
  busy,
  onDecide,
}: {
  subject: string;
  approveLabel: string;
  disabled: boolean;
  busy: boolean;
  onDecide: (decision: ReviewDecision, reason: string) => Promise<boolean>;
}) {
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [reason, setReason] = useState('');
  const note = reason.trim();
  const valid = note.length >= 5 && note.length <= 500;

  function choose(next: ReviewDecision) {
    if (disabled) return;
    setDecision(next);
    setReason('');
  }

  return (
    <div className={styles.reviewControls}>
      {decision ? (
        <form
          className={styles.reviewForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled || !valid) return;
            void onDecide(decision, note).then((completed) => {
              if (completed) {
                setDecision(null);
                setReason('');
              }
            });
          }}
        >
          <fieldset disabled={disabled} className={styles.reviewFieldset}>
            <div className={styles.reviewConfirmation}>
              <strong>{decision === 'approve' ? '確認核准' : '確認拒絕'}</strong>
              <p>
                審核對象：{subject}。請核對申請資料並寫下本次決定的實際依據；
                送出後會變更申請狀態。
              </p>
            </div>
            <Textarea
              label="審核理由"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              minLength={5}
              maxLength={500}
              rows={3}
              autoFocus
              hint="至少 5 個字，請勿填入不必要的個人資料。"
            />
            <div className={styles.actions}>
              <Button type="submit" disabled={disabled || !valid}>
                {busy ? '處理中…' : decision === 'approve' ? '確認核准' : '確認拒絕'}
              </Button>
              <Button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setDecision(null);
                  setReason('');
                }}
              >
                取消
              </Button>
            </div>
          </fieldset>
        </form>
      ) : (
        <div className={styles.actions}>
          <Button type="button" disabled={disabled} onClick={() => choose('approve')}>
            {approveLabel}
          </Button>
          <Button type="button" disabled={disabled} onClick={() => choose('reject')}>
            拒絕
          </Button>
        </div>
      )}
    </div>
  );
}
