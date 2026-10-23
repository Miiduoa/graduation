import React, { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { PersonalImportKind, PersonalImportRecord } from '@campus/shared';
import { usePersonalImportScope } from '../state/personalImportScope';
import { loadPersonalImports } from '../services/personalImports';
import { safeNavigate } from '../utils/safeNavigate';
import { Button } from '../ui/components';
import { theme } from '../ui/theme';

/** Personal records stay visibly separate from official grades and calendar feeds. */
export function PersonalImportSummary({ kind }: { kind: PersonalImportKind }) {
  const navigation = useNavigation();
  const scope = usePersonalImportScope();
  const key = scope ? JSON.stringify([scope, kind]) : '';
  const current = useRef(key);
  current.current = key;
  const [state, setState] = useState<{
    key: string;
    records: PersonalImportRecord[];
    error?: boolean;
  } | null>(null);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (scope)
        void loadPersonalImports(scope)
          .then((ledger) => {
            if (active && current.current === key)
              setState({ key, records: ledger.records.filter((row) => row.kind === kind) });
          })
          .catch(() => {
            if (active && current.current === key) setState({ key, records: [], error: true });
          });
      return () => {
        active = false;
      };
    }, [key, kind, scope]),
  );
  const visible = state?.key === key ? state : null;
  const names = { timetable: '課表', grades: '成績與學分', events: '行事曆' };
  return (
    <View style={{ gap: 8, paddingVertical: 10 }}>
      <Button
        text={`匯入${names[kind]}／查看個人紀錄`}
        onPress={() => {
          safeNavigate(navigation, 'PersonalImport', { kind });
        }}
      />
      <Text style={{ color: theme.colors.muted }}>
        {!scope
          ? '正在確認帳號，暫時不顯示個人資料。'
          : !visible
            ? '正在讀取這台裝置的個人匯入紀錄…'
            : visible.error
              ? '個人匯入紀錄暫時讀不到，請開啟匯入頁重試。'
              : `這台裝置已存 ${visible?.records.length || 0} 筆個人${names[kind]}。尚未同步或經學校確認。`}
      </Text>
      {kind !== 'timetable'
        ? visible?.records
            .slice(-3)
            .reverse()
            .map((row) => (
              <Text key={row.id} style={{ color: theme.colors.text }}>
                {row.title} ·{' '}
                {kind === 'grades'
                  ? `${row.credits} 學分／${row.grade}（${row.academicYear}／${row.semester}）`
                  : `${row.date} ${row.allDay ? '全天' : row.startTime || ''}`}
              </Text>
            ))
        : null}
    </View>
  );
}
