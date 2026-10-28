import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, Text, View } from 'react-native';
import type { User } from 'firebase/auth';
import type { PersonalImportRow } from '@campus/shared';
import { getAuthInstance } from '../firebase';
import { loadOwnedSchoolCourses } from '../services/ownedSchoolAcademicRecords';
import type { PersonalImportScope } from '../services/personalImports';
import { undoPortalReimport, type PortalReimportReceipt } from '../services/portalReimport';
import { previewSchoolTimetable, schoolCourseTimeLabel, type SchoolTimetablePreview } from '../services/schoolTimetableImport';
import { useThemeMode } from '../state/theme';
import { Button } from '../ui/components';
import { theme } from '../ui/theme';
import { SchoolPortalReimport } from './SchoolPortalReimport';
import { SchoolPortalRowEditor } from './SchoolPortalRowEditor';

type Props = {
  scope: PersonalImportScope;
  uid: string | null;
  isCurrent(): boolean;
  onConnect(): void;
  onOpenImports(): void;
  onSaved(termKey: string | null): void;
};
type Snapshot = { data: SchoolTimetablePreview; requester: User; generation: number };
type Review = Snapshot & { rows: PersonalImportRow[] };
type Receipt = { data: PortalReimportReceipt; requester: User };

/** Remount on either account boundary, including a platform account using the same school identity. */
export function SchoolTimetableImport(props: Props) {
  if (props.scope.schoolId !== 'pu') return null;
  return <SchoolTimetableImportPanel key={JSON.stringify([props.scope, props.uid])} {...props} />;
}

