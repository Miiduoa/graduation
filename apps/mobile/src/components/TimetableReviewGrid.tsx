import React from 'react';
import { ScrollView, View, Text, Pressable } from 'react-native';
import {
  validatePersonalImportRow,
  type PersonalImportRow,
  type PeriodProfileId,
} from '@campus/shared';
import { REVIEW_DAYS, reviewCellRows, reviewPeriods } from '@campus/shared/src/imports/reviewGrid';
import { theme } from '../ui/theme';

export function TimetableReviewGrid({
  rows,
  profile,
  disabled,
  editedIds = [],
  onEdit,
  onAdd,
}: {
  rows: PersonalImportRow[];
  profile?: PeriodProfileId;
  disabled: boolean;
  editedIds?: string[];
  onEdit(row: PersonalImportRow): void;
  onAdd(day: number, period: number): void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.colors.text }}>
        週課表核對：左右滑動，點課程修正、點空格補課。跨節課可拆分。
      </Text>
      <ScrollView horizontal accessibilityLabel="週課表核對">
        <View>
          <View style={{ flexDirection: 'row' }}>
            <Text style={{ width: 48, color: theme.colors.text }}>節次</Text>
            {REVIEW_DAYS.map((day) => (
              <Text key={day} style={{ width: 110, color: theme.colors.text }}>
                星期{day}
              </Text>
            ))}
          </View>
          {reviewPeriods(rows, profile).map((period) => (
            <View key={period.index} style={{ flexDirection: 'row' }}>
              <Text style={{ width: 48, color: theme.colors.text }}>{period.label}</Text>
              {REVIEW_DAYS.map((day, index) => {
                const entries = reviewCellRows(rows, index + 1, period.index);
                return (
                  <View
                    key={day}
                    style={{ width: 110, borderWidth: 0.5, borderColor: theme.colors.border }}
                  >
                    {entries.length ? (
                      entries.map((row) => (
                        <Pressable
                          key={row.id}
                          accessibilityRole="button"
                          disabled={disabled}
                          accessibilityLabel={`修正星期${day}第${period.label}節 ${row.title || '未命名課程'}`}
                          onPress={() => onEdit(row)}
                          style={{ minHeight: 54, padding: 8 }}
                        >
                          <Text style={{ color: theme.colors.text }}>
                            {row.title || '名稱待填'}
                          </Text>
                          <Text style={{ color: theme.colors.muted }}>
                            {validatePersonalImportRow(row, { periodProfile: profile }).some(
                              (issue) => issue.severity === 'error',
                            )
                              ? '需修正'
                              : editedIds.includes(row.id)
                                ? '已手動修改'
                                : '待核對'}
                            {entries.length > 1 ? ' · 時段重疊' : ''}
                          </Text>
                          <Text style={{ color: theme.colors.muted }}>
                            {row.location || '教室待填'}
                          </Text>
                        </Pressable>
                      ))
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        disabled={disabled}
                        accessibilityLabel={`新增星期${day}第${period.label}節`}
                        onPress={() => onAdd(index + 1, period.index)}
                        style={{ minHeight: 54, padding: 8 }}
                      >
                        <Text style={{ color: theme.colors.accentStrong }}>＋</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
