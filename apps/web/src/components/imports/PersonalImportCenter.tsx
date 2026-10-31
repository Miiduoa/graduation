'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import {
  createPersonalImportId,
  serializePersonalImportsCsv,
  parsePersonalImport,
  personalImportErrorMessage,
  extractSchoolPageTables,
  type SchoolPageTable,
  personalImportPreviewNotice,
  personalImportSavedNotice,
  personalImportUndoBody,
  personalImportUndoneNotice,
  PERSONAL_IMPORT_IMAGE_UNREADABLE,
  PERSONAL_IMPORT_UNDO_CONFIRM,
  PERSONAL_IMPORT_UNDO_KEEP,
  PERSONAL_IMPORT_UNDO_LABEL,
  PERSONAL_IMPORT_UNDO_TITLE,
  parsePersonalImportBackup,
  serializePersonalImportBackup,
  PERSONAL_IMPORT_BACKUP_MAX_BYTES,
  periodCount,
  periodDisplayLabel,
  periodLabelAt,
  periodProfileForSchool,
  periodSlots,
  PERIOD_PROFILE_TITLES,
  validatePersonalImportRow,
  type PeriodProfileId,
  type PersonalImportKind,
  type PersonalImportRow,
  type PersonalImportRecord,
  type PersonalImportSource,
  type ImportIssue,
  type PersonalImportBackupPreview,
  type PersonalImportDocument,
} from '@campus/shared';
import { createNuniClasses, type NuniWorkspace } from '@campus/shared/src/nuni';
import { buildSchoolPageCaptureBookmarklet } from '@campus/shared/src/imports/schoolPageCapture';
import { personalImportDocumentAiSource } from '@campus/shared/src/imports/aiRecognition';
import { browserRequest, useOptionalNuniSession } from '@/features/nuni/Session';
import {
  changePersonalImport,
  readPersonalImports,
  readPersonalImportSyncState,
  savePersonalImportBatch,
  undoPersonalImports,
  type PersonalImportScope,
} from '@/lib/personalImports';
import { usePersonalImportScope, usePersonalImports } from '@/lib/usePersonalImports';
import {
  clearPersonalImportDraft,
  readPersonalImportDraft,
  writePersonalImportDraft,
  type PersonalImportDraft,
} from '@/lib/personalImportDrafts';
import { recognizePersonalImportImage } from '@/lib/personalImportOcr';
import { createPersonalImportImagePreview } from '@/lib/personalImportImagePreview';
import {
  deletePersonalImportAiModelCache,
  getPersonalImportAiAvailability,
  runPersonalImportAi,
} from '@/lib/personalImportAi';
import styles from './PersonalImport.module.css';
import { TimetableReviewGrid } from './TimetableReviewGrid';
import { nextReviewRow, splitReviewRow } from '@campus/shared/src/imports/reviewGrid';
import { CourseAccessPanel } from './CourseAccessPanel';
import { DocumentSelection } from './DocumentSelection';
import { PersonalImportSyncPanel } from './PersonalImportSync';
import { readPersonalImportDocumentFile } from '@/lib/personalImportDocuments';

const KINDS: { value: PersonalImportKind; title: string; detail: string }[] = [
  { value: 'timetable', title: '課表與選課結果', detail: '上課日、時間、教室與老師' },
  { value: 'grades', title: '成績與學分', detail: '留一份可查找的個人成績紀錄' },
  { value: 'events', title: '活動與考試', detail: '把日期、時間與地點記下來' },
];
const EXAMPLES: Record<PersonalImportKind, string> = {
  timetable: '課程名稱,星期,開始節次,結束節次,教師,教室,課號\n資料庫,一,3,4,王老師,主顧303,CS301',
  grades: '課程名稱,學分,成績,課號\n資料庫,3,85,CS301',
  events: '活動名稱,日期,開始時間,結束時間,地點\n期中考,2026-11-05,10:00,12:00,主顧303',
};
const REVIEW_PAGE_SIZE = 25;
const SCHOOL_CAPTURE_BOOKMARK = buildSchoolPageCaptureBookmarklet();
const subscribeClient = () => () => {};
type AiImportRequest = {
  input: { text?: string; image?: File };
  source: Pick<PersonalImportSource, 'type' | 'name'>;
  fromDocument?: boolean;
};
function errorMessage(error: unknown, fallback = '這次沒有完成，草稿仍保留，請再試一次。') {
  return personalImportErrorMessage(error, fallback);
}
function periodSummary(row: PersonalImportRow, periodProfile?: PeriodProfileId) {
  if (row.startTime && row.endTime) return `${row.startTime}–${row.endTime}`;
  if (row.periodLabel) return row.periodLabel;
  if (periodProfile && row.startPeriod) {
    const start = periodLabelAt(row.startPeriod, periodProfile);
    const end = periodLabelAt(row.endPeriod ?? row.startPeriod, periodProfile);
    return start === end ? `第 ${start} 節` : `第 ${start}–${end} 節`;
  }
  return `第 ${row.startPeriod ?? '?'}–${row.endPeriod ?? '?'} 節`;
}

function rowSummary(row: PersonalImportRow, periodProfile?: PeriodProfileId) {
  if (row.kind === 'grades')
    return `${row.academicYear} 學年度 ${row.semester} 學期 · ${row.credits} 學分 · ${row.grade}`;
  if (row.kind === 'events')
    return `${row.date} ${row.startTime || '全天'}${row.endTime ? `–${row.endTime}` : ''}${row.endDate && row.endDate !== row.date ? `（至 ${row.endDate}）` : ''}`;
  return `星期${['', '一', '二', '三', '四', '五', '六', '日'][row.dayOfWeek || 0] || '待確認'} · ${periodSummary(row, periodProfile)} · ${row.teacher || '老師未填'} · ${row.location || '教室未填'}`;
}

