import React, { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { ActivityIndicator, AppState, Modal, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import { randomUUID } from 'expo-crypto';
import {
  extractSchoolPageTables, parsePersonalImport, periodProfileForSchool,
  personalImportErrorMessage,
  type SchoolPageTable, type PersonalImportRow, type ImportIssue,
} from '@campus/shared';
import { useSchool } from '../state/school';
import { usePersonalImportScope } from '../state/personalImportScope';
import { appendPersonalImports, undoLastPersonalImport, type PersonalImportScope } from '../services/personalImports';
import {
  schoolPortalFor, schoolPortalOrigin, schoolPortalCaptureScript, readPortalCapture,
  PORTAL_CAPTURE_TIMEOUT, type SchoolPortal, type PortalCaptureRequest,
} from '@campus/shared/src/imports/portalCapture';
import { Button } from '../ui/components';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';
import { portalReviewIssues, reconcilePortalRowIssues } from '@campus/shared/src/imports/portalRowReview';
import { SchoolPortalRowEditor } from './SchoolPortalRowEditor';
import { SchoolPortalTablePicker } from './SchoolPortalTablePicker';
import { parseSchoolTableBatch, type SchoolTableChoice, type SchoolTableBatch } from '@campus/shared/src/imports/schoolTableBatch';
import { SchoolPortalReimport } from './SchoolPortalReimport';
import { undoPortalReimport, type PortalReimportReceipt } from '../services/portalReimport';

type Kind = 'timetable' | 'grades';
type Stage = 'consent' | 'browse' | 'choose' | 'review' | 'done';
type CloseRequest = MutableRefObject<(() => void) | null>;
type Selection = { name: string; tables: SchoolPageTable[]; partial: boolean };
function usePortalStyles() {
  useThemeMode();
  return {
    copy: { color: theme.colors.text, lineHeight: 23 },
    input: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, padding: 12, color: theme.colors.text, backgroundColor: theme.colors.surface },
  };
}
const captureErrors = {
  'too-large': '這頁表格過大，未帶入部分資料。請縮小查詢範圍，或改用檔案匯入。',
  'no-table': '目前頁面沒有可讀表格。請登入並開啟課表或成績列表；圖片或跨來源內嵌頁請改用檔案匯入。',
  unavailable: '未能讀取這個頁面。可以重新載入，或改用檔案匯入，現有紀錄沒有變更。',
};

/** The account hooks and WebView are mounted only after the explicit entry action. */
export function SchoolPortalImportEntry({ onOpenRecords, disabled = false }: {
  onOpenRecords(kind: Kind): void; disabled?: boolean;
}) {
  const { school } = useSchool();
  const [openedSchool, setOpenedSchool] = useState<string | null>(null);
  const closeRequest = useRef<(() => void) | null>(null);
  const close = useCallback(() => { closeRequest.current = null; setOpenedSchool(null); }, []);
  const portal = schoolPortalFor(school.id);
  useEffect(() => { close(); }, [school.id, disabled, close]);
  if (!portal || Platform.OS === 'web') return null;
  return <>
    <Button text="在 App 內開啟校務網站匯入" disabled={disabled} onPress={() => setOpenedSchool(school.id)} />
    {openedSchool === school.id && !disabled ? (
      <Modal visible animationType="slide" onRequestClose={() => (closeRequest.current ?? close)()}>
        <PortalSession portal={portal} onClose={close} closeRequest={closeRequest}
          onOpenRecords={(kind) => { close(); onOpenRecords(kind); }} />
      </Modal>
    ) : null}
  </>;
}
function PortalSession({ portal, onClose, onOpenRecords, closeRequest }: {
  portal: SchoolPortal; onClose(): void; onOpenRecords(kind: Kind): void; closeRequest: CloseRequest;
}) {
  const scope = usePersonalImportScope();
  const { copy } = usePortalStyles();
  const current = useRef(scope);
  current.current = scope;
  const first = useRef<PersonalImportScope | null>(scope);
  if (!first.current && scope) first.current = scope;
  useFocusEffect(useCallback(() => () => onClose(), [onClose]));
  const isScopeCurrent = useCallback((expected: PersonalImportScope) => current.current?.owner === expected.owner && current.current?.schoolId === expected.schoolId, []);
  const same = scope && first.current && scope.owner === first.current.owner &&
    scope.schoolId === first.current.schoolId && scope.schoolId === portal.schoolId;
  if (!same) return <SafeAreaView style={{ flex: 1, padding: 20, backgroundColor: theme.colors.bg }}>
    <Text style={copy}>帳號或學校正在變更，已停止本次匯入。請關閉後重新開始。</Text>
    <Button text="關閉校務匯入" onPress={onClose} />
  </SafeAreaView>;
  return <PortalFlow key={`${scope.owner}:${scope.schoolId}`} portal={portal} scope={scope} isScopeCurrent={isScopeCurrent}
    onClose={onClose} onOpenRecords={onOpenRecords} closeRequest={closeRequest} />;
}
function PortalFlow({ portal, scope, isScopeCurrent, onClose, onOpenRecords, closeRequest }: {
  portal: SchoolPortal; scope: PersonalImportScope; isScopeCurrent(scope: PersonalImportScope): boolean;
  onClose(): void; onOpenRecords(kind: Kind): void; closeRequest: CloseRequest;
}) {
  const { copy, input } = usePortalStyles();
  const [stage, setStage] = useState<Stage>('consent');
  const stageRef = useRef<Stage>('consent');
  const moveTo = (next: Stage) => { stageRef.current = next; setStage(next); };
  const [kind, setKind] = useState<Kind>('timetable');
  const [url, setUrl] = useState(portal.url);
  const source = useMemo(() => ({ uri: url }), [url]);
  const [browserEpoch, setBrowserEpoch] = useState(0);
  const currentUrl = useRef(portal.url);
  const [origin, setOrigin] = useState(new URL(portal.url).origin);
  const [loaded, setLoaded] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [browserError, setBrowserError] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tablePicker, setTablePicker] = useState(false);
  const [tableChoices, setTableChoices] = useState<SchoolTableChoice[]>([]);
  const [tableBatch, setTableBatch] = useState<{ choices: SchoolTableChoice[]; tables: SchoolTableBatch['tables'] } | null>(null);
  const [text, setText] = useState('');
  const [year, setYear] = useState('');
  const [semester, setSemester] = useState('');
  const [rows, setRows] = useState<PersonalImportRow[]>([]);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = useRef<string | null>(null);
  const [corrected, setCorrected] = useState<Set<string>>(new Set());
  const [confirmReparse, setConfirmReparse] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState(20);
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<{ added: number; duplicates: number; batchId: string | null; reimport?: PortalReimportReceipt } | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const reconcileLock = useRef(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [undone, setUndone] = useState(false);
  const [confirmRead, setConfirmRead] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const hasDraft = useRef(false);
  const resumeStage = useRef<'choose' | 'review'>('choose');
  const alive = useRef(true);
  const foreground = useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const writeLock = useRef(false);
  const web = useRef<WebView>(null);
  const pending = useRef<PortalCaptureRequest | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profile = periodProfileForSchool(scope.schoolId);
  const active = () => alive.current && foreground.current && isScopeCurrent(scope);
  const stop = useCallback(() => {
    pending.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setBusy(false);
  }, []);
  const askClose = useCallback(() => {
    if (writeLock.current || reconcileLock.current) return;
    stop(); setConfirmRead(false);
    if (hasDraft.current) setConfirmClose(true);
    else onClose();
  }, [onClose, stop]);
  useEffect(() => {
    closeRequest.current = askClose;
    return () => { if (closeRequest.current === askClose) closeRequest.current = null; };
  }, [askClose, closeRequest]);
  useEffect(() => {
    alive.current = true;
    const listener = AppState.addEventListener('change', (state) => {
      foreground.current = state === 'active';
      if (state !== 'active') { stop(); setConfirmRead(false); }
    });
    return () => {
      alive.current = false;
      pending.current = null;
      if (timer.current) clearTimeout(timer.current);
      listener.remove();
    };
  }, [stop]);
  const clearDraft = () => {
    reconcileLock.current = false; setReconciling(false);
    hasDraft.current = false; resumeStage.current = 'choose';
    setSelection(null); setText(''); setYear(''); setSemester('');
    setTablePicker(false); setTableChoices([]); setTableBatch(null);
    setRows([]); setIssues([]); setSelected(new Set()); setVisible(20);
    editing.current = null; setEditingId(null); setCorrected(new Set()); setConfirmReparse(false);
    setConfirmRead(false); setConfirmClose(false);
  };
  // Only an explicit restart creates a new incognito browser. Review keeps it mounted.
  const resetBrowser = () => {
    if (writeLock.current || reconcileLock.current || !active()) return;
    stop(); setError(''); setBrowserError(''); setLoaded(false); setCanBack(false);
    currentUrl.current = portal.url; setOrigin(new URL(portal.url).origin);
    setUrl(portal.url); setConfirmRead(false); moveTo('browse');
    setBrowserEpoch((value) => value + 1);
  };
  const returnToBrowser = () => {
    if (writeLock.current || reconcileLock.current || editing.current || !active()) return;
    stop(); setError(''); setConfirmRead(false); moveTo('browse');
  };
  const resumeDraft = () => {
    if (writeLock.current || reconcileLock.current || !active() || !hasDraft.current) return;
    stop(); setError(''); setConfirmRead(false); moveTo(resumeStage.current);
  };
  const continueImport = (nextKind: Kind) => {
    if (writeLock.current || reconcileLock.current || !active() || stageRef.current !== 'done') return;
    stop(); clearDraft(); setReceipt(null); setConfirmUndo(false); setUndone(false);
    setKind(nextKind); setError(''); moveTo('browse');
  };
  const read = (replaceDraft = false) => {
    if (stageRef.current !== 'browse' || !loaded || pending.current || !active() || writeLock.current) return;
    if (hasDraft.current && !replaceDraft) { setConfirmRead(true); return; }
    const currentOrigin = schoolPortalOrigin(portal, currentUrl.current);
    if (!currentOrigin || !web.current) return;
    // Keep the previous draft until a new table has actually been parsed successfully.
    const request = { id: randomUUID(), origin: currentOrigin };
    pending.current = request; setBusy(true); setError(''); setConfirmRead(false);
    timer.current = setTimeout(() => {
      if (pending.current !== request) return;
      stop(); if (active()) setError('讀取逾時，未匯入任何資料。請確認校務頁面已載入，再試一次。');
    }, PORTAL_CAPTURE_TIMEOUT);
    try { web.current.injectJavaScript(schoolPortalCaptureScript(request)); }
    catch { stop(); setError(captureErrors.unavailable); }
  };
  const receive = (eventUrl: string, data: string) => {
    if (!active() || stageRef.current !== 'browse') return;
    const result = readPortalCapture(portal, pending.current, eventUrl, currentUrl.current, data);
    if (result.status === 'ignored') return;
    stop();
    if (result.status === 'error') { setError(captureErrors[result.reason]); return; }
    try {
      const tables = extractSchoolPageTables(result.value.html, kind, profile);
      clearDraft(); hasDraft.current = true;
      setSelection({ name: `${portal.label} · ${result.value.origin}`, tables, partial: result.value.blockedFrames > 0 });
      setError(''); moveTo('choose');
    } catch { setError('讀到表格，但未辨識出目前資料類型。請切到課表／成績列表，或改用檔案匯入。'); }
  };
  const prepareTableBatch = () => {
    if (!selection || stageRef.current !== 'choose' || !active() || writeLock.current || reconcileLock.current || confirmClose) return;
    try {
      const prepared = parseSchoolTableBatch(selection.tables, tableChoices, {
        kind, schoolId: scope.schoolId, periodProfile: profile, source: { type: 'paste', name: selection.name },
      });
      setTableBatch({ choices: tableChoices.map((choice) => ({ ...choice })), tables: prepared.tables });
      setText(''); setYear(''); setSemester(''); setCorrected(new Set()); setConfirmReparse(false);
      setRows(prepared.rows); setIssues(prepared.issues); setSelected(new Set(prepared.rows.map((row) => row.id)));
      setVisible(20); setError(''); resumeStage.current = 'review'; moveTo('review');
    } catch (err) { setError(personalImportErrorMessage(err, '無法整理所選表格，尚未儲存任何資料。')); }
  };
  const preview = (discardCorrections = false) => {
    if (writeLock.current || reconcileLock.current || editing.current || !active()) return;
    if (corrected.size && !discardCorrections) { setConfirmReparse(true); return; }
    setConfirmReparse(false); setCorrected(new Set());
    try {
      const parsed = tableBatch && selection ? parseSchoolTableBatch(selection.tables, tableBatch.choices, {
        kind, schoolId: scope.schoolId, periodProfile: profile, source: { type: 'paste', name: selection.name },
      }) : parsePersonalImport(text, {
        kind, schoolId: scope.schoolId, academicYear: year, semester,
        periodProfile: profile, source: { type: 'paste', name: selection?.name },
      });
      setRows(parsed.rows); setIssues(parsed.issues);
      setSelected(new Set(parsed.rows.map((row) => row.id))); setVisible(20);
      setError(parsed.rows.length ? '' : '沒有可匯入資料。請修正表格文字後再整理。');
    } catch (err) { setRows([]); setError(personalImportErrorMessage(err, '無法整理這份表格。')); }
  };
  const chosen = rows.filter((row) => selected.has(row.id));
  const reviewIssues = useMemo(() => portalReviewIssues(rows, issues, profile), [rows, issues, profile]);
  const errors = reviewIssues.filter((issue) => issue.severity === 'error' && (!issue.rowId || selected.has(issue.rowId)));
  const invalidIds = new Set(reviewIssues.filter((issue) => issue.severity === 'error' && issue.rowId).map((issue) => issue.rowId!));
  const globalErrors = reviewIssues.some((issue) => issue.severity === 'error' && !issue.rowId);
  const beginEdit = (id: string) => {
    if (writeLock.current || reconcileLock.current || editing.current || !active() || confirmClose) return;
    editing.current = id; setEditingId(id); setError('');
  };
  const cancelEdit = () => { editing.current = null; setEditingId(null); };
  const applyEdit = (next: PersonalImportRow) => {
    if (writeLock.current || reconcileLock.current || !active() || editing.current !== next.id || confirmClose) return;
    const previous = rows.find((row) => row.id === next.id);
    if (!previous || previous.schoolId !== next.schoolId || previous.kind !== next.kind) return;
    setRows((old) => old.map((row) => row.id === next.id ? next : row));
    setIssues((old) => reconcilePortalRowIssues(old, previous, next, profile));
    setCorrected((old) => new Set([...old, next.id])); cancelEdit();
  };
  const selectRows = (mode: 'all' | 'none' | 'valid') => {
    if (writeLock.current || reconcileLock.current || editing.current || !active() || confirmClose) return;
    if (mode === 'valid' && globalErrors) return;
    setSelected(new Set(rows.filter((row) => mode === 'all' || (mode === 'valid' && !invalidIds.has(row.id))).map((row) => row.id)));
  };
  const beginReimport = () => {
    if (writeLock.current || reconcileLock.current || editing.current || !active() || !chosen.length || errors.length || confirmClose || confirmReparse) return;
    reconcileLock.current = true; setReconciling(true);
  };
  const save = async () => {
    if (writeLock.current || reconcileLock.current || editing.current || !active() || !chosen.length || errors.length || confirmClose || confirmReparse) return;
    writeLock.current = true; setSaving(true); setError('');
    try {
      const result = await appendPersonalImports(scope, chosen, active);
      if (!active()) return;
      setReceipt({ added: result.added, duplicates: result.duplicates,
        batchId: result.added ? result.ledger.batches[result.ledger.batches.length - 1]?.id ?? null : null });
      clearDraft(); moveTo('done');
    } catch (err) { if (active()) setError(personalImportErrorMessage(err, '儲存未完成，核對內容仍保留，可重試。')); }
    finally { writeLock.current = false; if (alive.current) setSaving(false); }
  };
  const undo = async () => {
    if (!confirmUndo || !receipt?.batchId || writeLock.current || reconcileLock.current || !active()) return;
    writeLock.current = true; setSaving(true); setError('');
    try {
      if (receipt.reimport) await undoPortalReimport(scope, receipt.reimport, active);
      else await undoLastPersonalImport(scope, receipt.batchId, active);
      if (active()) setUndone(true);
    }
    catch (err) { if (active()) setError(personalImportErrorMessage(err, '撤回未完成，請到匯入紀錄核對。')); }
    finally { writeLock.current = false; if (alive.current) setSaving(false); }
  };
  const field = (label: string, value: string, change: (next: string) => void, multiline = false) => (
    <View style={{ gap: 6 }}><Text style={copy}>{label}</Text><TextInput accessibilityLabel={label}
      style={[input, multiline ? { minHeight: 120, textAlignVertical: 'top' } : {}]} value={value}
      multiline={multiline} editable={!saving && !editingId && !corrected.size} maxLength={multiline ? 100_000 : 32} autoCorrect={false}
      onChangeText={(next) => { if (writeLock.current || reconcileLock.current || editing.current || corrected.size) return; change(next); setRows([]); setIssues([]); }} /></View>
  );
  const visibleError = error || (stage === 'browse' ? browserError : '');
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
    <View style={{ padding: 16, gap: 8, borderBottomWidth: 1, borderColor: theme.colors.border }}>
      <Text accessibilityRole="header" style={{ ...copy, fontSize: 19, fontWeight: '700' }}>{`${portal.label} · 本人資料匯入`}</Text>
      <Text style={{ color: theme.colors.muted }}>{stage === 'browse' ? origin : '登入校方網站、選擇表格、核對儲存'}</Text>
      <Button text="關閉校務匯入" kind="outline" disabled={saving} onPress={askClose} />
      {confirmClose ? <View style={{ gap: 8 }}>
        <Text accessibilityRole="alert" style={copy}>這份表格尚未儲存。關閉會捨棄目前草稿與校務網頁，已匯入的紀錄不受影響。</Text>
        <Button text="繼續核對" onPress={() => setConfirmClose(false)} />
        <Button text="放棄未儲存資料並關閉" kind="outline" disabled={saving} onPress={() => { if (!writeLock.current) onClose(); }} />
      </View> : null}
      {visibleError ? <Text accessibilityRole="alert" style={copy}>{visibleError}</Text> : null}
    </View>
    {/* A stable tree position retains the browser during review; it is never mounted before consent. */}
    {stage !== 'consent' ? <View testID="school-portal-browser-container"
      style={{ flex: 1, display: stage === 'browse' ? 'flex' : 'none' }}
      pointerEvents={stage === 'browse' ? 'auto' : 'none'} accessibilityElementsHidden={stage !== 'browse'}
      importantForAccessibility={stage === 'browse' ? 'auto' : 'no-hide-descendants'}>
      <View style={{ padding: 12, gap: 8 }}>
        <Text style={copy}>{`請自行登入，開啟本人的${kind === 'grades' ? '成績' : '課表'}列表，再按讀取。登入成功不等於匯入完成。`}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button text="回上一頁" kind="outline" disabled={!canBack || busy} onPress={() => { stop(); setLoaded(false); web.current?.goBack(); }} />
          <Button text="重新載入入口" kind="outline" disabled={busy} onPress={resetBrowser} />
        </View>
        <Button text={busy ? '正在讀取表格…' : '讀取這頁表格'} disabled={!loaded || busy || confirmClose} onPress={() => read()} />
        {hasDraft.current ? <Button text="繼續核對未儲存表格" kind="outline" onPress={resumeDraft} /> : null}
        {confirmRead ? <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={copy}>重新讀取成功後會取代未儲存的草稿；讀取失敗則保留原稿。</Text>
          <Button text="讀取新表格並取代草稿" onPress={() => read(true)} />
          <Button text="保留原稿" kind="outline" onPress={() => setConfirmRead(false)} />
        </View> : null}
        {!loaded ? <ActivityIndicator accessibilityLabel="正在載入校務頁面" /> : null}
      </View>
      {/* Intercept every scheme here: an unmatched originWhitelist entry otherwise opens the OS browser. */}
      <WebView key={browserEpoch} testID="school-portal-browser" ref={web} source={source} style={{ flex: 1 }}
        incognito cacheEnabled={false} sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
        allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never" javaScriptCanOpenWindowsAutomatically={false} setSupportMultipleWindows
        geolocationEnabled={false} allowsBackForwardNavigationGestures={false} originWhitelist={['*']}
        onShouldStartLoadWithRequest={(request) => {
          if (stageRef.current !== 'browse' || !active()) return false;
          const allowed = !!schoolPortalOrigin(portal, request.url);
          if (!allowed) { stop(); setBrowserError('已阻止離開此校園的網站。外部驗證或下載請改用系統瀏覽器與檔案匯入。'); }
          return allowed;
        }}
        onNavigationStateChange={(state) => {
          const allowed = schoolPortalOrigin(portal, state.url);
          if (!allowed) { stop(); setLoaded(false); return; }
          if (currentUrl.current !== state.url) stop();
          currentUrl.current = state.url; setOrigin(allowed); setCanBack(state.canGoBack);
        }}
        onLoadStart={() => { stop(); setLoaded(false); }}
        onLoad={() => { setLoaded(!!schoolPortalOrigin(portal, currentUrl.current)); setBrowserError(''); }}
        onError={() => { stop(); setLoaded(false); setBrowserError('校方頁面未能載入。請檢查網路後重新載入，或改用檔案匯入。'); }}
        onHttpError={() => { stop(); setLoaded(false); setBrowserError('校方頁面回傳錯誤，未進行匯入。'); }}
        onContentProcessDidTerminate={() => { stop(); setLoaded(false); setBrowserError('校務瀏覽器已中斷，請重新載入入口。'); }}
        onRenderProcessGone={() => { stop(); setLoaded(false); setBrowserError('校務瀏覽器已中斷，請重新載入入口。'); }}
        onOpenWindow={(event) => {
          if (stageRef.current !== 'browse' || !active()) return;
          const target = event.nativeEvent.targetUrl;
          if (!schoolPortalOrigin(portal, target)) { setBrowserError('新視窗不屬於此校園，未開啟。'); return; }
          stop(); setLoaded(false); currentUrl.current = target; setUrl(target);
        }}
        onFileDownload={() => setBrowserError('此頁提供下載檔案，請使用系統瀏覽器下載後，改從檔案匯入。')}
        onMessage={(event) => receive(event.nativeEvent.url, event.nativeEvent.data)} />
    </View> : null}
    {stage !== 'browse' ? <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
      {stage === 'consent' ? <>
        <Text style={copy}>你會在校方網站登入。此匯入功能不擷取密碼欄位、Cookie 或網站儲存內容，只在你按下「讀取這頁表格」後帶出可見表格文字。</Text>
        <Text style={copy}>這是網頁輔助匯入，不是跨校自動登入或背景同步。網站若要求驗證碼、多因素驗證或不接受內嵌瀏覽器，請自行完成驗證或改用檔案匯入。</Text>
        <Text style={copy}>只匯入你有權使用的資料；讀取內容仍須核對，不會成為校方認證的修課或成績證明。</Text>
        <Text style={copy}>核對與連續匯入期間保留同一個校務瀏覽器，不與外部瀏覽器共用登入 Cookie；關閉、離開畫面或切換帳號／校園會卸載頁面。校方仍可能要求重新登入，不同手機的網站相容性仍需驗證。</Text>
        <Text style={copy}>{`校方網址：${portal.url}`}</Text>
        <Button text={kind === 'timetable' ? '已選課表' : '改為課表'} kind="outline" onPress={() => setKind('timetable')} />
        <Button text={kind === 'grades' ? '已選成績' : '改為成績'} kind="outline" onPress={() => setKind('grades')} />
        <Button text="同意並開啟校方網站" onPress={resetBrowser} />
      </> : null}
      {selection?.partial ? <Text accessibilityRole="alert" style={copy}>部分內嵌頁面無法讀取；下列資料可能不完整，請逐筆與校方頁面核對。</Text> : null}
      {stage === 'choose' && selection ? <>
        <Text style={copy}>{`找到 ${selection.tables.length} 張表格。選擇本人的資料，接著核對欄位；目前尚未儲存。`}</Text>
        {tablePicker ? <SchoolPortalTablePicker tables={selection.tables} choices={tableChoices}
          disabled={saving || confirmClose} onChange={setTableChoices} onContinue={prepareTableBatch}
          onCancel={() => setTablePicker(false)} /> : <>
          {selection.tables.length > 1 ? <Button text="一次核對多張表格" disabled={confirmClose} onPress={() => setTablePicker(true)} /> : null}
          {selection.tables.map((table) => <Button key={table.id} text={table.label} kind="outline" onPress={() => {
            setTableBatch(null);
            setText(table.text); setYear(table.suggestedTerm?.academicYear ?? ''); setSemester(table.suggestedTerm?.semester ?? '');
            setRows([]); setIssues([]); setSelected(new Set()); setError(''); resumeStage.current = 'review'; moveTo('review');
          }} />)}
        </>}
        <Button text="返回校方頁面" kind="outline" onPress={returnToBrowser} />
      </> : null}
      {stage === 'review' ? <>
        <Text style={copy}>{tableBatch
          ? `已整理 ${tableBatch.tables.length} 張表格；各列保留自己的學期與來源。這只涵蓋本次選取的表格，不代表歷年資料完整。`
          : '先確認學期及表格文字，再整理成預覽。修改文字後須重新整理；原有紀錄不會被覆蓋。'}</Text>
        <Button text="回校方頁面核對" kind="outline" disabled={saving || !!editingId} onPress={returnToBrowser} />
        {tableBatch ? tableBatch.tables.map((table) => <Text key={table.id} style={copy}>{`${table.label} · 已整理 ${table.rowCount} 筆`}</Text>) : <>
          {field('學年度', year, setYear)}{field('學期', semester, setSemester)}
          {field('校務表格文字（可修正）', text, setText, true)}
        </>}
        <Button text="整理並核對匯入內容" disabled={saving || !!editingId || (!tableBatch && !text.trim())} onPress={() => preview()} />
        {corrected.size ? <Text style={copy}>{`已逐筆修正 ${corrected.size} 筆。原始文字暫時鎖定，避免覆蓋修正；需要重整原文時請按上方整理按鈕確認。`}</Text> : null}
        {confirmReparse ? <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={copy}>重新整理會以原始表格取代逐筆修正及選列；尚未儲存的修正不會保留。</Text>
          <Button text="放棄逐筆修正並重新整理" disabled={saving || !!editingId} onPress={() => preview(true)} />
          <Button text="保留逐筆修正" kind="outline" onPress={() => setConfirmReparse(false)} />
        </View> : null}
        {rows.length ? <>
          <Text style={copy}>{`預覽 ${rows.length} 筆，選取 ${chosen.length} 筆。未顯示的列仍會保留；請核對學校、學期、節次與成績。`}</Text>
          <Text style={copy}>{`待修正 ${invalidIds.size} 筆；可直接修正欄位，不必改寫整段文字。排除的資料不會被匯入。`}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button text="全選資料" kind="outline" disabled={saving || !!editingId} onPress={() => selectRows('all')} />
            <Button text="全部取消" kind="outline" disabled={saving || !!editingId} onPress={() => selectRows('none')} />
            <Button text="只選可匯入資料" kind="outline" disabled={saving || !!editingId || globalErrors} onPress={() => selectRows('valid')} />
          </View>
          {editingId ? <Text style={copy}>請先套用或取消這筆修正，才能確認匯入或切換資料。</Text> : null}
          {rows.slice(0, visible).map((row) => <View key={row.id} style={{ borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 12, gap: 6 }}>
            <Button text={`${selected.has(row.id) ? '已選' : '未選'}：${row.title}`} kind="outline" disabled={saving || !!editingId} onPress={() => setSelected((old) => {
              const next = new Set(old); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next;
            })} />
            <Text style={copy}>{`${row.academicYear}／${row.semester}`}{kind === 'grades'
              ? ` · ${row.credits ?? '未提供'} 學分 · 成績 ${row.grade ?? '未提供'}`
              : ` · 星期 ${row.dayOfWeek ?? '?'} · ${row.startTime || row.periodLabel || `節次 ${row.startPeriod ?? '?'}–${row.endPeriod ?? '?'}`} · ${row.location || '教室未提供'}`}</Text>
            {tableBatch ? <Text style={{ color: theme.colors.muted }}>{`來源：${row.source.name} · 第 ${row.source.line} 行`}</Text> : null}
            {corrected.has(row.id) ? <Text style={copy}>已手動修正，原始來源保留</Text> : null}
            {reviewIssues.filter((issue) => issue.rowId === row.id).map((issue, index) => (
              <Text key={`${issue.code}:${index}`} accessibilityRole={issue.severity === 'error' ? 'alert' : undefined} style={copy}>{issue.message}</Text>
            ))}
            {editingId === row.id ? <SchoolPortalRowEditor key={row.id} row={row} profile={profile}
              disabled={saving || confirmClose} onApply={applyEdit} onCancel={cancelEdit} /> :
              <Button text={`修正欄位：${row.title}`} kind="outline" disabled={saving || !!editingId || confirmClose} onPress={() => beginEdit(row.id)} />}
          </View>)}
          {rows.length > visible ? <Button text={`再顯示 ${Math.min(20, rows.length - visible)} 筆`} onPress={() => setVisible((count) => count + 20)} /> : null}
          {errors.filter((issue) => !issue.rowId).slice(0, 10).map((issue, index) => <Text key={index} accessibilityRole="alert" style={copy}>{issue.message}</Text>)}
          {errors.length > 10 ? <Text style={copy}>{`另有 ${errors.length - 10} 個問題，請修正表格後重新整理。`}</Text> : null}
          <Button text={saving ? '正在儲存…' : `確認匯入 ${chosen.length} 筆`} disabled={saving || !!editingId || confirmClose || confirmReparse || !chosen.length || !!errors.length} onPress={() => void save()} />
          <Button text="核對重複與更新既有資料" kind="outline"
            disabled={saving || reconciling || !!editingId || confirmClose || confirmReparse || !chosen.length || !!errors.length} onPress={beginReimport} />
          <Text style={copy}>一般匯入只新增、不覆蓋；已有同學期資料時，可先核對差異，再明確確認更新。</Text>
        </> : null}
        <Button text="重選表格" kind="outline" disabled={saving || !!editingId || !!corrected.size} onPress={() => { setRows([]); setError(''); resumeStage.current = 'choose'; moveTo('choose'); }} />
      </> : null}
      {stage === 'done' && receipt ? <>
        <Text accessibilityRole="header" style={{ ...copy, fontSize: 20, fontWeight: '700' }}>{undone ? (receipt.reimport?.updated ? '已撤回這次新增與更新' : '已撤回這次新增資料') : '匯入完成'}</Text>
        <Text style={copy}>{undone ? '後續編輯的紀錄不會被撤回。' : receipt.reimport
          ? `已新增 ${receipt.added} 筆、更新 ${receipt.reimport.updated} 筆；保留舊值 ${receipt.reimport.kept} 筆，相同列 ${receipt.duplicates} 筆未重複新增。`
          : `已新增 ${receipt.added} 筆，相同資料 ${receipt.duplicates} 筆未重複新增。`}</Text>
        {receipt.reimport && receipt.batchId && !undone ? <Text style={copy}>本頁撤回會同時恢復這次更新前的值；若紀錄已被後續編輯或同步改變，會停止撤回。離開此頁不保留撤回暫存。</Text> : null}
        <Text style={copy}>{scope.owner === 'guest:device' ? '儲存於這台裝置的訪客空間。' : '儲存於目前帳號與校園的個人匯入空間。'}已啟用的個人資料同步仍依原設定運作；未新增校務背景同步。</Text>
        <Button text="查看與編輯已匯入資料" disabled={saving} onPress={() => onOpenRecords(kind)} />
        <Button text="繼續匯入其他學期" kind="outline" disabled={saving} onPress={() => continueImport(kind)} />
        <Button text={kind === 'grades' ? '接著匯入課表' : '接著匯入成績'} kind="outline" disabled={saving}
          onPress={() => continueImport(kind === 'grades' ? 'timetable' : 'grades')} />
        <Text style={copy}>繼續匯入會保留目前校務網頁；請自行切換學期或頁面後再讀取。已儲存批次仍可到匯入紀錄管理。</Text>
        {receipt.batchId && !undone ? <>
          <Button text={confirmUndo ? '確認撤回這次匯入' : '撤回這次匯入'} kind="outline" disabled={saving} onPress={() => confirmUndo ? void undo() : setConfirmUndo(true)} />
          {confirmUndo ? <Button text="保留資料" kind="outline" disabled={saving} onPress={() => setConfirmUndo(false)} /> : null}
        </> : null}
      </> : null}
    </ScrollView> : null}
    {reconciling ? <SchoolPortalReimport scope={scope} rows={chosen}
      isCurrent={() => alive.current && isScopeCurrent(scope)}
      onCancel={() => { reconcileLock.current = false; setReconciling(false); }}
      onSaved={(result) => {
        if (!alive.current || !isScopeCurrent(scope)) return;
        setReceipt({ added: result.added, duplicates: result.duplicates, batchId: result.batchId, reimport: result });
        setConfirmUndo(false); setUndone(false); clearDraft(); moveTo('done');
      }} /> : null}
  </SafeAreaView>;
}
