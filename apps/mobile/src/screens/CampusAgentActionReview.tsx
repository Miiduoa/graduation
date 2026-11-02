import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AIButton, aiTokens } from '../ui/aiFirst';
import {
  confirmCampusAgentWrite,
  type CampusAgentWriteProposal,
  type CampusAgentWriteReceipt,
} from '../features/campusAssistantActions';

const inputLabels: Record<string, string> = {
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
  category: '類別',
  description: '問題描述',
  urgency: '緊急程度',
  machineId: '洗衣機',
};

function readableFields(input: Record<string, unknown>) {
  return Object.entries(input).filter(([key, value]) =>
    !!inputLabels[key] && (typeof value === 'string' || typeof value === 'number'))
    .map(([key, value]) => ({
      label: inputLabels[key],
      value: String(value).slice(0, 400),
    }));
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

export function CampusAgentActionReview({
  proposal,
  userId,
  schoolId,
  isCurrent,
  onOpenService,
  onOpenSettings,
}: {
  proposal: CampusAgentWriteProposal;
  userId: string;
  schoolId: string;
  isCurrent: () => boolean;
  onOpenService?: () => void;
  onOpenSettings?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [receipt, setReceipt] = useState<CampusAgentWriteReceipt | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState<string | null>(null);
  const locked = useRef(false);
  const fields = readableFields(proposal.input);

  async function confirm() {
    if (locked.current || attempted || !expanded || !isCurrent()) return;
    locked.current = true;
    setAttempted(true);
    setPermissionDenied(null);
    try {
      const value = await confirmCampusAgentWrite({
        proposal,
        userId,
        schoolId,
        isCurrent,
      });
      if (isCurrent()) setReceipt(value);
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        if (isCurrent()) setPermissionDenied(permissionDeniedMessage(error));
        return;
      }
      // 逾時無法證明後端未寫入。
      if (isCurrent()) setUncertain(true);
    }
  }

  const reference = receipt?.requestId || receipt?.repairId ||
    receipt?.reservationId || receipt?.loanId;
  const success = receipt?.success === true;
  return (
    <View style={{
      marginTop: 16,
      padding: 16,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: aiTokens.border,
      backgroundColor: aiTokens.panel,
      gap: 10,
    }}>
      <Text style={{ color: aiTokens.muted, fontSize: 12, fontWeight: '700' }}>
        {success
          ? '伺服器已確認完成'
          : permissionDenied
            ? '設定已關閉此寫入動作'
            : attempted
              ? '已送出確認，請核對結果'
              : '需要本人確認 · 尚未執行'}
      </Text>
      <Text style={{ color: aiTokens.text, fontSize: 16, fontWeight: '700' }}>
        {proposal.label}
      </Text>
      <Text style={{ color: aiTokens.muted, fontSize: 13, lineHeight: 21 }}>
        僅接受這次對話的伺服器草稿。請檢視內容，再決定是否執行。
      </Text>
      {!expanded ? (
        <AIButton label="檢視任務草稿" variant="ghost" onPress={() => setExpanded(true)} />
      ) : (
        <View style={{ gap: 10 }}>
          {fields.map(({ label, value }) => (
            <View key={label} style={{ gap: 3 }}>
              <Text style={{ color: aiTokens.muted, fontSize: 12 }}>{label}</Text>
              <Text selectable style={{ color: aiTokens.text, lineHeight: 22 }}>{value}</Text>
            </View>
          ))}
          {!attempted ? (
            <View style={{ gap: 8 }}>
              <AIButton label="確認並執行" disabled={locked.current} onPress={() => void confirm()} />
              <AIButton label="先不要" variant="ghost" onPress={() => setExpanded(false)} />
            </View>
          ) : success ? (
            <View style={{ gap: 6 }}>
              <Text accessibilityRole="alert" style={{ color: aiTokens.text, fontWeight: '700' }}>
                伺服器已確認執行成功
              </Text>
              {reference ? (
                <Text selectable style={{ color: aiTokens.muted }}>
                  紀錄編號：{reference}
                </Text>
              ) : null}
              <Text style={{ color: aiTokens.muted, lineHeight: 20, fontSize: 12 }}>
                請到對應服務頁面核對完整紀錄。
              </Text>
            </View>
          ) : permissionDenied ? (
            <View style={{ gap: 5 }}>
              <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
                設定已關閉此寫入動作
              </Text>
              <Text selectable style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
                {permissionDenied}
              </Text>
            </View>
          ) : (
            <View style={{ gap: 5 }}>
              <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
                {uncertain ? '執行狀態尚未確認' : receipt?.success === false ? '伺服器未確認操作成功' : '正在等待執行結果…'}
              </Text>
              <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
                為避免重複送出，請先到對應服務頁面查核。這份草稿不會再次自動執行。
              </Text>
            </View>
          )}
          {attempted && permissionDenied && onOpenSettings ? (
            <AIButton label="前往設定" variant="ghost" onPress={onOpenSettings} />
          ) : null}
          {attempted && !permissionDenied && onOpenService ? (
            <AIButton label="開啟服務頁核對紀錄" variant="ghost" onPress={onOpenService} />
          ) : null}
        </View>
      )}
    </View>
  );
}
