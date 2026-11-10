import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import {
  assistantCalendarOwner, confirmAssistantCalendarTask, recheckAssistantCalendarTask,
  type AssistantCalendarContext, type AssistantCalendarTask,
} from '../services/assistantCalendarExecution';
import { mobileAssistantServiceDestination } from '../services/assistantServiceNavigation';
import { safeNavigate } from '../utils/safeNavigate';
import { AIButton, aiTokens } from '../ui/aiFirst';
import type { ServiceScreenProps } from './UnavailableFeatureScreen';

/** The conversation owns the state, including the receipt after the next turn. */
export function AssistantCalendarAction({ task, context, navigation, disabled, onChange }: {
  task: AssistantCalendarTask;
  context: AssistantCalendarContext;
  navigation: ServiceScreenProps['navigation'];
  disabled: boolean;
  onChange: (next: AssistantCalendarTask) => void;
}) {
  const active = useRef(true);
  const lock = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const current = () => active.current && context.isCurrent() &&
    assistantCalendarOwner(context) === task.proposal.owner && context.schoolId === task.proposal.schoolId;
  const execute = async (action: 'confirm' | 'check') => {
    if (disabled || lock.current || !current() ||
        (action === 'confirm' ? task.state !== 'review' : task.state !== 'unknown' && task.state !== 'verified')) return;
    lock.current = true;
    setError('');
    onChange(task.state === 'verified' ? { ...task, checking: true }
      : { proposal: task.proposal, state: action === 'confirm' ? 'saving' : 'checking' });
    try {
      const access = { ...context, isCurrent: current };
      const result = await (action === 'confirm' ? confirmAssistantCalendarTask(task.proposal, access)
        : recheckAssistantCalendarTask(task.proposal, access, task));
      if (current()) onChange(result);
    } catch {
      if (current()) onChange(task.state === 'verified'
        ? { ...task, checking: false, warning: '這次無法重新核對，已保留先前回執與核對時間。' }
        : { proposal: task.proposal, state: 'unknown', reason: 'unavailable',
          message: '目前無法確認保存結果。請重新核對同一筆行程，不會再次建立。',
          ...(task.state === 'unknown' && task.lastVerified ? { lastVerified: task.lastVerified } : {}) });
    } finally {
      lock.current = false;
    }
  };
  const open = () => {
    if (disabled || !current() || task.state !== 'verified') return;
    // This receipt describes device storage. Opening a website cannot prove
    // that the same event exists there; only the registered local screen is used.
    const target = mobileAssistantServiceDestination('calendar', context.platformTimetable ? 'platform' : 'campus', navigation);
    if (target?.kind !== 'native' || target.route !== 'PersonalCalendar' ||
        !safeNavigate(navigation, 'PersonalCalendar', { eventId: task.receipt.record.id }, { fallbackMessage: null })) {
      setError('目前無法從此頁開啟行事曆。行程已保存，可從個人行事曆查看。');
    }
  };
  const { event } = task.proposal;
  const pending = task.state === 'saving' || task.state === 'checking';
  return <View style={{ gap: 10, marginTop: 10 }}>
    <Text style={{ color: aiTokens.text, fontSize: 17, fontWeight: '600' }}>{event.title}</Text>
    <Text style={{ color: aiTokens.textSecondary, lineHeight: 23 }}>
      {event.date}{event.endDate ? ` 至 ${event.endDate}` : ''} · {event.allDay ? '全天' : `${event.startTime}–${event.endTime}`}（台灣時間）
    </Text>
    {event.location ? <Text style={{ color: aiTokens.textSecondary }}>地點：{event.location}</Text> : null}
    {task.state === 'review' ? <>
      <Text style={{ color: aiTokens.textSecondary, lineHeight: 23 }}>
        確認後會加入目前帳號與學校的個人行事曆，並檢查這台手機的個人行程是否重疊。課表與校方排程仍請另外核對。
      </Text>
      <AIButton label="確認加入個人行事曆" disabled={disabled} onPress={() => void execute('confirm')} />
      <AIButton label="先不要" variant="ghost" disabled={disabled} onPress={() => {
        if (!disabled && !lock.current && current()) onChange({ proposal: task.proposal, state: 'cancelled' });
      }} />
    </> : pending ? <Text accessibilityLiveRegion="polite" style={{ color: aiTokens.text, lineHeight: 23 }}>
      {task.state === 'saving' ? '正在保存並讀回核對行程…' : '正在核對同一筆已送出的行程…'}
    </Text> : task.state === 'verified' ? <>
      <Text accessibilityLiveRegion="polite" style={{ color: aiTokens.text, lineHeight: 23 }}>已在這台手機保存並核對行程。</Text>
      <Text style={{ color: aiTokens.muted, fontSize: 13, lineHeight: 21 }}>
        核對時間：{new Date(task.receipt.verifiedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}
      </Text>
      <AIButton label="查看已建立的行程" variant="ghost" disabled={disabled} onPress={open} />
      {task.warning ? <Text accessibilityRole="alert" style={{ color: aiTokens.textSecondary, lineHeight: 23 }}>{task.warning}</Text> : null}
      <AIButton label={task.checking ? '正在重新核對…' : '重新核對行程'} variant="ghost" disabled={disabled || task.checking}
        onPress={() => void execute('check')} />
    </> : task.state === 'cancelled' ? <Text style={{ color: aiTokens.muted, lineHeight: 23 }}>已取消這份草稿，尚未建立行程。</Text>
      : <>
        <Text accessibilityRole="alert" style={{ color: aiTokens.textSecondary, lineHeight: 23 }}>{task.message}</Text>
        {task.state === 'unknown' && task.lastVerified ? <Text style={{ color: aiTokens.muted, fontSize: 13, lineHeight: 21 }}>
          先前核對時間：{new Date(task.lastVerified.verifiedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}。這份歷史回執不代表目前仍有相同內容。
        </Text> : null}
        {task.state === 'unknown' ? <AIButton label="重新核對行程" variant="ghost" disabled={disabled}
          onPress={() => void execute('check')} /> : null}
      </>}
    <Text style={{ color: aiTokens.muted, fontSize: 13, lineHeight: 21 }}>
      這項操作只處理個人行程；沒有排程手機通知，也沒有提交作業或修改校方期限。
    </Text>
    {error ? <Text accessibilityRole="alert" style={{ color: aiTokens.danger, lineHeight: 22 }}>{error}</Text> : null}
  </View>;
}
