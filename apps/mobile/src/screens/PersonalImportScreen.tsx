import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import {
  createPersonalImportId,
  parsePersonalImport,
  personalImportErrorMessage,
  personalImportSavedNotice,
  personalImportUndoBody,
  personalImportUndoneNotice,
  PERSONAL_IMPORT_IMAGE_UNREADABLE,
  PERSONAL_IMPORT_UNDO_CONFIRM,
  PERSONAL_IMPORT_UNDO_KEEP,
  PERSONAL_IMPORT_UNDO_LABEL,
  PERSONAL_IMPORT_UNDO_TITLE,
  validatePersonalImportRow,
  type PersonalImportRow,
  type PersonalImportRecord,
  type ImportIssue,
} from '@campus/shared';
import { createNuniClasses, type NuniWorkspace } from '@campus/shared/src/nuni';
import { Screen, Button } from '../ui/components';
import { CourseAccessPanel } from '../components/CourseAccessPanel';
import { theme } from '../ui/theme';
import { useNuniSession } from '../state/nuniSession';
import { useSchool } from '../state/school';
import { usePersonalImportScope } from '../state/personalImportScope';
import { TimetableOcrHost, type TimetableOcrHandle } from '../components/TimetableOcrHost';
import {
  IMPORT_IMAGE_MAX_BYTES,
  IMPORT_IMAGE_MAX_PIXELS,
  readImageBase64,
  TimetableOcrError,
} from '../services/timetableOcr';
import {
  loadPersonalImports,
  appendPersonalImports,
  editPersonalImport,
  undoLastPersonalImport,
  type PersonalImportScope,
  type PersonalImportLedger,
} from '../services/personalImports';

const kinds = [
  ['timetable', '課表'],
  ['grades', '成績與學分'],
  ['events', '行事曆'],
] as const;
type Kind = (typeof kinds)[number][0];
const names = Object.fromEntries(kinds) as Record<Kind, string>;
const inputStyle = {
  borderWidth: 1,
  borderColor: theme.colors.border,
  borderRadius: 8,
  padding: 12,
  color: theme.colors.text,
  backgroundColor: theme.colors.surface,
};
const textStyle = { color: theme.colors.text, lineHeight: 23 };
const numeric = new Set(['credits', 'dayOfWeek', 'startPeriod', 'endPeriod']);
const commonFields: Array<[keyof PersonalImportRow, string]> = [
  ['title', '名稱'],
  ['academicYear', '學年度'],
  ['semester', '學期'],
  ['courseCode', '課號（選填）'],
  ['teacher', '教師姓名（選填）'],
  ['className', '班別（選填）'],
];
const extraFields: Record<Kind, Array<[keyof PersonalImportRow, string]>> = {
  timetable: [
    ['dayOfWeek', '星期（1–7）'],
    ['startPeriod', '開始節次'],
    ['endPeriod', '結束節次'],
    ['startTime', '開始時間 HH:mm'],
    ['endTime', '結束時間 HH:mm'],
    ['location', '教室（選填）'],
    ['periodLabel', '原始節次（其他學校選填，例如 A-B）'],
  ],
  grades: [
    ['credits', '學分'],
    ['grade', '成績'],
  ],
  events: [
    ['date', '開始日期 YYYY-MM-DD'],
    ['endDate', '結束日期（選填；全天活動不含這一天）'],
    ['startTime', '開始時間 HH:mm（全天留空）'],
    ['endTime', '結束時間 HH:mm（全天留空）'],
    ['location', '地點（選填）'],
  ],
};

function Field({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={textStyle}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        style={inputStyle}
        maxLength={200}
        autoCorrect={false}
      />
    </View>
  );
}

