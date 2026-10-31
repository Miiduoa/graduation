import { readImportReviewDraft, writeImportReviewDraft } from '../services/personalImportDrafts';
import { TimetableReviewGrid } from '../components/TimetableReviewGrid';
import { nextReviewRow, splitReviewRow } from '@campus/shared/src/imports/reviewGrid';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  createPersonalImportId,
  serializePersonalImportsCsv,
  parsePersonalImport,
  extractSchoolPageTables,
  type SchoolPageTable,
  parsePersonalImportBackup,
  parsePersonalImportDocument,
  personalImportDocumentFormat,
  personalImportErrorMessage,
  personalImportPreviewNotice,
  personalImportSavedNotice,
  personalImportUndoBody,
  personalImportUndoneNotice,
  PERSONAL_IMPORT_BACKUP_MAX_BYTES,
  PERSONAL_IMPORT_DOCUMENT_LIMITS,
  PERSONAL_IMPORT_IMAGE_UNREADABLE,
  PERSONAL_IMPORT_MAX_ROWS,
  PERSONAL_IMPORT_UNDO_CONFIRM,
  PERSONAL_IMPORT_UNDO_KEEP,
  PERSONAL_IMPORT_UNDO_LABEL,
  PERSONAL_IMPORT_UNDO_TITLE,
  PersonalImportDocumentError,
  periodSlots,
  periodCount,
  periodDisplayLabel,
  periodLabelAt,
  periodProfileForSchool,
  PERIOD_PROFILE_TITLES,
  slotIndexForLabel,
  validatePersonalImportRow,
  type PersonalImportDocument,
  type PeriodProfileId,
  type PersonalImportRow,
  type PersonalImportRecord,
  type ImportIssue,
} from '@campus/shared';
import { createNuniClasses, type NuniWorkspace } from '@campus/shared/src/nuni';
import { CourseAccessPanel } from '../components/CourseAccessPanel';
import { DocumentImportHost } from '../components/DocumentImportHost';
import { Screen, Button } from '../ui/components';
import { theme } from '../ui/theme';
import { PersonalImportSyncPanel } from '../components/PersonalImportSyncPanel';
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
  personalImportStorageKey,
  loadPersonalImports,
  appendPersonalImports,
  editPersonalImport,
  deletePersonalImport,
  snapshotPersonalImports,
  undoLastPersonalImport,
  type PersonalImportScope,
  type PersonalImportLedger,
} from '../services/personalImports';
import { sharePersonalImportBackup } from '../services/personalImportBackupSharing';
import { personalImportDocumentAiSource } from '@campus/shared/src/imports/aiRecognition';
import {
  getMobileImportAiAvailability,
  MOBILE_IMPORT_AI_MAX_CHARACTERS,
  runMobilePersonalImportAi,
  subscribeMobileImportAi,
} from '../services/imports/personalImportAi';
import AIModelManagerScreen from './AIModelManagerScreen';

const DOCUMENT_PREVIEW_ROWS = 6;

type DocumentPrep = {
  document: PersonalImportDocument;
  /** sectionId → chosen header line (original worksheet/page line). */
  selections: Record<string, number>;
};
type DocumentSource = { uri: string; name: string; size?: number };

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
  periodProfile,
}: {
  row: PersonalImportRow;
  onChange(row: PersonalImportRow): void;
  workspaces: NuniWorkspace[];
  disabled?: boolean;
  onRefreshWorkspaces?: () => void;
  periodProfile?: PeriodProfileId;
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
          value={
            periodProfile && (key === 'startPeriod' || key === 'endPeriod') && row[key]
              ? periodLabelAt(Number(row[key]), periodProfile)
              : row[key] == null
                ? ''
                : String(row[key])
          }
          onChange={(value) =>
            onChange({
              ...row,
              [key]:
                periodProfile && (key === 'startPeriod' || key === 'endPeriod')
                  ? slotIndexForLabel(value, periodProfile)
                  : numeric.has(key)
                    ? value.trim()
                      ? Number(value)
                      : undefined
                    : value,
            })
          }
        />
      ))}
      <CourseAccessPanel
        row={row}
        workspaces={workspaces}
        disabled={disabled}
        onRefreshWorkspaces={onRefreshWorkspaces}
        onSelectLinkedCourse={(id) => onChange({ ...row, linkedCourseId: id })}
      />
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

