import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AIButton, aiTokens } from '../ui/aiFirst';
import { validCampusSenseSnapshot, type CampusSenseSnapshot } from '../services/campusSenseSnapshot';
import type { CampusPlanStep } from '../services/offlineCampusPlanner';
import { resolveCampusAssignmentTarget } from '../services/campusAssignmentTarget';
import type { CampusReminderLead } from '../services/campusAssignmentReminders';

function deadlineLabel(iso: string) {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

function reminderErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null &&
    'code' in error && typeof error.code === 'string' ? error.code : '';
  switch (code) {
    case 'invalid-source':
    case 'expired-source':
      return '作業來源已失效或不相符。請重新同步校園資料後再設定。';
    case 'deadline-too-close':
      return '提醒時間已過或太接近截止。請直接開啟作業頁核對。';
    case 'permission-required':
      return '尚未取得通知權限。請在手機設定中允許通知後重新確認。';
    case 'device-capacity':
      return '裝置待處理通知較多，無法安全新增；請先整理既有提醒。';
    case 'session-changed':
      return '帳號或學校已切換，本次提醒沒有成立。';
    case 'legacy-cleanup-required':
      return '請先到作業提醒管理區同步並整理未辨識的舊版提醒，再重新設定。';
    case 'busy':
      return '正在處理這項提醒，請避免重複操作。';
    case 'unsupported':
      return '目前裝置無法設定本機通知。';
    default:
      return '無法驗證本機排程結果，請稍後重試或到系統通知設定檢查。';
  }
}

