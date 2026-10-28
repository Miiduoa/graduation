import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { SchoolPageTable } from '@campus/shared';
import type { SchoolTableChoice } from '@campus/shared/src/imports/schoolTableBatch';
import { Button } from '../ui/components';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';

type Props = {
  tables: readonly SchoolPageTable[];
  choices: readonly SchoolTableChoice[];
  disabled?: boolean;
  onChange(choices: SchoolTableChoice[]): void;
  onContinue(): void;
  onCancel(): void;
};

/** Controlled by the session so returning to the school page does not erase a selection. */
export function SchoolPortalTablePicker({ tables, choices, disabled = false, onChange, onContinue, onCancel }: Props) {
  useThemeMode();
  const copy = { color: theme.colors.text, lineHeight: 23 };
  const field = { minHeight: 44, padding: 12, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: 8, color: theme.colors.text, backgroundColor: theme.colors.surface };
  const update = (tableId: string, key: 'academicYear' | 'semester', value: string) => {
    if (!disabled) onChange(choices.map((choice) => choice.tableId === tableId ? { ...choice, [key]: value } : choice));
  };
  return <View style={{ gap: 16 }}>
    <Text accessibilityRole="header" style={{ ...copy, fontSize: 18, fontWeight: '700' }}>一次核對多張表格</Text>
    <Text style={copy}>只選取本人的課表或成績。每張表各自保留學期；這裡的學期只補原表沒有的欄位，不覆蓋原始資料。沒有把握請留空，在預覽逐筆修正。</Text>
    {tables.map((table, index) => {
      const choice = choices.find((item) => item.tableId === table.id);
      const number = index + 1;
      return <View key={table.id} style={{ padding: 16, gap: 10, borderWidth: 1, borderColor: theme.colors.border,
        borderRadius: 12, backgroundColor: theme.colors.surface }}>
        <Pressable accessibilityRole="checkbox" accessibilityLabel={`選取表格 ${number}`}
          accessibilityState={{ checked: !!choice, disabled }} disabled={disabled}
          style={{ minHeight: 48, paddingVertical: 8, justifyContent: 'center' }}
          onPress={() => {
            if (disabled) return;
            onChange(choice ? choices.filter((item) => item.tableId !== table.id) : [...choices, {
              tableId: table.id, academicYear: table.suggestedTerm?.academicYear ?? '', semester: table.suggestedTerm?.semester ?? '',
            }]);
          }}>
          <Text style={{ ...copy, fontWeight: '600' }}>{`${choice ? '已選' : '未選'} · ${table.label}`}</Text>
        </Pressable>
        <Text style={{ color: theme.colors.muted, lineHeight: 20, fontSize: 12 }}>{table.text.slice(0, 160)}{table.text.length > 160 ? '…' : ''}</Text>
        {choice ? <>
          <Text style={copy}>原表缺少學期欄位時使用</Text>
          <TextInput accessibilityLabel={`表格 ${number} 學年度`} placeholder="學年度，例如 115" maxLength={4}
            keyboardType="number-pad" style={field} value={choice.academicYear} editable={!disabled} autoCorrect={false}
            onChangeText={(value) => update(table.id, 'academicYear', value)} />
          <TextInput accessibilityLabel={`表格 ${number} 學期`} placeholder="學期，例如 1、2、暑期" maxLength={30}
            style={field} value={choice.semester} editable={!disabled} autoCorrect={false}
            onChangeText={(value) => update(table.id, 'semester', value)} />
        </> : null}
      </View>;
    })}
    <Text style={copy} accessibilityLiveRegion="polite">{`選取 ${choices.length} 張表格，尚未儲存。超過 500 筆時需分批處理。`}</Text>
    <Button text={`核對所選 ${choices.length} 張表格`} disabled={disabled || !choices.length} onPress={onContinue} />
    <Button text="返回單表選擇" kind="outline" disabled={disabled} onPress={onCancel} />
  </View>;
}
