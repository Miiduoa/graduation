import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { randomUUID } from 'expo-crypto';
import {
  extractSchoolPageTables, parsePersonalImport, periodLabelAt, periodProfileForSchool,
  slotIndexForLabel, validatePersonalImportRow,
  type ImportIssue, type PersonalImportRow, type SchoolPageTable,
} from '@campus/shared';
import {
  isSchoolPortalUrl, PORTAL_CAPTURE_TIMEOUT_MS, SchoolPortalCapture,
  schoolPortalFor, type SchoolPortal,
} from '@campus/shared/src/imports/schoolPortal';
import { useSchool } from '../state/school';
import { usePersonalImportScope } from '../state/personalImportScope';
import { appendPersonalImports, type PersonalImportScope } from '../services/personalImports';
import { Button } from '../ui/components';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

type Kind = 'timetable' | 'grades';
type Receipt = { added: number; duplicates: number };

export function SchoolPortalImportEntry({ onImported }: { onImported: (kind: Kind) => void }) {
  const { school } = useSchool();
  const [open, setOpen] = useState(false);
  const portal = schoolPortalFor(school.id);
  if (!portal || Platform.OS === 'web') return null;
  return <>
    <Button text="在學校網站登入並匯入（試行）" kind="outline" onPress={() => setOpen(true)} />
    {open ? <PortalSession portal={portal} onClose={() => setOpen(false)} onImported={(kind) => {
      setOpen(false); onImported(kind);
    }} /> : null}
  </>;
}

function PortalSession(props: { portal: SchoolPortal; onClose: () => void; onImported: (kind: Kind) => void }) {
  const scope = usePersonalImportScope();
  const current = useRef(scope);
  current.current = scope;
  if (!scope || scope.schoolId !== props.portal.schoolId) return (
    <Modal onRequestClose={props.onClose}>
      <SafeAreaView style={{ flex: 1, padding: 24, backgroundColor: theme.colors.bg }}>
        <Text style={{ color: theme.colors.text }}>帳號或校園狀態已變更，校務頁面已關閉。請關閉後重新開始。</Text>
        <Button text="關閉校務匯入" onPress={props.onClose} />
      </SafeAreaView>
    </Modal>
  );
  const key = JSON.stringify([scope.owner, scope.schoolId]);
  return <PortalWorkspace {...props} key={key} scope={scope} active={() =>
    current.current?.owner === scope.owner && current.current?.schoolId === scope.schoolId
  } />;
}