function SchoolTimetableImportPanel(props: Props) {
  useThemeMode();
  const latest = useRef(props); latest.current = props;
  const mounted = useRef(true), request = useRef(0), reading = useRef(false), undoing = useRef(false);
  const foreground = useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null), [editedIds, setEditedIds] = useState<string[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false), [visible, setVisible] = useState(8);
  const [error, setError] = useState(''), [undoError, setUndoError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener('change', (state) => { foreground.current = state === 'active'; });
    return () => { mounted.current = false; listener.remove(); };
  }, []);
  const connected = !!props.uid && (props.scope.owner === `firebase:${props.uid}` || props.scope.owner.startsWith('nuni:'));
  const current = (requester: User) => mounted.current && connected && latest.current.isCurrent()
    && latest.current.uid === requester.uid && getAuthInstance().currentUser === requester;
  const read = async () => {
    if (reading.current || undoing.current || review || editingId || !connected || !props.isCurrent()) return;
    const requester = getAuthInstance().currentUser;
    if (!requester || requester.uid !== props.uid) {
      setSnapshot(null); setSelected([]); setError('請重新連線學校帳號後再讀取課表。');
      return;
    }
    const generation = ++request.current;
    reading.current = true; setLoading(true); setError(''); setNotice(''); setConfirmUndo(false);
    try {
      const result = await loadOwnedSchoolCourses(requester.uid);
      if (!current(requester) || generation !== request.current) return;
      const data = previewSchoolTimetable(result);
      setSnapshot({ data, requester, generation });
      setSelected(data.courses.filter((item) => !item.reasons.length).map((item) => item.id));
      setVisible(8); setEditedIds([]); setEditingId(null);
    } catch (cause) {
      if (current(requester) && generation === request.current)
        setError(cause instanceof Error ? cause.message : '這次未能讀取校方課表，請稍後重試。');
    } finally {
      reading.current = false;
      if (mounted.current && generation === request.current) {
        setLoading(false);
        if (!current(requester)) { setSnapshot(null); setSelected([]); }
      }
    }
  };
  const startReview = () => {
    if (!snapshot || loading || error || saving || editingId || !current(snapshot.requester)
      || snapshot.generation !== request.current) return;
    const rows = snapshot.data.courses.filter((item) => !item.reasons.length && selected.includes(item.id)).map((item) => item.row);
    if (rows.length) setReview({ ...snapshot, rows });
  };
  const undo = async () => {
    if (!receipt || !confirmUndo || undoing.current || reading.current || !foreground.current || !current(receipt.requester)) return;
    const target = receipt;
    const active = () => foreground.current && current(target.requester);
    undoing.current = true; setSaving(true); setUndoError('');
    try {
      await undoPortalReimport(props.scope, target.data, active);
      if (!current(target.requester)) return;
      setReceipt(null); setConfirmUndo(false); setNotice('已撤回這次帶入，恢復核對前的個人紀錄。');
      latest.current.onSaved(null);
    } catch (cause) {
      if (current(target.requester)) setUndoError(cause instanceof Error ? cause.message : '這次未能撤回，個人紀錄仍保留。');
    } finally { undoing.current = false; if (current(target.requester)) setSaving(false); }
  };
  const data = snapshot && current(snapshot.requester) ? snapshot.data : undefined;
  const available = data?.courses.filter((item) => !item.reasons.length) ?? [];
  const blocked = (data?.courses.length ?? 0) - available.length;
  const copy = { color: theme.colors.text, lineHeight: 23 };
  const muted = { color: theme.colors.muted, lineHeight: 22 };
  const disabled = loading || saving || !!review || !!editingId;
  return <View style={{ padding: 18, gap: 12, borderRadius: 18, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
    <View style={{ gap: 4 }}>
      <Text accessibilityRole="header" style={{ ...copy, fontSize: 18, fontWeight: '700' }}>帶入校方課表</Text>
      <Text style={muted}>讀取本人 e 校園課表，核對後存入這台裝置。儲存後可在首頁「今日」查看上課時間。</Text>
    </View>
    {connected ? <Button text={loading ? '正在讀取校方課表…' : data ? '重新讀取校方課表' : '讀取校方課表'}
      kind="outline" disabled={disabled} onPress={() => void read()} />
      : <Button text="連線學校帳號讀取課表" onPress={props.onConnect} />}
    {loading ? <ActivityIndicator accessibilityLabel="正在讀取本人校方課表" /> : null}
    {error ? <View style={{ gap: 8 }}>
      <Text accessibilityRole="alert" style={{ color: theme.colors.danger, lineHeight: 23 }}>{error}</Text>
      {data ? <Text style={muted}>本次沒有更新預覽；下面仍是上次讀取的內容。個人課表沒有因此刪除或改寫。</Text> : null}
      <Button text="重新連線學校帳號" kind="outline" disabled={disabled} onPress={props.onConnect} />
    </View> : null}
    {data ? <>
      <View style={{ gap: 4 }}>
        <Text style={{ ...copy, fontWeight: '700' }}>{data.termKey ? `${data.termKey.replace('|', ' 學年度 · 第 ')} 學期` : `來源學期：${data.sourceSemester || '未提供'}`}</Text>
        <Text style={copy}>{`本次課程合計 ${data.listedCredits} 學分 · ${data.courses.length} 筆課程`}</Text>
        <Text style={muted}>{`可核對帶入 ${available.length} 筆${blocked ? `，另有 ${blocked} 筆待補齊時間或學期` : ''}。週末與完整時間會保留；相同資料會在下一步略過。`}</Text>
      </View>
      {!data.courses.length ? <Text style={copy}>校方這次回傳 0 筆課程。請確認選課與來源學期；原有個人課表保持不變。</Text> : null}
      {data.courses.slice(0, visible).map((item) => {
        const checked = selected.includes(item.id), eligible = !item.reasons.length;
        return <View key={item.id} style={{ paddingTop: 12, gap: 5, borderTopWidth: 1, borderColor: theme.colors.border }}>
          <Pressable accessibilityRole="checkbox" accessibilityLabel={`帶入${item.course.name}，來源第 ${item.sourceIndex} 筆`}
            accessibilityState={{ checked, disabled: disabled || !eligible }} disabled={disabled || !eligible}
            onPress={() => setSelected((old) => checked ? old.filter((id) => id !== item.id) : [...old, item.id])}
            style={{ minHeight: 44, justifyContent: 'center', gap: 3 }}>
            <Text style={{ ...copy, fontWeight: '700' }}>{`${item.course.name} · ${item.course.credits} 學分`}</Text>
            <Text style={{ color: eligible ? theme.colors.accent : theme.colors.muted }}>{eligible ? checked ? '已選取帶入' : '未選取帶入' : '保留來源，待補齊'}</Text>
          </Pressable>
          <Text style={copy}>{schoolCourseTimeLabel(item.course)}</Text>
          <Text style={muted}>{[item.course.code || '課號未提供', item.course.classOffered, item.course.teacherName, item.course.location || '教室未提供'].filter(Boolean).join(' · ')}</Text>
          {item.course.timePlaceRaw ? <Text style={muted}>{`校方原文：${item.course.timePlaceRaw}`}</Text> : null}
          {editedIds.includes(item.id) ? <Text style={copy}>{`個人帶入內容：${item.row.academicYear}／${item.row.semester} · 週${'一二三四五六日'[(item.row.dayOfWeek ?? 0) - 1] || '未填'} · ${item.row.startTime && item.row.endTime ? `${item.row.startTime}–${item.row.endTime}` : '時間未提供'}。原始校方內容保留在上方。`}</Text> : null}
          {item.reasons.map((reason) => <Text key={reason} style={muted}>{reason}</Text>)}
          {!eligible && editingId !== item.id ? <Button text={`補齊這筆資料：${item.course.name}`} kind="outline" disabled={disabled || !!error}
            onPress={() => setEditingId(item.id)} /> : null}
          {editingId === item.id ? <SchoolPortalRowEditor key={item.id} row={item.row} profile="pu"
            disabled={loading || saving || !!review} onCancel={() => setEditingId(null)} onApply={(row) => {
              if (!snapshot || !current(snapshot.requester) || snapshot.generation !== request.current || reading.current || undoing.current) return;
              setSnapshot({ ...snapshot, data: { ...snapshot.data, courses: snapshot.data.courses.map((old) =>
                old.id === item.id ? { ...old, row, reasons: [] } : old) } });
              setSelected((old) => old.includes(item.id) ? old : [...old, item.id]);
              setEditedIds((old) => [...old, item.id]); setEditingId(null);
            }} /> : null}
        </View>;
      })}
      {data.courses.length > visible ? <Button text={`再顯示 ${Math.min(20, data.courses.length - visible)} 筆校方課程`} kind="outline" onPress={() => setVisible((old) => old + 20)} /> : null}
      {available.length ? <>
        <Button text={selected.length === available.length ? '取消全部選取' : '選取全部可帶入課程'} kind="outline" disabled={disabled}
          onPress={() => setSelected(selected.length === available.length ? [] : available.map((item) => item.id))} />
        <Button text={`核對並帶入 ${selected.length} 筆`} disabled={disabled || !selected.length || !!error} onPress={startReview} />
      </> : null}
      {blocked ? <Button text="開啟個人匯入補齊資料" kind="outline" disabled={disabled} onPress={props.onOpenImports} /> : null}
    </> : null}
    {receipt ? <View style={{ padding: 12, gap: 8, borderRadius: 12, backgroundColor: theme.colors.surface2 }}>
      <Text accessibilityRole="alert" style={copy}>{`已新增 ${receipt.data.added} 筆、更新 ${receipt.data.updated} 筆；相同略過 ${receipt.data.duplicates} 筆、保留原有資料 ${receipt.data.kept} 筆。`}</Text>
      {undoError ? <Text accessibilityRole="alert" style={{ color: theme.colors.danger, lineHeight: 23 }}>{undoError}</Text> : null}
      {receipt.data.batchId ? <>
        <Button text={confirmUndo ? '確認撤回這次帶入' : '撤回這次帶入'} kind="outline" disabled={disabled}
          onPress={() => confirmUndo ? void undo() : setConfirmUndo(true)} />
        {confirmUndo ? <Button text="保留資料" kind="outline" disabled={disabled} onPress={() => setConfirmUndo(false)} /> : null}
      </> : null}
    </View> : null}
    {notice ? <Text accessibilityRole="alert" style={copy}>{notice}</Text> : null}
    {review ? <SchoolPortalReimport scope={props.scope} rows={review.rows}
      isCurrent={() => current(review.requester) && review.generation === request.current}
      onCancel={() => setReview(null)} onSaved={(result) => {
        if (!current(review.requester) || review.generation !== request.current) return;
        setReceipt({ data: result, requester: review.requester });
        setConfirmUndo(false); setReview(null); setError(''); setUndoError('');
        const terms = [...new Set(review.rows.map((row) => `${row.academicYear}|${row.semester}`))];
        latest.current.onSaved(terms.length === 1 ? terms[0] : review.data.termKey);
      }} /> : null}
  </View>;
}
