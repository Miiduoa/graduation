'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ASSISTANT_PERMISSIONS_SETTINGS_HREF,
} from '@campus/shared/src/assistantPermissions';
import { DORM_REPAIR_COPY } from '@campus/shared/src/dormitory';
import {
  executeCampusAgentWrite,
  type AgentWriteResult,
} from '@/lib/campusAssistantClient';
import type { AssistantWriteProposal } from '@/lib/assistantPresentation';
import { isWebOnlineOrderingEnabled } from '@/lib/onlineOrdering';
import styles from './assistant.module.css';

interface Props {
  proposal: AssistantWriteProposal;
  userId: string;
  schoolId: string;
  groupId?: string;
  onCompleted: () => void;
}

const servicePaths: Record<string, string> = {
  submitLeaveRequest: '/leave',
  reserveSeat: '/library',
  borrowBook: '/library',
  renewBook: '/library',
  returnBook: '/library',
  createDormRepairRequest: '/dormitory',
  reserveWashingMachine: '/dormitory',
  createOrder: '/orders',
};

const fieldLabels: Record<string, string> = {
  courseId: '課程代碼',
  date: '日期',
  type: '假別',
  seatId: '座位',
  startTime: '開始時間',
  endTime: '結束時間',
  bookId: '館藏代碼',
  loanId: '借閱紀錄',
  dormitory: '宿舍',
  room: '房號',
  category: '報修類別',
  description: '狀況',
  urgency: '緊急程度',
  machineId: '機台',
  cafeteriaId: '餐廳代碼',
  expectedTotal: '預估金額',
  pickupTime: '取餐時間',
};

function reviewFields(input: Record<string, unknown>) {
  return Object.entries(input).flatMap(([key, value]) => {
    if (key === 'items' && Array.isArray(value)) {
      return [{ label: '訂單品項', value: value.length + ' 項' }];
    }
    if (!fieldLabels[key] || !['string', 'number'].includes(typeof value)) return [];
    return [{ label: fieldLabels[key], value: String(value).slice(0, 240) }];
  });
}

function isPermissionDeniedError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'functions/permission-denied' || code === 'permission-denied';
}

function permissionDeniedMessage(error: unknown): string {
  const message = String((error as { message?: string } | null)?.message || '').trim();
  if (message && !/^Firebase:\s*Error/i.test(message)) return message;
  return '你在設定關閉了此助理寫入動作，可到設定頁開啟。';
}

export function AgentWritePanel({ proposal, userId, schoolId, groupId, onCompleted }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [result, setResult] = useState<AgentWriteResult | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState<string | null>(null);

  if (proposal.toolName === 'createOrder' && !isWebOnlineOrderingEnabled()) return null;

  async function confirm() {
    if (attempted) return;
    setAttempted(true);
    setUncertain(false);
    setPermissionDenied(null);
    try {
      const response = await executeCampusAgentWrite({
        userId,
        schoolId,
        groupId,
        toolName: proposal.toolName,
        payload: proposal.input,
        agentRunId: proposal.agentRunId,
      });
      setResult(response);
      if (response.success) onCompleted();
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        setPermissionDenied(permissionDeniedMessage(error));
        return;
      }
      // 逾時無法證明後端未寫入。
      setUncertain(true);
    }
  }

  const path = servicePaths[proposal.toolName];
  const verified = result?.success === true;
  const isRepair = proposal.toolName === 'createDormRepairRequest';
  const reference = isRepair
    ? undefined
    : result?.requestId || result?.repairId || result?.reservationId || result?.orderId;
  const fields = reviewFields(proposal.input);

  return (
    <section className={styles.actionReview} aria-label={proposal.label}>
      <div className={styles.actionHeader}>
        <div>
          <span className={styles.actionTag}>需要你確認</span>
          <h3>{proposal.label}</h3>
          <p>已依照這次對話整理草稿，確認之前不會寫入資料。</p>
        </div>
        {!expanded && (
          <button type="button" className={styles.actionSecondary} onClick={() => setExpanded(true)}>
            檢視草稿
          </button>
        )}
      </div>
      {expanded && (
        <div className={styles.actionDetails}>
          <dl>
            {fields.map((field) => (
              <div key={field.label}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.note}>
            {isRepair
              ? DORM_REPAIR_COPY.assistantWriteStayNote
              : '請先核對內容。送出後即使離開此頁，操作也可能繼續完成。'}
          </p>
          {verified ? (
            <div className={styles.actionSuccess} role="status">
              <strong>{isRepair ? DORM_REPAIR_COPY.assistantWriteSuccess : '伺服器已確認執行成功'}</strong>
              {reference && <p>紀錄編號：{reference}</p>}
              {isRepair && <p>{DORM_REPAIR_COPY.assistantSavedMemo}</p>}
              {path && <Link href={path}>前往服務頁面核對紀錄</Link>}
            </div>
          ) : permissionDenied ? (
            <div className={styles.actionWarning} role="alert">
              <strong>設定已關閉此寫入動作</strong>
              <p style={{ whiteSpace: 'pre-line' }}>{permissionDenied}</p>
              <Link href={ASSISTANT_PERMISSIONS_SETTINGS_HREF}>前往設定</Link>
            </div>
          ) : result || uncertain ? (
            <div className={styles.actionWarning} role="alert">
              <strong>{result?.success === false ? '系統未確認完成這項操作' : '尚未收到確定的執行結果'}</strong>
              <p>
                {isRepair
                  ? DORM_REPAIR_COPY.assistantWriteUncertain
                  : '請先到對應服務頁面查核，避免重複送出。'}
              </p>
              {path && <Link href={path}>查看服務紀錄</Link>}
            </div>
          ) : (
            <div className={styles.actionControls}>
              <button type="button" className={styles.actionSecondary} onClick={() => setExpanded(false)}>
                先不要
              </button>
              <button type="button" className={styles.actionPrimary} onClick={confirm} disabled={attempted}>
                {attempted ? '正在確認執行結果…' : '確認並執行'}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