function rowSummary(row: PersonalImportRow, profile?: PeriodProfileId) {
  if (row.kind === 'grades')
    return `${row.academicYear}／${row.semester} · ${row.credits ?? '未填'} 學分 · 成績 ${row.grade || '未填'}`;
  if (row.kind === 'events')
    return `${row.date || '日期待填'} ${row.startTime || '全天'}${row.endTime ? `–${row.endTime}` : ''} · ${row.location || '地點未填'}`;
  const periods = row.startPeriod
    ? profile
      ? `${periodDisplayLabel(row.startPeriod, profile)}–${periodDisplayLabel(row.endPeriod ?? row.startPeriod, profile)}`
      : `第 ${row.startPeriod}–${row.endPeriod ?? '?'} 節`
    : row.periodLabel || `${row.startTime || '?'}–${row.endTime || '?'}`;
  return `星期 ${row.dayOfWeek ?? '未填'} · ${periods} · ${row.teacher || '教師未填'}`;
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
  const [editedIds, setEditedIds] = useState<string[]>([]);
  const [rows, setRows] = useState<PersonalImportRow[]>([]);
  const [backupPreview, setBackupPreview] = useState<
    (Omit<ReturnType<typeof parsePersonalImportBackup>, 'rows'> & { name: string }) | null
  >(null);
  const [visibleRowCount, setVisibleRowCount] = useState(50);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [gridEditing, setGridEditing] = useState<string | null>(null);
  const gridRow = rows.find((row) => row.id === gridEditing);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [ledger, setLedger] = useState<PersonalImportLedger | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiState, setAiState] = useState(getMobileImportAiAvailability);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiReviewed, setAiReviewed] = useState(false);
  const [modelManagerOpen, setModelManagerOpen] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'attention'>('all');
  const [attentionSnapshot, setAttentionSnapshot] = useState<Set<string>>(() => new Set());
  const [sourceImage, setSourceImage] = useState<{
    uri: string;
    width: number;
    height: number;
  } | null>(null);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [imageViewerWidth, setImageViewerWidth] = useState(1);
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
  const [deleting, setDeleting] = useState<PersonalImportRecord | null>(null);
  const [savedQuery, setSavedQuery] = useState('');
  const [visibleSavedCount, setVisibleSavedCount] = useState(40);
  const [savedFeedback, setSavedFeedback] = useState('');
  const [exporting, setExporting] = useState(false);
  const [documentPrep, setDocumentPrep] = useState<DocumentPrep | null>(null);
  const [schoolPage, setSchoolPage] = useState<{ name: string; tables: SchoolPageTable[] } | null>(
    null,
  );
  const alive = useRef(true);
  const focused = useRef(true);
  const generation = useRef(0);
  const savingRef = useRef(false);
  const sharingRef = useRef(false);
  const ledgerGeneration = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const ocr = useRef<TimetableOcrHandle>(null);
  const documents = useRef<React.ElementRef<typeof DocumentImportHost>>(null);
  /** Picked PDF URI stays in memory only until confirm, cancel, or unmount / scope remount. */
  const documentSource = useRef<DocumentSource | null>(null);
  const profile = periodProfileForSchool(scope.schoolId);
  const [draftReady, setDraftReady] = useState(false);
  const [draftError, setDraftError] = useState('');
  const draftKey = `${personalImportStorageKey(scope)}:grid-draft:v1`;
  useEffect(() => {
    let mounted = true;
    readImportReviewDraft(draftKey)
      .then((raw) => {
        if (!mounted || !raw) return;
        const draft = JSON.parse(raw);
        if (
          draft.version !== 1 ||
          !['timetable', 'grades', 'events'].includes(draft.kind) ||
          ![draft.academicYear, draft.semester, draft.text].every(
            (value) => typeof value === 'string',
          ) ||
          !draft.source ||
          !['paste', 'file', 'screenshot'].includes(draft.source.type) ||
          !Array.isArray(draft.issues) ||
          !Array.isArray(draft.rows) ||
          draft.rows.length > 2000 ||
          !draft.rows.every(
            (row: PersonalImportRow) =>
              row.schoolId === schoolId &&
              typeof row.id === 'string' &&
              typeof row.title === 'string',
          ) ||
          !Array.isArray(draft.selected) ||
          !draft.selected.every((id: unknown) => typeof id === 'string')
        )
          throw new Error('invalid draft');
        setKind(draft.kind);
        setYear(draft.academicYear);
        setSemester(draft.semester);
        setText(draft.text);
        setSource(draft.source);
        setRows(draft.rows);
        setEditedIds(
          Array.isArray(draft.editedIds)
            ? draft.editedIds.filter((id: unknown) => typeof id === 'string')
            : [],
        );
        setSelected(new Set(draft.selected));
        setIssues(draft.issues);
        setBackupPreview(draft.backupPreview);
      })
      .catch(() => {
        if (mounted) setDraftError('草稿讀取失敗，請先離開並重試，避免覆蓋原草稿。');
      })
      .finally(() => {
        if (mounted) setDraftReady(true);
      });
    return () => {
      mounted = false;
    };
  }, [draftKey, schoolId]);
  useEffect(() => {
    if (!draftReady || draftError) return;
    const value = JSON.stringify({
      version: 1,
      editedIds,
      kind,
      academicYear,
      semester,
      text,
      source,
      rows,
      selected: [...selected],
      issues,
      backupPreview,
    });
    writeImportReviewDraft(draftKey, value).catch(() => {
      if (alive.current) setNotice('草稿未能保存在此裝置，離開前請重試。');
    });
  }, [
    editedIds,
    draftReady,
    draftError,
    draftKey,
    kind,
    academicYear,
    semester,
    text,
    source,
    rows,
    selected,
    issues,
    backupPreview,
  ]);
  const active = () => alive.current && focused.current && availableRef.current;
  const current = (run: number) => active() && generation.current === run;
  const clearDocumentSource = () => {
    documentSource.current = null;
  };
  const clearSourceImage = () => {
    setSourceImage(null);
    setImageViewerOpen(false);
  };
  const cancel = () => {
    generation.current += 1;
    abort.current?.abort();
    ocr.current?.cancel();
    documents.current?.cancel();
    setBusy(false);
    setAiRunning(false);
  };
  useEffect(() => {
    const update = () => setAiState(getMobileImportAiAvailability());
    const unsubscribe = subscribeMobileImportAi(update);
    update();
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!available) {
      generation.current += 1;
      abort.current?.abort();
      ocr.current?.cancel();
      documents.current?.cancel();
      setBusy(false);
      setAiRunning(false);
      setModelManagerOpen(false);
      setGridEditing(null);
      setSourceImage(null);
      setImageViewerOpen(false);
    }
  }, [available]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current += 1;
      abort.current?.abort();
      documents.current?.cancel();
      clearDocumentSource();
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
        documents.current?.cancel();
        setBusy(false);
        setAiRunning(false);
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
  const needsAttention = (row: PersonalImportRow) =>
    !!rowIssues.get(row.id)?.some((issue) => issue.severity === 'error') ||
    issues.some((issue) => issue.rowId === row.id && issue.severity === 'error');
  const attentionCount = rows.filter(needsAttention).length;
  const reviewRows =
    reviewFilter === 'attention' ? rows.filter((row) => attentionSnapshot.has(row.id)) : rows;
  const rowIdsKey = rows.map((row) => row.id).join('|');
  useEffect(() => {
    setReviewFilter('all');
    setAttentionSnapshot(new Set());
  }, [rowIdsKey]);
  const isAiPreview = issues.some((issue) => issue.code === 'ai-review-required');
  const generalIssues = issues.filter(
    (issue) => !['ai-review-required', 'ai-uncertain-field'].includes(issue.code),
  );
  const updateDraft = (before: PersonalImportRow, next: PersonalImportRow) => {
    if (next.kind === 'timetable' && profile) {
      const slots = periodSlots(profile);
      if (next.startPeriod !== before.startPeriod)
        next = {
          ...next,
          startTime: slots[(next.startPeriod ?? 0) - 1]?.start,
          periodLabel: undefined,
        };
      if (next.endPeriod !== before.endPeriod)
        next = { ...next, endTime: slots[(next.endPeriod ?? 0) - 1]?.end, periodLabel: undefined };
    }
    setAiReviewed(false);
    setEditedIds((current) => (current.includes(next.id) ? current : [...current, next.id]));
    setRows((items) => items.map((item) => (item.id === before.id ? next : item)));
    const validation = validatePersonalImportRow(next, { periodProfile: profile });
    setIssues((items) =>
      items.filter(
        (issue) =>
          !(
            ['unrecognized-field', 'ai-uncertain-field'].includes(issue.code) &&
            issue.rowId === next.id &&
            issue.field &&
            before[issue.field] !== next[issue.field] &&
            !validation.some((item) => item.field === issue.field && item.severity === 'error')
          ),
      ),
    );
  };

  const organizeWithAi = async (input?: {
    text: string;
    source: { type: 'paste' | 'file' | 'screenshot'; name?: string };
    fromDocument?: boolean;
  }) => {
    const inputText = input?.text ?? text;
    const inputSource = input?.source ?? source;
    if (
      !active() ||
      busy ||
      savingRef.current ||
      (!input?.fromDocument && rows.length) ||
      !inputText.trim()
    )
      return;
    cancel();
    const run = generation.current;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setAiRunning(true);
    setAiReviewed(false);
    setNotice('本機 AI 正在整理文字、對照來源，完成後仍需由你核對。');
    try {
      const parsed = await runMobilePersonalImportAi(
        inputText,
        { kind, schoolId, academicYear, semester, source: inputSource, periodProfile: profile },
        controller.signal,
      );
      if (!current(run) || controller.signal.aborted) return;
      if (!parsed.rows.length) throw new Error('沒有可核對的資料。');
      const validationKeys = new Set(
        parsed.rows
          .flatMap((row) => validatePersonalImportRow(row, { periodProfile: profile }))
          .map((issue) => JSON.stringify(issue)),
      );
      setRows(parsed.rows);
      setSelected(new Set(parsed.rows.map((row) => row.id)));
      setIssues(parsed.issues.filter((issue) => !validationKeys.has(JSON.stringify(issue))));
      setVisibleRowCount(50);
      setReviewFilter('all');
      setExpanded(null);
      setSchoolPage(null);
      if (input?.fromDocument) {
        clearDocumentSource();
        setDocumentPrep(null);
        setBackupPreview(null);
        setText(inputText);
        setSource(inputSource);
        clearSourceImage();
      }
      setNotice(
        parsed.rows.length
          ? `AI 已整理 ${parsed.rows.length} 筆待核對資料。請對照原文，修正缺漏並確認，才會新增。`
          : 'AI 沒有整理出可核對的資料，原文仍保留。可縮短內容重試，或使用一般整理。',
      );
    } catch {
      if (current(run) && !controller.signal.aborted)
        setNotice('AI 未能完成這次整理。原文與已儲存資料仍保留，可分批重試或使用一般整理。');
    } finally {
      if (current(run)) {
        setBusy(false);
        setAiRunning(false);
        setAiState(getMobileImportAiAvailability());
      }
    }
  };
  const organizeDocumentWithAi = () => {
    if (!documentPrep || !active() || busy || savingRef.current || aiState.status !== 'ready')
      return;
    try {
      const input = personalImportDocumentAiSource(
        documentPrep.document,
        { selected: Object.keys(documentPrep.selections), headers: { ...documentPrep.selections } },
        MOBILE_IMPORT_AI_MAX_CHARACTERS,
      );
      void organizeWithAi({ ...input, fromDocument: true });
    } catch (error) {
      setNotice(personalImportErrorMessage(error, '選取內容還不能交給 AI，請縮小範圍或重新選擇。'));
    }
  };

  const preview = () => {
    cancel();
    setAiReviewed(false);
    setReviewFilter('all');
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
      clearDocumentSource();
      setDocumentPrep(null);
      setBackupPreview(null);
      setVisibleRowCount(50);
      setRows(parsed.rows);
      setSelected(new Set(parsed.rows.map((row) => row.id)));
      // Parser errors (including unsupported calendar recurrence) survive field editing.
      // Only current row validation is recalculated from the editable values below.
      setIssues(parsed.issues.filter((issue) => !validationKeys.has(JSON.stringify(issue))));
      setExpanded(parsed.rows[0]?.id || null);
      setNotice(
        parsed.rows.length
          ? personalImportPreviewNotice(parsed.rows.length)
          : '沒有找到可匯入的資料。可修正文字，或手動新增一筆。',
      );
    } catch (error) {
      setNotice(personalImportErrorMessage(error, '無法解析，請檢查內容。'));
    }
  };
  const pickImage = async (referenceOnly = false) => {
    cancel();
    const run = generation.current;
    setBusy(true);
    setNotice('');
    setSchoolPage(null);
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
      if (referenceOnly) {
        setSourceImage({ uri: asset.uri, width: asset.width, height: asset.height });
        setNotice('已補上對照截圖，草稿內容沒有變更。');
        return;
      }
      const base64 = await readImageBase64(asset.uri);
      if (!current(run)) return;
      abort.current = new AbortController();
      if (!ocr.current) throw new Error('辨識程式尚未就緒，請改貼文字。');
      setNotice('正在讀取截圖，可隨時取消。');
      const result = await ocr.current.recognize(base64, mime, abort.current.signal);
      if (!current(run)) return;
      setText(result);
      setSource({ type: 'screenshot', name: asset.fileName || '截圖' });
      setSourceImage({ uri: asset.uri, width: asset.width, height: asset.height });
      setImageViewerOpen(false);
      clearDocumentSource();
      setDocumentPrep(null);
      setBackupPreview(null);
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
    setNotice('');
    setSchoolPage(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'text/*',
          'text/html',
          'application/csv',
          'text/tab-separated-values',
          'application/octet-stream',
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (!current(run) || result.canceled) return;
      const asset = result.assets[0];
      const name = asset.name || '';
      if (/\.html?$/i.test(name)) {
        const file = new File(asset.uri);
        if ((asset.size || file.size) > 512_000)
          throw new Error('學校網頁存檔超過 500 KB，請只保存表格或改用 CSV。');
        const tables = extractSchoolPageTables(await file.text(), kind, profile);
        if (!current(run)) return;
        setSchoolPage({ name, tables });
        setNotice('找到 ' + tables.length + ' 張校務表格。選取內容後，仍需核對才會儲存。');
        return;
      }
      if (personalImportDocumentFormat(name)) {
        const size = asset.size;
        if (typeof size === 'number') {
          if (size <= 0) throw new Error('這個檔案沒有內容，請重新選擇。');
          if (size > PERSONAL_IMPORT_DOCUMENT_LIMITS.bytes)
            throw new Error('PDF／Excel 上限 8 MiB，請拆成較小的檔案。');
        }
        if (!documents.current) throw new Error('文件讀取程式尚未就緒，請改用 CSV 或截圖。');
        setNotice('正在讀取文件，可隨時取消。不會上傳網路。');
        abort.current = new AbortController();
        const source = { uri: asset.uri, name, size: asset.size };
        const document = await documents.current.read(source, abort.current.signal);
        if (!current(run)) return;
        setBackupPreview(null);
        documentSource.current = document.format === 'pdf' ? source : null;
        setDocumentPrep({ document, selections: {} });
        setNotice(
          document.sections.some((section) => !section.needsOcr && section.rows.length)
            ? '請選擇要讀取的工作表或頁面，並指定標題列。確認前不會寫入。'
            : '這個檔案沒有可讀取的文字頁。掃描 PDF 請改用「選擇截圖」；若預覽不完整也可試「重新辨識 PDF 整頁」。',
        );
        return;
      }
      if (!/\.(txt|csv|tsv|ics)$/i.test(name))
        throw new Error('目前支援 HTML、TXT、CSV、TSV、ICS、PDF、XLSX。舊版 XLS 請先另存為 XLSX。');
      const file = new File(asset.uri);
      if ((asset.size || file.size) > 512 * 1024)
        throw new Error('文字檔上限 512 KB，請分批匯入。');
      const resultText = await file.text();
      if (!current(run)) return;
      if (resultText.length > 100_000) throw new Error('文字過長，請分批匯入。');
      clearDocumentSource();
      setDocumentPrep(null);
      setText(resultText);
      setSource({ type: 'file', name });
      clearSourceImage();
      setBackupPreview(null);
      setRows([]);
      setIssues([]);
      if (/\.ics$/i.test(name)) setKind('events');
      setNotice(`已讀取 ${name}，請核對內容後整理。`);
    } catch (error) {
      if (current(run))
        setNotice(
          personalImportErrorMessage(error, '檔案讀取失敗。可能已加密、損壞、過大或無法開啟。'),
        );
    } finally {
      if (current(run)) setBusy(false);
    }
  };
  const toggleDocumentSection = (sectionId: string) => {
    if (busy || saving) return;
    setDocumentPrep((currentPrep) => {
      if (!currentPrep) return currentPrep;
      const section = currentPrep.document.sections.find((item) => item.id === sectionId);
      if (!section) return currentPrep;
      const selections = { ...currentPrep.selections };
      if (sectionId in selections) {
        delete selections[sectionId];
        return { ...currentPrep, selections };
      }
      if (section.needsOcr || !section.rows.length) return currentPrep;
      selections[sectionId] = section.rows[0].line;
      return { ...currentPrep, selections };
    });
  };
  const setDocumentHeaderLine = (sectionId: string, headerLine: number) => {
    if (busy || saving) return;
    setDocumentPrep((currentPrep) => {
      if (!currentPrep || !(sectionId in currentPrep.selections)) return currentPrep;
      return {
        ...currentPrep,
        selections: { ...currentPrep.selections, [sectionId]: headerLine },
      };
    });
  };
  const cancelDocumentPrep = () => {
    if (busy || saving) return;
    clearDocumentSource();
    setDocumentPrep(null);
    setNotice('已取消文件準備，先前草稿保留。');
  };
  const rereadDocumentPdf = async () => {
    if (
      !documentPrep ||
      documentPrep.document.format !== 'pdf' ||
      !documentSource.current ||
      busy ||
      saving ||
      savingRef.current ||
      !documents.current
    )
      return;
    const source = documentSource.current;
    generation.current += 1;
    abort.current?.abort();
    documents.current.cancel();
    const run = generation.current;
    setBusy(true);
    setNotice('正在這台裝置重新辨識 PDF 每一頁，原本的預覽會保留到讀取完成…');
    try {
      abort.current = new AbortController();
      const document = await documents.current.read(source, abort.current.signal, {
        pdfMode: 'ocr',
      });
      if (!current(run)) return;
      setDocumentPrep({ document, selections: {} });
      setNotice(
        document.sections.some((section) => !section.needsOcr && section.rows.length)
          ? '已重新辨識整頁。請再選擇頁面與標題列；確認前不會寫入。'
          : '重新辨識後仍沒有可讀取的文字頁。請改用「選擇截圖」。',
      );
    } catch (error) {
      if (
        current(run) &&
        !(error instanceof PersonalImportDocumentError && error.code === 'cancelled')
      )
        setNotice(personalImportErrorMessage(error, '重新辨識失敗。原本的文件預覽仍可使用。'));
      else if (current(run)) setNotice('已取消重新辨識，原本的文件預覽保留。');
    } finally {
      if (current(run)) setBusy(false);
    }
  };
  const applyDocumentSelection = () => {
    if (!documentPrep || busy || saving || savingRef.current) return;
    const entries = Object.entries(documentPrep.selections);
    if (!entries.length) {
      setNotice('請先選擇至少一個工作表或頁面。');
      return;
    }
    const blocked = entries.find(
      ([sectionId]) =>
        documentPrep.document.sections.find((item) => item.id === sectionId)?.needsOcr,
    );
    if (blocked) {
      setNotice('選取的頁面沒有可讀文字。請改用「選擇截圖」辨識掃描頁。');
      return;
    }
    setBusy(true);
    try {
      const options = {
        kind,
        schoolId: scope.schoolId,
        academicYear,
        semester,
        periodProfile: profile,
      };
      const parsedRows: PersonalImportRow[] = [];
      const parsedIssues: ImportIssue[] = [];
      for (const [sectionId, headerLine] of entries) {
        const parsed = parsePersonalImportDocument(
          documentPrep.document,
          sectionId,
          headerLine,
          options,
        );
        parsedRows.push(...parsed.rows);
        parsedIssues.push(...parsed.issues);
      }
      if (parsedRows.length > PERSONAL_IMPORT_MAX_ROWS)
        throw new Error('選取的內容超過 500 筆，請減少工作表或頁面，分次匯入。');
      const validationKeys = new Set(
        parsedRows
          .flatMap((row) => validatePersonalImportRow(row, { periodProfile: profile }))
          .map((issue) => JSON.stringify(issue)),
      );
      clearDocumentSource();
      setDocumentPrep(null);
      setBackupPreview(null);
      setText('');
      setSource({ type: 'file', name: documentPrep.document.name });
      clearSourceImage();
      setVisibleRowCount(50);
      setRows(parsedRows);
      setSelected(new Set(parsedRows.map((row) => row.id)));
      setIssues(parsedIssues.filter((issue) => !validationKeys.has(JSON.stringify(issue))));
      setExpanded(parsedRows[0]?.id || null);
      setNotice(
        parsedRows.length
          ? personalImportPreviewNotice(parsedRows.length)
          : '選取範圍沒有找到可匯入的資料。可調整標題列，或改貼文字。',
      );
    } catch (error) {
      setNotice(
        personalImportErrorMessage(error, '無法讀取選取內容，請調整工作表、頁面或標題列。'),
      );
    } finally {
      setBusy(false);
    }
  };
  const readBackup = async () => {
    if (savingRef.current) return;
    cancel();
    const run = generation.current;
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', 'application/octet-stream'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (!current(run) || result.canceled) return;
      const asset = result.assets[0];
      if (!asset || !/\.json$/i.test(asset.name))
        throw new Error('請選擇 Campus One 匯出的 JSON 備份檔。');
      const file = new File(asset.uri);
      if ((asset.size || file.size) > PERSONAL_IMPORT_BACKUP_MAX_BYTES)
        throw new Error('備份檔超過 8 MB，請確認檔案。');
      const content = await file.text();
      if (!current(run)) return;
      const { rows: restored, ...summary } = parsePersonalImportBackup(content);
      if (summary.schoolId !== scope.schoolId)
        throw new Error(
          `這份備份屬於 ${summary.schoolId}，與目前學校不同。請先切換學校再還原；原有資料沒有變更。`,
        );
      clearDocumentSource();
      setDocumentPrep(null);
      setText('');
      setRows(restored);
      clearSourceImage();
      setSelected(new Set(restored.map((row) => row.id)));
      setIssues([]);
      setVisibleRowCount(50);
      setExpanded(restored[0]?.id || null);
      setEditing(null);
      setBackupPreview({ ...summary, name: asset.name });
      setNotice('已讀取備份。請核對目的帳號、學校與各筆資料；確認前不會寫入。');
    } catch (error) {
      if (current(run))
        setNotice(error instanceof Error ? error.message : '備份讀取失敗，原有資料沒有變更。');
    } finally {
      if (current(run)) setBusy(false);
    }
  };
  const shareBackup = async () => {
    if (savingRef.current || !active()) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await sharePersonalImportBackup(scope, active);
      if (active())
        setNotice(
          '已開啟系統分享選單。是否已保存，請到你選擇的目的地確認；這不代表資料已雲端同步。',
        );
    } catch (error) {
      if (active())
        setNotice(error instanceof Error ? error.message : '分享未完成，個人資料仍保留。');
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
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
    if (
      savingRef.current ||
      busy ||
      !active() ||
      !chosen.length ||
      invalidCount ||
      structuralErrors.length ||
      !ledger ||
      (isAiPreview && !aiReviewed)
    )
      return;
    savingRef.current = true;
    ledgerGeneration.current += 1;
    setSaving(true);
    try {
      verifyLinks(chosen);
      const result = await appendPersonalImports(scope, chosen, active, {
        restoreBackup: !!backupPreview,
      });
      if (!active()) return;
      setLedger(result.ledger);
      setBackupPreview(null);
      setRows([]);
      setSelected(new Set());
      setIssues([]);
      setExpanded(null);
      setText('');
      setSource({ type: 'paste' });
      clearSourceImage();
      setNotice(personalImportSavedNotice(result.added, !!ledger.sync?.enabled));
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
  const savedRecords = useMemo(() => {
    if (!ledger) return [];
    const query = savedQuery.trim().toLowerCase();
    return ledger.records.filter(
      (row) =>
        row.kind === kind &&
        (!query ||
          [row.title, row.teacher, row.courseCode, row.academicYear, row.location, row.grade].some(
            (value) =>
              String(value || '')
                .toLowerCase()
                .includes(query),
          )),
    );
  }, [ledger, kind, savedQuery]);

  const deleteRecord = async () => {
    const original = deleting;
    if (!original || savingRef.current) return;
    savingRef.current = true;
    ledgerGeneration.current += 1;
    setSaving(true);
    try {
      const next = await deletePersonalImport(scope, original, active);
      if (active()) {
        setLedger(next);
        setEditing(null);
        setDeleting(null);
        setSavedFeedback('已移除這筆個人紀錄；其他紀錄不受影響。');
      }
    } catch (error) {
      if (active()) {
        setSavedFeedback(personalImportErrorMessage(error, '移除失敗，原資料沒有變更。'));
        setDeleting(null);
        void load();
      }
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
  };

  const exportRecords = async () => {
    if (sharingRef.current || savingRef.current || !active()) return;
    sharingRef.current = true;
    setExporting(true);
    setSavedFeedback('');
    try {
      const latest = await snapshotPersonalImports(scope, active);
      if (!active()) return;
      const records = latest.records.filter((row) => row.kind === kind);
      if (!records.length) {
        setSavedFeedback('這類資料目前沒有可匯出的紀錄。');
        return;
      }
      const supported = await Sharing.isAvailableAsync();
      if (!active()) return;
      if (!supported) {
        setSavedFeedback('此裝置目前無法開啟系統檔案分享。資料仍留在裝置上。');
        return;
      }
      const file = new File(
        Paths.cache,
        'campus-one-' + kind + '-' + createPersonalImportId() + '.csv',
      );
      file.create();
      file.write(serializePersonalImportsCsv(records));
      if (!active()) {
        file.delete();
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/csv',
        UTI: 'public.comma-separated-values-text',
      });
      if (active()) setSavedFeedback('分享選單已關閉；請確認已在「檔案」或其他位置完成儲存。');
    } catch (error) {
      if (active())
        setSavedFeedback(personalImportErrorMessage(error, '無法準備 CSV，原有資料未變更。'));
    } finally {
      sharingRef.current = false;
      if (alive.current) setExporting(false);
    }
  };

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

  if (!draftReady || draftError)
    return (
      <Screen>
        <Text accessibilityLabel="讀取匯入紀錄" style={textStyle}>
          {draftError || '正在讀取匯入草稿…'}
        </Text>
      </Screen>
    );
  return (
    <Screen title="匯入我的資料" subtitle="課表、成績、活動，從你手上的資料開始">
      <TimetableOcrHost ref={ocr} />
      <DocumentImportHost ref={documents} />
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
          <View
            style={{
              padding: 18,
              borderRadius: 18,
              gap: 10,
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderWidth: 1,
            }}
          >
            <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
              {school?.name || scope.schoolId} ·{' '}
              {scope.owner === 'guest:device' ? '此裝置的訪客資料' : '我的個人資料'}
            </Text>
            <Text
              accessibilityRole="header"
              style={{ ...textStyle, fontSize: 22, lineHeight: 30, fontWeight: '700' }}
            >
              把學校資料整理好
            </Text>
            <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
              放入表格、截圖或文字，核對後才新增。已存資料不會整份被取代。
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingTop: 4 }}>
              {['1 放入資料', '2 核對內容', '3 確認新增'].map((step, index) => (
                <Text
                  key={step}
                  style={{
                    fontSize: 13,
                    fontWeight: '600',
                    color: (rows.length ? index === 1 : index === 0)
                      ? theme.colors.accentStrong
                      : theme.colors.muted,
                  }}
                >
                  {step}
                </Text>
              ))}
            </View>
          </View>
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
                  setAiReviewed(false);
                  setReviewFilter('all');
                  setSchoolPage(null);
                  clearDocumentSource();
                  setDocumentPrep(null);
                  if (!backupPreview) {
                    setRows([]);
                    setIssues([]);
                  }
                  setEditing(null);
                  setDeleting(null);
                  setSavedQuery('');
                  setVisibleSavedCount(40);
                  setSavedFeedback('');
                }}
              />
            ))}
          </View>
          {backupPreview ? (
            <View style={{ gap: 10 }}>
              <Text style={{ ...textStyle, fontWeight: '700' }}>
                備份還原預覽：{backupPreview.name}
              </Text>
              <Text style={textStyle}>
                目的地：
                {scope.owner === 'guest:device'
                  ? '這台裝置的訪客資料'
                  : scope.owner.startsWith('nuni:')
                    ? '目前登入的平台帳號'
                    : '目前登入的校園帳號'}{' '}
                · {school?.name || scope.schoolId}
              </Text>
              <Text style={textStyle}>
                備份時間：{new Date(backupPreview.exportedAt).toLocaleString('zh-TW')}。課表{' '}
                {backupPreview.counts.timetable} 筆、成績 {backupPreview.counts.grades} 筆、活動{' '}
                {backupPreview.counts.events} 筆。
              </Text>
              <Text style={{ color: theme.colors.muted }}>
                每筆資料保留原學年度、學期與來源。新匯入資料的課班連結需從目前可存取的課班重新選擇；原有相同紀錄的個人連結會保留。
              </Text>
              <Button
                text="取消備份預覽"
                disabled={saving}
                onPress={() => {
                  setBackupPreview(null);
                  setRows([]);
                  setIssues([]);
                  setSelected(new Set());
                  setNotice('已取消預覽，原有資料沒有變更。');
                }}
              />
            </View>
          ) : documentPrep ? (
            <View style={{ gap: 12 }}>
              <Text style={{ ...textStyle, fontWeight: '700' }}>
                準備讀取：{documentPrep.document.name}
              </Text>
              <Text style={{ color: theme.colors.muted }}>
                {documentPrep.document.format === 'pdf' ? 'PDF' : 'Excel'}
                。請選取工作表或頁面與讀取起始列；一般讀取使用標題列，AI
                可直接理解原始內容。檔案只在這台裝置讀取。
              </Text>
              {documentPrep.document.warnings.map((warning, index) => (
                <Text key={`doc-warn-${index}`} style={{ color: theme.colors.muted }}>
                  {warning}
                </Text>
              ))}
              {documentPrep.document.format === 'pdf' ? (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: theme.colors.muted }}>
                    預覽只有標題，或表格文字不完整？可以重新辨識整頁，再核對一次。不會自動對每個 PDF
                    做整頁辨識。
                  </Text>
                  <Button
                    text="重新辨識 PDF 整頁"
                    disabled={busy || saving || !documentSource.current}
                    onPress={() => void rereadDocumentPdf()}
                  />
                </View>
              ) : null}
              {busy ? (
                <>
                  <ActivityIndicator
                    accessibilityLabel={aiRunning ? 'AI 正在整理文件' : '正在讀取文件'}
                  />
                  <Button
                    text={aiRunning ? '取消 AI 整理' : '取消讀取'}
                    onPress={() => {
                      cancel();
                      setNotice(
                        aiRunning
                          ? '已取消 AI 整理，文件與選取範圍仍保留。'
                          : '已取消重新辨識，原本的文件預覽保留。',
                      );
                    }}
                  />
                </>
              ) : null}
              <Text style={textStyle}>選擇工作表／頁面</Text>
              {documentPrep.document.sections.map((section) => {
                const selectedSection = section.id in documentPrep.selections;
                const headerLine = documentPrep.selections[section.id];
                return (
                  <View
                    key={section.id}
                    style={{
                      borderTopWidth: 1,
                      borderColor: theme.colors.border,
                      paddingTop: 12,
                      gap: 8,
                    }}
                  >
                    <Button
                      text={`${selectedSection ? '☑' : '□'} ${section.label}${
                        section.needsOcr ? '（無文字，需截圖）' : ''
                      }`}
                      kind={selectedSection ? 'primary' : 'outline'}
                      disabled={busy || saving || section.needsOcr || !section.rows.length}
                      onPress={() => toggleDocumentSection(section.id)}
                    />
                    {section.needsOcr ? (
                      <Text style={{ color: theme.colors.muted }}>
                        此頁沒有可讀文字（可能是掃描影像）。請改用「選擇截圖」辨識，不要當成已成功讀取。
                      </Text>
                    ) : null}
                    {section.warnings.map((warning, index) => (
                      <Text
                        key={`${section.id}-warn-${index}`}
                        style={{ color: theme.colors.muted }}
                      >
                        {warning}
                      </Text>
                    ))}
                    {selectedSection ? (
                      <>
                        <Text style={textStyle}>標題列／AI 讀取起始列</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {section.rows.slice(0, DOCUMENT_PREVIEW_ROWS).map((row) => (
                            <Button
                              key={`${section.id}-header-${row.line}`}
                              text={`第 ${row.line} 列`}
                              kind={headerLine === row.line ? 'primary' : 'outline'}
                              disabled={busy || saving}
                              onPress={() => setDocumentHeaderLine(section.id, row.line)}
                            />
                          ))}
                        </View>
                        <Text style={{ color: theme.colors.muted }}>前幾列預覽</Text>
                        {section.rows.slice(0, DOCUMENT_PREVIEW_ROWS).map((row) => (
                          <Text
                            key={`${section.id}-preview-${row.line}`}
                            style={{
                              ...textStyle,
                              fontWeight: headerLine === row.line ? '700' : '400',
                            }}
                          >
                            {row.line}. {row.cells.join('｜') || '（空列）'}
                          </Text>
                        ))}
                      </>
                    ) : null}
                  </View>
                );
              })}
              <Button
                text="讀取選取內容"
                kind="primary"
                disabled={busy || saving || !Object.keys(documentPrep.selections).length}
                onPress={applyDocumentSelection}
              />
              <View
                style={{
                  padding: 16,
                  borderRadius: 14,
                  backgroundColor: theme.colors.focusSurface,
                  borderColor: theme.colors.border,
                  borderWidth: 1,
                  gap: 10,
                }}
              >
                <Text style={{ ...textStyle, fontWeight: '600' }}>
                  欄位不規則？交給本機 AI 整理
                </Text>
                <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.text }}>
                  {aiState.title}
                </Text>
                <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
                  AI 會從選取的起始列理解文字，不必先辨認標準欄位名稱。一次最多 1,000
                  字；失敗或取消會保留文件與選取範圍。
                </Text>
                <Button
                  text="用 AI 整理選取內容"
                  kind="primary"
                  disabled={
                    busy ||
                    saving ||
                    aiState.status !== 'ready' ||
                    !Object.keys(documentPrep.selections).length
                  }
                  onPress={organizeDocumentWithAi}
                />
                <Button
                  text="管理本機模型"
                  disabled={
                    busy || saving || aiState.status === 'unavailable' || aiState.status === 'busy'
                  }
                  onPress={() => setModelManagerOpen(true)}
                />
              </View>
              <Button
                text="取消，回到先前草稿"
                disabled={busy || saving}
                onPress={cancelDocumentPrep}
              />
            </View>
          ) : (
            <>
              <Field
                label="這批資料的學年度（例如 115）"
                value={academicYear}
                onChange={(value) => {
                  if (busy) cancel();
                  setYear(value);
                  setRows([]);
                  setIssues([]);
                  setAiReviewed(false);
                }}
                disabled={saving}
              />
              <Field
                label="這批資料的學期（例如 1、2、暑期）"
                value={semester}
                onChange={(value) => {
                  if (busy) cancel();
                  setSemester(value);
                  setRows([]);
                  setIssues([]);
                  setAiReviewed(false);
                }}
                disabled={saving}
              />
              <Text
                accessibilityRole="header"
                style={{ ...textStyle, fontSize: 19, fontWeight: '700' }}
              >
                1. 放入資料
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <View
                  style={{
                    flex: 1,
                    minWidth: 140,
                    padding: 14,
                    borderRadius: 14,
                    borderColor: theme.colors.border,
                    borderWidth: 1,
                    backgroundColor: theme.colors.surface,
                    gap: 8,
                  }}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                    學校表格／文件
                  </Text>
                  <Text style={{ color: theme.colors.muted, lineHeight: 21 }}>
                    保留原始欄位，適合課表與成績單。
                  </Text>
                  <Button text="選擇檔案" onPress={pickFile} disabled={busy || saving} />
                </View>
                <View
                  style={{
                    flex: 1,
                    minWidth: 140,
                    padding: 14,
                    borderRadius: 14,
                    borderColor: theme.colors.border,
                    borderWidth: 1,
                    backgroundColor: theme.colors.surface,
                    gap: 8,
                  }}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: '600' }}>手機裡的截圖</Text>
                  <Text style={{ color: theme.colors.muted, lineHeight: 21 }}>
                    讀出文字後，再讓本機 AI 協助整理。
                  </Text>
                  <Button
                    text="選擇截圖"
                    onPress={() => void pickImage()}
                    disabled={busy || saving}
                  />
                </View>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {busy ? (
                  <Button
                    text={aiRunning ? '取消 AI 整理' : '取消讀取'}
                    onPress={() => {
                      cancel();
                      setNotice('已取消，原有資料沒有變更。');
                    }}
                  />
                ) : null}
              </View>
              <Text style={{ color: theme.colors.muted }}>
                截圖支援 PNG、JPG，最多 8 MB；從學校網站儲存的 HTML 可選取課程或成績表格（500 KB
                內）。 文字檔支援 TXT、CSV、TSV、ICS；PDF／XLSX 上限 8
                MiB。內容在裝置上讀取，不會上傳。
              </Text>
              {schoolPage ? (
                <View
                  style={{
                    gap: 12,
                    padding: 16,
                    backgroundColor: theme.colors.focusSurface,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}
                >
                  <Text style={{ ...textStyle, fontWeight: '700' }}>選擇校務網頁表格</Text>
                  <Text style={{ color: theme.colors.muted }}>
                    來源：{schoolPage.name}
                    。只讀取表格文字，未連線學校或使用帳號密碼。請先選正確表格，再核對資料。
                  </Text>
                  {schoolPage.tables.map((table) => (
                    <Button
                      key={table.id}
                      text={
                        table.label +
                        (table.suggestedTerm
                          ? ' · ' +
                            table.suggestedTerm.academicYear +
                            ' 學年度第 ' +
                            table.suggestedTerm.semester +
                            ' 學期'
                          : '')
                      }
                      disabled={busy || saving}
                      onPress={() => {
                        setText(table.text);
                        clearSourceImage();
                        if (table.suggestedTerm) {
                          if (!academicYear.trim()) setYear(table.suggestedTerm.academicYear);
                          if (!semester.trim()) setSemester(table.suggestedTerm.semester);
                        }
                        setSource({ type: 'file', name: schoolPage.name });
                        setRows([]);
                        setIssues([]);
                        setBackupPreview(null);
                        setSchoolPage(null);
                        setNotice(
                          '已帶入 ' +
                            table.rowCount +
                            ' 筆文字。請檢查下方內容，再點選整理成可編輯資料。',
                        );
                      }}
                    />
                  ))}
                  <Button
                    text="取消選擇表格"
                    onPress={() => setSchoolPage(null)}
                    disabled={busy || saving}
                  />
                </View>
              ) : null}
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
                  if (!value || source.type !== 'screenshot') {
                    setSource({ type: 'paste' });
                    clearSourceImage();
                  }
                  setRows([]);
                  setIssues([]);
                  setAiReviewed(false);
                }}
                style={[inputStyle, { minHeight: 130, textAlignVertical: 'top' }]}
              />
              <Text style={{ color: theme.colors.muted }}>
                {kind === 'timetable'
                  ? profile
                    ? `目前使用${PERIOD_PROFILE_TITLES[profile]} ${periodCount(profile)} 節。文字範例：資料庫 星期一 第3-4節 老師：王老師 教室：主顧303`
                    : '這所學校尚未設定課表格線，請保留原始時間。文字範例：資料庫 星期一 09:00-12:00 老師：王老師'
                  : kind === 'grades'
                    ? 'CSV／TSV 欄位：課程名稱,學分,成績,課號,教師'
                    : 'CSV／TSV 欄位：活動名稱,日期,開始時間,結束時間,地點。全天活動加「全天」欄並填「是」，時間留空。'}
              </Text>
              <View
                style={{
                  padding: 16,
                  borderRadius: 16,
                  gap: 10,
                  backgroundColor: theme.colors.focusSurface,
                  borderColor: theme.colors.border,
                  borderWidth: 1,
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <Text style={{ ...textStyle, fontWeight: '700' }}>用免費 AI 整理文字</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>在手機執行</Text>
                </View>
                <Text
                  accessibilityLiveRegion="polite"
                  style={{ color: theme.colors.text, fontWeight: '600' }}
                >
                  {aiState.title}
                </Text>
                <Text style={{ color: theme.colors.muted, lineHeight: 21 }}>{aiState.detail}</Text>
                <Text style={{ color: theme.colors.muted, lineHeight: 21 }}>
                  手機 AI 理解的是讀出的文字；週格位置可能無法從文字還原，格狀課表建議先選學校表格。
                </Text>
                <Text
                  style={{
                    color:
                      text.length > MOBILE_IMPORT_AI_MAX_CHARACTERS
                        ? theme.colors.danger
                        : theme.colors.muted,
                    fontSize: 12,
                  }}
                >
                  {text.length.toLocaleString()}／{MOBILE_IMPORT_AI_MAX_CHARACTERS.toLocaleString()}{' '}
                  字 · 較長內容請分批，不會自動刪去後段。
                </Text>
                <Button
                  text={aiRunning ? 'AI 正在整理…' : '讓本機 AI 整理'}
                  kind="primary"
                  disabled={
                    !text.trim() ||
                    text.length > MOBILE_IMPORT_AI_MAX_CHARACTERS ||
                    aiState.status !== 'ready' ||
                    busy ||
                    saving ||
                    rows.length > 0
                  }
                  onPress={() => void organizeWithAi()}
                />
                <Button
                  text="管理本機模型"
                  disabled={
                    busy || saving || aiState.status === 'unavailable' || aiState.status === 'busy'
                  }
                  onPress={() => setModelManagerOpen(true)}
                />
              </View>
              <Button
                text="整理成可編輯資料"
                kind="outline"
                disabled={!text.trim() || busy || saving}
                onPress={preview}
              />
              <Button
                text="手動新增一筆"
                disabled={busy || saving}
                onPress={() => {
                  setAiReviewed(false);
                  setReviewFilter('all');
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
            </>
          )}
          {kind === 'timetable' && rows.length > 0 ? (
            <Button
              text="補上對照截圖（保留草稿）"
              disabled={busy || saving}
              onPress={() => void pickImage(true)}
            />
          ) : null}
          {kind === 'timetable' && !documentPrep && !backupPreview ? (
            <TimetableReviewGrid
              rows={rows.filter((row) => selected.has(row.id))}
              editedIds={editedIds}
              profile={profile}
              disabled={busy || saving}
              onEdit={(row) => {
                setReviewFilter('all');
                setVisibleRowCount(rows.length);
                setGridEditing(row.id);
              }}
              onAdd={(day, period) => {
                const row: PersonalImportRow = {
                  id: createPersonalImportId(),
                  kind: 'timetable',
                  title: '',
                  schoolId,
                  academicYear,
                  semester,
                  dayOfWeek: day,
                  startPeriod: period,
                  endPeriod: period,
                  source: { type: 'paste', line: 1, rawText: '' },
                };
                setRows((current) => [...current, row]);
                setSelected((current) => new Set([...current, row.id]));
                setGridEditing(row.id);
                setReviewFilter('all');
                setVisibleRowCount(rows.length + 1);
                setAiReviewed(false);
              }}
            />
          ) : null}
          {rows.length ? (
            <Button
              text="取消這份草稿"
              disabled={busy || saving}
              onPress={() => {
                setRows([]);
                setSelected(new Set());
                setIssues([]);
                setBackupPreview(null);
                setGridEditing(null);
                setAiReviewed(false);
                setNotice('已取消待確認清單，原有課表沒有變更。');
              }}
            />
          ) : null}
          <Modal
            visible={!!gridRow && available}
            transparent={false}
            onRequestClose={() => setGridEditing(null)}
          >
            <ScrollView
              contentContainerStyle={{
                padding: 20,
                gap: 12,
                backgroundColor: theme.colors.surface,
              }}
            >
              <Text style={{ color: theme.colors.text, fontSize: 20 }}>修正草稿課程</Text>
              {sourceImage ? (
                <Image
                  source={{ uri: sourceImage.uri }}
                  accessibilityLabel="原始匯入截圖"
                  resizeMode="contain"
                  style={{ width: '100%', height: 220 }}
                />
              ) : null}
              {gridRow ? (
                <>
                  <RowEditor
                    row={gridRow}
                    workspaces={workspaces}
                    periodProfile={profile}
                    disabled={saving || busy}
                    onChange={(next) => updateDraft(gridRow, next)}
                  />
                  <Button
                    text="拆成單節課程"
                    disabled={
                      saving ||
                      busy ||
                      !gridRow.startPeriod ||
                      !gridRow.endPeriod ||
                      gridRow.endPeriod <= gridRow.startPeriod
                    }
                    onPress={() => {
                      const parts = splitReviewRow(gridRow, profile);
                      setEditedIds((current) => [
                        ...new Set([...current, ...parts.map((item) => item.id)]),
                      ]);
                      setRows((current) =>
                        current.flatMap((row) => (row.id === gridRow.id ? parts : [row])),
                      );
                      setSelected(
                        (current) => new Set([...current, ...parts.map((row) => row.id)]),
                      );
                      setAiReviewed(false);
                      setGridEditing(null);
                    }}
                  />
                  <Button
                    text="與下一節同名課程合併"
                    disabled={
                      saving ||
                      busy ||
                      !nextReviewRow(
                        rows.filter((item) => selected.has(item.id)),
                        gridRow,
                      )
                    }
                    onPress={() => {
                      const next = nextReviewRow(
                        rows.filter((item) => selected.has(item.id)),
                        gridRow,
                      );
                      if (!next) return;
                      updateDraft(gridRow, {
                        ...gridRow,
                        endPeriod: next.endPeriod ?? next.startPeriod,
                        endTime: next.endTime,
                        periodLabel: undefined,
                      });
                      setRows((current) => current.filter((item) => item.id !== next.id));
                      setSelected(
                        (current) => new Set([...current].filter((id) => id !== next.id)),
                      );
                    }}
                  />
                  <Button
                    text="刪除此草稿課程"
                    disabled={saving || busy}
                    onPress={() => {
                      setRows((current) => current.filter((row) => row.id !== gridRow.id));
                      setSelected(
                        (current) => new Set([...current].filter((id) => id !== gridRow.id)),
                      );
                      setAiReviewed(false);
                      setGridEditing(null);
                    }}
                  />
                </>
              ) : null}
              <Button text="回到週課表核對" onPress={() => setGridEditing(null)} />
            </ScrollView>
          </Modal>
          {sourceImage && !documentPrep && !backupPreview ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="放大核對原始截圖"
              onPress={() => setImageViewerOpen(true)}
              style={{
                borderRadius: 16,
                borderColor: theme.colors.border,
                borderWidth: 1,
                padding: 14,
                gap: 10,
                backgroundColor: theme.colors.surface,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ ...textStyle, fontWeight: '600' }}>對照原始截圖</Text>
                <Text style={{ color: theme.colors.accentStrong }}>點一下放大</Text>
              </View>
              <Image
                accessibilityLabel="原始匯入截圖"
                source={{ uri: sourceImage.uri }}
                resizeMode="contain"
                style={{ width: '100%', height: 240, borderRadius: 8 }}
              />
              <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
                原圖只供本次核對，不會寫入匯入紀錄或備份。
              </Text>
            </Pressable>
          ) : null}
          {notice ? (
            <Text accessibilityRole="alert" style={textStyle}>
              {notice}
            </Text>
          ) : null}
          {generalIssues.length && !documentPrep ? (
            <View style={{ gap: 5 }}>
              {generalIssues.map((issue, i) => (
                <Text key={i} style={{ color: theme.colors.muted }}>
                  {issue.message}
                </Text>
              ))}
            </View>
          ) : null}
          {rows.length && !documentPrep ? (
            <>
              <Text
                accessibilityRole="header"
                style={{ ...textStyle, fontSize: 20, fontWeight: '700' }}
              >
                2. 核對 {rows.length} 筆資料
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {[
                  ['資料總數', rows.length],
                  ['待修正', attentionCount],
                  ['已選取', chosen.length],
                ].map(([label, count]) => (
                  <View
                    key={label}
                    style={{
                      flex: 1,
                      minWidth: 90,
                      borderRadius: 12,
                      backgroundColor: theme.colors.surface,
                      padding: 14,
                      gap: 6,
                    }}
                  >
                    <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{label}</Text>
                    <Text
                      style={{
                        color:
                          label === '待修正' && Number(count) > 0
                            ? theme.colors.danger
                            : theme.colors.text,
                        fontSize: 24,
                        fontWeight: '700',
                      }}
                    >
                      {count}
                    </Text>
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Button
                  text={`全部資料（${rows.length}）`}
                  kind={reviewFilter === 'all' ? 'primary' : 'outline'}
                  onPress={() => {
                    setReviewFilter('all');
                    setVisibleRowCount(50);
                  }}
                />
                <Button
                  text={`只看待修正（${attentionCount}）`}
                  kind={reviewFilter === 'attention' ? 'primary' : 'outline'}
                  onPress={() => {
                    setReviewFilter('attention');
                    setAttentionSnapshot(new Set(rows.filter(needsAttention).map((row) => row.id)));
                    setVisibleRowCount(50);
                  }}
                />
              </View>
              {reviewFilter === 'attention' && !reviewRows.length ? (
                <Text style={{ color: theme.colors.muted }}>
                  目前沒有缺少必填欄位的資料；仍請核對來源與辨識內容。
                </Text>
              ) : null}
              <Text style={textStyle}>{linksStatus}</Text>
              <Button text="重新讀取可連結課班" onPress={loadLinks} disabled={saving} />
              {!gridRow &&
                reviewRows.slice(0, visibleRowCount).map((row) => (
                  <View
                    key={row.id}
                    style={{
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      borderRadius: 16,
                      backgroundColor: theme.colors.surface,
                      padding: 16,
                      gap: 10,
                    }}
                  >
                    <Pressable
                      disabled={saving}
                      accessibilityRole="checkbox"
                      accessibilityLabel={`匯入 ${row.title || '未命名資料'}`}
                      accessibilityState={{ checked: selected.has(row.id), disabled: saving }}
                      style={{ minHeight: 44, justifyContent: 'center' }}
                      onPress={() => {
                        setAiReviewed(false);
                        setSelected((value) => {
                          const next = new Set(value);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        });
                      }}
                    >
                      <Text style={{ ...textStyle, fontWeight: '700' }}>
                        {selected.has(row.id) ? '☑' : '□'} {rows.indexOf(row) + 1}.{' '}
                        {backupPreview ? `${names[row.kind]} · ` : ''}
                        {row.title || '名稱待填'}
                      </Text>
                    </Pressable>
                    <Text style={textStyle}>{rowSummary(row, profile)}</Text>
                    {isAiPreview && row.source.rawText ? (
                      <View
                        style={{
                          backgroundColor: theme.colors.surfaceMuted,
                          padding: 12,
                          borderRadius: 10,
                          gap: 4,
                        }}
                      >
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                          來源文字 · 請對照
                        </Text>
                        <Text
                          selectable
                          style={{ color: theme.colors.textSecondary, lineHeight: 22 }}
                        >
                          {row.source.rawText}
                        </Text>
                      </View>
                    ) : null}
                    {backupPreview?.proposedLinks[row.id] ? (
                      <Text style={{ color: theme.colors.muted }}>
                        原備份有課班對照：
                        {workspaces.find((item) => item.id === backupPreview.proposedLinks[row.id])
                          ?.title || '目前無法確認原課班'}
                        。需要時請在下方重新選擇。
                      </Text>
                    ) : null}
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
                    {issues
                      .filter(
                        (issue) => issue.rowId === row.id && issue.code === 'ai-uncertain-field',
                      )
                      .map((issue, index) => (
                        <Text
                          key={`ai-field-${index}`}
                          style={{ color: theme.colors.muted, lineHeight: 22 }}
                        >
                          {issue.message}
                        </Text>
                      ))}
                    <Button
                      text={expanded === row.id ? '收起欄位' : '編輯與連結課班'}
                      disabled={saving}
                      onPress={() => setExpanded(expanded === row.id ? null : row.id)}
                    />
                    {row.kind === 'timetable' ? (
                      <View style={{ gap: 8 }}>
                        <Button
                          text="拆成單節課程"
                          disabled={
                            saving ||
                            busy ||
                            !row.startPeriod ||
                            !row.endPeriod ||
                            row.endPeriod <= row.startPeriod
                          }
                          onPress={() => {
                            const parts = splitReviewRow(row, profile);
                            setEditedIds((current) => [
                              ...new Set([...current, ...parts.map((item) => item.id)]),
                            ]);
                            setRows((current) =>
                              current.flatMap((item) => (item.id === row.id ? parts : [item])),
                            );
                            setSelected(
                              (current) =>
                                new Set([
                                  ...current,
                                  ...parts.filter(() => current.has(row.id)).map((item) => item.id),
                                ]),
                            );
                            setAiReviewed(false);
                          }}
                        />
                        <Button
                          text="刪除此草稿課程"
                          disabled={saving || busy}
                          onPress={() => {
                            setRows((current) => current.filter((item) => item.id !== row.id));
                            setSelected(
                              (current) => new Set([...current].filter((id) => id !== row.id)),
                            );
                            setAiReviewed(false);
                          }}
                        />
                      </View>
                    ) : null}
                    {expanded === row.id ? (
                      <RowEditor
                        disabled={saving}
                        row={row}
                        workspaces={workspaces}
                        periodProfile={profile}
                        onRefreshWorkspaces={() => void loadLinks()}
                        onChange={(next) => updateDraft(row, next)}
                      />
                    ) : null}
                  </View>
                ))}
              {reviewRows.length > visibleRowCount ? (
                <>
                  <Text style={{ color: theme.colors.muted }}>
                    目前顯示前 {visibleRowCount} 筆，共 {reviewRows.length} 筆；已勾選{' '}
                    {chosen.length} 筆。
                  </Text>
                  <Button
                    text="顯示接下來 50 筆"
                    disabled={saving}
                    onPress={() => setVisibleRowCount((count) => count + 50)}
                  />
                </>
              ) : null}
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
              {isAiPreview ? (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel="已逐筆核對 AI 結果"
                  accessibilityState={{ checked: aiReviewed, disabled: saving || busy }}
                  disabled={saving || busy}
                  onPress={() => setAiReviewed((value) => !value)}
                  style={{
                    minHeight: 52,
                    padding: 16,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: aiReviewed ? theme.colors.accent : theme.colors.border,
                    backgroundColor: theme.colors.focusSurface,
                    gap: 6,
                  }}
                >
                  <Text style={{ ...textStyle, fontWeight: '600' }}>
                    {aiReviewed ? '☑' : '□'} 已逐筆核對 AI 結果
                  </Text>
                  <Text style={{ color: theme.colors.muted, lineHeight: 21 }}>
                    名稱、日期、時段與數字都已對照來源。修改欄位或選取範圍後，需要重新確認。
                  </Text>
                </Pressable>
              ) : null}
              <Button
                text={`確認新增 ${chosen.length} 筆`}
                kind="primary"
                onPress={save}
                disabled={
                  !chosen.length ||
                  invalidCount > 0 ||
                  structuralErrors.length > 0 ||
                  (isAiPreview && !aiReviewed) ||
                  busy ||
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
          <PersonalImportSyncPanel
            scope={scope}
            active={active}
            available={available}
            onSynced={load}
          />
          <Text style={{ ...textStyle, fontWeight: '700' }}>備份與換裝置</Text>
          <Text style={{ color: theme.colors.muted }}>
            備份包含目前帳號與學校的全部課表、成績、活動與來源文字，檔案沒有加密。請只存到你信任的位置；分享選單開啟不代表已保存。
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button
              text="備份全部個人資料"
              onPress={shareBackup}
              disabled={busy || saving || !ledger?.records.length || !!loadError}
            />
            <Button text="從備份檔還原" onPress={readBackup} disabled={busy || saving} />
          </View>
          <Text
            accessibilityRole="header"
            style={{ ...textStyle, fontSize: 20, fontWeight: '700' }}
          >
            已儲存的{names[kind]}
          </Text>
          {ledger?.records.some((row) => row.kind === kind) ? (
            <View style={{ gap: 10 }}>
              <TextInput
                accessibilityLabel="搜尋已儲存的個人紀錄"
                placeholder="搜尋課程、教師、學年度、成績或地點"
                value={savedQuery}
                onChangeText={(value) => {
                  setSavedQuery(value);
                  setVisibleSavedCount(40);
                }}
                editable={!saving}
                style={inputStyle}
              />
              <Text style={{ color: theme.colors.muted }}>
                找到 {savedRecords.length} 筆，顯示前{' '}
                {Math.min(visibleSavedCount, savedRecords.length)} 筆。
              </Text>
              <Button
                text="匯出本類資料為 CSV"
                kind="outline"
                disabled={saving || exporting || !!loadError}
                loading={exporting}
                onPress={() => void exportRecords()}
              />
              <Text style={{ color: theme.colors.muted }}>
                匯出包含私人課表或成績，請只分享給信任的對象。CSV
                供試算表保存與查閱，不會同步帳號，也不包含原始截圖。
              </Text>
            </View>
          ) : null}
          {savedFeedback ? (
            <Text accessibilityRole="alert" style={textStyle}>
              {savedFeedback}
            </Text>
          ) : null}
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
          {ledger && !!savedQuery.trim() && !savedRecords.length ? (
            <Text style={{ color: theme.colors.muted }}>
              沒有符合搜尋條件的資料，可修改關鍵字。
            </Text>
          ) : null}
          {savedRecords.slice(0, visibleSavedCount).map((row) => (
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
              <Text style={textStyle}>{rowSummary(row, profile)}</Text>
              {row.kind === 'timetable' &&
              (!profile || !row.startPeriod || !row.endPeriod || (row.dayOfWeek || 0) > 5) ? (
                <Text style={{ color: theme.colors.muted }}>
                  {profile
                    ? '這筆缺少星期一至五的節次，尚未放入課表格子。'
                    : '已保存原始上課時間；這所學校尚未設定課表格線，這筆不會放入格子。'}
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
                    periodProfile={profile}
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
              <Button
                text="移除這筆"
                kind="outline"
                disabled={saving}
                onPress={() => {
                  setSavedFeedback('');
                  setDeleting(row);
                }}
              />
            </View>
          ))}
          {savedRecords.length > visibleSavedCount ? (
            <Button
              text={'再顯示 ' + Math.min(40, savedRecords.length - visibleSavedCount) + ' 筆'}
              disabled={saving}
              onPress={() => setVisibleSavedCount((count) => count + 40)}
            />
          ) : null}
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
      {sourceImage && imageViewerOpen && available ? (
        <Modal
          visible
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setImageViewerOpen(false)}
        >
          <View style={{ flex: 1, padding: 16, gap: 12, backgroundColor: theme.colors.bg }}>
            <Text
              accessibilityRole="header"
              style={{ ...textStyle, fontSize: 20, fontWeight: '700' }}
            >
              核對原始截圖
            </Text>
            <Text style={{ color: theme.colors.muted, lineHeight: 21 }}>
              可捲動查看整張截圖，對照課名、星期、時段與數字。
            </Text>
            <Button text="回到核對清單" onPress={() => setImageViewerOpen(false)} />
            <ScrollView
              style={{ flex: 1 }}
              maximumZoomScale={4}
              minimumZoomScale={1}
              onLayout={(event) => setImageViewerWidth(Math.max(1, event.nativeEvent.layout.width))}
            >
              <Image
                accessibilityLabel="放大的原始匯入截圖"
                source={{ uri: sourceImage.uri }}
                resizeMode="contain"
                style={{
                  width: imageViewerWidth,
                  height: (imageViewerWidth * sourceImage.height) / Math.max(1, sourceImage.width),
                }}
              />
            </ScrollView>
          </View>
        </Modal>
      ) : null}
      {modelManagerOpen && available ? (
        <Modal
          visible
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setModelManagerOpen(false)}
        >
          <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
            <View style={{ padding: 16, gap: 8 }}>
              <Text style={{ ...textStyle, fontWeight: '600' }}>
                啟用後回來繼續匯入，原始文字會保留。
              </Text>
              <Button text="回到資料匯入" onPress={() => setModelManagerOpen(false)} />
            </View>
            <AIModelManagerScreen />
          </View>
        </Modal>
      ) : null}
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
      <Modal
        visible={!!deleting && available}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleting(null)}
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
            <Text style={{ ...textStyle, fontSize: 18, fontWeight: '700' }}>移除個人紀錄</Text>
            <Text style={textStyle}>
              確定移除「{deleting?.title}
              」？只會刪除目前帳號與學校的這筆本機資料。此操作無法直接復原，請先確認是否需要匯出備份。
            </Text>
            <Button
              text="確認移除"
              kind="danger"
              disabled={saving}
              loading={saving}
              onPress={() => void deleteRecord()}
            />
            <Button text="保留這筆" disabled={saving} onPress={() => setDeleting(null)} />
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
