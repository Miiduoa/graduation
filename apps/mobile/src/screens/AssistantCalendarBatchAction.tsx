import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import {
  cancelRemainingAssistantCalendarBatch, confirmAssistantCalendarBatch, recheckAssistantCalendarBatch,
  type AssistantCalendarBatchView,
} from '../services/assistantCalendarBatchExecution';
import { assistantCalendarOwner, type AssistantCalendarContext } from '../services/assistantCalendarExecution';
import { mobileAssistantServiceDestination } from '../services/assistantServiceNavigation';
import { AIButton, aiTokens } from '../ui/aiFirst';
import { safeNavigate } from '../utils/safeNavigate';
import type { ServiceScreenProps } from './UnavailableFeatureScreen';

const timeLabel = (value: string) => new Date(value).toLocaleString('zh-TW', {
  timeZone: 'Asia/Taipei', hour12: false,
});

/** A saved plan never carries approval. Every run starts with this explicit confirmation. */
export function AssistantCalendarBatchAction({ batch, context, navigation, disabled, onChange }: {
  batch: AssistantCalendarBatchView;
  context: AssistantCalendarContext;
  navigation: ServiceScreenProps['navigation'];
  disabled: boolean;
  onChange: (next: AssistantCalendarBatchView) => void;
}) {
  const mounted = useRef(true);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const latest = useRef(batch);
  latest.current = batch;
  const [action, setAction] = useState<'confirm' | 'check' | 'cancel' | null>(null);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  const current = () => mounted.current && context.isCurrent() &&
    assistantCalendarOwner(context) === batch.plan.owner && context.schoolId === batch.plan.schoolId;
  const unread = batch.stop?.reason === 'unavailable' || batch.stop?.reason === 'timeout';
  const canContinue = !batch.plan.cancelledAt && batch.state !== 'cancelled' && !unread &&
    batch.progress.notStarted > 0 && batch.steps.every((step) => step.state === 'not-started' ||
      (step.state === 'recorded' && step.task.state === 'verified' && !step.task.warning));
  const execute = async (nextAction: 'confirm' | 'check' | 'cancel') => {
    if (disabled || lock.current || !current() || (nextAction === 'confirm' && !canContinue)) return;
    lock.current = true;
    setAction(nextAction);
    setStopping(false);
    setError('');
    const run = new AbortController();
    controller.current = run;
    const update = (next: AssistantCalendarBatchView) => {
      if (current()) { latest.current = next; onChange(next); }
    };
    update({ ...batch, ...(nextAction === 'confirm' ? { state: 'running' as const } : { checking: true }) });
    try {
      const access = { ...context, isCurrent: current };
      const result = nextAction === 'confirm'
        ? await confirmAssistantCalendarBatch(batch.plan, access, { signal: run.signal, onUpdate: update })
        : nextAction === 'cancel'
          ? await cancelRemainingAssistantCalendarBatch(batch.plan, access)
          : await recheckAssistantCalendarBatch(batch.plan, access);
      update(result);
    } catch {
      // A thrown call cannot prove that a write did not happen. Recheck must
      // resolve the original operations before another confirmation is offered.
      if (current()) update({ ...latest.current, state: 'paused', checking: false,
        stop: { reason: 'unavailable', message: '這次無法完整核對進度。請重新核對整份行程後，再決定是否接續。' } });
    } finally {
      lock.current = false;
      if (controller.current === run) controller.current = null;
      if (current()) { setAction(null); setStopping(false); }
    }
  };
  const open = (eventId: string) => {
    if (disabled || lock.current || !current()) return;
    const target = mobileAssistantServiceDestination('calendar', context.platformTimetable ? 'platform' : 'campus', navigation);
    if (target?.kind !== 'native' || target.route !== 'PersonalCalendar' ||
        !safeNavigate(navigation, 'PersonalCalendar', { eventId }, { fallbackMessage: null })) {
      setError('目前無法從此頁開啟行事曆。已核對的行程可從個人行事曆查看。');
    }
  };
  const pending = batch.state === 'running' || !!batch.checking || !!action;
  return <View style={{ gap: 12, marginTop: 10 }}>
    <Text accessibilityLiveRegion="polite" style={{ color: aiTokens.text, fontSize: 16, fontWeight: '600' }}>
      {batch.state === 'completed' ? `已逐筆保存並核對 ${batch.progress.total} 筆行程。`
        : `已核對 ${batch.progress.verified}／${batch.progress.total} 筆行程`}
    </Text>
    {batch.steps.map((step, index) => {
      const task = step.state === 'recorded' ? step.task : undefined;
      return <View key={step.id} style={{ gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: aiTokens.border }}>
        <Text style={{ color: aiTokens.text, fontSize: 17, fontWeight: '600' }}>{index + 1}. {step.event.title}</Text>
        <Text style={{ color: aiTokens.textSecondary, lineHeight: 23 }}>
          {step.event.date}{step.event.endDate ? ` 至 ${step.event.endDate}` : ''} · {step.event.allDay ? '全天'
            : `${step.event.startTime}–${step.event.endTime}`}（台灣時間）
        </Text>
        {step.event.location ? <Text style={{ color: aiTokens.textSecondary }}>地點：{step.event.location}</Text> : null}
        {task?.state === 'verified' ? <>
          <Text style={{ color: aiTokens.textSecondary, lineHeight: 23 }}>已保存並讀回核對</Text>
          <Text style={{ color: aiTokens.muted, fontSize: 13 }}>核對時間：{timeLabel(task.receipt.verifiedAt)}</Text>
          {task.warning ? <Text accessibilityRole="alert" style={{ color: aiTokens.textSecondary }}>{task.warning}</Text> : null}
          <AIButton label={`查看行程：${step.event.title}`} variant="ghost" disabled={disabled || pending}
            onPress={() => open(task.receipt.record.id)} />
        </> : task ? <>
          <Text accessibilityRole="alert" style={{ color: aiTokens.textSecondary, lineHeight: 23 }}>{task.message}</Text>
          {task.state === 'unknown' && task.lastVerified ? <Text style={{ color: aiTokens.muted, fontSize: 13, lineHeight: 21 }}>
            先前核對時間：{timeLabel(task.lastVerified.verifiedAt)}。歷史回執不代表目前仍有相同內容。
          </Text> : null}
        </> : <Text style={{ color: aiTokens.textSecondary, lineHeight: 23 }}>
          {step.state === 'running' ? '正在保存並讀回核對…' : unread ? '操作進度待重新核對'
            : batch.plan.cancelledAt ? '已取消，尚未開始' : '尚未開始'}
        </Text>}
      </View>;
    })}
    {batch.stop ? <Text accessibilityRole="alert" style={{ color: aiTokens.textSecondary, lineHeight: 23 }}>{batch.stop.message}</Text> : null}
    {pending ? <>
      <Text accessibilityLiveRegion="polite" style={{ color: aiTokens.textSecondary, lineHeight: 23 }}>
        {stopping ? '正在停止後續安排；已送出的操作仍會保留並核對。'
          : action === 'cancel' ? '正在保存取消決定並核對既有行程…'
            : batch.checking ? '正在重新核對整份行程…' : '正在依序處理，完成一筆才會進入下一筆…'}
      </Text>
      {action === 'confirm' ? <AIButton label="停止後續行程" variant="ghost" disabled={stopping}
        onPress={() => {
          if (current() && controller.current) { setStopping(true); controller.current.abort(); }
        }} /> : null}
    </> : <>
      {canContinue ? <>
        <Text style={{ color: aiTokens.textSecondary, lineHeight: 23 }}>
          確認後會依序處理上方尚未開始的 {batch.progress.notStarted} 筆行程。遇到結果不明或衝突會暫停；已完成的行程會保留。
        </Text>
        <AIButton label={batch.progress.verified ? `確認接續剩餘 ${batch.progress.notStarted} 筆行程`
          : `確認加入 ${batch.progress.notStarted} 筆行程`} disabled={disabled} onPress={() => void execute('confirm')} />
      </> : null}
      <AIButton label="重新核對整份行程" variant="ghost" disabled={disabled} onPress={() => void execute('check')} />
      {!batch.plan.cancelledAt && batch.progress.notStarted > 0 ? <AIButton label="取消尚未開始的行程"
        variant="ghost" disabled={disabled || unread} onPress={() => void execute('cancel')} /> : null}
    </>}
    <Text style={{ color: aiTokens.muted, fontSize: 13, lineHeight: 21 }}>
      行程保存在這台手機目前帳號的個人行事曆；重開 App 後需要再次確認，才會接續尚未開始的安排。會檢查個人行程的重疊，課表與校方排程請另外核對。
    </Text>
    {error ? <Text accessibilityRole="alert" style={{ color: aiTokens.danger, lineHeight: 22 }}>{error}</Text> : null}
  </View>;
}
