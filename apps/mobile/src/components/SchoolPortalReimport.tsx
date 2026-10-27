import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PersonalImportRow } from '@campus/shared';
import { resolvePortalReimport, type ReimportChoice } from '@campus/shared/src/imports/portalReimport';
import { previewPortalReimport, commitPortalReimport, type PortalReimportPreview, type PortalReimportReceipt } from '../services/portalReimport';
import type { PersonalImportScope } from '../services/personalImports';
import { Button } from '../ui/components';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';

type Props = {
  scope: PersonalImportScope;
  rows: PersonalImportRow[];
  isCurrent(): boolean;
  onCancel(): void;
  onSaved(receipt: PortalReimportReceipt): void;
};
export function SchoolPortalReimport(props: Props) {
  useThemeMode();
  const latest = useRef(props); latest.current = props;
  const initial = useRef({ scope: { ...props.scope }, rows: JSON.parse(JSON.stringify(props.rows)) as PersonalImportRow[] });
  const mounted = useRef(true), lock = useRef(false), request = useRef(0);
  const foreground = useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [preview, setPreview] = useState<PortalReimportPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, ReimportChoice>>({});
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [visible, setVisible] = useState(8);
  const current = useCallback(() => mounted.current && latest.current.isCurrent() &&
    latest.current.scope.owner === initial.current.scope.owner && latest.current.scope.schoolId === initial.current.scope.schoolId, []);
  const active = useCallback(() => current() && foreground.current, [current]);
  const load = useCallback(async () => {
    if (lock.current || !active()) return;
    const generation = ++request.current;
    setLoading(true); setPreview(null); setChoices({}); setError(''); setVisible(8);
    try {
      const result = await previewPortalReimport(initial.current.scope, initial.current.rows, active);
      if (current() && request.current === generation) setPreview(result);
    } catch (cause) {
      if (current() && request.current === generation) setError(cause instanceof Error ? cause.message : '無法讀取既有紀錄，尚未寫入任何資料。');
    } finally {
      if (current() && request.current === generation) setLoading(false);
    }
  }, [active, current]);
  useEffect(() => {
    mounted.current = true;
    void load();
    const listener = AppState.addEventListener('change', (state) => { foreground.current = state === 'active'; });
    return () => { mounted.current = false; request.current++; listener.remove(); };
  }, [load]);
  const cancel = () => { if (!lock.current) { request.current++; latest.current.onCancel(); } };
  const commit = async () => {
    if (!preview || loading || lock.current || !active()) return;
    lock.current = true; setSaving(true); setError('');
    try {
      const receipt = await commitPortalReimport(initial.current.scope, preview, choices, active);
      // A durable write may finish just after backgrounding. Preserve its receipt, never blindly retry it.
      if (current()) latest.current.onSaved(receipt);
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : '儲存未完成，核對內容仍保留。');
    } finally { lock.current = false; if (current()) setSaving(false); }
  };
  const entries = preview?.plan.entries ?? [];
  const review = entries.filter((item) => item.status === 'change' || item.status === 'ambiguous');
  const unresolved = review.filter((item) => !choices[item.row.id]).length;
  let totals: ReturnType<typeof resolvePortalReimport> | null = null;
  if (preview) { try { totals = resolvePortalReimport(preview.plan, choices); } catch { /* All conflicts require decisions. */ } }
  const copy = { color: theme.colors.text, lineHeight: 23 };
  return <Modal visible animationType="slide" onRequestClose={cancel}>
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ padding: 16, gap: 10, borderBottomWidth: 1, borderColor: theme.colors.border }}>
        <Text accessibilityRole="header" style={{ ...copy, fontSize: 20, fontWeight: '700' }}>核對既有課務資料</Text>
        <Text style={copy}>同一學期的資料有變動時，逐筆決定保留或更新。不刪除本次沒有讀到的舊紀錄。</Text>
        <Button text="返回原預覽" kind="outline" disabled={saving} onPress={cancel} />
        {error ? <Text accessibilityRole="alert" style={copy}>{error}</Text> : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        {loading ? <ActivityIndicator accessibilityLabel="正在比對既有紀錄" /> : null}
        {preview ? <>
          <Text style={copy}>{`預計新增 ${entries.filter((item) => item.status === 'new').length} 筆；相同列略過 ${entries.filter((item) => item.status === 'duplicate').length} 筆；尚待確認 ${unresolved} 筆。`}</Text>
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>這裡更新的是你的個人匯入紀錄，不會修改學校成績。新來源未提供的教師、班別等欄位保留舊值；學分與成績不會被猜測。</Text>
          {review.slice(0, visible).map((entry) => <View key={entry.row.id} style={{ padding: 16, gap: 8, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12 }}>
            <Text accessibilityRole="header" style={{ ...copy, fontWeight: '700' }}>{entry.row.title}</Text>
            <Text style={copy}>{`${entry.row.academicYear}／${entry.row.semester} · ${entry.row.courseCode || '課號未提供'} · ${entry.row.className || '班別未提供'}`}</Text>
            {entry.status === 'ambiguous' ? <Text accessibilityRole="alert" style={copy}>同名科目、缺少班別或多個上課時段無法唯一配對。這筆不會新增或覆蓋，請保留舊紀錄，再回原預覽修正識別欄位。</Text> : entry.differences.map((field) =>
              <Text key={field.label} style={copy}>{`${field.label}：${field.before} → ${field.after}`}</Text>)}
            <Button text={`${choices[entry.row.id] === 'keep' ? '已選' : '選擇'}保留舊紀錄：${entry.row.title}`} kind="outline" disabled={saving}
              onPress={() => setChoices((old) => ({ ...old, [entry.row.id]: 'keep' }))} />
            {entry.status === 'change' ? <Button text={`${choices[entry.row.id] === 'replace' ? '已選' : '選擇'}更新這筆：${entry.row.title}`} kind="outline" disabled={saving}
              onPress={() => setChoices((old) => ({ ...old, [entry.row.id]: 'replace' }))} /> : null}
          </View>)}
          {review.length > visible ? <Button text={`再顯示 ${Math.min(20, review.length - visible)} 筆差異`} disabled={saving} onPress={() => setVisible((old) => old + 20)} /> : null}
          {review.length ? <Button text="全部保留舊紀錄" kind="outline" disabled={saving} onPress={() => setChoices(Object.fromEntries(review.map((item) => [item.row.id, 'keep' as const])))} /> : null}
          {totals ? <Text style={copy}>{`此次確認：新增 ${totals.added.length} 筆、更新 ${totals.replacements.length} 筆、保留舊值 ${totals.kept} 筆。`}</Text> : <Text style={copy}>請完成每一筆差異的選擇，才可儲存。</Text>}
          <Button text={saving ? '正在儲存核對結果…' : `確認新增 ${totals?.added.length ?? 0} 筆、更新 ${totals?.replacements.length ?? 0} 筆`}
            disabled={saving || loading || !totals} onPress={() => void commit()} />
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>儲存前會再次檢查版本；期間若有其他編輯或同步，整次停止並要求重新比對。完成後可在本次畫面撤回新增與更新；離開畫面不保留這份撤回暫存。</Text>
        </> : null}
        <Button text="重新比對既有紀錄" kind="outline" disabled={saving || loading} onPress={() => void load()} />
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}