function RowEditor({
  row,
  onChange,
  workspaces,
  disabled = false,
  onRefreshWorkspaces,
}: {
  row: PersonalImportRow;
  onChange(row: PersonalImportRow): void;
  workspaces: NuniWorkspace[];
  disabled?: boolean;
  onRefreshWorkspaces?: () => void;
}) {
  const fields = [...commonFields, ...extraFields[row.kind]];
  return (
    <View style={{ gap: 10 }}>
      {row.kind === 'events' ? (
        <Button
          disabled={disabled}
          text={row.allDay ? '全天活動：是' : '全天活動：否'}
          onPress={() =>
            onChange({
              ...row,
              allDay: !row.allDay,
              ...(!row.allDay ? { startTime: undefined, endTime: undefined } : {}),
            })
          }
        />
      ) : null}
      {fields.map(([key, label]) => (
        <Field
          key={key}
          disabled={disabled}
          label={label}
          value={row[key] == null ? '' : String(row[key])}
          onChange={(value) =>
            onChange({
              ...row,
              [key]: numeric.has(key) ? (value.trim() ? Number(value) : undefined) : value,
            })
          }
        />
      ))}
      <CourseAccessPanel row={row} workspaces={workspaces} disabled={disabled}
        onRefreshWorkspaces={onRefreshWorkspaces}
        onSelectLinkedCourse={(workspaceId) => onChange({ ...row, linkedCourseId: workspaceId })} />
      <Text style={textStyle}>連結已加入的課班（選填）</Text>
      <Text style={{ color: theme.colors.muted }}>
        只建立你自己的對照；不會加入課班或通知老師。課班清單尚未提供學校、學期與教師資訊，請先自行核對。教師姓名是個人記錄，尚未驗證身分。
      </Text>
      <Button
        disabled={disabled}
        text={row.linkedCourseId ? '取消課班連結' : '不連結課班'}
        onPress={() => onChange({ ...row, linkedCourseId: undefined })}
      />
      {workspaces.map((workspace) => (
        <Button
          key={workspace.id}
          disabled={disabled}
          text={`${row.linkedCourseId === workspace.id ? '已選：' : ''}${workspace.title}（${workspace.memberRole === 'student' ? '學生' : '管理者（未代表教師認證）'}）`}
          kind={row.linkedCourseId === workspace.id ? 'primary' : 'outline'}
          onPress={() => onChange({ ...row, linkedCourseId: workspace.id })}
        />
      ))}
      {row.linkedCourseId &&
      !workspaces.some((workspace) => workspace.id === row.linkedCourseId) ? (
        <Text style={{ color: theme.colors.muted }}>
          原連結目前無法驗證；儲存前請重新選擇或取消連結。
        </Text>
      ) : null}
    </View>
  );
}

function rowSummary(row: PersonalImportRow) {
  if (row.kind === 'grades')
    return `${row.academicYear}／${row.semester} · ${row.credits ?? '未填'} 學分 · 成績 ${row.grade || '未填'}`;
  if (row.kind === 'events')
    return `${row.date || '日期待填'} ${row.startTime || '全天'}${row.endTime ? `–${row.endTime}` : ''} · ${row.location || '地點未填'}`;
  return `星期 ${row.dayOfWeek ?? '未填'} · ${row.startPeriod ? `第 ${row.startPeriod}–${row.endPeriod ?? '?'} 節` : row.periodLabel || `${row.startTime || '?'}–${row.endTime || '?'}`} · ${row.teacher || '教師未填'}`;
}

