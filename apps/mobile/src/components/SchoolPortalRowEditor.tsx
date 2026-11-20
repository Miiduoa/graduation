import React, { useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import type { PersonalImportRow } from '@campus/shared';
import { isPeriodProfileId, periodSlots, type PeriodProfileId } from '@campus/shared/src/timetable/periods';
import { applyPortalRowDraft, createPortalRowDraft, type PortalRowDraft } from '@campus/shared/src/imports/portalRowReview';
import { Button } from '../ui/components';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';

/** Local form state is discarded on cancel. Applying changes still does not persist an import. */
export function SchoolPortalRowEditor({ row, profile, disabled = false, onApply, onCancel }: {
  row: PersonalImportRow; profile?: PeriodProfileId; disabled?: boolean;
  onApply(row: PersonalImportRow): void; onCancel(): void;
}) {
  useThemeMode();
  const [draft, setDraft] = useState(() => createPortalRowDraft(row, profile));
  const [showSource, setShowSource] = useState(false);
  const result = useMemo(() => applyPortalRowDraft(row, draft, profile), [row, draft, profile]);
  const errors = result.issues.filter((issue) => issue.severity === 'error');
  const copy = { color: theme.colors.text, lineHeight: 23 };
  const field = (key: keyof PortalRowDraft, label: string, numeric = false, maxLength = 300) => (
    <View key={key} style={{ gap: 6 }}>
      <Text style={copy}>{label}</Text>
      <TextInput accessibilityLabel={`修正：${label}`} value={draft[key]} editable={!disabled}
        onChangeText={(value) => setDraft((old) => ({ ...old, [key]: value }))} autoCorrect={false}
        keyboardType={numeric ? 'decimal-pad' : 'default'} maxLength={maxLength}
        style={{ minHeight: 46, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8,
          padding: 12, color: theme.colors.text, backgroundColor: theme.colors.surface }} />
    </View>
  );
  return <View testID="portal-row-editor" style={{ gap: 12, padding: 16, borderRadius: 12,
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.focusSurface }}>
    <Text accessibilityRole="header" style={{ ...copy, fontSize: 17, fontWeight: '700' }}>修正這筆資料</Text>
    <Text style={copy}>依校方資料修正欄位，套用後仍需按「確認匯入」才會儲存。原始來源不會被改寫。</Text>
    {field('title', '課程名稱', false, 200)}
    {field('academicYear', '學年度', true, 4)}{field('semester', '學期', false, 30)}
    {field('courseCode', '課號')}{field('className', '班別')}
    {field('credits', '學分', true, 12)}
    {row.kind === 'grades' ? field('grade', '原始成績', false, 40) : <>
      {field('dayOfWeek', '星期（1 至 7）', true, 1)}
      {isPeriodProfileId(profile) ? <>
        <Text style={copy}>{`此校節次：${periodSlots(profile).map((slot) => slot.label).join('、')}。套用時依這些節次更新起訖時間，請先與校方核對。`}</Text>
        {field('startPeriod', '開始節次', false, 4)}{field('endPeriod', '結束節次', false, 4)}
      </> : <>
        <Text style={copy}>此校尚未設定節次格線，請保留原始節次，或填完整起訖時間；不套用其他學校的時間。</Text>
        {field('periodLabel', '原始節次')}{field('startTime', '開始時間（HH:MM）', false, 5)}{field('endTime', '結束時間（HH:MM）', false, 5)}
      </>}
      {field('location', '教室')}{field('teacher', '教師')}
    </>}
    <Button text={showSource ? '收合這筆原始來源' : '查看這筆原始來源'} kind="outline"
      onPress={() => setShowSource((value) => !value)} />
    {showSource ? <View style={{ gap: 6 }}>
      <Text style={copy}>{`來源第 ${row.source.line} 行 · ${row.source.name ?? '校務表格'}`}</Text>
      <Text selectable style={copy}>{row.source.rawText}</Text>
    </View> : null}
    {errors.map((issue, index) => <Text key={`${issue.code}:${index}`} accessibilityRole="alert" style={copy}>{issue.message}</Text>)}
    <Button text="套用這筆修正" disabled={disabled || !result.ok} onPress={() => { if (!disabled && result.ok) onApply(result.row); }} />
    <Button text="取消這筆修正" kind="outline" disabled={disabled} onPress={onCancel} />
  </View>;
}