function PortalWorkspace({ portal, scope, active, onClose, onImported }: {
  portal: SchoolPortal; scope: PersonalImportScope; active: () => boolean;
  onClose: () => void; onImported: (kind: Kind) => void;
}) {
  const s = useThemeStyleSheet(createStyles);
  const web = useRef<WebView>(null);
  const alive = useRef(true);
  const gate = useRef(new SchoolPortalCapture(portal));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentUrl = useRef('');
  const writeLock = useRef(false);
  const readLock = useRef(false);
  const loadFailed = useRef(false);
  const approval = useRef<string | null>(null);
  const [stage, setStage] = useState<'consent' | 'browser' | 'tables' | 'review' | 'saved'>('consent');
  const [kind, setKind] = useState<Kind>('timetable');
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [host, setHost] = useState(new URL(portal.entryUrl).hostname);
  const [error, setError] = useState('');
  const [tables, setTables] = useState<SchoolPageTable[]>([]);
  const [rows, setRows] = useState<PersonalImportRow[]>([]);
  const [sourceIssues, setSourceIssues] = useState<ImportIssue[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [visible, setVisible] = useState(12);
  const [confirmed, setConfirmed] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const periodProfile = periodProfileForSchool(scope.schoolId);
  const isActive = () => alive.current && active();
  const stopRead = () => {
    gate.current.cancel(); readLock.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    alive.current = true;
    const capture = gate.current;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        capture.cancel(); readLock.current = false;
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        if (alive.current) setReading(false);
      }
    });
    return () => {
      alive.current = false; capture.cancel(); subscription.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const close = () => {
    if (writeLock.current) return;
    const exit = () => { stopRead(); onClose(); };
    if (stage === 'review' || stage === 'tables') Alert.alert('離開校務匯入？', '尚未儲存的核對內容會捨棄。', [
      { text: '繼續核對', style: 'cancel' }, { text: '離開', style: 'destructive', onPress: exit },
    ]);
    else exit();
  };
  const failBrowser = () => {
    stopRead(); loadFailed.current = true; currentUrl.current = ''; setReading(false); setLoading(true);
    setError('這個校務頁面無法載入。可重載，或關閉後使用檔案匯入；不會將連線失敗當作沒有課。');
  };
  const capture = () => {
    if (!isActive() || loading || readLock.current || !web.current || !currentUrl.current) return;
    readLock.current = true; setError(''); setReading(true);
    try {
      const script = gate.current.begin(randomUUID(), currentUrl.current);
      timer.current = setTimeout(() => {
        stopRead();
        if (isActive()) { setReading(false); setError('讀取逾時。請確認已開啟課表或成績列表，再按一次讀取。'); }
      }, PORTAL_CAPTURE_TIMEOUT_MS);
      web.current.injectJavaScript(script);
    } catch { stopRead(); setReading(false); setError('無法開始讀取，請重載學校頁面後再試。'); }
  };
  const receive = (raw: string, url: string) => {
    if (!isActive()) return;
    try {
      const html = gate.current.receive(raw, url);
      if (html === null) return;
      stopRead(); setReading(false);
      const candidates = extractSchoolPageTables(html, kind, periodProfile);
      setTables(candidates); setStage('tables'); setError('');
      currentUrl.current = '';
    } catch {
      stopRead(); setReading(false);
      setError('無法辨識這頁的課表或成績表格。請切到正確列表；圖片、跨網域框架或不支援的格式請改用檔案匯入。');
    }
  };
  const choose = (table: SchoolPageTable) => {
    try {
    const parsed = parsePersonalImport(table.text, {
      kind, schoolId: scope.schoolId, academicYear: table.suggestedTerm?.academicYear ?? '',
      semester: table.suggestedTerm?.semester ?? '', periodProfile,
      source: { type: 'paste', name: `${portal.name}校務網頁（本人核對）` },
    });
    setRows(parsed.rows);
    setSelected(new Set(parsed.rows.map((row) => row.id)));
    setSourceIssues(parsed.issues.filter((issue) => !issue.rowId || !parsed.rows.some((row) => row.id === issue.rowId)));
    approval.current = null;
    setVisible(12); setExpanded(null); setConfirmed(false); setError(''); setStage('review');
    } catch { setError('這張表格無法整理成可核對資料，請選另一張表格或改用檔案匯入。'); }
  };
  const chosen = rows.filter((row) => selected.has(row.id));
  const blocking = sourceIssues.some((issue) => issue.severity === 'error') || chosen.some((row) =>
    validatePersonalImportRow(row, { periodProfile }).some((issue) => issue.severity === 'error')
  );
  const edit = (id: string, field: keyof PersonalImportRow, value: string) => {
    if (writeLock.current) return;
    approval.current = null; setConfirmed(false); setError('');
    const periods = field === 'startPeriod' || field === 'endPeriod';
    const numeric = periods || field === 'dayOfWeek' || field === 'credits';
    const next = periods && periodProfile ? slotIndexForLabel(value, periodProfile)
      : numeric ? (value.trim() ? Number(value) : undefined) : value;
    setRows((existing) => existing.map((row) => row.id === id ? { ...row, [field]: next } : row));
  };
  const save = async () => {
    if (!isActive() || writeLock.current || !confirmed || approval.current !== JSON.stringify(chosen) || !chosen.length || blocking) return;
    writeLock.current = true; setSaving(true); setError('');
    try {
      const result = await appendPersonalImports(scope, chosen, isActive);
      if (isActive()) { setReceipt({ added: result.added, duplicates: result.duplicates }); setStage('saved'); setRows([]); setTables([]); }
    } catch {
      if (isActive()) setError('這次沒有確認儲存成功，請保留核對內容。資料衝突、裝置儲存空間或既有紀錄異常需先處理；重試會沿用重複檢查。');
    } finally { writeLock.current = false; if (isActive()) setSaving(false); }
  };
  const fields: Array<[keyof PersonalImportRow, string]> = [
    ['title', '課程名稱'], ['academicYear', '學年度'], ['semester', '學期'], ['courseCode', '課號'],
    ['className', '班別'], ['teacher', '教師'], ['credits', '學分'],
    ...(kind === 'grades' ? [['grade', '成績']] : [
      ['dayOfWeek', '星期（1–7）'], ['startPeriod', '開始節次'], ['endPeriod', '結束節次'],
      ['startTime', '開始時間 HH:mm'], ['endTime', '結束時間 HH:mm'], ['location', '教室'], ['periodLabel', '原始節次'],
    ]) as Array<[keyof PersonalImportRow, string]>,
  ];
  return <Modal animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
    <SafeAreaView style={s.page}>
      <View style={s.header}>
        <Text accessibilityRole="header" style={s.title}>從{portal.name}取得資料</Text>
        <Button text="關閉校務匯入" kind="outline" disabled={saving} onPress={close} />
      </View>
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      {stage === 'browser' ? <>
        <Text style={s.domain}>學校網頁 · {host}</Text>
        <WebView
          testID="school-portal-webview" ref={web} source={{ uri: portal.entryUrl }} style={s.web}
          originWhitelist={['*']} incognito cacheEnabled={false} sharedCookiesEnabled={false}
          thirdPartyCookiesEnabled={false} saveFormDataDisabled javaScriptEnabled domStorageEnabled
          allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
          mixedContentMode="never" javaScriptCanOpenWindowsAutomatically={false} setSupportMultipleWindows
          onShouldStartLoadWithRequest={(request) => {
            if (isSchoolPortalUrl(portal, request.url)) return true;
            stopRead(); setReading(false); setError('已阻擋離開目前學校網域的跳轉。此登入方式可能不支援 App 內瀏覽，請改用檔案匯入。');
            return false;
          }}
          onOpenWindow={() => setError('這個功能需要另外開啟視窗，目前不支援。請改用學校可在同一頁開啟的列表或檔案匯入。')}
          onLoadStart={() => { stopRead(); loadFailed.current = false; currentUrl.current = ''; setLoading(true); setReading(false); }}
          onLoadEnd={(event) => {
            if (loadFailed.current) return;
            if (isSchoolPortalUrl(portal, event.nativeEvent.url)) {
              currentUrl.current = event.nativeEvent.url; setHost(new URL(event.nativeEvent.url).hostname); setLoading(false);
            } else { web.current?.stopLoading(); failBrowser(); }
          }}
          onNavigationStateChange={(navigation) => {
            if (!isSchoolPortalUrl(portal, navigation.url)) { web.current?.stopLoading(); failBrowser(); setStage('consent'); return; }
            setCanBack(navigation.canGoBack);
            if (currentUrl.current && currentUrl.current !== navigation.url) { stopRead(); currentUrl.current = ''; setReading(false); }
          }}
          onMessage={(event) => receive(event.nativeEvent.data, event.nativeEvent.url)}
          onError={failBrowser} onHttpError={failBrowser}
          onContentProcessDidTerminate={failBrowser} onRenderProcessGone={failBrowser}
        />
        <View style={s.toolbar}>
          <Button text="上一頁" kind="outline" disabled={!canBack || reading} onPress={() => web.current?.goBack()} />
          <Button text="重載" kind="outline" disabled={reading} onPress={() => { stopRead(); setError(''); web.current?.reload(); }} />
          <Button text={reading ? '讀取中…' : `讀取目前${kind === 'timetable' ? '課表' : '成績'}`} disabled={loading || reading} onPress={capture} />
        </View>
      </> : <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {stage === 'consent' ? <>
          <Text style={s.step}>1 選擇資料 → 2 登入學校 → 3 核對儲存</Text>
          <Text style={s.body}>接下來開啟學校自己的網站。帳號、密碼與驗證碼由你在校方頁面輸入；本功能不代填、不記錄登入欄位。只有按下「讀取」才取得頁面上的表格文字。</Text>
          <Text style={s.domain}>{new URL(portal.entryUrl).hostname}</Text>
          <View style={s.toolbar}>
            <Button text={kind === 'timetable' ? '已選：課表' : '課表'} onPress={() => setKind('timetable')} />
            <Button text={kind === 'grades' ? '已選：成績與學分' : '成績與學分'} onPress={() => setKind('grades')} />
          </View>
          <Text style={s.body}>這是本人資料匯入，不是校方單一登入或學籍認證。儲存前可以修正、排除資料；若已開啟個人資料同步，新增紀錄會沿用原設定。</Text>
          <Text style={s.note}>試行支援 HTML 表格及可讀取的同網域框架。部分學校禁止內嵌登入、需要另開視窗或使用跨網域框架時，仍須改用檔案匯入。關閉後不承諾保留登入狀態。</Text>
          <Button text="同意並開啟學校網站" onPress={() => { setStage('browser'); setLoading(true); setError(''); }} />
        </> : null}
        {stage === 'tables' ? <>
          <Text style={s.step}>已取得 {tables.length} 張候選表格，尚未儲存</Text>
          {tables.map((table) => <Button key={table.id} text={table.label} kind="outline" onPress={() => choose(table)} />)}
          <Button text="重新開啟學校頁面" kind="outline" onPress={() => { setTables([]); setStage('browser'); setLoading(true); }} />
        </> : null}
        {stage === 'review' ? <>
          <Text style={s.step}>核對 {rows.length} 筆 · 已選 {chosen.length} 筆</Text>
          <Text style={s.note}>請確認學年度、學期與上課時間。未確認的欄位不會由系統猜測；有錯誤的資料需先修正或取消選取。</Text>
          {sourceIssues.map((issue, i) => <Text key={`${issue.code}:${i}`} style={s.error}>{issue.message}</Text>)}
          {rows.slice(0, visible).map((row) => {
            const issues = validatePersonalImportRow(row, { periodProfile });
            return <View key={row.id} style={s.card}>
              <Text style={s.rowTitle}>{row.title || '課程名稱待填'}</Text>
              <Text style={s.note}>{row.academicYear || '學年度待填'}／{row.semester || '學期待填'} · {kind === 'grades' ? `${row.credits ?? '?'} 學分 · ${row.grade || '成績待填'}` : `星期 ${row.dayOfWeek ?? '?'} · ${row.location || '教室未填'}`}</Text>
              {issues.map((issue, i) => <Text key={`${issue.code}:${i}`} style={s.error}>{issue.message}</Text>)}
              <Button text={`${selected.has(row.id) ? '取消選取' : '選取'} ${row.title}`} disabled={saving} kind="outline" onPress={() => {
                approval.current = null; setConfirmed(false); setSelected((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; });
              }} />
              <Button text={expanded === row.id ? '收起欄位' : `修正 ${row.title}`} kind="outline" disabled={saving} onPress={() => setExpanded(expanded === row.id ? null : row.id)} />
              {expanded === row.id ? fields.map(([field, label]) => <View key={field}>
                <Text style={s.note}>{label}</Text>
                <TextInput accessibilityLabel={`${row.title}：${label}`} style={s.input} editable={!saving} maxLength={200} autoCorrect={false}
                  value={periodProfile && (field === 'startPeriod' || field === 'endPeriod') && row[field]
                    ? periodLabelAt(Number(row[field]), periodProfile) : row[field] == null ? '' : String(row[field])}
                  onChangeText={(value) => edit(row.id, field, value)} />
              </View>) : null}
            </View>;
          })}
          {visible < rows.length ? <Button text={`顯示更多（還有 ${rows.length - visible} 筆）`} kind="outline" onPress={() => setVisible((count) => count + 20)} /> : null}
          {!confirmed ? <Button text={`核對並儲存 ${chosen.length} 筆`} disabled={blocking || !chosen.length || saving} onPress={() => { approval.current = JSON.stringify(chosen); setConfirmed(true); }} /> : <View style={s.card}>
            <Text style={s.body}>將 {chosen.length} 筆加入目前帳號的{portal.name}個人資料，不修改學校紀錄。重複資料會檢查，衝突不會直接覆寫。</Text>
            <Button text="確認加入我的資料" disabled={saving} loading={saving} onPress={() => void save()} />
            <Button text="返回核對" kind="outline" disabled={saving} onPress={() => { approval.current = null; setConfirmed(false); }} />
          </View>}
          <Button text="重新選擇表格" kind="outline" disabled={saving} onPress={() => { setStage('tables'); setRows([]); setConfirmed(false); }} />
        </> : null}
        {stage === 'saved' && receipt ? <>
          <Text accessibilityRole="header" style={s.title}>已加入個人資料</Text>
          <Text style={s.body}>新增 {receipt.added} 筆，略過 {receipt.duplicates} 筆重複資料。</Text>
          <Text style={s.note}>這是你確認的個人紀錄，不代表校方認證。可在匯入紀錄中編輯或撤銷本次新增。</Text>
          <Button text="查看我的匯入紀錄" onPress={() => onImported(kind)} />
        </> : null}
      </ScrollView>}
    </SafeAreaView>
  </Modal>;
}

const createStyles = () => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.bg },
  header: { padding: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  title: { color: theme.colors.text, fontSize: 19, fontWeight: '700', lineHeight: 28 },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  step: { color: theme.colors.accent, fontSize: 14, fontWeight: '600', lineHeight: 23 },
  body: { color: theme.colors.text, fontSize: 15, lineHeight: 25 },
  note: { color: theme.colors.muted, fontSize: 13, lineHeight: 21 },
  domain: { color: theme.colors.text, backgroundColor: theme.colors.focusSurface, padding: 12, fontSize: 13 },
  error: { color: theme.colors.text, backgroundColor: theme.colors.focusSurface, padding: 12, fontSize: 13, lineHeight: 21 },
  web: { flex: 1 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  card: { borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, borderRadius: 12, padding: 16, gap: 10 },
  rowTitle: { color: theme.colors.text, fontWeight: '600', fontSize: 16, lineHeight: 24 },
  input: { color: theme.colors.text, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, minHeight: 44, padding: 12 },
});