function ImportWorkspace({
  scope,
  initialKind,
  available,
}: {
  scope: PersonalImportScope;
  initialKind: Kind;
  available: boolean;
}) {
  const platform = useNuniSession();
  const { school } = useSchool();
  const { owner, schoolId } = scope;
  const { session, request } = platform;
  const [kind, setKind] = useState<Kind>(initialKind);
  const [academicYear, setYear] = useState('');
  const [semester, setSemester] = useState('');
  const [text, setText] = useState('');
  const [source, setSource] = useState<{ type: 'paste' | 'file' | 'screenshot'; name?: string }>({
    type: 'paste',
  });
  const [rows, setRows] = useState<PersonalImportRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [ledger, setLedger] = useState<PersonalImportLedger | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [catalog, setCatalog] = useState<{ context: string; rows: NuniWorkspace[] } | null>(null);
  const workspaces = catalog?.context === platform.session?.context ? catalog?.rows || [] : [];
  const linkGeneration = useRef(0);
  const availableRef = useRef(available);
  availableRef.current = available;
  const [linksStatus, setLinksStatus] = useState('');
  const [editing, setEditing] = useState<{
    before: PersonalImportRecord;
    row: PersonalImportRow;
  } | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);
  const alive = useRef(true);
  const focused = useRef(true);
  const generation = useRef(0);
  const savingRef = useRef(false);
  const ledgerGeneration = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const ocr = useRef<TimetableOcrHandle>(null);
  const profile = scope.schoolId === 'pu' ? ('pu' as const) : undefined;
  const active = () => alive.current && focused.current && availableRef.current;
  const current = (run: number) => alive.current && focused.current && generation.current === run;
  const cancel = () => {
    generation.current += 1;
    abort.current?.abort();
    ocr.current?.cancel();
    setBusy(false);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current += 1;
      abort.current?.abort();
    };
  }, []);

  const load = useCallback(async () => {
    const run = ++ledgerGeneration.current;
    try {
      const next = await loadPersonalImports({ owner, schoolId });
      if (alive.current && ledgerGeneration.current === run) {
        setLedger(next);
        setLoadError('');
      }
    } catch {
      if (alive.current) setLoadError('讀不到這台裝置的匯入紀錄，請重試。現有資料沒有變更。');
    }
  }, [owner, schoolId]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void load();
      return () => {
        focused.current = false;
        generation.current += 1;
        abort.current?.abort();
        ocr.current?.cancel();
        setBusy(false);
      };
    }, [load]),
  );
  const loadLinks = useCallback(async () => {
    const linkRun = ++linkGeneration.current;
    if (!session || !available) {
      setLinksStatus('登入平台後，可選擇已加入的課班。');
      setCatalog(null);
      return;
    }
    setLinksStatus('正在讀取已加入的課班…');
    try {
      const available = await createNuniClasses(
        (path, input) => request(path, session.context, input),
        session.platformAccountId,
      ).list();
      if (!alive.current || linkRun !== linkGeneration.current) return;
      setCatalog({
        context: session.context,
        rows: available.filter((item) => item.state === 'active'),
      });
      setLinksStatus(
        available.some((item) => item.state === 'active')
          ? '下方逐筆編輯可選擇已加入的課班。請自行確認學校、學期與授課教師。'
          : '目前沒有可連結的課班。可以先保存個人資料。',
      );
    } catch {
      if (alive.current && linkRun === linkGeneration.current) {
        setCatalog(null);
        setLinksStatus('課班暫時讀不到。可重試，或先保留不連結的個人資料。');
      }
    }
  }, [session, request, available]);
  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);
  useEffect(() => {
    if (available) void load();
  }, [available, load]);

  const rowIssues = useMemo(
    () =>
      new Map(
        rows.map((row) => [row.id, validatePersonalImportRow(row, { periodProfile: profile })]),
      ),
    [rows, profile],
  );
  const chosen = rows.filter((row) => selected.has(row.id));
  const structuralErrors = issues.filter(
    (issue) => issue.severity === 'error' && (!issue.rowId || selected.has(issue.rowId)),
  );
  const invalidCount = chosen.filter((row) =>
    rowIssues.get(row.id)?.some((issue) => issue.severity === 'error'),
  ).length;

  const preview = () => {
    cancel();
    try {
      const parsed = parsePersonalImport(text, {
        kind,
        schoolId: scope.schoolId,
        academicYear,
        semester,
        source,
        periodProfile: profile,
      });
      const validationKeys = new Set(
        parsed.rows
          .flatMap((row) => validatePersonalImportRow(row, { periodProfile: profile }))
          .map((issue) => JSON.stringify(issue)),
      );
      setRows(parsed.rows);
      setSelected(new Set(parsed.rows.map((row) => row.id)));
      // Parser errors (including unsupported calendar recurrence) survive field editing.
      // Only current row validation is recalculated from the editable values below.
      setIssues(parsed.issues.filter((issue) => !validationKeys.has(JSON.stringify(issue))));
      setExpanded(parsed.rows[0]?.id || null);
      setNotice(
        parsed.rows.length
          ? '請逐筆核對。確認儲存前不會寫入。'
          : '沒有找到可匯入的資料。可修正文字，或手動新增一筆。',
      );
    } catch (error) {
      setNotice(personalImportErrorMessage(error, '無法解析，請檢查內容。'));
    }
  };
  const pickImage = async () => {
    cancel();
    const run = generation.current;
    setBusy(true);
    setNotice('');
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        base64: false,
      });
      if (!current(run) || picked.canceled) return;
      const asset = picked.assets[0];
      const mime =
        asset?.mimeType ||
        (asset?.uri.toLowerCase().endsWith('.png')
          ? 'image/png'
          : asset?.uri.toLowerCase().match(/\.jpe?g$/)
            ? 'image/jpeg'
            : '');
      if (!asset || (mime !== 'image/png' && mime !== 'image/jpeg'))
        throw new Error('請選 PNG 或 JPG 截圖；其他圖片格式請先轉存。');
      if (
        (asset.fileSize || 0) > IMPORT_IMAGE_MAX_BYTES ||
        asset.width * asset.height > IMPORT_IMAGE_MAX_PIXELS
      )
        throw new Error('圖片上限 8 MB、2,000 萬像素，請先裁切。');
      const base64 = await readImageBase64(asset.uri);
      if (!current(run)) return;
      abort.current = new AbortController();
      if (!ocr.current) throw new Error('辨識程式尚未就緒，請改貼文字。');
      setNotice('正在讀取截圖，可隨時取消。');
      const result = await ocr.current.recognize(base64, mime, abort.current.signal);
      if (!current(run)) return;
      setText(result);
      setSource({ type: 'screenshot', name: asset.fileName || '截圖' });
      setRows([]);
      setIssues([]);
      setNotice(
        result.trim()
          ? '已讀取文字，請核對後按「整理成可編輯資料」。'
          : '圖片沒有讀出文字，請裁切後再試，或手動輸入。',
      );
    } catch (error) {
      if (current(run) && !(error instanceof TimetableOcrError && error.kind === 'cancelled'))
        setNotice(personalImportErrorMessage(error, PERSONAL_IMPORT_IMAGE_UNREADABLE));
    } finally {
      if (current(run)) setBusy(false);
    }
  };
  const pickFile = async () => {
    cancel();
    const run = generation.current;
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/*', 'application/csv', 'application/octet-stream'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (!current(run) || result.canceled) return;
      const asset = result.assets[0];
      if (!/\.(txt|csv|ics)$/i.test(asset.name))
        throw new Error('目前支援 TXT、CSV、ICS。PDF 或試算表請先轉存文字或截圖。');
      const file = new File(asset.uri);
      if ((asset.size || file.size) > 512 * 1024)
        throw new Error('文字檔上限 512 KB，請分批匯入。');
      const resultText = await file.text();
      if (!current(run)) return;
      if (resultText.length > 100_000) throw new Error('文字過長，請分批匯入。');
      setText(resultText);
      setSource({ type: 'file', name: asset.name });
      setRows([]);
      setIssues([]);
      if (/\.ics$/i.test(asset.name)) setKind('events');
      setNotice(`已讀取 ${asset.name}，請核對內容後整理。`);
    } catch (error) {
      if (current(run)) setNotice(personalImportErrorMessage(error, '檔案讀取失敗。'));
    } finally {
      if (current(run)) setBusy(false);
    }
  };
  const verifyLinks = (items: PersonalImportRow[]) => {
    if (
      items.some(
        (row) =>
          row.linkedCourseId &&
          !workspaces.some((workspace) => workspace.id === row.linkedCourseId),
      )
    )
      throw new Error('有課班連結無法驗證，請重新選擇或取消連結。');
  };
  const save = async () => {
    if (savingRef.current || !chosen.length || invalidCount || structuralErrors.length || !ledger)
      return;
    savingRef.current = true;
    ledgerGeneration.current += 1;
    setSaving(true);
    try {
      verifyLinks(chosen);
      const result = await appendPersonalImports(scope, chosen, active);
      if (!active()) return;
      setLedger(result.ledger);
      setRows([]);
      setSelected(new Set());
      setIssues([]);
      setExpanded(null);
      setText('');
      setSource({ type: 'paste' });
      setNotice(personalImportSavedNotice(result.added));
    } catch (error) {
      if (active()) setNotice(personalImportErrorMessage(error, '儲存失敗，請重試。'));
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const saveEdit = async () => {
    if (!editing || savingRef.current) return;
    savingRef.current = true;
    ledgerGeneration.current += 1;
    setSaving(true);
    try {
      verifyLinks([editing.row]);
      const next = await editPersonalImport(scope, editing.before, editing.row, active);
      if (active()) {
        setLedger(next);
        setEditing(null);
        setNotice('已更新這筆個人資料。撤回原匯入批次會保留這次編輯。');
      }
    } catch (error) {
      if (active()) setNotice(personalImportErrorMessage(error, '更新失敗。'));
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const lastBatch = ledger?.batches[ledger.batches.length - 1];
  const lastBatchCount = lastBatch
    ? ledger.records.filter((row) => row.batchId === lastBatch.id).length
    : 0;
  const undo = async () => {
    const batch = lastBatch;
    if (!batch || savingRef.current) return;
    savingRef.current = true;
    ledgerGeneration.current += 1;
    setSaving(true);
    try {
      const result = await undoLastPersonalImport(scope, batch.id, active);
      if (active()) {
        setLedger(result.ledger);
        setEditing(null);
        setUndoOpen(false);
        setNotice(personalImportUndoneNotice(result.removed));
      }
    } catch (error) {
      if (active()) setNotice(personalImportErrorMessage(error, '撤回失敗。'));
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  };

  return (
    <Screen title="匯入我的資料" subtitle="課表、成績、活動，從你手上的資料開始">
      <TimetableOcrHost ref={ocr} />
      {!available ? (
        <View style={{ padding: 20, gap: 10 }}>
          <Text style={textStyle}>
            正在重新確認帳號，個人資料暫時隱藏。輸入內容會為同一帳號保留。
          </Text>
          <Button text="重新確認帳號" onPress={platform.refresh} />
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 18, gap: 16, paddingBottom: 120 }}
        >
          <Text style={textStyle}>
            只儲存在這台裝置，依目前帳號與學校分開。尚未同步到其他裝置，也不會改動學校的正式紀錄。
            {scope.owner === 'guest:device' ? '目前是訪客資料，登入後不會自動搬移。' : ''}
          </Text>
          <Text style={{ color: theme.colors.muted }}>
            目前學校：{school?.name || scope.schoolId}
            。教師姓名可先記錄；要連結課班，請從你已加入的課班手動選擇。
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {kinds.map(([value, title]) => (
              <Button
                key={value}
                text={title}
                kind={kind === value ? 'primary' : 'outline'}
                disabled={saving}
                onPress={() => {
                  cancel();
                  setKind(value);
                  setRows([]);
                  setIssues([]);
                  setEditing(null);
                }}
              />
            ))}
          </View>
          <Field
            label="這批資料的學年度（例如 115）"
            value={academicYear}
            onChange={(value) => {
              setYear(value);
              setRows([]);
              setIssues([]);
            }}
            disabled={saving}
          />
          <Field
            label="這批資料的學期（例如 1、2、暑期）"
            value={semester}
            onChange={(value) => {
              setSemester(value);
              setRows([]);
              setIssues([]);
            }}
            disabled={saving}
          />
          <Text style={textStyle}>1. 放入資料</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button text="選擇截圖" onPress={pickImage} disabled={busy || saving} />
            <Button text="選擇文字檔" onPress={pickFile} disabled={busy || saving} />
            {busy ? (
              <Button
                text="取消讀取"
                onPress={() => {
                  cancel();
                  setNotice('已取消，原有資料沒有變更。');
                }}
              />
            ) : null}
          </View>
          <Text style={{ color: theme.colors.muted }}>
            截圖支援 PNG、JPG，最多 8 MB。圖片在裝置上辨識，使用 App 內的辨識程式與中英文字庫。文字檔支援
            TXT、CSV；行事曆也可讀 ICS。
          </Text>
          {busy ? <ActivityIndicator accessibilityLabel="正在讀取資料" /> : null}
          <TextInput
            accessibilityLabel="貼上或修正原始文字"
            placeholder="貼上從學校網頁複製的文字，也可修正截圖辨識結果。"
            multiline
            editable={!saving}
            maxLength={100_000}
            value={text}
            onChangeText={(value) => {
              if (busy) cancel();
              setText(value);
              if (!value || source.type !== 'screenshot') setSource({ type: 'paste' });
              setRows([]);
              setIssues([]);
            }}
            style={[inputStyle, { minHeight: 130, textAlignVertical: 'top' }]}
          />
          <Text style={{ color: theme.colors.muted }}>
            {kind === 'timetable'
              ? '文字範例：資料庫 星期一 第3-4節 老師：王老師 教室：主顧303'
              : kind === 'grades'
                ? 'CSV 欄位：課程名稱,學分,成績,課號,教師'
                : 'CSV 欄位：活動名稱,日期,開始時間,結束時間,地點。全天活動加「全天」欄並填「是」，時間留空。'}
          </Text>
          <Button
            text="整理成可編輯資料"
            kind="primary"
            disabled={!text.trim() || busy || saving}
            onPress={preview}
          />
          <Button
            text="手動新增一筆"
            disabled={busy || saving}
            onPress={() => {
              const row: PersonalImportRow = {
                id: createPersonalImportId(),
                kind,
                title: '',
                schoolId: scope.schoolId,
                academicYear,
                semester,
                source: { type: 'paste', line: 1, rawText: '' },
              };
              setRows((currentRows) => [...currentRows, row]);
              setSelected((value) => new Set([...value, row.id]));
              setExpanded(row.id);
            }}
          />
          {notice ? (
            <Text accessibilityRole="alert" style={textStyle}>
              {notice}
            </Text>
          ) : null}
          {issues.length ? (
            <View style={{ gap: 5 }}>
              {issues.map((issue, i) => (
                <Text key={i} style={{ color: theme.colors.muted }}>
                  {issue.message}
                </Text>
              ))}
            </View>
          ) : null}
          {rows.length ? (
            <>
              <Text
                accessibilityRole="header"
                style={{ ...textStyle, fontSize: 20, fontWeight: '700' }}
              >
                2. 核對 {rows.length} 筆資料
              </Text>
              <Text style={textStyle}>{linksStatus}</Text>
              <Button text="重新讀取可連結課班" onPress={loadLinks} disabled={saving} />
              {rows.map((row, index) => (
                <View
                  key={row.id}
                  style={{
                    borderTopWidth: 1,
                    borderColor: theme.colors.border,
                    paddingTop: 16,
                    gap: 10,
                  }}
                >
                  <Pressable
                    disabled={saving}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected.has(row.id) }}
                    onPress={() =>
                      setSelected((value) => {
                        const next = new Set(value);
                        if (next.has(row.id)) next.delete(row.id);
                        else next.add(row.id);
                        return next;
                      })
                    }
                  >
                    <Text style={{ ...textStyle, fontWeight: '700' }}>
                      {selected.has(row.id) ? '☑' : '□'} {index + 1}. {row.title || '名稱待填'}
                    </Text>
                  </Pressable>
                  <Text style={textStyle}>{rowSummary(row)}</Text>
                  {(rowIssues.get(row.id) || []).map((issue, i) => (
                    <Text
                      key={i}
                      style={{
                        color:
                          issue.severity === 'error' ? theme.colors.danger : theme.colors.muted,
                      }}
                    >
                      {issue.message}
                    </Text>
                  ))}
                  <Button
                    text={expanded === row.id ? '收起欄位' : '編輯與連結課班'}
                    disabled={saving}
                    onPress={() => setExpanded(expanded === row.id ? null : row.id)}
                  />
                  {expanded === row.id ? (
                    <RowEditor
                      disabled={saving}
                      row={row}
                      workspaces={workspaces}
                      onRefreshWorkspaces={() => void loadLinks()}
                      onChange={(next) =>
                        setRows((items) => items.map((item) => (item.id === row.id ? next : item)))
                      }
                    />
                  ) : null}
                </View>
              ))}
              {structuralErrors.length ? (
                <Text style={{ color: theme.colors.danger }}>
                  來源格式還有問題，請修正原文後重新整理，或取消勾選有問題的資料。
                </Text>
              ) : null}
              {invalidCount ? (
                <Text style={{ color: theme.colors.danger }}>
                  勾選的資料有 {invalidCount} 筆需要修正。也可取消勾選，先儲存其他資料。
                </Text>
              ) : null}
              <Button
                text={`確認新增 ${chosen.length} 筆`}
                kind="primary"
                onPress={save}
                disabled={
                  !chosen.length ||
                  invalidCount > 0 ||
                  structuralErrors.length > 0 ||
                  !ledger ||
                  saving
                }
                loading={saving}
              />
              <Text style={{ color: theme.colors.muted }}>
                採用新增方式；重複資料會略過，原有資料不會被整份取代。
              </Text>
            </>
          ) : null}
          <Text
            accessibilityRole="header"
            style={{ ...textStyle, fontSize: 20, fontWeight: '700' }}
          >
            已儲存的{names[kind]}
          </Text>
          {loadError ? (
            <>
              <Text accessibilityRole="alert" style={textStyle}>
                {loadError}
              </Text>
              <Button text="重試讀取" onPress={load} />
            </>
          ) : null}
          {!ledger && !loadError ? <ActivityIndicator accessibilityLabel="讀取匯入紀錄" /> : null}
          {ledger && !ledger.records.some((row) => row.kind === kind) ? (
            <Text style={{ color: theme.colors.muted }}>目前沒有這類資料。</Text>
          ) : null}
          {ledger?.records
            .filter((row) => row.kind === kind)
            .map((row) => (
              <View
                key={row.id}
                style={{
                  paddingVertical: 12,
                  borderTopWidth: 1,
                  borderColor: theme.colors.border,
                  gap: 8,
                }}
              >
                <Text style={{ ...textStyle, fontWeight: '700' }}>{row.title}</Text>
                <Text style={textStyle}>{rowSummary(row)}</Text>
                {row.kind === 'timetable' &&
                (scope.schoolId !== 'pu' ||
                  !row.startPeriod ||
                  !row.endPeriod ||
                  (row.dayOfWeek || 0) > 5) ? (
                  <Text style={{ color: theme.colors.muted }}>
                    已保存原始上課時間；目前課表格子只支援靜宜週一至週五的節次，這筆尚未放入格子。
                  </Text>
                ) : null}
                {row.linkedCourseId ? (
                  <Text style={textStyle}>
                    個人課班對照：
                    {workspaces.find((workspace) => workspace.id === row.linkedCourseId)?.title ||
                      '目前無法驗證存取的課班'}
                  </Text>
                ) : null}
                {editing?.before.id === row.id ? (
                  <>
                    <RowEditor
                      disabled={saving}
                      row={editing.row}
                      workspaces={workspaces}
                      onRefreshWorkspaces={() => void loadLinks()}
                      onChange={(next) => setEditing({ before: editing.before, row: next })}
                    />
                    <Button text="儲存編輯" disabled={saving} onPress={saveEdit} />
                    <Button text="取消編輯" disabled={saving} onPress={() => setEditing(null)} />
                  </>
                ) : (
                  <Button
                    text={`編輯 ${row.title}`}
                    disabled={saving}
                    onPress={() => setEditing({ before: row, row: { ...row } })}
                  />
                )}
              </View>
            ))}
          {ledger?.batches.length ? (
            <>
              <Button
                text={PERSONAL_IMPORT_UNDO_LABEL}
                disabled={saving}
                onPress={() => setUndoOpen(true)}
              />
              <Text style={{ color: theme.colors.muted }}>
                僅移除該次新增且未再編輯的資料，之後新增或編輯的內容會保留。
              </Text>
            </>
          ) : null}
        </ScrollView>
      )}
      <Modal
        visible={undoOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setUndoOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(48, 38, 28, 0.32)',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <View
            accessibilityRole="alert"
            style={{
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderWidth: 1,
              borderRadius: 12,
              padding: 20,
              gap: 14,
            }}
          >
            <Text style={{ ...textStyle, fontSize: 18, fontWeight: '700' }}>
              {PERSONAL_IMPORT_UNDO_TITLE}
            </Text>
            <Text style={textStyle}>{personalImportUndoBody(lastBatchCount)}</Text>
            <Button
              text={PERSONAL_IMPORT_UNDO_CONFIRM}
              kind="danger"
              disabled={saving}
              onPress={() => void undo()}
            />
            <Button
              text={PERSONAL_IMPORT_UNDO_KEEP}
              disabled={saving}
              onPress={() => setUndoOpen(false)}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

export default function PersonalImportScreen({ route }: { route?: { params?: { kind?: Kind } } }) {
  const scope = usePersonalImportScope();
  const platform = useNuniSession();
  const confirmedScope = useRef<PersonalImportScope | null>(null);
  if (scope) confirmedScope.current = scope;
  const retained = scope || confirmedScope.current;
  if (!retained)
    return (
      <Screen title="匯入我的資料">
        <Text style={{ ...textStyle, padding: 20 }}>
          正在確認帳號，暫時不顯示個人資料。請稍候或重新整理登入狀態。
        </Text>
        <Button text="重新確認帳號" onPress={platform.refresh} />
      </Screen>
    );
  const kind = kinds.some(([value]) => value === route?.params?.kind)
    ? route!.params!.kind!
    : 'timetable';
  return (
    <ImportWorkspace
      key={`${retained.owner}:${retained.schoolId}:${kind}`}
      scope={retained}
      initialKind={kind}
      available={!!scope}
    />
  );
}
