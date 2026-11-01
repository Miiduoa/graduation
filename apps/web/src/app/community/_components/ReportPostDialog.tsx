'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select, Textarea } from '@/components/ui/Input';
import modalStyles from '@/components/ui/Modal.module.css';

/** 校園貼文既有檢舉類型（與手機端一致；不新增類型）。 */
export const CAMPUS_POST_REPORT_REASONS = [
  { value: '騷擾或不當言行', label: '騷擾或不當言行' },
  { value: '垃圾訊息', label: '垃圾訊息' },
  { value: '其他違規', label: '其他違規' },
] as const;

export type CampusPostReportReason = (typeof CAMPUS_POST_REPORT_REASONS)[number]['value'];

export type ReportPostSubmitPayload = {
  reason: CampusPostReportReason;
  detail?: string;
};

type ReportPostDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: ReportPostSubmitPayload) => Promise<void>;
};

/**
 * 貼文檢舉對話框：選原因、可填補充說明、送出中鎖定、失敗可重試、成功回饋。
 * Esc／焦點鎖／關閉後焦點還原由既有 Modal 負責。
 */
export function ReportPostDialog(props: ReportPostDialogProps) {
  // 每次開啟各自持有表單與送出狀態，避免上一輪失敗／成功殘留。
  return props.isOpen ? <ReportPostDialogSession {...props} /> : null;
}

function ReportPostDialogSession({ onClose, onSubmit }: ReportPostDialogProps) {
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const statusId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!done) return;
    doneRef.current?.focus({ preventScroll: true });
  }, [done]);

  function requestClose() {
    if (busy || inFlight.current) return;
    onClose();
  }

  async function submit() {
    if (busy || inFlight.current || done) return;
    if (!CAMPUS_POST_REPORT_REASONS.some((item) => item.value === reason)) {
      setError('請先選擇檢舉原因。');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const trimmed = detail.trim();
    try {
      await onSubmit({
        reason: reason as CampusPostReportReason,
        ...(trimmed ? { detail: trimmed } : {}),
      });
      if (mounted.current) setDone(true);
    } catch {
      if (mounted.current) {
        setError('這次未能檢舉，請稍後再試。');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title={done ? '檢舉已送出' : '檢舉貼文'}
      description={done ? undefined : '請選擇原因。補充說明為選填。'}
      size="sm"
      showCloseButton={!busy && !done}
      closeOnEsc={!busy}
      closeOnOverlayClick={!busy}
      initialFocusRef={cancelRef}
      aria-describedby={done ? statusId : undefined}
      footer={
        done ? (
          <Button ref={doneRef} type="button" variant="primary" onClick={requestClose}>
            完成
          </Button>
        ) : (
          <>
            <Button
              ref={cancelRef}
              type="button"
              variant="ghost"
              onClick={requestClose}
              disabled={busy}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => void submit()}
              loading={busy}
              disabled={busy || !reason}
            >
              {busy ? '送出中…' : '送出檢舉'}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p id={statusId} role="status" className={modalStyles.message}>
          已記錄你的檢舉，管理人員將於後台處理。
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Select
            label="檢舉原因"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            options={[...CAMPUS_POST_REPORT_REASONS]}
            placeholder="請選擇原因"
            disabled={busy}
          />
          <Textarea
            label="補充說明（選填）"
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            maxLength={2000}
            rows={3}
            disabled={busy}
          />
          {busy && (
            <p role="status" className={modalStyles.notice}>
              正在送出，請勿重複點擊。
            </p>
          )}
          {error && (
            <p role="alert" className={modalStyles.error}>
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
