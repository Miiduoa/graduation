import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { useEventRegistrations } from '../hooks/useEventRegistrations';
import {
  changeEventRegistration,
  createEventRegistrationRequestId,
  eventRegistrationLabel,
  type EventRegistrationState,
} from '../services/eventRegistration';
import { AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
export function EventRegistrationPanel({ eventId }: { eventId: string }) {
  const { user } = useAuth();
  const { school } = useSchool();
  return <Registration key={JSON.stringify([user?.uid, school.id, eventId])} eventId={eventId} />;
}
function Registration({ eventId }: { eventId: string }) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const content = useEventRegistrations([eventId]);
  const [confirmed, setConfirmed] = useState<EventRegistrationState | null>(null);
  const [pending, setPending] = useState<{
    action: 'register' | 'cancel';
    requestId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const mounted = useRef(true);
  const lock = useRef(false);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    if (content.states[0]) setConfirmed(content.states[0]);
  }, [content.states]);
  const state = confirmed ?? content.states[0];
  const current = () => mounted.current;
  const change = async (action: 'register' | 'cancel') => {
    if (lock.current || !current()) return;
    lock.current = true;
    setBusy(true);
    setError(false);
    const attempt =
      pending?.action === action
        ? pending
        : { action, requestId: createEventRegistrationRequestId() };
    setPending(attempt);
    try {
      const result = await changeEventRegistration(
        { uid: content.uid, schoolId: content.schoolId },
        { ...attempt, eventId },
        current,
      );
      if (current()) {
        setConfirmed(result);
        setPending(null);
      }
    } catch {
      if (current()) setError(true);
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };
  const date = (value: string | null) =>
    value
      ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })
      : '';
  return (
    <AICard title="App 報名">
      <View style={{ gap: 12 }}>
        {state?.policyConfirmed ? (
          <Text style={{ color: aiTokens.muted, lineHeight: 23 }}>
            免費活動，限目前學校的有效會員。名額與受理時間以送出時確認為準。
          </Text>
        ) : null}
        {!content.uid ? (
          <Text style={{ color: aiTokens.text }}>請登入目前學校的帳號，再確認報名資格與狀態。</Text>
        ) : (
          <>
            <Text style={{ color: aiTokens.text }}>
              {content.loading && !state ? '正在確認報名狀態…' : eventRegistrationLabel(state)}
            </Text>
            {state?.policyConfirmed ? (
              <>
                <Text style={{ color: aiTokens.muted }}>
                  App 報名人數：{state.count ?? '待確認'}
                  {state.capacity === null ? '（人數不限）' : `／${state.capacity} 人`}
                </Text>
                {state.opensAt ? (
                  <Text style={{ color: aiTokens.muted }}>
                    受理期間：{date(state.opensAt)} 至 {date(state.closesAt)}
                  </Text>
                ) : null}
                <Text style={{ color: aiTokens.muted }}>
                  {state.cancellationClosesAt
                    ? `可自行取消至 ${date(state.cancellationClosesAt)}`
                    : '未提供自行取消；請聯繫主辦單位。'}
                </Text>
              </>
            ) : null}
            {state && (!state.policyConfirmed || state.availability === 'unavailable') ? (
              <Text style={{ color: aiTokens.muted, lineHeight: 23 }}>
                主辦單位尚未開放 App 報名，請依活動說明辦理。
              </Text>
            ) : null}
            {error ? (
              <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
                尚未確認操作結果。請用相同操作重試，或更新狀態確認；不會自動重複報名。
              </Text>
            ) : null}
            {content.error ? (
              <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
                無法確認報名狀態，請確認登入與網路後重新讀取。
              </Text>
            ) : null}
            {pending && error ? (
              <AIButton
                label={pending.action === 'register' ? '重試這次報名' : '重試這次取消'}
                disabled={busy}
                onPress={() => void change(pending.action)}
              />
            ) : null}
            {!pending && state?.canRegister ? (
              <AIButton
                label={busy ? '正在確認…' : '確認報名'}
                disabled={busy}
                onPress={() => void change('register')}
              />
            ) : null}
            {!pending && state?.canCancel ? (
              <AIButton
                label={busy ? '正在確認…' : '取消報名'}
                variant="ghost"
                disabled={busy}
                onPress={() => void change('cancel')}
              />
            ) : null}
            <AIButton
              label="更新報名狀態"
              variant="ghost"
              disabled={busy || content.loading}
              onPress={() => {
                setConfirmed(null);
                void content.reload();
              }}
            />
          </>
        )}
      </View>
    </AICard>
  );
}
