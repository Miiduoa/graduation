import React from 'react';
import { Switch, Text, TextInput, View } from 'react-native';
import { theme } from '../ui/theme';

export type RegistrationPolicyDraft = {
  enabled: boolean;
  free: boolean;
  opensAt: string;
  closesAt: string;
  allowCancellation: boolean;
  cancellationClosesAt: string;
};
export type RegistrationPolicyInput =
  | { enabled: false }
  | {
      enabled: true;
      eligibility: 'active-school-members';
      free: true;
      opensAt: string;
      closesAt: string;
      allowCancellation: boolean;
      cancellationClosesAt: string | null;
    };
function dateText(value: unknown) {
  const date =
    typeof value === 'string'
      ? new Date(value)
      : value &&
          typeof value === 'object' &&
          'toDate' in value &&
          typeof value.toDate === 'function'
        ? value.toDate()
        : null;
  return date instanceof Date && Number.isFinite(date.getTime())
    ? new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')
    : '';
}
export function registrationPolicyDraft(value?: Record<string, unknown>): RegistrationPolicyDraft {
  return {
    enabled: value?.enabled === true,
    free: value?.free === true,
    opensAt: dateText(value?.opensAt),
    closesAt: dateText(value?.closesAt),
    allowCancellation: value?.allowCancellation === true,
    cancellationClosesAt: dateText(value?.cancellationClosesAt),
  };
}
function parseDate(text: string) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text))
    throw new Error('請使用 YYYY-MM-DD HH:mm 填寫完整期限（台灣時間）。');
  const date = new Date(`${text.replace(' ', 'T')}:00+08:00`);
  if (!Number.isFinite(date.getTime()) || dateText(date.toISOString()) !== text)
    throw new Error('請確認報名或取消日期確實存在。');
  return date.toISOString();
}
export function registrationPolicyInput(draft: RegistrationPolicyDraft): RegistrationPolicyInput {
  if (!draft.enabled) return { enabled: false };
  if (!draft.free) throw new Error('請確認本活動免費，才可開啟 App 報名。');
  const opensAt = parseDate(draft.opensAt.trim());
  const closesAt = parseDate(draft.closesAt.trim());
  const cancellationClosesAt = draft.allowCancellation
    ? parseDate(draft.cancellationClosesAt.trim())
    : null;
  if (opensAt >= closesAt || (cancellationClosesAt && cancellationClosesAt < opensAt))
    throw new Error('請確認報名與取消期限的先後順序。');
  return {
    enabled: true,
    eligibility: 'active-school-members',
    free: true,
    opensAt,
    closesAt,
    allowCancellation: draft.allowCancellation,
    cancellationClosesAt,
  };
}
export function EventRegistrationPolicyFields({
  value,
  onChange,
}: {
  value: RegistrationPolicyDraft;
  onChange: (value: RegistrationPolicyDraft) => void;
}) {
  const toggle = (field: 'enabled' | 'free' | 'allowCancellation', label: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text style={{ flex: 1, color: theme.colors.text }}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value[field]}
        onValueChange={(next) => onChange({ ...value, [field]: next })}
      />
    </View>
  );
  const field = (key: 'opensAt' | 'closesAt' | 'cancellationClosesAt', label: string) => (
    <View style={{ gap: 6 }}>
      <Text style={{ color: theme.colors.text }}>{label}（台灣時間）</Text>
      <TextInput
        accessibilityLabel={label}
        value={value[key]}
        onChangeText={(text) => onChange({ ...value, [key]: text })}
        placeholder="YYYY-MM-DD HH:mm"
        placeholderTextColor={theme.colors.muted}
        style={{
          color: theme.colors.text,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 10,
          padding: 12,
        }}
      />
    </View>
  );
  return (
    <View style={{ gap: 14, marginTop: 20 }}>
      {toggle('enabled', '受理 App 報名')}
      <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
        關閉時不接受新報名；已報名者仍依已設定的取消期限辦理。未設定的舊活動不會自動開放。
      </Text>
      {value.enabled ? (
        <>
          <Text style={{ color: theme.colors.text }}>
            參加資格：目前學校的有效會員。人數上限沿用上方設定，留空表示不限。
          </Text>
          {toggle('free', '確認本活動免費')}
          {field('opensAt', '開始受理時間')}
          {field('closesAt', '報名截止時間')}
          {toggle('allowCancellation', '允許本人取消報名')}
          {value.allowCancellation ? (
            field('cancellationClosesAt', '取消截止時間')
          ) : (
            <Text style={{ color: theme.colors.muted }}>
              不提供自行取消；參加者需聯繫主辦單位。
            </Text>
          )}
          <Text style={{ color: theme.colors.muted }}>
            報名與取消截止不得晚於活動開始。已有舊報名名單或未核對人數時，需先整理名單才能開啟。
          </Text>
        </>
      ) : null}
    </View>
  );
}