export function CampusAssignmentReminderAction({
  step,
  snapshot,
  userId,
  schoolId,
  disabled,
  isCurrent,
}: {
  step: CampusPlanStep;
  snapshot: CampusSenseSnapshot | null;
  userId: string;
  schoolId: string;
  disabled: boolean;
  isCurrent: () => boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [lead, setLead] = useState<CampusReminderLead>(60);
  const [saving, setSaving] = useState(false);
  const [confirmedLead, setConfirmedLead] = useState<CampusReminderLead | null>(null);
  const [paused, setPaused] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [statusRefresh, setStatusRefresh] = useState(0);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const scope = { uid: userId, schoolId };
  const verified = validCampusSenseSnapshot(snapshot, scope);
  const deadline = step.dueAt ? Date.parse(step.dueAt) : NaN;
  const canUse = Boolean(
    userId && resolveCampusAssignmentTarget({ assignment: step, snapshot: verified, scope }) && step.evidence === 'authorized-assignments' && verified &&
    Number.isFinite(deadline) && deadline > Date.now() + 61 * 60_000,
  );
  const oneDayAvailable = Number.isFinite(deadline) && deadline > Date.now() + (1441 * 60_000);
  const leadChoice = lead === 1440 && !oneDayAvailable ? 60 : lead;

  // The OS owns reminder delivery, not React component state. Reconcile when
  // the card remounts, preventing a second reminder after navigating away.
  useEffect(() => {
    let active = true;
    if (!userId || !schoolId || !step.dueAt ||
        step.evidence !== 'authorized-assignments' || !snapshot) {
      setConfirmedLead(null);
      setStatusError('');
      return () => { active = false; };
    }
    setStatusLoading(true);
    setStatusError('');
    const { getCampusAssignmentReminderStatus } =
      require('../services/campusAssignmentReminders') as typeof import('../services/campusAssignmentReminders');
    void Promise.all([
      getCampusAssignmentReminderStatus({ scope, step, snapshot, isCurrent }),
      getCampusAssignmentReminderStatus({ scope, step, snapshot, isCurrent, scheduledOnly: true }),
    ]).then(([leads, scheduled]) => {
        if (active && isCurrent()) {
          setConfirmedLead(leads[0] ?? null);
          setPaused(leads.length > 0 && scheduled.length === 0);
        }
      })
      .catch(() => {
        if (active && isCurrent()) setStatusError('無法確認裝置提醒狀態，暫不新增以免重複。');
      })
      .finally(() => {
        if (active && isCurrent()) setStatusLoading(false);
      });
    return () => { active = false; };
  }, [userId, schoolId, step.title, step.groupName, step.dueAt, snapshot?.checkedAt, statusRefresh]);

  const schedule = async () => {
    if (lock.current || statusLoading || statusError || disabled || !canUse ||
        !verified || !step.dueAt || !isCurrent()) return;
    lock.current = true;
    setSaving(true);
    setMessage('');
    try {
      const { scheduleCampusAssignmentReminder } = require('../services/campusAssignmentReminders') as typeof import('../services/campusAssignmentReminders');
      const receipt = await scheduleCampusAssignmentReminder({
        scope,
        step,
        snapshot: verified,
        leadMinutes: leadChoice,
        isCurrent,
      });
      if (!isCurrent()) return;
      if (receipt.outcome === 'submitted' || receipt.outcome === 'inactive') {
        setConfirmedLead(leadChoice);
        setPaused(true);
        setMessage(receipt.outcome === 'submitted' ? '這份作業已繳交，不再提醒。' : '這份作業目前不需提醒。');
        return;
      }
      setConfirmedLead(leadChoice);
      setPaused(false);
      setMessage(receipt.outcome === 'scheduled'
        ? '本機提醒已排程成功，這不會提交作業或修改校務資料。'
        : '這項本機提醒已存在，沒有重複建立。');
    } catch (error) {
      if (isCurrent()) setMessage(reminderErrorMessage(error));
    } finally {
      lock.current = false;
      if (isCurrent()) setSaving(false);
    }
  };

  const cancel = async () => {
    if (lock.current || disabled || confirmedLead === null || !isCurrent()) return;
    lock.current = true;
    setSaving(true);
    setMessage('');
    try {
      const { cancelCampusAssignmentReminder, getCampusAssignmentReminderStatus } = require('../services/campusAssignmentReminders') as typeof import('../services/campusAssignmentReminders');
      const leads = await getCampusAssignmentReminderStatus({ scope, step, snapshot, isCurrent });
      for (const leadMinutes of leads)
        await cancelCampusAssignmentReminder({ scope, step, snapshot, leadMinutes, isCurrent });
      if (!isCurrent()) return;
      setConfirmedLead(null);
      setMessage('已退訂並清除提醒偏好，撤回或延期後也不會自動恢復。');
      setStatusRefresh((value) => value + 1);
      setExpanded(false);
    } catch (error) {
      if (isCurrent()) setMessage(reminderErrorMessage(error));
    } finally {
      lock.current = false;
      if (isCurrent()) setSaving(false);
    }
  };

  if (step.evidence !== 'authorized-assignments' || !step.dueAt ||
      !Number.isFinite(deadline)) return null;
  if (!canUse && confirmedLead === null) return null;

  return (
    <View style={{
      borderTopWidth: 1, borderColor: aiTokens.border, paddingTop: 11, gap: 9,
    }}>
      {statusLoading && confirmedLead === null ? (
        <Text style={{ color: aiTokens.muted, fontSize: 12 }}>正在核對手機已設定的提醒…</Text>
      ) : statusError ? (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={{ color: aiTokens.warning, fontSize: 12 }}>
            {statusError}
          </Text>
          <AIButton
            label="重新確認本機提醒狀態"
            variant="ghost"
            size="sm"
            disabled={disabled || saving}
            onPress={() => setStatusRefresh((value) => value + 1)}
          />
        </View>
      ) : confirmedLead !== null ? (
        <>
          <Text style={{ color: aiTokens.text, fontSize: 12, fontWeight: '700' }}>
            {paused ? '已保留提醒偏好，目前暫停通知' : `已設定截止前 ${confirmedLead === 60 ? '1 小時' : '1 天'}提醒`}
          </Text>
          <AIButton
            label={saving ? '正在確認取消…' : '取消這項本機提醒'}
            variant="ghost"
            size="sm"
            disabled={saving || disabled}
            onPress={() => void cancel()}
          />
        </>
      ) : !expanded ? (
        <AIButton
          label="設定手機本機截止提醒"
          size="sm"
          variant="ghost"
          disabled={saving || disabled}
          onPress={() => setExpanded(true)}
        />
      ) : (
        <>
          <Text style={{ color: aiTokens.text, fontWeight: '700', fontSize: 13 }}>
            設定一次性作業提醒
          </Text>
          <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 19 }}>
            已核對的截止時間：{deadlineLabel(step.dueAt)}。提醒只安排在這台手機。連線確認已繳交後會取消；離線時無法核對其他裝置的繳交紀錄。
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <AIButton
              label={leadChoice === 60 ? '✓ 1 小時前' : '1 小時前'}
              size="sm"
              style={{ flex: 1 }}
              variant={leadChoice === 60 ? 'primary' : 'ghost'}
              disabled={saving || disabled}
              onPress={() => { setLead(60); setMessage(''); }}
            />
            {oneDayAvailable ? (
              <AIButton
                label={leadChoice === 1440 ? '✓ 1 天前' : '1 天前'}
                size="sm"
                style={{ flex: 1 }}
                variant={leadChoice === 1440 ? 'primary' : 'ghost'}
                disabled={saving || disabled}
                onPress={() => { setLead(1440); setMessage(''); }}
              />
            ) : null}
          </View>
          <AIButton
            label={saving ? '正在安排手機提醒…' : '確認設定本機提醒'}
            disabled={saving || disabled}
            onPress={() => void schedule()}
          />
          <AIButton
            label="取消設定"
            size="sm"
            variant="ghost"
            disabled={saving || disabled}
            onPress={() => { setExpanded(false); setMessage(''); }}
          />
        </>
      )}
      {confirmedLead !== null ? <Text>暫停時每 15 分鐘核對撤回或延期；截止後保留 7 天，暫停偏好最多保留 30 天。退訂後不會自動重排。</Text> : null}
      {message ? (
        <Text accessibilityRole="alert" style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}