function RowFields({
  row,
  onChange,
  workspaces,
  periodProfile,
  onRefreshWorkspaces,
  aiSource = false,
}: {
  row: PersonalImportRow;
  onChange: (row: PersonalImportRow) => void;
  workspaces: NuniWorkspace[];
  periodProfile?: PeriodProfileId;
  onRefreshWorkspaces?: () => void;
  aiSource?: boolean;
}) {
  const update = (field: keyof PersonalImportRow, value: string | number | boolean | undefined) =>
    onChange({ ...row, [field]: value });
  const issues = validatePersonalImportRow(row, { periodProfile });
  const invalid = (name: keyof PersonalImportRow) =>
    issues.some((issue) => issue.severity === 'error' && issue.field === name);
  const field = (name: keyof PersonalImportRow, label: string, type = 'text') => (
    <label className={styles.field}>
      {label}
      <input
        type={type}
        aria-invalid={invalid(name) || undefined}
        value={String(row[name] ?? '')}
        maxLength={name === 'title' ? 200 : 300}
        onChange={(event) =>
          update(
            name,
            event.target.value ||
              (['title', 'academicYear', 'semester'].includes(name) ? '' : undefined),
          )
        }
      />
    </label>
  );
  const number = (name: 'credits' | 'startPeriod' | 'endPeriod', label: string, max: number) => (
    <label className={styles.field}>
      {label}
      <input
        type="number"
        aria-invalid={invalid(name) || undefined}
        min={name === 'credits' ? 0 : 1}
        max={max}
        step={name === 'credits' ? '0.5' : '1'}
        value={row[name] ?? ''}
        onChange={(event) =>
          update(name, event.target.value === '' ? undefined : Number(event.target.value))
        }
      />
    </label>
  );
  return (
    <>
      <div className={styles.fields}>
        {field('title', '名稱')}
        {row.kind === 'grades' && (
          <>
            {number('credits', '學分', 40)}
            {field('grade', '成績')}
          </>
        )}
        {row.kind === 'timetable' && (
          <>
            <label className={styles.field}>
              星期
              <select
                aria-invalid={invalid('dayOfWeek') || undefined}
                value={row.dayOfWeek ?? ''}
                onChange={(event) =>
                  update('dayOfWeek', event.target.value ? Number(event.target.value) : undefined)
                }
              >
                <option value="">請選擇</option>
                {['一', '二', '三', '四', '五', '六', '日'].map((day, i) => (
                  <option key={day} value={i + 1}>
                    星期{day}
                  </option>
                ))}
              </select>
            </label>
            {periodProfile
              ? ['startPeriod', 'endPeriod'].map((name) => (
                  <label className={styles.field} key={name}>
                    {name === 'startPeriod' ? '開始節次' : '結束節次'}
                    <select
                      aria-invalid={invalid(name as 'startPeriod' | 'endPeriod') || undefined}
                      value={row[name as 'startPeriod' | 'endPeriod'] ?? ''}
                      onChange={(event) =>
                        update(
                          name as 'startPeriod' | 'endPeriod',
                          event.target.value ? Number(event.target.value) : undefined,
                        )
                      }
                    >
                      <option value="">請選擇</option>
                      {periodSlots(periodProfile).map((slot) => (
                        <option key={slot.index} value={slot.index}>
                          {periodDisplayLabel(slot.index, periodProfile)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))
              : null}
            {!periodProfile ? (
              <>
                {number('startPeriod', '開始節次', 99)}
                {number('endPeriod', '結束節次', 99)}
              </>
            ) : null}
            {field('teacher', '老師')}
            {field('location', '教室／地點')}
            {!periodProfile && (
              <>
                {field('startTime', '開始時間', 'time')}
                {field('endTime', '結束時間', 'time')}
                {field('periodLabel', '原始節次（例如 A–B）')}
              </>
            )}
          </>
        )}
        {row.kind === 'events' && (
          <>
            {field('date', '日期', 'date')}
            {field('location', '教室／地點')}
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={!!row.allDay}
                onChange={(event) =>
                  onChange({
                    ...row,
                    allDay: event.target.checked,
                    ...(event.target.checked ? { startTime: undefined, endTime: undefined } : {}),
                  })
                }
              />
              全天活動
            </label>
            {!row.allDay && (
              <>
                {field('startTime', '開始時間', 'time')}
                {field('endTime', '結束時間', 'time')}
              </>
            )}
            {field(
              'endDate',
              row.allDay ? '結束日期（不含當天，可留空）' : '結束日期（跨日才填）',
              'date',
            )}
          </>
        )}
      </div>
      <details
        className={styles.source}
        open={
          issues.some(
            (issue) =>
              issue.severity === 'error' &&
              ['academicYear', 'semester', 'startTime', 'endTime'].includes(issue.field || ''),
          ) || undefined
        }
      >
        <summary>
          {row.kind === 'events'
            ? '連結課程'
            : `${row.academicYear || '學年待填'}／${row.semester || '學期待填'}${row.courseCode ? ` · ${row.courseCode}` : ''} · 學期與課程資料`}
        </summary>
        <div className={styles.fields}>
          {row.kind !== 'events' && (
            <>
              {field('academicYear', '學年度')}
              {field('semester', '學期')}
              {field('courseCode', '課號')}
              {field('className', '班別')}
              {row.kind === 'grades' && (
                <>
                  {field('teacher', '老師')}
                  {field('location', '教室／地點')}
                </>
              )}
            </>
          )}
          {row.kind === 'timetable' && periodProfile && (
            <>
              {field('startTime', '開始時間', 'time')}
              {field('endTime', '結束時間', 'time')}
            </>
          )}
          <label className={styles.field}>
            連結我的課程
            <select
              value={row.linkedCourseId || ''}
              onChange={(event) => update('linkedCourseId', event.target.value || undefined)}
            >
              <option value="">先保留個人紀錄</option>
              {row.linkedCourseId && !workspaces.some((item) => item.id === row.linkedCourseId) && (
                <option value={row.linkedCourseId} disabled>
                  原連結尚未確認，請重新選擇
                </option>
              )}
              {workspaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} ·{' '}
                  {item.memberRole === 'student' ? '學生' : '管理者（未代表教師認證）'}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>
      <CourseAccessPanel
        row={row}
        workspaces={workspaces}
        onRefreshWorkspaces={onRefreshWorkspaces}
        onSelectLinkedCourse={(id) => onChange({ ...row, linkedCourseId: id })}
      />
      {issues.some((issue) => issue.severity === 'error') && (
        <ul className={styles.issues}>
          {issues
            .filter((issue) => issue.severity === 'error')
            .map((issue, index) => (
              <li data-error="true" key={`${issue.code}-${index}`}>
                {issue.message}
              </li>
            ))}
        </ul>
      )}
      <details className={styles.source}>
        <summary>{aiSource ? 'AI 辨讀的來源片段（請與原檔核對）' : '核對原始文字'}</summary>
        <pre>{row.source.rawText || '這筆是手動新增的資料。'}</pre>
      </details>
    </>
  );
}

export function PersonalImportCenter() {
  const context = usePersonalImportScope();
  const [confirmed, setConfirmed] = useState<typeof context | null>(null);
  if (
    !context.loading &&
    (confirmed?.scopeKey !== context.scopeKey || confirmed?.schoolName !== context.schoolName)
  )
    setConfirmed(context);
  // Revalidating after the native file picker must not throw away a same-account draft.
  // The retained workspace stays hidden; an actual identity change gets a new key.
  const visible = context.loading ? confirmed : context;
  return (
    <>
      {context.loading && <p role="status">正在確認資料儲存位置…</p>}
      {visible && (
        <div hidden={context.loading}>
          <ImportWorkspace
            key={visible.scopeKey}
            scope={visible.scope}
            schoolName={visible.schoolName}
            paused={context.loading}
          />
        </div>
      )}
    </>
  );
}

function ImportWorkspace({
  scope,
  schoolName,
  paused,
}: {
  scope: PersonalImportScope;
  schoolName: string;
  paused: boolean;
}) {
  const ledger = usePersonalImports(scope);
  const schoolSelection = useOptionalSelectedSchool();
  const suspended = useRef(paused);
  useLayoutEffect(() => {
    suspended.current = paused;
  }, [paused]);
  const nuni = useOptionalNuniSession();
  const periodProfile = periodProfileForSchool(scope.schoolId);
  const [kind, setKind] = useState<PersonalImportKind>('timetable');
  const [year, setYear] = useState('');
  const [semester, setSemester] = useState('');
  const [text, setText] = useState('');
  const [source, setSource] = useState<Pick<PersonalImportSource, 'type' | 'name'>>({
    type: 'paste',
  });
  const [editedIds, setEditedIds] = useState<string[]>([]);
  const [rows, setRows] = useState<PersonalImportRow[]>([]);
  const [backup, setBackup] = useState<Omit<PersonalImportBackupPreview, 'rows'> | null>(null);
  const [importDocument, setDocument] = useState<PersonalImportDocument | null>(null);
  const [hasDocumentFile, setHasDocumentFile] = useState(false);
  const [schoolPage, setSchoolPage] = useState<{ name: string; tables: SchoolPageTable[] } | null>(
    null,
  );
  const [documentSelection, setDocumentSelection] =
    useState<PersonalImportDraft['documentSelection']>(null);
  const [documentVersion, setDocumentVersion] = useState(0);
  const [reviewPage, setReviewPage] = useState(0);
  // Hold the chosen issue list while a field is being fixed, so typing never
  // removes the focused row. Switching filters refreshes the list.
  const [reviewIssueIds, setReviewIssueIds] = useState<string[] | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [captureCopyStatus, setCaptureCopyStatus] = useState('');
  const [captureManualCopy, setCaptureManualCopy] = useState(false);
  const [aiReviewed, setAiReviewed] = useState(false);
  const [pendingAi, setPendingAi] = useState<AiImportRequest | null>(null);
  const [removingAiModel, setRemovingAiModel] = useState(false);
  const clientReady = useSyncExternalStore(
    subscribeClient,
    () => true,
    () => false,
  );
  const aiAvailability = clientReady
    ? getPersonalImportAiAvailability()
    : {
        available: false,
        reason: '正在檢查這台裝置…',
        downloadLabel: '',
      };
  const [sourceImage, setSourceImage] = useState<File | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [parseIssues, setParseIssues] = useState<ImportIssue[]>([]);
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState('');
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreviewState] = useState('');
  const [workspaces, setWorkspaces] = useState<NuniWorkspace[]>([]);
  const [linkRefreshVersion, setLinkRefreshVersion] = useState(0);
  const [linkStatus, setLinkStatus] = useState('');
  const [lastBatch, setLastBatch] = useState('');
  const [undoOpen, setUndoOpen] = useState(false);
  const [editing, setEditing] = useState<{
    original: PersonalImportRecord;
    row: PersonalImportRow;
  } | null>(null);
  const [search, setSearch] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const [draftReadFailed, setDraftReadFailed] = useState(false);
  const [draftStorageError, setDraftStorageError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const job = useRef<AbortController | null>(null);
  const documentFile = useRef<File | null>(null);
  const active = useRef(true);
  const previewUrl = useRef('');
  const writing = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const aiImageInput = useRef<HTMLInputElement>(null);
  const originalText = useRef<HTMLTextAreaElement>(null);
  const reviewRows = useRef(new Map<string, HTMLElement>());
  const pdfInput = useRef<HTMLInputElement>(null);
  const review = useRef<HTMLElement>(null);
  const undoKeep = useRef<HTMLButtonElement>(null);
  const keepAiDraft = useRef<HTMLButtonElement>(null);
  const setPreview = (url: string) => {
    if (previewUrl.current === url) return;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = url;
    if (active.current) setPreviewState(url);
  };
  useEffect(() => {
    if (undoOpen) undoKeep.current?.focus();
  }, [undoOpen]);
  useEffect(() => {
    if (pendingAi) keepAiDraft.current?.focus();
  }, [pendingAi]);
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('kind');
    if (KINDS.some((entry) => entry.value === value)) setKind(value as PersonalImportKind);
    try {
      const draft = readPersonalImportDraft(scope);
      if (draft) {
        setKind(draft.kind);
        setYear(draft.year);
        setSemester(draft.semester);
        setText(draft.text);
        setSource(draft.source);
        setRows(draft.rows);
        setEditedIds(draft.editedIds ?? []);
        setExcluded(draft.excluded);
        setParseIssues(draft.parseIssues);
        setBackup(draft.backup);
        setDocument(draft.document ?? null);
        setDocumentSelection(draft.documentSelection ?? null);
        setNotice(
          '已找回這個分頁尚未匯入的草稿，請繼續核對。' +
            (draft.document
              ? '文件文字與選取內容已保留；重新辨識時請再選擇原始檔案。'
              : draft.source.type === 'screenshot'
                ? '原始圖片未暫存，需開啟原圖對照。'
                : ''),
        );
      }
    } catch (error) {
      setDraftReadFailed(true);
      setDraftStorageError(errorMessage(error));
    }
    setDraftReady(true);
    active.current = true;
    return () => {
      active.current = false;
      job.current?.abort();
      documentFile.current = null;
    };
    // Account or school changes remount this workspace with its own storage key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!draftReady || draftReadFailed || paused) return;
    try {
      writePersonalImportDraft(scope, {
        kind,
        year,
        semester,
        text,
        source,
        rows,
        excluded,
        editedIds,
        parseIssues,
        backup,
        document: importDocument,
        documentSelection,
      });
      setDraftStorageError('');
    } catch (error) {
      setDraftStorageError(errorMessage(error));
    }
  }, [
    editedIds,
    draftReady,
    draftReadFailed,
    paused,
    scope,
    kind,
    year,
    semester,
    text,
    source,
    rows,
    excluded,
    parseIssues,
    backup,
    importDocument,
    documentSelection,
  ]);
  useEffect(() => {
    if (!draftStorageError || (!text && !rows.length && !importDocument)) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [draftStorageError, text, rows.length, importDocument]);
  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = '';
    },
    [],
  );
  useEffect(() => {
    let current = true;
    setWorkspaces([]);
    if (!nuni?.session) {
      setLinkStatus('登入平台帳號後，可連結你已加入的課程。');
      return;
    }
    setLinkStatus('正在讀取你已加入的課程…');
    const session = nuni.session;
    void createNuniClasses(
      (path, input) => browserRequest(path, session.context, input),
      session.platformAccountId,
    )
      .list()
      .then((items) => {
        if (current) {
          setWorkspaces(items.filter((item) => item.state === 'active'));
          setLinkStatus(
            items.length
              ? '請核對老師、班別與學期後選擇課程；同名不代表同一班。'
              : '目前沒有可連結的課程，可先匯入個人資料，再使用老師的邀請碼加入。',
          );
        }
      })
      .catch(() => {
        if (current) setLinkStatus('暫時讀不到課程清單，可以先保留個人資料，稍後再連結。');
      });
    return () => {
      current = false;
    };
  }, [nuni?.session, linkRefreshVersion]);

  const options = {
    kind,
    schoolId: scope.schoolId,
    academicYear: year,
    semester,
    source,
    periodProfile,
  };
  const parse = (
    input: string,
    inputSource = source,
    term?: { academicYear: string; semester: string },
  ) => {
    setSchoolPage(null);
    setReviewIssueIds(null);
    setAiReviewed(false);
    const parsed = parsePersonalImport(input, { ...options, source: inputSource, ...(term ?? {}) });
    setRows(parsed.rows);
    setBackup(null);
    setReviewPage(0);
    setParseIssues(
      parsed.issues.filter((issue) => {
        if (issue.severity !== 'error') return false;
        const row = parsed.rows.find((item) => item.id === issue.rowId);
        return (
          !row ||
          !validatePersonalImportRow(row, { periodProfile }).some(
            (validation) => validation.code === issue.code && validation.field === issue.field,
          )
        );
      }),
    );
    setExcluded([]);
    const warnings = parsed.issues.filter((issue) => !issue.rowId).map((issue) => issue.message);
    setNotice(
      parsed.rows.length
        ? `${personalImportPreviewNotice(parsed.rows.length)}${warnings.join(' ')}`
        : `沒有整理出資料。可以修正下方文字，或手動加一筆。${warnings.join(' ')}`,
    );
    requestAnimationFrame(() =>
      review.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };
  const updateDraft = (before: PersonalImportRow, next: PersonalImportRow) => {
    if (next.kind === 'timetable' && periodProfile) {
      const slots = periodSlots(periodProfile);
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
    setRows((current) => current.map((item) => (item.id === next.id ? next : item)));
    setParseIssues((current) =>
      current.filter(
        (issue) =>
          !(
            ['unrecognized-field', 'ai-uncertain-field'].includes(issue.code) &&
            issue.rowId === next.id &&
            issue.field &&
            before[issue.field] !== next[issue.field] &&
            !validatePersonalImportRow(next, { periodProfile }).some(
              (validation) => validation.severity === 'error' && validation.field === issue.field,
            )
          ),
      ),
    );
  };
  const copySchoolCaptureTool = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(SCHOOL_CAPTURE_BOOKMARK);
      if (active.current && !suspended.current)
        setCaptureCopyStatus('工具網址已複製。請新增一個書籤，將網址替換成剛剛複製的內容。');
    } catch {
      if (active.current && !suspended.current) {
        setCaptureManualCopy(true);
        setCaptureCopyStatus(
          '瀏覽器未能自動複製，請全選下方工具網址並複製，再貼到新書籤的網址欄。',
        );
      }
    }
  };
  const removeAiModel = async () => {
    if (reading || saving || removingAiModel || suspended.current) return;
    setRemovingAiModel(true);
    try {
      await deletePersonalImportAiModelCache();
      if (active.current && !suspended.current)
        setNotice('已移除本瀏覽器的辨識模型快取，下次使用會重新下載。');
    } catch (error) {
      if (active.current && !suspended.current)
        setNotice(errorMessage(error, '辨識模型快取尚未移除，請稍後再試。'));
    } finally {
      if (active.current) setRemovingAiModel(false);
    }
  };
  const processAi = async (request: AiImportRequest) => {
    if (
      suspended.current ||
      reading ||
      saving ||
      removingAiModel ||
      (importDocument && !request.fromDocument) ||
      !aiAvailability.available
    )
      return;
    if (!request.input.image && !request.input.text?.trim()) return;
    const controller = new AbortController();
    job.current?.abort();
    job.current = controller;
    setPendingAi(null);
    setReading(true);
    setProgress('正在準備免費裝置端 AI…');
    setNotice('');
    const currentRead = () =>
      active.current &&
      !suspended.current &&
      !controller.signal.aborted &&
      job.current === controller;
    let preparedPreview = '';
    try {
      if (request.input.image) {
        const png = await createPersonalImportImagePreview(request.input.image, controller.signal);
        if (!currentRead()) return;
        preparedPreview = URL.createObjectURL(png);
      }
      const result = await runPersonalImportAi({
        input: request.input,
        options: { ...options, source: request.source },
        signal: controller.signal,
        onProgress: (message) => {
          if (currentRead()) setProgress(message);
        },
      });
      if (!currentRead()) return;
      if (!result.rows.length) {
        setNotice(
          'AI 沒有整理出可核對的資料，原本的草稿仍保留。請試著裁切到表格，或貼上學校的表格文字。',
        );
        return;
      }
      setRows(result.rows);
      setParseIssues(
        result.issues.filter(
          (issue) =>
            issue.severity !== 'error' ||
            !result.rows.some(
              (row) =>
                row.id === issue.rowId &&
                validatePersonalImportRow(row, { periodProfile }).some(
                  (validation) =>
                    validation.code === issue.code && validation.field === issue.field,
                ),
            ),
        ),
      );
      setBackup(null);
      setSchoolPage(null);
      setReviewPage(0);
      setReviewIssueIds(null);
      setExcluded([]);
      setAiReviewed(false);
      setText(request.input.text ?? '');
      setSource(request.source);
      if (request.fromDocument) {
        documentFile.current = null;
        setHasDocumentFile(false);
        setDocument(null);
        setDocumentSelection(null);
        setSourceImage(null);
        setPreview('');
      }
      if (request.input.image) {
        setSourceImage(request.input.image);
        setPreview(preparedPreview);
        preparedPreview = '';
      }
      setNotice(
        `AI 已整理 ${result.rows.length} 筆草稿。請對照來源，核對課名、日期、時間及數字，再確認匯入。`,
      );
      requestAnimationFrame(() =>
        review.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
    } catch (error) {
      if (currentRead())
        setNotice(errorMessage(error, 'AI 這次沒有完成，原本的草稿仍保留。可重試或使用一般讀取。'));
    } finally {
      if (preparedPreview) URL.revokeObjectURL(preparedPreview);
      if (active.current && job.current === controller) {
        setReading(false);
        setProgress('');
        job.current = null;
      }
    }
  };
  const requestAi = (request: AiImportRequest) => {
    if (reading || saving || removingAiModel || suspended.current || !aiAvailability.available)
      return;
    if (rows.length) setPendingAi(request);
    else void processAi(request);
  };
  const readFile = async (file?: File, pdfMode?: 'ocr') => {
    if (!file || suspended.current || reading || saving || rows.length) return;
    const controller = new AbortController();
    job.current?.abort();
    job.current = controller;
    setReading(true);
    setNotice('');
    setSchoolPage(null);
    const image = file.type.startsWith('image/');
    const nextSource = {
      type: image ? ('screenshot' as const) : ('file' as const),
      name: file.name,
    };
    let pendingPreview = '';
    const discardPendingPreview = () => {
      if (pendingPreview && previewUrl.current === pendingPreview) setPreview('');
      pendingPreview = '';
    };
    const currentRead = () =>
      active.current &&
      !suspended.current &&
      !controller.signal.aborted &&
      job.current === controller;
    controller.signal.addEventListener('abort', discardPendingPreview, { once: true });
    try {
      if (/\.html?$/i.test(file.name)) {
        if (file.size > 512_000)
          throw new Error('學校網頁存檔超過 500 KB，請只複製課表或成績表格。');
        const tables = extractSchoolPageTables(await file.text(), kind, periodProfile);
        if (!currentRead()) return;
        setSourceImage(null);
        setPreview('');
        setSchoolPage({ name: file.name, tables });
        setNotice(
          '已辨識 ' +
            tables.length +
            ' 張符合目前資料類型的表格。請選擇要讀取的資料，不會直接儲存。',
        );
        return;
      }
      if (/\.(pdf|xlsx)$/i.test(file.name)) {
        setProgress(
          pdfMode === 'ocr'
            ? '正在這台裝置重新辨識 PDF 每一頁，原本的預覽會保留到讀取完成…'
            : '正在這台裝置讀取文件；掃描頁會進行文字辨識…',
        );
        const document = await readPersonalImportDocumentFile(file, controller.signal, { pdfMode });
        if (!active.current || suspended.current || controller.signal.aborted) return;
        setSourceImage(null);
        setPreview('');
        documentFile.current = file;
        setHasDocumentFile(true);
        setDocument(document);
        setDocumentSelection(null);
        setDocumentVersion((current) => current + 1);
        setNotice('文件已讀取，請選擇內容與標題列。');
        return;
      }
      if (/\.json$/i.test(file.name)) {
        if (file.size > PERSONAL_IMPORT_BACKUP_MAX_BYTES)
          throw new Error('備份檔超過 8 MB，請確認是否為 Campus One 匯出的備份。');
        const restored = parsePersonalImportBackup(await file.text());
        if (!active.current || controller.signal.aborted) return;
        if (restored.schoolId !== scope.schoolId)
          throw new Error('這份備份屬於其他校園。請先切換到備份原本的校園，再選擇檔案。');
        const { rows: restoredRows, ...metadata } = restored;
        setRows(restoredRows);
        setBackup(metadata);
        setReviewPage(0);
        setExcluded([]);
        setParseIssues([]);
        setText('');
        setPreview('');
        setSourceImage(null);
        setSource({ type: 'paste' });
        setNotice(
          restoredRows.length
            ? `備份已讀取，共 ${restoredRows.length} 筆。請核對後再加入目前的個人紀錄。`
            : '這份備份沒有個人紀錄。',
        );
        requestAnimationFrame(() =>
          review.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        );
        return;
      }
      let input: string;
      if (image) {
        const png = await createPersonalImportImagePreview(file, controller.signal);
        if (!currentRead()) return;
        const url = URL.createObjectURL(png);
        if (!currentRead()) {
          URL.revokeObjectURL(url);
          return;
        }
        pendingPreview = url;
        setPreview(url);
        input = await recognizePersonalImportImage(file, controller.signal, setProgress);
      } else {
        if (!/\.(csv|tsv|txt|ics)$/i.test(file.name))
          throw new Error(
            '可讀圖片、PDF、XLSX、HTML、CSV、TSV、TXT、ICS 與 Campus One JSON 備份。舊版 XLS 請先另存為 XLSX。',
          );
        if (file.size > 400_000) throw new Error('文字檔超過 400 KB，請分成較小的檔案再匯入。');
        input = await file.text();
      }
      if (!currentRead()) {
        discardPendingPreview();
        return;
      }
      setSourceImage(image ? file : null);
      if (!image) setPreview('');
      setText(input);
      setSource(nextSource);
      parse(input, nextSource);
      pendingPreview = '';
    } catch (error) {
      discardPendingPreview();
      if (active.current && !controller.signal.aborted)
        setNotice(errorMessage(error, image ? PERSONAL_IMPORT_IMAGE_UNREADABLE : undefined));
    } finally {
      controller.signal.removeEventListener('abort', discardPendingPreview);
      if (active.current && job.current === controller) {
        setReading(false);
        setProgress('');
        job.current = null;
      }
    }
  };
  const selected = rows.filter((row) => !excluded.includes(row.id));
  const discardDraft = () => {
    try {
      clearPersonalImportDraft(scope);
      setSourceImage(null);
      setReviewIssueIds(null);
      setAiReviewed(false);
      setPendingAi(null);
      setRows([]);
      setText('');
      setSource({ type: 'paste' });
      setBackup(null);
      setDocument(null);
      setDocumentSelection(null);
      documentFile.current = null;
      setHasDocumentFile(false);
      setExcluded([]);
      setParseIssues([]);
      setReviewPage(0);
      setPreview('');
      setDraftReadFailed(false);
      setDraftStorageError('');
      setConfirmDiscard(false);
      setNotice('草稿已清除，已匯入的個人紀錄仍保留。');
    } catch (error) {
      setDraftStorageError(errorMessage(error));
    }
  };
  const errors = [
    ...selected.flatMap((row) =>
      validatePersonalImportRow(row, { periodProfile }).filter(
        (issue) => issue.severity === 'error',
      ),
    ),
    ...parseIssues.filter(
      (issue) =>
        issue.severity === 'error' &&
        (!issue.rowId || selected.some((row) => row.id === issue.rowId)),
    ),
  ];
  const invalidLinks = selected.some(
    (row) => row.linkedCourseId && !workspaces.some((item) => item.id === row.linkedCourseId),
  );
  const aiNeedsReview = parseIssues.some(
    (issue) =>
      issue.code === 'ai-review-required' &&
      (!issue.rowId || selected.some((row) => row.id === issue.rowId)),
  );
  const invalidRowIds = rows
    .filter(
      (row) =>
        validatePersonalImportRow(row, { periodProfile }).some(
          (issue) => issue.severity === 'error',
        ) ||
        parseIssues.some((issue) => issue.severity === 'error' && issue.rowId === row.id) ||
        (row.linkedCourseId && !workspaces.some((item) => item.id === row.linkedCourseId)),
    )
    .map((row) => row.id);
  const filteredRows = reviewIssueIds
    ? rows.filter((row) => reviewIssueIds.includes(row.id))
    : rows;
  const currentReviewPage = Math.min(
    reviewPage,
    Math.max(0, Math.ceil(filteredRows.length / REVIEW_PAGE_SIZE) - 1),
  );
  const focusFirstIssue = () => {
    setReviewIssueIds(invalidRowIds);
    setReviewPage(0);
    requestAnimationFrame(() => {
      const row = reviewRows.current.get(invalidRowIds[0]);
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (row?.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus();
      if (!row?.querySelector('[aria-invalid="true"]')) row?.focus();
    });
  };
  const save = async () => {
    if (
      reading ||
      suspended.current ||
      writing.current ||
      !selected.length ||
      errors.length ||
      invalidLinks ||
      (aiNeedsReview && !aiReviewed)
    )
      return;
    writing.current = true;
    setSaving(true);
    try {
      const result = await savePersonalImportBatch(
        scope,
        selected,
        () => active.current && !suspended.current,
        { restoreBackup: !!backup },
      );
      if (!active.current) return;
      // Finish the draft before announcing success; the next effect may not run
      // if the user leaves immediately. A damaged, unreadable draft stays protected.
      if (!draftReadFailed) {
        try {
          clearPersonalImportDraft(scope);
        } catch (error) {
          setDraftStorageError(errorMessage(error));
        }
      }
      setNotice(
        personalImportSavedNotice(result.added, readPersonalImportSyncState(scope).enabled),
      );
      if (result.added) setLastBatch(result.batchId);
      setRows([]);
      setBackup(null);
      setReviewPage(0);
      setExcluded([]);
      setParseIssues([]);
      setText('');
      setSource({ type: 'paste' });
      setPreview('');
      setSourceImage(null);
      setReviewIssueIds(null);
      setAiReviewed(false);
    } catch (error) {
      if (active.current) setNotice(errorMessage(error));
    } finally {
      writing.current = false;
      if (active.current) setSaving(false);
    }
  };
  const mutate = async (action: () => Promise<unknown>, message: string) => {
    if (writing.current) return;
    writing.current = true;
    setSaving(true);
    try {
      await action();
      if (active.current) {
        setNotice(message);
        setEditing(null);
      }
    } catch (error) {
      if (active.current) setNotice(errorMessage(error));
    } finally {
      writing.current = false;
      if (active.current) setSaving(false);
    }
  };
  const exportRecords = () => {
    const content = serializePersonalImportsCsv(ledger.records.filter((row) => row.kind === kind));
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'campus-one-' + kind + '.csv';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportBackup = () => {
    if (!active.current || suspended.current || writing.current) return;
    try {
      const content = serializePersonalImportBackup(readPersonalImports(scope), {
        schoolId: scope.schoolId,
      });
      const url = URL.createObjectURL(
        new Blob([content], { type: 'application/json;charset=utf-8' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `campus-one-backup-${scope.schoolId}-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('已交由瀏覽器下載完整備份，請確認檔案已存好。檔案含個人資料，請妥善保管。');
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };
  const saved = ledger.records.filter(
    (row) =>
      row.kind === kind &&
      `${row.title} ${row.teacher || ''} ${row.courseCode || ''} ${row.academicYear}`.includes(
        search,
      ),
  );
  const timetableGrid = kind === 'timetable' && !importDocument && (
    <TimetableReviewGrid
      rows={rows.filter((row) => !excluded.includes(row.id))}
      editedIds={editedIds}
      profile={periodProfile}
      disabled={saving || reading}
      onEdit={(row) => {
        setReviewIssueIds(null);
        setReviewPage(Math.floor(rows.indexOf(row) / REVIEW_PAGE_SIZE));
        requestAnimationFrame(() => {
          const element = reviewRows.current.get(row.id);
          element?.scrollIntoView({ block: 'center' });
          element?.focus();
        });
      }}
      onAdd={(day, period) => {
        const row: PersonalImportRow = {
          id: createPersonalImportId(),
          kind: 'timetable',
          title: '',
          schoolId: scope.schoolId,
          academicYear: year,
          semester,
          dayOfWeek: day,
          startPeriod: period,
          endPeriod: period,
          source: { type: 'paste', line: 1, rawText: '' },
        };
        setRows((current) => [...current, row]);
        setReviewIssueIds(null);
        setReviewPage(Math.floor(rows.length / REVIEW_PAGE_SIZE));
        requestAnimationFrame(() => {
          const element = reviewRows.current.get(row.id);
          element?.scrollIntoView({ block: 'center' });
          element?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
        });
      }}
    />
  );
  return (
    <div className={styles.root}>
      <section className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>你的校園資料，一次整理</p>
          <h2>把課表與紀錄帶進來</h2>
          <p>
            貼上學校表格、選擇檔案，或讓裝置端 AI 讀取截圖。先看清楚，再加入你的課表、成績與行事曆。
          </p>
        </div>
        <p className={styles.storage}>
          {schoolName}
          <br />
          {scope.owner === 'guest' ? '未登入 · 這個瀏覽器專用' : '目前帳號 · 個人紀錄'}
          <br />
          <small>同步狀態見下方。清除瀏覽器資料前，請先確認已同步或下載完整備份。</small>
        </p>
      </section>
      <ol className={styles.steps} aria-label="匯入進度">
        {['帶入資料', '核對與修正', '保存紀錄'].map((label, index) => {
          const current = rows.length
            ? 1
            : reading || text || importDocument || schoolPage
              ? 0
              : lastBatch
                ? 2
                : 0;
          return (
            <li
              key={label}
              aria-current={index === current ? 'step' : undefined}
              data-complete={index < current}
            >
              <span>{index + 1}</span>
              <strong>{label}</strong>
            </li>
          );
        })}
      </ol>
      <div className={styles.kinds} role="group" aria-label="選擇匯入內容">
        {KINDS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={kind === item.value}
            disabled={reading || saving || rows.length > 0 || !!editing || !!importDocument}
            onClick={() => {
              setKind(item.value);
              setText('');
              setNotice('');
              setPreview('');
              setSource({ type: 'paste' });
              setSchoolPage(null);
              setSourceImage(null);
              setPendingAi(null);
              setReviewIssueIds(null);
              setAiReviewed(false);
            }}
          >
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </button>
        ))}
      </div>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {ledger.error && (
        <p className={styles.error} role="alert">
          {ledger.error}
        </p>
      )}
      {(text || rows.length > 0 || importDocument || draftStorageError) && (
        <section className={styles.notice} aria-label="匯入草稿暫存">
          {draftStorageError ? (
            <p role="alert">{draftStorageError}</p>
          ) : (
            <p>
              草稿已暫存在這個分頁，重新整理或離開後回來可繼續核對。關閉分頁可能清除暫存；只保留文字與選取內容，原始圖片與檔案不會暫存。確認匯入後才會加入個人紀錄。
            </p>
          )}
          {confirmDiscard ? (
            <div className={styles.actions}>
              <p>清除這份草稿與原始文字？已匯入的紀錄會保留。</p>
              <button
                type="button"
                className="btn"
                disabled={reading || saving}
                onClick={discardDraft}
              >
                確認清除草稿
              </button>
              <button type="button" className="btn" onClick={() => setConfirmDiscard(false)}>
                繼續核對
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn"
              disabled={reading || saving}
              onClick={() => setConfirmDiscard(true)}
            >
              清除暫存草稿
            </button>
          )}
        </section>
      )}
      <section className={styles.panel} aria-label="選擇資料來源">
        <div className={styles.heading}>
          <h2>
            <span>1</span> 帶入資料
          </h2>
          <small>原始截圖與文件只在這台裝置讀取</small>
        </div>
        <div className={styles.sourceChoices} role="group" aria-label="選擇匯入方式">
          <button
            type="button"
            className={styles.sourceChoice}
            disabled={reading || saving || rows.length > 0 || !!importDocument}
            onClick={() => {
              setPasteOpen(true);
              requestAnimationFrame(() => originalText.current?.focus());
            }}
          >
            <span className={styles.sourceNumber}>01</span>
            <strong>學校網頁表格</strong>
            <span>登入自己的校務系統，複製課表或成績表格。</span>
            <small>保留欄位，適合已有電子資料</small>
          </button>
          <button
            type="button"
            className={styles.sourceChoice}
            disabled={
              reading ||
              saving ||
              removingAiModel ||
              rows.length > 0 ||
              !!importDocument ||
              !aiAvailability.available
            }
            onClick={() => aiImageInput.current?.click()}
            aria-describedby="import-ai-download-note"
          >
            <span className={styles.sourceNumber}>02</span>
            <strong>AI 讀取截圖</strong>
            <span>讓本機視覺模型讀取課表、成績或活動圖片。</span>
            <small>免費 · 首次需下載模型</small>
          </button>
          <button
            type="button"
            className={styles.sourceChoice}
            disabled={reading || saving || rows.length > 0 || !!importDocument}
            onClick={() => fileInput.current?.click()}
          >
            <span className={styles.sourceNumber}>03</span>
            <strong>檔案與備份</strong>
            <span>讀取 PDF、試算表、行事曆，或還原備份。</span>
            <small>也能一般讀取截圖，不下載 AI 模型</small>
          </button>
        </div>
        <p id="import-ai-download-note" className={styles.note}>
          {aiAvailability.available
            ? `AI 在這台裝置執行，不需 API 金鑰。首次下載${aiAvailability.downloadLabel}；圖片與文字不送到雲端辨識。`
            : aiAvailability.reason ||
              '目前瀏覽器無法使用裝置端 AI，可使用學校表格、檔案或一般圖片讀取。'}
        </p>
        <div className={styles.modelTools}>
          <button
            type="button"
            className="btn"
            disabled={reading || saving || removingAiModel}
            onClick={() => void removeAiModel()}
          >
            {removingAiModel ? '正在移除模型快取…' : '移除下載模型'}
          </button>
        </div>
        <details className={styles.captureGuide}>
          <summary>從已登入的學校網頁擷取</summary>
          <p>使用自己已登入的校務頁面，選取課表或成績表格並存成檔案。單次擷取，不會自動同步。</p>
          <ol>
            <li>複製下方工具網址，新增一個「Campus One 擷取表格」書籤，貼到書籤的網址欄。</li>
            <li>自行登入學校網站，開啟要匯入的課表或成績頁，再點這個書籤。</li>
            <li>
              選擇表格並下載，回到這裡選取 <strong>CampusOne-school-table.html</strong>
              ，核對後匯入。
            </li>
          </ol>
          <div className={styles.actions}>
            <button type="button" className="btn" onClick={() => void copySchoolCaptureTool()}>
              複製擷取工具
            </button>
            <button
              type="button"
              className="btn"
              disabled={reading || saving || rows.length > 0 || !!importDocument}
              onClick={() => fileInput.current?.click()}
            >
              選擇擷取的 HTML 檔
            </button>
          </div>
          {captureCopyStatus && (
            <p role="status" className={styles.note}>
              {captureCopyStatus}
            </p>
          )}
          <details open={captureManualCopy || undefined} className={styles.source}>
            <summary>手動複製工具網址</summary>
            <label className={styles.field}>
              校務擷取書籤網址
              <textarea
                rows={3}
                readOnly
                value={SCHOOL_CAPTURE_BOOKMARK}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
          </details>
          <p className={styles.note}>
            部分網站會限制書籤程式，或以圖片、內嵌頁面呈現資料。工具沒有開啟或找不到表格時，請直接複製表格或使用截圖匯入。
          </p>
        </details>
        <input
          ref={aiImageInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className={styles.file}
          aria-label="選擇交給 AI 辨識的截圖"
          disabled={
            reading ||
            saving ||
            removingAiModel ||
            rows.length > 0 ||
            !!importDocument ||
            !aiAvailability.available
          }
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file)
              requestAi({
                input: { image: file },
                source: { type: 'screenshot', name: file.name },
              });
            event.target.value = '';
          }}
        />
        {schoolSelection && (
          <label className={styles.field}>
            這份資料的校園
            <select
              value={schoolSelection.selectedSchoolId || ''}
              disabled={reading || saving || rows.length > 0 || !!editing || !!importDocument}
              onChange={(event) => schoolSelection.selectSchool(event.target.value || null)}
            >
              <option value="">個人資料（不限校園）</option>
              {schoolSelection.schools.map((school) => (
                <option value={school.id} key={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset
          disabled={reading || saving || rows.length > 0 || !!importDocument}
          className={styles.fieldset}
        >
          {kind !== 'events' && (
            <div className={styles.fields}>
              <label className={styles.field}>
                這份資料的學年度
                <input
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                  placeholder="例如 115 或 2026"
                  inputMode="numeric"
                />
              </label>
              <label className={styles.field}>
                學期
                <input
                  value={semester}
                  onChange={(event) => setSemester(event.target.value)}
                  placeholder="例如 1、2 或暑期"
                />
              </label>
            </div>
          )}
          <div
            className={styles.upload}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!rows.length && !importDocument) void readFile(event.dataTransfer.files[0]);
            }}
          >
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,.pdf,.xlsx,.html,.htm,text/html,.csv,.tsv,.txt,.ics,.json,application/json"
              className={styles.file}
              aria-label="選擇截圖或檔案"
              onChange={(event) => {
                void readFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <button
              className="btn primary"
              type="button"
              onClick={() => fileInput.current?.click()}
            >
              選截圖或檔案
            </button>
            <span>也可以拖曳到這裡</span>
            <small>
              PNG／JPEG／WebP，單張 10 MB 內；PDF／XLSX，8 MiB 內；HTML 校務網頁 500 KB
              內；CSV／TSV／TXT／ICS，400 KB 內
            </small>
            <small>
              換裝置：也可選擇 Campus One 完整備份（JSON，8 MB 內），一次帶回三類資料與所有學期。
            </small>
          </div>
          <details className={styles.paste} open={pasteOpen || !!text}>
            <summary>或貼上從學校網頁複製的表格／文字</summary>
            <label className={styles.field}>
              原始文字
              <textarea
                ref={originalText}
                rows={7}
                value={text}
                onPaste={(event) => {
                  const html = event.clipboardData?.getData('text/html');
                  if (!html || !/<table\b/i.test(html)) return;
                  try {
                    const tables = extractSchoolPageTables(html, kind, periodProfile);
                    event.preventDefault();
                    setSourceImage(null);
                    setPreview('');
                    setSchoolPage({ name: '校務網頁複製內容', tables });
                    setNotice('已辨識複製的校務表格。請先選擇要匯入的表格，再核對每筆資料。');
                  } catch {
                    // Unsupported markup falls through to normal plain-text paste.
                  }
                }}
                onChange={(event) => {
                  setSchoolPage(null);
                  setText(event.target.value);
                  // Keep screenshot provenance so corrected OCR table spacing is still parsed.
                  if (!event.target.value || source.type !== 'screenshot')
                    setSource({ type: 'paste' });
                }}
                placeholder={EXAMPLES[kind]}
                maxLength={200000}
              />
            </label>
            <button
              className="btn"
              type="button"
              disabled={!text.trim()}
              onClick={() => parse(text)}
            >
              整理成待確認清單
            </button>
            <p className={styles.note}>
              學校網頁：選取整張表格並複製，直接貼到上方。也可選擇自行儲存的 HTML 網頁。
            </p>
          </details>
        </fieldset>
        {schoolPage && !importDocument && !rows.length && (
          <section className={styles.schoolPageChooser} aria-label="選擇校務網頁表格">
            <div>
              <h3>從校務網頁取出資料</h3>
              <p>
                來源：{schoolPage.name}
                。以下只保留表格文字，不執行原網頁程式，也不連線到學校。請選擇正確表格並核對欄位。
              </p>
            </div>
            <div className={styles.schoolPageCandidates}>
              {schoolPage.tables.map((table) => (
                <button
                  type="button"
                  key={table.id}
                  disabled={reading || saving}
                  onClick={() => {
                    const selectedSource = { type: 'file' as const, name: schoolPage.name };
                    setSourceImage(null);
                    setPreview('');
                    setSource(selectedSource);
                    const term = {
                      academicYear: year.trim() || table.suggestedTerm?.academicYear || '',
                      semester: semester.trim() || table.suggestedTerm?.semester || '',
                    };
                    if (table.suggestedTerm) {
                      if (!year.trim()) setYear(term.academicYear);
                      if (!semester.trim()) setSemester(term.semester);
                    }
                    setText(table.text);
                    // React state updates are deferred; parsing must use the same
                    // values that will appear in the academic-term fields.
                    parse(table.text, selectedSource, term);
                  }}
                >
                  <strong>{table.label}</strong>
                  <span>
                    {table.layout === 'weekly' ? '週課表轉換' : '校務資料列'} · {table.rowCount} 筆
                    · 點擊後進入核對
                  </span>
                  {table.suggestedTerm && (
                    <span>
                      網頁標示：{table.suggestedTerm.academicYear} 學年度第{' '}
                      {table.suggestedTerm.semester} 學期（只補空欄，匯入前請確認）
                    </span>
                  )}
                </button>
              ))}
            </div>
            <button type="button" className="btn" onClick={() => setSchoolPage(null)}>
              取消選擇表格
            </button>
          </section>
        )}
        {(text.trim() || sourceImage) && !importDocument && (
          <div className={styles.aiTools}>
            <div>
              <strong>欄位沒有對上？</strong>
              <p>可用免費 AI 重新整理目前來源，完成後再核對一次。</p>
            </div>
            <div className={styles.actions}>
              {sourceImage && (
                <button
                  type="button"
                  className="btn"
                  disabled={reading || saving || removingAiModel || !aiAvailability.available}
                  onClick={() =>
                    sourceImage && requestAi({ input: { image: sourceImage }, source })
                  }
                >
                  AI 重新讀取圖片
                </button>
              )}
              {text.trim() && (
                <button
                  type="button"
                  className="btn"
                  disabled={reading || saving || removingAiModel || !aiAvailability.available}
                  onClick={() => requestAi({ input: { text }, source })}
                >
                  AI 整理這段文字
                </button>
              )}
            </div>
          </div>
        )}
        {pendingAi && (
          <div
            className={styles.replacePrompt}
            role="alertdialog"
            aria-labelledby="import-ai-replace-title"
            aria-describedby="import-ai-replace-body"
          >
            <strong id="import-ai-replace-title">重新整理這份草稿？</strong>
            <p id="import-ai-replace-body">
              AI 完成後會替換目前 {rows.length}{' '}
              筆待確認內容，包含你已修改的欄位。已保存的紀錄不受影響；失敗或取消時會保留原草稿。
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className="btn primary"
                disabled={reading || saving}
                onClick={() => void processAi(pendingAi)}
              >
                確認以 AI 重新整理
              </button>
              <button
                type="button"
                className="btn"
                ref={keepAiDraft}
                onClick={() => setPendingAi(null)}
              >
                保留目前草稿
              </button>
            </div>
          </div>
        )}
        {reading && (
          <div className={styles.reading} aria-busy="true">
            <p role="status">{progress || '正在讀取檔案…'}</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                job.current?.abort();
                setReading(false);
                setProgress('');
                setNotice('已取消，原有資料與草稿沒有改變。');
              }}
            >
              取消讀取
            </button>
          </div>
        )}
        <p className={styles.note}>
          一般圖片讀取使用裝置端文字辨識；AI
          讀圖另使用需下載的視覺模型。兩種方式都會先產生草稿，無法確認的欄位留待核對。
        </p>
        {kind === 'timetable' && (
          <p className={styles.note}>
            {periodProfile
              ? `目前使用${PERIOD_PROFILE_TITLES[periodProfile]}節次表（${periodCount(periodProfile)} 節）；星期一至五的課程可顯示在「我的課表」。`
              : '尚未選用學校節次表。請保留原始上課時間；其他學校與週末課程會顯示在下方個人紀錄。'}
          </p>
        )}
        {preview && !rows.length && (
          <details className={styles.source} open>
            <summary>對照這張截圖</summary>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="你選擇的資料截圖，僅供核對" className={styles.preview} />
          </details>
        )}
      </section>
      {importDocument && (
        <fieldset disabled={reading || saving} className={styles.fieldset}>
          {importDocument.format === 'pdf' && (
            <div className={styles.panel}>
              <p>預覽只有標題，或表格文字不完整？可以重新辨識整頁，再核對一次。</p>
              {!hasDocumentFile && <p>請重新選擇原始 PDF，辨識完成前會保留目前的預覽。</p>}
              <input
                ref={pdfInput}
                type="file"
                accept=".pdf,application/pdf"
                className={styles.file}
                aria-label="重新選擇原始 PDF"
                onChange={(event) => {
                  void readFile(event.target.files?.[0], 'ocr');
                  event.target.value = '';
                }}
              />
              <button
                type="button"
                className="btn"
                onClick={() =>
                  documentFile.current
                    ? void readFile(documentFile.current, 'ocr')
                    : pdfInput.current?.click()
                }
              >
                重新辨識 PDF 整頁
              </button>
            </div>
          )}
          <DocumentSelection
            key={documentVersion}
            document={importDocument}
            initialSelection={documentSelection}
            onSelectionChange={setDocumentSelection}
            options={options}
            aiDisabled={reading || saving || removingAiModel || !aiAvailability.available}
            aiNote={
              aiAvailability.available
                ? `免費在這台裝置整理文字，不需 API 金鑰。首次下載${aiAvailability.downloadLabel}；文件內容不送到雲端辨識。`
                : aiAvailability.reason || '目前瀏覽器無法使用裝置端 AI，仍可使用一般整理。'
            }
            onAi={(selection) => {
              try {
                const selectedSource = personalImportDocumentAiSource(importDocument, selection);
                void processAi({
                  input: { text: selectedSource.text },
                  source: selectedSource.source,
                  fromDocument: true,
                });
              } catch (error) {
                setNotice(errorMessage(error, '無法整理選取內容，請調整頁面、工作表或起始列。'));
              }
            }}
            onCancel={() => {
              documentFile.current = null;
              setHasDocumentFile(false);
              setDocument(null);
              setDocumentSelection(null);
              setNotice('已取消這份文件，個人紀錄沒有改變。');
            }}
            onConfirm={(nextRows, issues) => {
              setRows(nextRows);
              setBackup(null);
              setReviewPage(0);
              setExcluded([]);
              setParseIssues(
                issues.filter(
                  (issue) =>
                    issue.severity === 'error' &&
                    !nextRows.some(
                      (row) =>
                        row.id === issue.rowId &&
                        validatePersonalImportRow(row, { periodProfile }).some(
                          (validation) =>
                            validation.code === issue.code && validation.field === issue.field,
                        ),
                    ),
                ),
              );
              setText('');
              setPreview('');
              documentFile.current = null;
              setHasDocumentFile(false);
              setDocument(null);
              setDocumentSelection(null);
              setNotice(
                `${personalImportPreviewNotice(nextRows.length)}${[...new Set(issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.message))].join(' ')}`,
              );
              requestAnimationFrame(() =>
                review.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
              );
            }}
          />
        </fieldset>
      )}
      <section ref={review} className={styles.panel} aria-label="核對匯入資料">
        <div className={styles.heading}>
          <h2>
            <span>2</span> 核對內容
          </h2>
          <button
            className="btn"
            disabled={saving || reading || !!importDocument}
            type="button"
            onClick={() => {
              setRows((current) => [
                ...current,
                {
                  id: createPersonalImportId(),
                  kind,
                  title: '',
                  schoolId: scope.schoolId,
                  academicYear: year,
                  semester,
                  source: { type: 'paste', line: 1, rawText: '' },
                },
              ]);
            }}
          >
            手動加一筆
          </button>
        </div>
        {kind === 'timetable' && rows.length > 0 && (
          <label className={styles.field}>
            補上對照截圖（保留草稿）
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={reading || saving}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                try {
                  const image = await createPersonalImportImagePreview(
                    file,
                    new AbortController().signal,
                  );
                  if (!active.current) return;
                  setPreview(URL.createObjectURL(image));
                  setNotice('已補上對照截圖，草稿內容沒有變更。');
                } catch (error) {
                  if (active.current) setNotice(errorMessage(error));
                }
              }}
            />
          </label>
        )}
        {!rows.length && timetableGrid}
        {parseIssues.some((issue) => issue.severity === 'error') && (
          <div role="alert" className={styles.error}>
            <p>
              原始資料有欄位需要確認。格式辨識錯誤可直接修改；表格結構或重複行程規則請修正原文後重新整理。
            </p>
            <ul>
              {parseIssues
                .filter((issue) => issue.severity === 'error')
                .map((issue, index) => (
                  <li key={index}>{issue.message}</li>
                ))}
            </ul>
          </div>
        )}
        <details className={styles.source}>
          <summary>需要把資料連結到課程空間？</summary>
          <p>
            {linkStatus} <Link href="/classroom">前往課程空間</Link>
          </p>
          <p>課程連結方便你開啟已加入的課，匯入後仍是個人紀錄。</p>
        </details>
        {backup && (
          <div className={styles.notice}>
            <strong>正在核對完整備份</strong>
            <p>
              {new Date(backup.exportedAt).toLocaleString('zh-TW')} 匯出 · 課表{' '}
              {backup.counts.timetable} 筆、成績 {backup.counts.grades} 筆、活動{' '}
              {backup.counts.events} 筆。
            </p>
            <p>
              各筆保留原學期與來源文字。原有課程連結需重新選擇你現在可開啟的課程；已在這台裝置存在的相同紀錄會保留原連結。
            </p>
          </div>
        )}
        {!rows.length ? (
          <p className={styles.empty}>帶入資料後，會在這裡逐筆顯示。你也可以直接手動新增。</p>
        ) : (
          <>
            <div className={styles.reviewSummary} aria-label="核對摘要">
              <div>
                <strong>{rows.length}</strong>
                <span>筆待核對</span>
              </div>
              <div data-warning={invalidRowIds.length > 0}>
                <strong>{invalidRowIds.length}</strong>
                <span>筆需要修正</span>
              </div>
              <div>
                <strong>{selected.length}</strong>
                <span>筆準備加入</span>
              </div>
              {invalidRowIds.length > 0 && (
                <button
                  type="button"
                  className="btn"
                  disabled={reading || saving}
                  onClick={focusFirstIssue}
                >
                  前往第一筆待修正
                </button>
              )}
            </div>
            <div className={styles.actions}>
              <strong>
                {selected.length} / {rows.length} 筆已選擇
              </strong>
              <button
                className="btn"
                type="button"
                disabled={saving || reading}
                onClick={() => {
                  setRows([]);
                  setBackup(null);
                  setReviewPage(0);
                  setExcluded([]);
                  setParseIssues([]);
                  setAiReviewed(false);
                  setPendingAi(null);
                  setReviewIssueIds(null);
                  setNotice('已取消待確認清單，原始文字仍保留，可修改後重新整理。');
                }}
              >
                取消這份草稿
              </button>
              <button
                className="btn"
                type="button"
                disabled={saving || reading}
                onClick={() => {
                  setExcluded([]);
                  setAiReviewed(false);
                }}
              >
                全選
              </button>
              <button
                className="btn"
                type="button"
                disabled={saving || reading}
                onClick={() => {
                  setExcluded(rows.map((row) => row.id));
                  setAiReviewed(false);
                }}
              >
                全部取消勾選
              </button>
            </div>
            <div className={styles.reviewFilters} role="group" aria-label="篩選待確認資料">
              <button
                type="button"
                aria-pressed={reviewIssueIds === null}
                disabled={reading || saving}
                onClick={() => {
                  setReviewIssueIds(null);
                  setReviewPage(0);
                }}
              >
                全部 {rows.length} 筆
              </button>
              <button
                type="button"
                aria-pressed={reviewIssueIds !== null}
                disabled={reading || saving}
                onClick={() => {
                  setReviewIssueIds(invalidRowIds);
                  setReviewPage(0);
                }}
              >
                待修正 {invalidRowIds.length} 筆
              </button>
            </div>
            {reviewIssueIds && (
              <p className={styles.note}>
                已修正的項目會留在目前清單，方便你完成對照；重新選擇「待修正」會更新清單。
              </p>
            )}
            <div className={styles.reviewLayout} data-has-source={!!preview || !!text}>
              {(preview || text) && (
                <aside className={styles.sourcePane} aria-label="匯入來源對照">
                  <div className={styles.sourcePaneHeading}>
                    <strong>來源對照</strong>
                    <span>{source.name || '貼上的文字'}</span>
                  </div>
                  {preview ? (
                    <>
                      <a
                        href={preview}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="另開原始截圖以放大核對"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={preview}
                          alt="你選擇的資料截圖，僅供核對"
                          className={styles.preview}
                        />
                      </a>
                      <small>點圖片可另開放大；原圖只保留在這次畫面。</small>
                    </>
                  ) : (
                    <pre>{text}</pre>
                  )}
                </aside>
              )}
              <div className={styles.reviewContent}>
                {timetableGrid}
                {!filteredRows.length && (
                  <p className={styles.empty}>目前沒有需要修正的項目。切換「全部」繼續核對。</p>
                )}
                <fieldset className={styles.fieldset} disabled={saving || reading}>
                  {filteredRows
                    .slice(
                      currentReviewPage * REVIEW_PAGE_SIZE,
                      (currentReviewPage + 1) * REVIEW_PAGE_SIZE,
                    )
                    .map((row) => (
                      <article
                        className={styles.row}
                        key={row.id}
                        tabIndex={-1}
                        ref={(element) => {
                          if (element) reviewRows.current.set(row.id, element);
                          else reviewRows.current.delete(row.id);
                        }}
                        data-needs-correction={invalidRowIds.includes(row.id)}
                      >
                        <label className={styles.check}>
                          <input
                            type="checkbox"
                            checked={!excluded.includes(row.id)}
                            onChange={(event) => {
                              setAiReviewed(false);
                              setExcluded((current) =>
                                event.target.checked
                                  ? current.filter((id) => id !== row.id)
                                  : [...current, row.id],
                              );
                            }}
                          />
                          <strong>
                            第 {rows.indexOf(row) + 1} 筆 ·{' '}
                            {KINDS.find((entry) => entry.value === row.kind)?.title}
                            {row.title ? ` · ${row.title}` : ''}
                          </strong>
                        </label>
                        <div className={styles.rowBadges}>
                          {invalidRowIds.includes(row.id) ? (
                            <span data-warning="true">需要修正</span>
                          ) : (
                            <span>欄位已補齊</span>
                          )}
                          {parseIssues.some(
                            (issue) =>
                              issue.code === 'ai-review-required' && issue.rowId === row.id,
                          ) && <span>AI 草稿 · 請對照來源</span>}
                        </div>
                        {backup?.proposedLinks[row.id] && (
                          <p className={styles.note}>
                            原備份有課程連結。
                            {workspaces.find((item) => item.id === backup.proposedLinks[row.id])
                              ?.title || '請核對目前可用的課程'}
                            ；要連結請在下方重新選擇，也可先保留個人紀錄。
                          </p>
                        )}
                        <RowFields
                          row={row}
                          aiSource={parseIssues.some(
                            (issue) =>
                              issue.code === 'ai-review-required' && issue.rowId === row.id,
                          )}
                          periodProfile={periodProfile}
                          workspaces={workspaces}
                          onRefreshWorkspaces={() => setLinkRefreshVersion((v) => v + 1)}
                          onChange={(next) => updateDraft(row, next)}
                        />
                        {row.kind === 'timetable' && (
                          <div className={styles.actions}>
                            <button
                              type="button"
                              className="btn"
                              disabled={
                                saving ||
                                reading ||
                                !row.startPeriod ||
                                !row.endPeriod ||
                                row.endPeriod <= row.startPeriod
                              }
                              onClick={() => {
                                setAiReviewed(false);
                                const parts = splitReviewRow(row, periodProfile);
                                setEditedIds((current) => [
                                  ...new Set([...current, ...parts.map((item) => item.id)]),
                                ]);
                                setRows((current) =>
                                  current.flatMap((item) => (item.id === row.id ? parts : [item])),
                                );
                              }}
                            >
                              拆成單節課程
                            </button>
                            <button
                              type="button"
                              className="btn"
                              disabled={
                                saving ||
                                reading ||
                                !nextReviewRow(
                                  rows.filter((item) => !excluded.includes(item.id)),
                                  row,
                                )
                              }
                              onClick={() => {
                                const next = nextReviewRow(
                                  rows.filter((item) => !excluded.includes(item.id)),
                                  row,
                                );
                                if (!next) return;
                                updateDraft(row, {
                                  ...row,
                                  endPeriod: next.endPeriod ?? next.startPeriod,
                                  endTime: next.endTime,
                                  periodLabel: undefined,
                                });
                                setRows((current) => current.filter((item) => item.id !== next.id));
                              }}
                            >
                              與下一節同名課程合併
                            </button>
                            <button
                              type="button"
                              className="btn"
                              disabled={saving || reading}
                              onClick={() => {
                                setAiReviewed(false);
                                setRows((current) => current.filter((item) => item.id !== row.id));
                                setExcluded((current) => current.filter((id) => id !== row.id));
                              }}
                            >
                              刪除此草稿課程
                            </button>
                          </div>
                        )}
                        {parseIssues.some(
                          (issue) =>
                            issue.rowId === row.id &&
                            issue.severity === 'warning' &&
                            issue.code !== 'ai-review-required',
                        ) && (
                          <ul className={styles.issues} aria-label="AI 待核對提示">
                            {parseIssues
                              .filter(
                                (issue) =>
                                  issue.rowId === row.id &&
                                  issue.severity === 'warning' &&
                                  issue.code !== 'ai-review-required',
                              )
                              .map((issue, index) => (
                                <li key={`${issue.code}-${index}`}>{issue.message}</li>
                              ))}
                          </ul>
                        )}
                      </article>
                    ))}
                </fieldset>
                {filteredRows.length > REVIEW_PAGE_SIZE && (
                  <nav className={styles.actions} aria-label="待確認資料分頁">
                    <button
                      className="btn"
                      type="button"
                      disabled={saving || reading || currentReviewPage === 0}
                      onClick={() => setReviewPage(currentReviewPage - 1)}
                    >
                      上一頁
                    </button>
                    <span>
                      第 {currentReviewPage + 1} /{' '}
                      {Math.ceil(filteredRows.length / REVIEW_PAGE_SIZE)} 頁 · 每頁{' '}
                      {REVIEW_PAGE_SIZE} 筆
                    </span>
                    <button
                      className="btn"
                      type="button"
                      disabled={
                        saving ||
                        reading ||
                        (currentReviewPage + 1) * REVIEW_PAGE_SIZE >= filteredRows.length
                      }
                      onClick={() => setReviewPage(currentReviewPage + 1)}
                    >
                      下一頁
                    </button>
                  </nav>
                )}
              </div>
            </div>
            {aiNeedsReview && (
              <div className={styles.aiReview}>
                <strong>AI 整理完成，最後由你核對</strong>
                <p>
                  請對照原檔確認課名、日期、星期、節次與成績數字。AI 留白或讀錯的欄位，可直接修改。
                </p>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={aiReviewed}
                    disabled={reading || saving}
                    onChange={(event) => setAiReviewed(event.target.checked)}
                  />
                  <span>我已對照來源，逐筆核對這次 AI 整理的內容</span>
                </label>
              </div>
            )}
            <div className={styles.confirm}>
              <div>
                <strong>只新增，不取代你原有的資料</strong>
                <p>
                  {errors.length
                    ? `已選資料有 ${errors.length} 個欄位需要確認，可修改或取消勾選該筆。`
                    : invalidLinks
                      ? '有課程連結尚未確認，請重新選擇或先保留個人紀錄。'
                      : aiNeedsReview && !aiReviewed
                        ? '請先勾選已完成逐筆核對，再確認匯入。'
                        : '相同資料會略過。確認後可撤銷這次新增。'}
                </p>
              </div>
              <button
                type="button"
                className="btn primary"
                disabled={
                  saving ||
                  reading ||
                  !!ledger.error ||
                  !selected.length ||
                  errors.length > 0 ||
                  invalidLinks ||
                  (aiNeedsReview && !aiReviewed)
                }
                onClick={() => void save()}
              >
                {saving ? '儲存中…' : `確認匯入 ${selected.length} 筆`}
              </button>
            </div>
          </>
        )}
      </section>
      <details className={styles.syncDetails}>
        <summary>
          同步與保存設定 <span>目前帳號在{schoolName}的個人資料</span>
        </summary>
        <PersonalImportSyncPanel scope={scope} available={!paused && !saving && !reading} />
      </details>
      <section className={styles.panel} aria-label="已匯入的個人資料">
        <div className={styles.heading}>
          <h2>
            <span>3</span> 我的個人紀錄
          </h2>
          <div className={styles.actions}>
            <button
              type="button"
              className="btn"
              disabled={
                saving || reading || ledger.loading || !!ledger.error || !ledger.records.length
              }
              onClick={exportBackup}
            >
              下載完整備份
            </button>
            <button type="button" className="btn" disabled={!saved.length} onClick={exportRecords}>
              匯出這類資料
            </button>
            {lastBatch && (
              <button
                type="button"
                className="btn"
                disabled={saving}
                onClick={() => setUndoOpen(true)}
              >
                {PERSONAL_IMPORT_UNDO_LABEL}
              </button>
            )}
          </div>
        </div>
        <p className={styles.note}>
          完整備份包含目前帳號在{schoolName}的課表、成績、活動、所有學期與來源文字，可在 Web 或 App
          選檔還原。JSON 檔未加密，請存到自己信任的位置；下載後請確認檔案存在。
        </p>
        {kind === 'grades' && (
          <p className={styles.note}>
            自行匯入的參考成績，共 {saved.length} 筆、
            {saved.reduce((sum, row) => sum + (row.credits || 0), 0)}{' '}
            個修課學分。含未通過與重修，不能當作畢業採計學分。
          </p>
        )}
        <label className={styles.field}>
          搜尋個人紀錄
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="課名、老師、課號或學年度"
          />
        </label>
        {ledger.loading ? (
          <p role="status">正在讀取…</p>
        ) : !saved.length ? (
          <p className={styles.empty}>還沒有符合的個人紀錄。</p>
        ) : (
          <ul className={styles.saved}>
            {saved.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>{row.title}</strong>
                  <p>{rowSummary(row, periodProfile)}</p>
                  <small>自行匯入 · {row.source.name || '手動／貼上文字'}</small>
                  {row.linkedCourseId &&
                    workspaces.some((item) => item.id === row.linkedCourseId) && (
                      <p>
                        <Link href={`/classroom/course/${encodeURIComponent(row.linkedCourseId)}`}>
                          開啟連結的課程 →
                        </Link>
                      </p>
                    )}
                </div>
                <button
                  type="button"
                  className="btn"
                  disabled={saving}
                  onClick={() => setEditing({ original: row, row: { ...row } })}
                >
                  編輯 {row.title}
                </button>
              </li>
            ))}
          </ul>
        )}
        {undoOpen && lastBatch && (
          <div className={styles.dialogMask}>
            <div
              className={styles.dialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="personal-import-undo-title"
            >
              <h3 id="personal-import-undo-title">{PERSONAL_IMPORT_UNDO_TITLE}</h3>
              <p>
                {personalImportUndoBody(
                  ledger.records.filter((row) => row.batchId === lastBatch).length,
                )}
              </p>
              <div className={styles.dialogActions}>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={saving}
                  onClick={() => {
                    setUndoOpen(false);
                    void mutate(
                      async () => {
                        await undoPersonalImports(
                          scope,
                          lastBatch,
                          () => active.current && !suspended.current,
                        );
                        if (active.current) setLastBatch('');
                      },
                      personalImportUndoneNotice(
                        ledger.records.filter((row) => row.batchId === lastBatch).length,
                      ),
                    );
                  }}
                >
                  {PERSONAL_IMPORT_UNDO_CONFIRM}
                </button>
                <button
                  type="button"
                  className="btn"
                  ref={undoKeep}
                  disabled={saving}
                  onClick={() => setUndoOpen(false)}
                >
                  {PERSONAL_IMPORT_UNDO_KEEP}
                </button>
              </div>
            </div>
          </div>
        )}
        {editing && (
          <section className={styles.row} aria-label="編輯個人紀錄">
            <h3>編輯 {editing.original.title}</h3>
            <fieldset disabled={saving} className={styles.fieldset}>
              <RowFields
                row={editing.row}
                workspaces={workspaces}
                periodProfile={periodProfile}
                onRefreshWorkspaces={() => setLinkRefreshVersion((v) => v + 1)}
                onChange={(row) => setEditing({ ...editing, row })}
              />
            </fieldset>
            <div className={styles.actions}>
              <button
                className="btn primary"
                type="button"
                disabled={
                  saving ||
                  validatePersonalImportRow(editing.row, { periodProfile }).some(
                    (issue) => issue.severity === 'error',
                  ) ||
                  !!(
                    editing.row.linkedCourseId &&
                    !workspaces.some((item) => item.id === editing.row.linkedCourseId)
                  )
                }
                onClick={() =>
                  void mutate(
                    () =>
                      changePersonalImport(
                        scope,
                        editing.original,
                        editing.row,
                        () => active.current && !suspended.current,
                      ),
                    '個人紀錄已更新。',
                  )
                }
              >
                儲存修改
              </button>
              <button
                className="btn"
                type="button"
                disabled={saving}
                onClick={() => setEditing(null)}
              >
                取消編輯
              </button>
              <button
                className="btn"
                type="button"
                disabled={saving}
                onClick={() => {
                  if (window.confirm(`確定移除「${editing.original.title}」這筆個人紀錄？`))
                    void mutate(
                      () =>
                        changePersonalImport(
                          scope,
                          editing.original,
                          null,
                          () => active.current && !suspended.current,
                        ),
                      '已移除這筆個人紀錄。',
                    );
                }}
              >
                移除這筆
              </button>
            </div>
          </section>
        )}
      </section>
    </div>
  );
}
