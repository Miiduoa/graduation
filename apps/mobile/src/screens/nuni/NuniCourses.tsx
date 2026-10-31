import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react';
import { Image, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { revealAssignmentSubmitArea } from './scrollAssignment';
import {
  MATERIAL_CURSOR_CYCLE_MESSAGE,
  MATERIAL_TARGET_AUTO_PAGE_BUDGET,
  appendMaterialPage,
  emptyMaterialPageProgress,
  filterLoadedMaterials,
  materialSearchStatusCopy,
  visibleLoadedMaterials,
  type MaterialPageProgress,
} from './materialDiscovery';
import { randomUUID } from 'expo-crypto';
import {
  createNuniClasses,
  NuniError,
  nuniErrorMessage,
  type NuniAssignment,
  type NuniMaterial,
  type NuniQuiz,
  type NuniQuizResponse,
  type NuniSubmission,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import {
  assignmentLateOpenLabel,
  assignmentReceiptStatusLabel,
  assignmentSubmissionLate,
  assignmentCanRevise,
} from '@campus/shared/src/assignmentFiles';
import { formatTaipeiDateTime, parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { loadNuniStudyAgenda } from '@campus/shared/src/nuniStudyAgenda';
import {
  assignmentFileDownloadUrl,
  assignmentFileSubmitEnabledNative,
  localFileSizeLabel,
  moveNativeFile,
  pickAssignmentAlbum,
  pickAssignmentCamera,
  pickAssignmentDocuments,
  removeNativeFile,
  submitNativeAssignmentFiles,
  usesAssignmentFileBff,
  type LocalNativeFile,
  type NativeUploadProgress,
} from './assignmentFileSubmit';
import { courseRoleLabels } from '@campus/shared/src/nuniCourseTasks';
import {
  awaitingFeedbackPosition,
  feedbackPredatesSubmission,
  feedbackQueueLabel,
  matchesFeedbackQueueFilter,
  needsFeedbackReview,
  nextAwaitingFeedbackReview,
  sortFeedbackQueue,
  type FeedbackQueueFilter,
} from '@campus/shared/src/lmsReviewQueue';
import { useNuniSession } from '../../state/nuniSession';
import { useNuniDraftState } from '../../state/nuniDrafts';
import { useTheme } from '../../state/theme';
import type { NativeNuniSession } from '../../services/nuniSessionController';
import type {
  NuniRecentTeacherFeedback,
  NuniRecentTeacherFeedbackResult,
} from '../../services/nuniRecentFeedback';
import {
  isPendingActivity,
  matchesActivityFilter,
  matchesActivitySearch,
  matchesCourseListFilter,
  matchesCourseSearch,
  prioritizeActivities,
  type ActivityFilter,
  type CourseListFilter,
} from '../../services/nuniActivityTasks';
import { StudyAgenda } from './StudyAgenda';
import { createNuniClassroom } from '@campus/shared/src/nuniClassroom';
import { NuniAttendance, createAttendanceStore } from './NuniAttendance';

type Classes = ReturnType<typeof createNuniClasses>;
type Field = {
  name: string;
  label: string;
  max: number;
  multiline?: boolean;
  min?: number;
  hint?: string;
};
type Activity = NuniAssignment | NuniQuiz;
type Receipt = NuniSubmission | NuniQuizResponse;
// Matches parseNuniQuizResponse and the platform quiz submission endpoint.
const QUIZ_ANSWER_LIMIT = 2000;
const time = (value: string) => formatTaipeiDateTime(value);
const receiptFeedbackIsStale = (receipt: Receipt) =>
  !!receipt.teacherFeedback && !!receipt.reviewedAt && needsFeedbackReview(receipt);

function Copy({
  children,
  title = false,
  alert = false,
}: {
  children: ReactNode;
  title?: boolean;
  alert?: boolean;
}) {
  const theme = useTheme();
  return (
    <Text
      accessibilityRole={alert ? 'alert' : title ? 'header' : undefined}
      style={{
        color: alert ? theme.colors.danger : theme.colors.text,
        fontSize: title ? 20 : 15,
        fontWeight: title ? '600' : '400',
        lineHeight: title ? 29 : 24,
      }}
    >
      {children}
    </Text>
  );
}
function Button({
  label,
  onPress,
  disabled = false,
  selected,
  expanded,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  selected?: boolean;
  expanded?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{
        disabled,
        ...(selected === undefined ? {} : { selected }),
        ...(expanded === undefined ? {} : { expanded }),
      }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 10,
        borderWidth: 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        paddingHorizontal: 14,
        paddingVertical: 12,
        backgroundColor: pressed || selected ? theme.colors.surface2 : theme.colors.surface,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text style={{ color: theme.colors.accent, fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
function Section({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderColor: theme.colors.border,
        paddingTop: 18,
        marginTop: 6,
        gap: 12,
      }}
    >
      {children}
    </View>
  );
}

function truncateFeedback(text: string, max = 120): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function RecentTeacherFeedbackPanel({
  loading,
  error,
  data,
  limited = false,
  onRetry,
  open,
}: {
  loading: boolean;
  error: string;
  data: NuniRecentTeacherFeedbackResult | null;
  limited?: boolean;
  onRetry(): void;
  open(courseId: string, activityId?: string): void;
}) {
  const items = data?.items ?? [];
  const failed = data?.failedCourseIds.length ?? 0;
  const studied = data?.studiedCourseCount ?? 0;
  // List failure: do not claim an empty success. Partial course failures keep loaded rows.
  if (!loading && !error && !data) return null;
  return (
    <Section>
      <Copy title>最近老師回饋{items.length ? ` · ${items.length}` : ''}</Copy>
      <Copy>跨課程已留下的回饋，依時間由新到舊。點進去可看完整內容。</Copy>
      {loading ? <Copy>正在讀取老師回饋…</Copy> : null}
      {error ? (
        <>
          <Copy alert>{error}</Copy>
          <Button label="重試讀取回饋" onPress={onRetry} />
        </>
      ) : null}
      {!loading && !error && data && failed > 0 ? (
        <>
          <Copy alert>
            有 {failed} 門課程的回饋讀取失敗
            {items.length ? '；以下為已成功載入的部分。' : '，目前無法顯示回饋。'}
          </Copy>
          <Button label="重試讀取回饋" onPress={onRetry} />
        </>
      ) : null}
      {!loading && !error && data && items.length === 0 && failed === 0 ? (
        <Copy>
          {limited
            ? '已載入內容中尚無回饋，較早紀錄可能未包含。'
            : studied === 0
              ? '加入修習課程後，老師留下的回饋會顯示在這裡。'
              : '目前還沒有跨課程的老師回饋。'}
        </Copy>
      ) : null}
      {!loading && !error && limited && items.length > 0 ? (
        <Copy>這裡只顯示已載入的回饋，較早紀錄可能未包含。</Copy>
      ) : null}
      {!loading && !error
        ? items.map((item) => (
            <RecentTeacherFeedbackRow
              key={`${item.courseId}-${item.kind}-${item.id}`}
              item={item}
              open={open}
            />
          ))
        : null}
    </Section>
  );
}

function RecentTeacherFeedbackRow({
  item,
  open,
}: {
  item: NuniRecentTeacherFeedback;
  open(courseId: string, activityId?: string): void;
}) {
  const kindLabel = item.kind === 'quiz' ? '測驗回饋' : '作業回饋';
  const label = `開啟「${item.title}」完整回饋`;
  return (
    <View style={{ gap: 6 }}>
      <Copy title>{item.title}</Copy>
      <Copy>
        {item.courseName} · {kindLabel}
        {item.stale ? ' · 早於最近繳交' : ''}
      </Copy>
      <Copy>{truncateFeedback(item.feedback)}</Copy>
      {item.stale ? <Copy>這則回饋早於你最近一次繳交，請到作業頁確認是否仍適用。</Copy> : null}
      {item.reviewedAt ? <Copy>{time(item.reviewedAt)}</Copy> : null}
      <Button label={label} onPress={() => open(item.courseId, item.id)} />
    </View>
  );
}

type MutationIntent = 'primary' | 'secondary';

/** Retry preserves the submitted payload and key until the server confirms the outcome. */
function MutationForm({
  draftKey,
  fields,
  label,
  secondaryLabel,
  submit,
  savedContent,
}: {
  draftKey: string;
  fields: Field[];
  label: string;
  /** Optional second action (e.g. save feedback and open next awaiting review). */
  secondaryLabel?: string;
  savedContent?: { values: Record<string, string>; revision: string };
  submit(
    values: Record<string, string>,
    key: string,
    active: () => boolean,
    intent: MutationIntent,
  ): Promise<string | void>;
}) {
  const theme = useTheme();
  const [values, setValues] = useNuniDraftState<Record<string, string>>(`${draftKey}:values`, {});
  const [draftRevision, setDraftRevision] = useNuniDraftState<string | null>(
    `${draftKey}:revision`,
    null,
  );
  const editingValues = savedContent ? { ...savedContent.values, ...values } : values;
  const changed =
    !!savedContent &&
    Object.keys(values).length > 0 &&
    draftRevision !== null &&
    savedContent.revision !== draftRevision;
  const [storedIntent, setStoredIntent] = useNuniDraftState<{
    values: Record<string, string>;
    signature: string;
    key: string;
    action: MutationIntent;
  } | null>(`${draftKey}:intent`, null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(!!storedIntent);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const lock = useRef(false);
  const intent = useRef<{
    values: Record<string, string>;
    signature: string;
    key: string;
    action: MutationIntent;
  } | null>(storedIntent);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const send = async (action: MutationIntent) => {
    if (lock.current || !mounted.current) return;
    if (changed && !uncertain) {
      setError('請先選擇使用最新內容，或保留草稿後再儲存。');
      return;
    }
    const payload = Object.fromEntries(
      fields.map((field) => [field.name, (editingValues[field.name] ?? '').trim()]),
    );
    const tooLong = fields.find((field) => payload[field.name].length > field.max);
    if (!uncertain && tooLong) {
      setError(`${tooLong.label}最多 ${tooLong.max} 字，請縮短內容後再送出。`);
      return;
    }
    if (
      !uncertain &&
      fields.some(
        (field) =>
          payload[field.name].length < (field.min ?? 1) || payload[field.name].length > field.max,
      )
    ) {
      setError('請填妥內容，再送出。');
      return;
    }
    const signature = JSON.stringify({ payload, action });
    if (!intent.current || (!uncertain && intent.current.signature !== signature))
      intent.current = { values: payload, signature, key: randomUUID(), action };
    setStoredIntent(intent.current);
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const confirmed = await submit(
        intent.current.values,
        intent.current.key,
        () => mounted.current,
        intent.current.action,
      );
      if (mounted.current) {
        intent.current = null;
        setStoredIntent(null);
        setUncertain(false);
        if (savedContent) {
          setValues({});
          setDraftRevision(null);
        }
        setNotice(typeof confirmed === 'string' ? confirmed : '已確認儲存。');
      }
    } catch (failure) {
      if (mounted.current) {
        const unknown =
          uncertain ||
          !(failure instanceof NuniError) ||
          failure.status === 0 ||
          failure.status === 408 ||
          failure.status >= 500 ||
          failure.code === 'SESSION_CHANGED';
        if (!unknown) {
          intent.current = null;
          setStoredIntent(null);
        }
        setUncertain(unknown);
        setError(
          unknown
            ? '尚未確認這次送出結果。內容已保留，重試會確認同一次送出。'
            : nuniErrorMessage(failure),
        );
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <View style={{ gap: 10 }}>
      {changed && !uncertain ? (
        <View style={{ gap: 8 }}>
          <Copy alert>這份內容已有更新。你的草稿尚未儲存，請選擇接下來要編輯的內容。</Copy>
          <Button
            label="改用目前內容"
            disabled={busy}
            onPress={() => {
              setValues({});
              setDraftRevision(null);
              setError('');
              setNotice('');
            }}
          />
          <Button
            label="保留草稿，儲存時覆寫"
            disabled={busy}
            onPress={() => {
              setDraftRevision(savedContent!.revision);
              setError('');
              setNotice('');
            }}
          />
        </View>
      ) : null}
      {fields.map((field) => (
        <View key={field.name} style={{ gap: 6 }}>
          <Copy>{field.label}</Copy>
          <TextInput
            accessibilityLabel={field.label}
            value={editingValues[field.name] ?? ''}
            editable={!busy && !uncertain}
            maxLength={field.max}
            multiline={field.multiline}
            autoCapitalize="none"
            textAlignVertical="top"
            onChangeText={(value) => {
              const next = { ...editingValues, [field.name]: value };
              if (savedContent) {
                const pristine = fields.every(
                  (entry) => (next[entry.name] ?? '') === (savedContent.values[entry.name] ?? ''),
                );
                setValues(pristine ? {} : next);
                setDraftRevision(pristine ? null : (draftRevision ?? savedContent.revision));
              } else setValues(next);
              setError('');
              setNotice('');
            }}
            style={{
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: 8,
              padding: 12,
              color: theme.colors.text,
              backgroundColor: theme.colors.surface,
              minHeight: field.multiline ? 100 : 46,
              fontSize: 16,
            }}
          />
          {field.hint ? <Copy>{field.hint}</Copy> : null}
        </View>
      ))}
      {error ? <Copy alert>{error}</Copy> : null}
      {notice ? <Copy>{notice}</Copy> : null}
      <Button
        label={
          busy
            ? '正在確認…'
            : uncertain
              ? '重試確認這次送出'
              : intent.current?.action === 'secondary' && uncertain
                ? '重試確認這次送出'
                : label
        }
        disabled={busy}
        onPress={() => void send(uncertain && intent.current ? intent.current.action : 'primary')}
      />
      {secondaryLabel && !uncertain ? (
        <Button
          label={busy ? '正在確認…' : secondaryLabel}
          disabled={busy}
          onPress={() => void send('secondary')}
        />
      ) : null}
    </View>
  );
}

function useLoad<T>(
  load: (fence: { cancelled(): boolean }) => Promise<T>,
  automatic = true,
  clearOnDenied = false,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(automatic);
  const generation = useRef(0);
  const mounted = useRef(true);
  const reading = useRef(false);
  const confirmedDuringRead = useRef(false);
  const refresh = useCallback(
    async function refreshData(): Promise<void> {
      const run = ++generation.current;
      reading.current = true;
      setLoading(true);
      setError('');
      try {
        const value = await load({
          cancelled: () => !mounted.current || run !== generation.current,
        });
        if (mounted.current && run === generation.current) setData(value);
      } catch (failure) {
        if (mounted.current && run === generation.current) {
          setError(nuniErrorMessage(failure));
          if (
            clearOnDenied &&
            failure instanceof NuniError &&
            ([401, 403, 404].includes(failure.status) || failure.code === 'SESSION_CHANGED')
          )
            setData(null);
        }
      } finally {
        if (mounted.current && run === generation.current) {
          reading.current = false;
          if (confirmedDuringRead.current) {
            confirmedDuringRead.current = false;
            // Finish the newer authority read, then verify the confirmed write.
            // A delayed mutation must never unmask the old role or cancel that read.
            void refreshData();
          } else setLoading(false);
        }
      }
    },
    [load, clearOnDenied],
  );
  useEffect(() => {
    mounted.current = true;
    if (automatic) void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh, automatic]);
  const commit = useCallback(
    (update: (current: T | null) => T | null, expectedGeneration: number) => {
      if (!mounted.current) return;
      if (reading.current) {
        confirmedDuringRead.current = true;
        return;
      }
      if (generation.current !== expectedGeneration) {
        void refresh();
        return;
      }
      setData(update);
    },
    [refresh],
  );
  const reloadAfterMutation = useCallback(() => {
    if (!mounted.current) return;
    if (reading.current) confirmedDuringRead.current = true;
    else void refresh();
  }, [refresh]);
  return {
    data,
    commit,
    error,
    loading,
    refresh,
    reloadAfterMutation,
    version: generation.current,
  };
}

export function NuniCourses({
  initialWorkspaceId,
  initialAssignmentId,
  initialMaterialId,
}: {
  initialWorkspaceId?: string;
  initialAssignmentId?: string;
  initialMaterialId?: string;
} = {}) {
  const auth = useNuniSession();
  if (!auth.session || auth.loading || auth.pendingLogout) return null;
  return (
    <CourseScope
      key={auth.session.context}
      session={auth.session}
      request={auth.request}
      upload={auth.upload}
      bffRequest={auth.bffRequest}
      initialWorkspaceId={initialWorkspaceId}
      initialAssignmentId={initialAssignmentId}
      initialMaterialId={initialMaterialId}
    />
  );
}
function CourseScope({
  session,
  request,
  upload,
  bffRequest,
  initialWorkspaceId,
  initialAssignmentId,
  initialMaterialId,
}: {
  session: NativeNuniSession;
  request: ReturnType<typeof useNuniSession>['request'];
  upload?: ReturnType<typeof useNuniSession>['upload'];
  bffRequest?: ReturnType<typeof useNuniSession>['bffRequest'];
  initialWorkspaceId?: string;
  initialAssignmentId?: string;
  initialMaterialId?: string;
}) {
  const theme = useTheme();
  const classes = useMemo(
    () =>
      createNuniClasses(
        (path, input, query) => {
          const send =
            assignmentFileSubmitEnabledNative() &&
            bffRequest &&
            usesAssignmentFileBff(path, input)
              ? bffRequest
              : request;
          return query
            ? send(path, session.context, input, undefined, query)
            : send(path, session.context, input);
        },
        session.platformAccountId,
        upload
          ? (path, body, contentType) => upload(path, session.context, body, contentType)
          : undefined,
      ),
    [bffRequest, request, session.context, session.platformAccountId, upload],
  );
  const classroom = useMemo(
    () => createNuniClassroom((path, input) => request(path, session.context, input)),
    [request, session.context],
  );
  const [attendanceStore] = useState(createAttendanceStore);
  const scrollRef = useRef<ScrollView>(null);
  const contentOffsetYRef = useRef(0);
  const [selected, setSelected] = useNuniDraftState<string | null>(
    'courses:selected',
    initialWorkspaceId ?? null,
  );
  const [focusActivityId, setFocusActivityId] = useState<string | undefined>(initialAssignmentId);
  const [focusMaterialId, setFocusMaterialId] = useState<string | undefined>(initialMaterialId);
  useEffect(() => {
    if (initialWorkspaceId) {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      contentOffsetYRef.current = 0;
      setSelected(initialWorkspaceId);
    }
  }, [initialWorkspaceId, setSelected]);
  useEffect(() => {
    if (initialAssignmentId) setFocusActivityId(initialAssignmentId);
  }, [initialAssignmentId]);
  useEffect(() => {
    if (initialMaterialId) setFocusMaterialId(initialMaterialId);
  }, [initialMaterialId]);
  const openCourse = useCallback(
    (id: string, activityId?: string) => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      contentOffsetYRef.current = 0;
      setFocusActivityId(activityId);
      setFocusMaterialId(undefined);
      setSelected(id);
    },
    [setSelected],
  );
  return (
    <ScrollView
      ref={scrollRef}
      testID="nuni-courses-scroll"
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={16}
      onScroll={(event) => {
        contentOffsetYRef.current = event.nativeEvent.contentOffset.y;
      }}
      contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 16 }}
      style={{ backgroundColor: theme.colors.bg }}
    >
      {selected ? (
        <CourseDetail
          attendanceStore={attendanceStore}
          key={selected}
          id={selected}
          classes={classes}
          classroom={classroom}
          onBack={() => {
            scrollRef.current?.scrollTo({ y: 0, animated: false });
            contentOffsetYRef.current = 0;
            setFocusActivityId(undefined);
            setFocusMaterialId(undefined);
            setSelected(null);
          }}
          initialAssignmentId={focusActivityId}
          initialMaterialId={focusMaterialId}
          scrollRef={scrollRef}
          contentOffsetYRef={contentOffsetYRef}
        />
      ) : (
        <CourseList classes={classes} open={openCourse} />
      )}
    </ScrollView>
  );
}

function CourseList({
  classes,
  open,
}: {
  classes: Classes;
  open(id: string, activityId?: string): void;
}) {
  const theme = useTheme();
  const load = useCallback(() => classes.list(), [classes]);
  const result = useLoad(load, true, true);
  const loadAgenda = useCallback(
    (fence: { cancelled(): boolean }) => loadNuniStudyAgenda(classes, result.data ?? [], fence),
    [classes, result.data],
  );
  const agenda = useLoad(loadAgenda, result.data !== null, true);
  const agendaData = useMemo(() => {
    if (!agenda.data || agenda.data === 'cancelled') return null;
    const allowed = new Set(
      (result.data ?? [])
        .filter((course) => course.state === 'active' && course.memberRole === 'student')
        .map((course) => course.id),
    );
    return {
      ...agenda.data,
      tasks: agenda.data.tasks.filter((task) => allowed.has(task.courseId)),
      failedCourseIds: agenda.data.failedCourseIds.filter((id) => allowed.has(id)),
      limitedCourseIds: agenda.data.limitedCourseIds.filter((id) => allowed.has(id)),
      studiedCourseCount: allowed.size,
    };
  }, [agenda.data, result.data]);
  const feedback = useMemo<NuniRecentTeacherFeedbackResult | null>(() => {
    if (!agendaData) return null;
    return {
      studiedCourseCount: agendaData.studiedCourseCount,
      failedCourseIds: agendaData.failedCourseIds,
      items: agendaData.tasks
        .filter((task) => !!task.feedback && !!task.submittedAt)
        .map((task) => ({
          kind: task.kind,
          id: task.id,
          courseId: task.courseId,
          courseName: task.courseTitle,
          title: task.title,
          feedback: task.feedback!,
          reviewedAt: task.reviewedAt,
          submittedAt: task.submittedAt,
          stale: feedbackPredatesSubmission(task.reviewedAt, task.submittedAt),
        }))
        .sort(
          (left, right) =>
            (right.reviewedAt ? (parseTaipeiInstant(right.reviewedAt) ?? 0) : 0) -
            (left.reviewedAt ? (parseTaipeiInstant(left.reviewedAt) ?? 0) : 0),
        )
        .slice(0, 8),
    };
  }, [agendaData]);
  const [action, setAction] = useNuniDraftState<'join' | 'create' | null>('courses:entry', null);
  const [query, setQuery] = useNuniDraftState('courses:search', '');
  const [filter, setFilter] = useNuniDraftState<CourseListFilter>('courses:filter', 'all');
  const courses = result.data ?? [];
  const matched = courses.filter(
    (course) => matchesCourseListFilter(course, filter) && matchesCourseSearch(course, query),
  );
  const filters: [CourseListFilter, string][] = [
    ['all', '全部課程'],
    ['student', '修習'],
    ['teaching', '授課'],
    ['archived', '已封存'],
  ];
  return (
    <>
      <View style={{ gap: 6 }}>
        <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>學習空間</Text>
        <Text
          accessibilityRole="header"
          style={{ color: theme.colors.text, fontSize: 30, fontWeight: '600', lineHeight: 39 }}
        >
          我的課程
        </Text>
        <Copy>先掌握待辦，再回到課程繼續學習。</Copy>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button
          label="加入課程"
          selected={action === 'join'}
          onPress={() => setAction(action === 'join' ? null : 'join')}
        />
        <Button
          label="建立課程"
          selected={action === 'create'}
          onPress={() => setAction(action === 'create' ? null : 'create')}
        />
        <Button
          label="更新課程"
          onPress={() => void result.refresh()}
          disabled={result.loading || agenda.loading}
        />
      </View>
      <View style={{ display: action === 'join' ? 'flex' : 'none' }}>
        <MutationForm
          draftKey="courses:join"
          fields={[{ name: 'code', label: '老師提供的邀請碼', max: 24, min: 6 }]}
          label="確認加入"
          submit={async ({ code }, key, active) => {
            const course = await classes.join(code, key);
            if (active()) open(course.id);
          }}
        />
      </View>
      <View style={{ display: action === 'create' ? 'flex' : 'none' }}>
        <Copy>建立課程後，你可以發布教材與邀請學生。這不會取得校方教職員權限。</Copy>
        <MutationForm
          draftKey="courses:create"
          fields={[{ name: 'title', label: '課程名稱', max: 120, min: 2 }]}
          label="確認建立"
          submit={async ({ title }, key, active) => {
            const course = await classes.create(title, key);
            if (active()) open(course.id);
          }}
        />
      </View>
      {result.loading ? <Copy>正在讀取課程…</Copy> : null}
      {result.error ? <Copy alert>{result.error}</Copy> : null}
      {result.data && !result.error ? (
        <>
          <StudyAgenda
            data={agendaData}
            loading={agenda.loading}
            error={agenda.error}
            retry={() => void agenda.refresh()}
            open={open}
          />
          <Section>
            <Copy title>課程目錄</Copy>
            <TextInput
              accessibilityLabel="搜尋我的課程"
              placeholder="輸入課程名稱"
              placeholderTextColor={theme.colors.muted}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={{
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 12,
                color: theme.colors.text,
                backgroundColor: theme.colors.surface,
                fontSize: 16,
                minHeight: 48,
              }}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {filters.map(([value, label]) => (
                <Button
                  key={value}
                  label={`${label} ${courses.filter((course) => matchesCourseListFilter(course, value)).length}`}
                  selected={filter === value}
                  onPress={() => setFilter(value)}
                />
              ))}
            </View>
            {query.trim() || filter !== 'all' ? (
              <View style={{ gap: 8 }}>
                <Copy>找到 {matched.length} 門課程</Copy>
                <Button
                  label="顯示所有課程"
                  onPress={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                />
              </View>
            ) : null}
            {courses.length === 0 ? (
              <Copy>尚未加入修習課程。請向老師取得邀請碼。</Copy>
            ) : matched.length === 0 ? (
              <Copy>沒有符合的課程。試試其他名稱，或顯示所有課程。</Copy>
            ) : (
              (['student', 'teaching', 'archived'] as const).map((group) => {
                const rows = matched.filter((course) => matchesCourseListFilter(course, group));
                if (!rows.length) return null;
                return (
                  <View key={group} style={{ gap: 8, marginTop: 10 }}>
                    <Copy title>
                      {group === 'student'
                        ? '修習課程'
                        : group === 'teaching'
                          ? '授課與協作'
                          : '封存課程'}{' '}
                      · {rows.length}
                    </Copy>
                    {rows.map((course) => (
                      <Pressable
                        key={course.id}
                        accessibilityRole="button"
                        accessibilityLabel={course.title}
                        accessibilityHint={`開啟課程。${courseRoleLabels[course.memberRole]}${course.state === 'archived' ? '，已封存' : ''}`}
                        onPress={() => open(course.id)}
                        style={({ pressed }) => ({
                          borderBottomWidth: 1,
                          borderColor: theme.colors.border,
                          paddingVertical: 17,
                          paddingHorizontal: 2,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 12,
                          opacity: pressed ? 0.65 : 1,
                        })}
                      >
                        <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
                          <Text
                            style={{
                              color: theme.colors.text,
                              fontSize: 17,
                              fontWeight: '600',
                              lineHeight: 26,
                            }}
                          >
                            {course.title}
                          </Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>
                            {courseRoleLabels[course.memberRole]}
                            {course.state === 'archived' ? ' · 已封存' : ''}
                          </Text>
                        </View>
                        <Text
                          importantForAccessibility="no"
                          style={{ color: theme.colors.muted, fontSize: 22 }}
                        >
                          ›
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                );
              })
            )}
          </Section>
          <RecentTeacherFeedbackPanel
            loading={agenda.loading}
            error={agenda.error}
            data={feedback}
            limited={!!agendaData?.limitedCourseIds.length}
            onRetry={() => void agenda.refresh()}
            open={open}
          />
        </>
      ) : null}
    </>
  );
}

type CourseData = {
  course: NuniWorkspace;
  materials: NuniMaterial[];
  materialsCursor: string | null;
  assignments: NuniAssignment[];
  quizzes: NuniQuiz[];
};
function CourseDetail({
  attendanceStore,
  id,
  classes,
  classroom,
  onBack,
  initialAssignmentId,
  initialMaterialId,
  scrollRef,
  contentOffsetYRef,
}: {
  attendanceStore: ReturnType<typeof createAttendanceStore>;
  id: string;
  classes: Classes;
  classroom: ReturnType<typeof createNuniClassroom>;
  onBack(): void;
  initialAssignmentId?: string;
  initialMaterialId?: string;
  scrollRef: RefObject<ScrollView | null>;
  contentOffsetYRef: MutableRefObject<number>;
}) {
  const theme = useTheme();
  const pageGeneration = useRef(0);
  const pagePending = useRef(false);
  const pageFlight = useRef(0);
  const lookupGeneration = useRef(0);
  const pageProgress = useRef<MaterialPageProgress<NuniMaterial>>(emptyMaterialPageProgress());
  const [loadingMore, setLoadingMore] = useState(false);
  const [materialsError, setMaterialsError] = useState('');
  const [materialsDenied, setMaterialsDenied] = useState(false);
  const [classroomDenied, setClassroomDenied] = useState(false);
  const [cursorInvalid, setCursorInvalid] = useState(false);
  const [cursorCycled, setCursorCycled] = useState(false);
  const [materialQuery, setMaterialQuery] = useState('');
  const [targetSeekBudget, setTargetSeekBudget] = useState(0);
  const [targetSeekCancelled, setTargetSeekCancelled] = useState(false);
  const [targetSeekActive, setTargetSeekActive] = useState(false);
  const invalidateMaterialLookup = useCallback(() => {
    lookupGeneration.current += 1;
    pageFlight.current += 1;
    pagePending.current = false;
    setLoadingMore(false);
  }, []);
  const resetMaterialPaging = useCallback(() => {
    invalidateMaterialLookup();
    pageProgress.current = emptyMaterialPageProgress();
    setMaterialsError('');
    setMaterialsDenied(false);
    setCursorInvalid(false);
    setCursorCycled(false);
  }, [invalidateMaterialLookup]);
  useEffect(
    () => () => {
      pageGeneration.current += 1;
      lookupGeneration.current += 1;
      pageFlight.current += 1;
    },
    [classes, id],
  );
  const load = useCallback(async (): Promise<CourseData> => {
    // Reloads and confirmed publication restart at the newest page. An older
    // pending page must never append into this new authority snapshot.
    pageGeneration.current += 1;
    const run = pageGeneration.current;
    resetMaterialPaging();
    setClassroomDenied(false);
    if (initialMaterialId) {
      setTargetSeekCancelled(false);
      setTargetSeekBudget(MATERIAL_TARGET_AUTO_PAGE_BUDGET);
      setTargetSeekActive(true);
    } else {
      setTargetSeekActive(false);
      setTargetSeekBudget(0);
      setTargetSeekCancelled(false);
    }
    const course = await classes.get(id);
    const [page, assignments, quizzes] = await Promise.all([
      classes.materialsPage(id),
      classes.assignments(id),
      classes.quizzes(id),
    ]);
    const snapshot = appendMaterialPage<NuniMaterial>(
      emptyMaterialPageProgress<NuniMaterial>(),
      page,
      undefined,
    );
    // useLoad drops stale state, but must not let an older first page rewrite the shared pager ref.
    if (run === pageGeneration.current) pageProgress.current = snapshot;
    return {
      course,
      materials: snapshot.items,
      materialsCursor: snapshot.nextCursor,
      assignments,
      quizzes,
    };
  }, [classes, id, initialMaterialId, resetMaterialPaging]);
  const result = useLoad(load, true, true);
  const [tab, setTab] = useNuniDraftState<
    'assignments' | 'materials' | 'quizzes' | 'attendance' | 'members'
  >(`course:${id}:tab`, 'assignments');
  const [activityFilter, setActivityFilter] = useNuniDraftState<ActivityFilter>(
    `course:${id}:activity-filter`,
    'all',
  );
  const [assignmentQuery, setAssignmentQuery] = useNuniDraftState(
    `course:${id}:assignment-search`,
    '',
  );
  const [quizQuery, setQuizQuery] = useNuniDraftState(`course:${id}:quiz-search`, '');
  const activityQuery = tab === 'quizzes' ? quizQuery : assignmentQuery;
  const setActivityQuery = tab === 'quizzes' ? setQuizQuery : setAssignmentQuery;
  const data = result.data;
  const linkedAssignment =
    !!initialAssignmentId && !!data?.assignments.some((item) => item.id === initialAssignmentId);
  const linkedQuiz =
    !!initialAssignmentId && !!data?.quizzes.some((item) => item.id === initialAssignmentId);
  const missingLinkedWork =
    !!initialAssignmentId && !initialMaterialId && !!data && !linkedAssignment && !linkedQuiz;
  const linkedQuizTab =
    !!initialAssignmentId &&
    (linkedQuiz || (!linkedAssignment && /^cwq_/i.test(initialAssignmentId)));
  const linkedMaterial =
    !!initialMaterialId && !!data?.materials.some((item) => item.id === initialMaterialId);
  const missingLinkedMaterial =
    !!initialMaterialId &&
    !!data &&
    !result.loading &&
    !loadingMore &&
    !materialsDenied &&
    !cursorInvalid &&
    !cursorCycled &&
    !materialsError &&
    !data.materialsCursor &&
    !linkedMaterial &&
    !targetSeekActive;
  useEffect(() => {
    if (initialMaterialId) {
      invalidateMaterialLookup();
      setTab('materials');
      setMaterialQuery('');
      setTargetSeekCancelled(false);
      setTargetSeekBudget(MATERIAL_TARGET_AUTO_PAGE_BUDGET);
      setTargetSeekActive(true);
      return;
    }
    invalidateMaterialLookup();
    setTargetSeekActive(false);
    setTargetSeekBudget(0);
    setTargetSeekCancelled(false);
  }, [initialMaterialId, id, invalidateMaterialLookup, setTab]);
  useEffect(() => {
    if (initialMaterialId || !initialAssignmentId) return;
    setTab(linkedQuizTab ? 'quizzes' : 'assignments');
    setActivityFilter('all');
    if (linkedQuizTab) setQuizQuery('');
    else setAssignmentQuery('');
  }, [
    initialAssignmentId,
    initialMaterialId,
    linkedQuizTab,
    setActivityFilter,
    setAssignmentQuery,
    setQuizQuery,
    setTab,
  ]);
  const cancelMaterialLookup = () => {
    invalidateMaterialLookup();
    setTargetSeekCancelled(true);
    setTargetSeekActive(false);
    setTargetSeekBudget(0);
  };
  const resumeMaterialLookup = () => {
    invalidateMaterialLookup();
    setTargetSeekCancelled(false);
    setTargetSeekActive(true);
    setTargetSeekBudget(MATERIAL_TARGET_AUTO_PAGE_BUDGET);
  };
  const loadOlderMaterials = async () => {
    if (
      !data?.materialsCursor ||
      result.loading ||
      result.error ||
      cursorInvalid ||
      cursorCycled ||
      materialsDenied ||
      pagePending.current
    )
      return;
    const run = pageGeneration.current;
    const lookupRun = lookupGeneration.current;
    const flight = ++pageFlight.current;
    const requestedCursor = data.materialsCursor;
    pagePending.current = true;
    setLoadingMore(true);
    setMaterialsError('');
    try {
      const page = await classes.materialsPage(id, requestedCursor);
      if (run !== pageGeneration.current) return;
      if (lookupRun !== lookupGeneration.current) return;
      const merged = appendMaterialPage(pageProgress.current, page, requestedCursor);
      pageProgress.current = merged;
      if (merged.cycleDetected) {
        setCursorCycled(true);
        setMaterialsError(MATERIAL_CURSOR_CYCLE_MESSAGE);
        setTargetSeekActive(false);
        setTargetSeekBudget(0);
      }
      result.commit((current) => {
        if (!current || run !== pageGeneration.current) return current;
        if (lookupRun !== lookupGeneration.current) return current;
        return {
          ...current,
          materials: merged.items,
          materialsCursor: merged.nextCursor,
        };
      }, result.version);
      if (lookupRun === lookupGeneration.current && targetSeekActive && !merged.cycleDetected) {
        setTargetSeekBudget((remaining) => Math.max(0, remaining - 1));
      }
    } catch (failure) {
      if (run !== pageGeneration.current) return;
      if (lookupRun !== lookupGeneration.current) return;
      setMaterialsError(nuniErrorMessage(failure));
      if (failure instanceof NuniError && (failure.status === 403 || failure.status === 404)) {
        pageGeneration.current += 1;
        invalidateMaterialLookup();
        setMaterialsDenied(true);
        setTargetSeekActive(false);
        setTargetSeekBudget(0);
        pageProgress.current = emptyMaterialPageProgress();
        result.commit(() => null, result.version);
      } else if (
        failure instanceof NuniError &&
        failure.code === 'CLASS_WORKSPACE_MATERIAL_CURSOR_INVALID'
      ) {
        setCursorInvalid(true);
        setTargetSeekActive(false);
        setTargetSeekBudget(0);
      }
    } finally {
      if (flight === pageFlight.current && run === pageGeneration.current) {
        pagePending.current = false;
        setLoadingMore(false);
      }
    }
  };
  useEffect(() => {
    if (!initialMaterialId || !targetSeekActive || targetSeekCancelled) return;
    if (!data || result.loading || result.error || materialsDenied) return;
    if (cursorInvalid || cursorCycled || materialsError) return;
    if (linkedMaterial) {
      setTargetSeekActive(false);
      return;
    }
    if (!data.materialsCursor) {
      setTargetSeekActive(false);
      setTargetSeekBudget(0);
      return;
    }
    if (targetSeekBudget <= 0 || loadingMore || pagePending.current) return;
    void loadOlderMaterials();
    // loadOlderMaterials closes over the current cursor; re-run after each committed page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cursorCycled,
    cursorInvalid,
    data,
    initialMaterialId,
    linkedMaterial,
    loadingMore,
    materialsDenied,
    materialsError,
    result.error,
    result.loading,
    targetSeekActive,
    targetSeekBudget,
    targetSeekCancelled,
  ]);
  const saveActivity = (item: Activity) => {
    result.commit(
      (current) =>
        current
          ? 'instructions' in item
            ? {
                ...current,
                assignments: current.assignments.map((entry) =>
                  entry.id === item.id ? item : entry,
                ),
              }
            : {
                ...current,
                quizzes: current.quizzes.map((entry) => (entry.id === item.id ? item : entry)),
              }
          : current,
      result.version,
    );
    // The confirmed receipt must stay visible when the item leaves the pending list.
    setActivityFilter((filter) => (filter === 'pending' ? 'submitted' : filter));
  };
  const teacher = data && data.course.memberRole !== 'student';
  useEffect(() => {
    if (data?.course.memberRole === 'student' && tab === 'members') setTab('assignments');
  }, [data?.course.memberRole, setTab, tab]);
  const currentActivities = data ? (tab === 'quizzes' ? data.quizzes : data.assignments) : [];
  const matchingActivities = data
    ? currentActivities.filter(
        (item) =>
          (teacher || matchesActivityFilter(item, data.course, activityFilter)) &&
          matchesActivitySearch(item, activityQuery),
      )
    : [];
  return (
    <>
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}
      >
        <Button label="返回我的課程" onPress={onBack} />
        <Button label="更新內容" onPress={() => void result.refresh()} disabled={result.loading} />
      </View>
      {result.loading ? <Copy>正在讀取課程內容…</Copy> : null}
      {result.error ? <Copy alert>{result.error}</Copy> : null}
      {materialsDenied ? <Copy alert>{materialsError}</Copy> : null}
      {classroomDenied ? <Copy alert>目前無法存取這門課程，請更新內容後確認權限。</Copy> : null}
      {data && !classroomDenied ? (
        <View style={{ gap: 16, display: result.loading || result.error ? 'none' : 'flex' }}>
          <Copy title>{data.course.title}</Copy>
          <Copy>
            {courseRoleLabels[data.course.memberRole]}
            {data.course.state === 'archived' ? ' · 課程已封存' : ''}
          </Copy>
          {data.assignments.length >= 100 || data.quizzes.length >= 100 ? (
            <Copy>
              作業或測驗已達本次載入上限，較早內容可能尚未完整顯示；數量只計算目前已載入的項目。
            </Copy>
          ) : null}
          <Copy>
            {teacher
              ? '教學操作僅限這門課；不代表校方教職員身分。'
              : `待繳作業 ${data.assignments.filter((item) => isPendingActivity(item, data.course)).length} · 待答測驗 ${data.quizzes.filter((item) => isPendingActivity(item, data.course)).length}`}
          </Copy>
          {missingLinkedWork ? (
            <Copy alert>
              {linkedQuizTab
                ? '找不到這份測驗。可能已被老師刪除，或你沒有查看權限。請從測驗列表選擇其他測驗。'
                : '找不到這份作業。可能已被老師刪除，或你沒有查看權限。請從作業列表選擇其他作業。'}
            </Copy>
          ) : null}
          {missingLinkedMaterial ? (
            <Copy alert>
              找不到這份教材。可能已被老師刪除，或你沒有查看權限。請從教材列表選擇其他教材。
            </Copy>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button
              label={`作業 ${data.assignments.length}`}
              onPress={() => setTab('assignments')}
              selected={tab === 'assignments'}
            />
            <Button
              label={`教材 ${data.materials.length}${data.materialsCursor || cursorCycled ? '+' : ''}`}
              onPress={() => setTab('materials')}
              selected={tab === 'materials'}
            />
            <Button
              label={`測驗 ${data.quizzes.length}`}
              onPress={() => setTab('quizzes')}
              selected={tab === 'quizzes'}
            />
            <Button
              label="點名"
              onPress={() => setTab('attendance')}
              selected={tab === 'attendance'}
            />
            {teacher ? (
              <Button label="名冊" onPress={() => setTab('members')} selected={tab === 'members'} />
            ) : null}
          </View>
          {(tab === 'attendance' || (tab === 'members' && teacher)) &&
          !result.loading &&
          !result.error ? (
            <NuniAttendance
              attendanceStore={attendanceStore}
              classroom={classroom}
              course={data.course}
              mode={tab === 'members' ? 'members' : 'attendance'}
              onAccessDenied={() => {
                pageGeneration.current += 1;
                invalidateMaterialLookup();
                setClassroomDenied(true);
              }}
            />
          ) : null}
          {tab === 'assignments' || tab === 'quizzes' ? (
            <View style={{ gap: 8 }}>
              <TextInput
                accessibilityLabel={tab === 'assignments' ? '搜尋這門課的作業' : '搜尋這門課的測驗'}
                placeholder="搜尋標題、單元或說明"
                placeholderTextColor={theme.colors.muted}
                value={activityQuery}
                onChangeText={setActivityQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                style={{
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  color: theme.colors.text,
                  backgroundColor: theme.colors.surface,
                  fontSize: 16,
                  minHeight: 48,
                }}
              />
              {activityQuery.trim() ? (
                <Button label="清除作業與測驗搜尋" onPress={() => setActivityQuery('')} />
              ) : null}
            </View>
          ) : null}
          {!teacher && (tab === 'assignments' || tab === 'quizzes') ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(['all', 'pending', 'submitted'] as const).map((filter) => {
                const items = tab === 'assignments' ? data.assignments : data.quizzes;
                const count = items.filter((item) =>
                  matchesActivityFilter(item, data.course, filter),
                ).length;
                return (
                  <Button
                    key={filter}
                    label={`${filter === 'all' ? '全部' : filter === 'pending' ? '待完成' : '已繳交'} ${count}`}
                    selected={activityFilter === filter}
                    onPress={() => setActivityFilter(filter)}
                  />
                );
              })}
            </View>
          ) : null}
          {(tab === 'assignments' || tab === 'quizzes') && activityQuery.trim() ? (
            <Copy>
              {matchingActivities.length
                ? `搜尋符合 ${matchingActivities.length} 項。`
                : '沒有符合的作業或測驗。請更換關鍵字，或清除搜尋。'}
              {initialAssignmentId ? ' 從連結開啟的項目仍保留在下方。' : ''}
            </Copy>
          ) : null}
          <View style={{ display: tab === 'assignments' ? 'flex' : 'none', gap: 16 }}>
            {data.assignments.length === 0 ? (
              <Copy>老師尚未發布作業。</Copy>
            ) : (
              prioritizeActivities(data.assignments, data.course).map((item, index) => (
                <ActivityCard
                  key={`${data.course.memberRole}:${data.course.state}:${item.id}`}
                  item={item}
                  course={data.course}
                  classes={classes}
                  saved={saveActivity}
                  hidden={
                    ((!teacher && !matchesActivityFilter(item, data.course, activityFilter)) ||
                      !matchesActivitySearch(item, assignmentQuery)) &&
                    item.id !== initialAssignmentId
                  }
                  compact={data.assignments.length > 8 && index > 0}
                  focused={item.id === initialAssignmentId}
                  scrollRef={scrollRef}
                  contentOffsetYRef={contentOffsetYRef}
                />
              ))
            )}
            {!teacher &&
            data.assignments.length > 0 &&
            !data.assignments.some((item) =>
              matchesActivityFilter(item, data.course, activityFilter),
            ) ? (
              <Copy>
                {activityFilter === 'pending'
                  ? '目前沒有待繳作業。可切換「全部」查看其他作業。'
                  : '尚無已繳交的作業紀錄。'}
              </Copy>
            ) : null}
          </View>
          <View style={{ display: tab === 'materials' ? 'flex' : 'none', gap: 16 }}>
            {data.materials.length > 0 ? (
              <>
                <TextInput
                  accessibilityLabel="在這門課找已載入教材"
                  value={materialQuery}
                  onChangeText={setMaterialQuery}
                  placeholder="標題、單元或內容關鍵字"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    borderRadius: 10,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 15,
                    color: theme.colors.text,
                    backgroundColor: theme.colors.surface,
                  }}
                />
                {materialQuery.trim() ? (
                  <Button label="清除搜尋" onPress={() => setMaterialQuery('')} />
                ) : null}
              </>
            ) : null}
            {(() => {
              const matched = filterLoadedMaterials(data.materials, materialQuery);
              const visible = visibleLoadedMaterials(
                data.materials,
                materialQuery,
                initialMaterialId,
              );
              const status = materialSearchStatusCopy({
                query: materialQuery,
                loadedCount: data.materials.length,
                matchCount: matched.length,
                hasOlder: !!data.materialsCursor,
                interrupted: cursorCycled,
              });
              const seekingTarget =
                !!initialMaterialId &&
                targetSeekActive &&
                !targetSeekCancelled &&
                !linkedMaterial &&
                targetSeekBudget > 0;
              const targetLookupPaused =
                !!initialMaterialId &&
                !linkedMaterial &&
                !missingLinkedMaterial &&
                !!data.materialsCursor &&
                !cursorInvalid &&
                !cursorCycled &&
                !seekingTarget &&
                (targetSeekCancelled || targetSeekBudget <= 0);
              return (
                <>
                  {status ? <Copy>{status}</Copy> : null}
                  {seekingTarget ? (
                    <>
                      <Copy>正在載入較早教材以尋找目標…</Copy>
                      <Button label="取消尋找" onPress={cancelMaterialLookup} />
                    </>
                  ) : null}
                  {targetLookupPaused ? (
                    <>
                      <Copy>
                        {targetSeekCancelled
                          ? '已取消尋找目標教材。已載入內容仍保留，可繼續尋找。'
                          : '尚未找到這份教材，已暫停自動載入。可繼續尋找或載入較早教材。'}
                      </Copy>
                      <Button label="繼續尋找" onPress={resumeMaterialLookup} />
                    </>
                  ) : null}
                  {data.materials.length === 0 ? (
                    <Copy>老師尚未發布教材。</Copy>
                  ) : visible.length === 0 ? null : (
                    visible.map((material) => (
                      <MaterialCard
                        key={material.id}
                        material={material}
                        focused={material.id === initialMaterialId && !targetSeekCancelled}
                        lookupGeneration={lookupGeneration}
                        scrollRef={scrollRef}
                        contentOffsetYRef={contentOffsetYRef}
                      />
                    ))
                  )}
                </>
              );
            })()}
            {materialsError ? <Copy alert>{materialsError}</Copy> : null}
            {cursorInvalid || cursorCycled ? (
              <Button label="更新教材" onPress={() => void result.refresh()} />
            ) : data.materialsCursor ? (
              <Button
                label={
                  loadingMore
                    ? '正在載入教材…'
                    : materialsError
                      ? '重試載入較早教材'
                      : '載入較早教材'
                }
                onPress={() => void loadOlderMaterials()}
                disabled={loadingMore}
              />
            ) : null}
          </View>
          <View style={{ display: tab === 'quizzes' ? 'flex' : 'none', gap: 16 }}>
            {data.quizzes.length === 0 ? (
              <Copy>老師尚未發布測驗。</Copy>
            ) : (
              prioritizeActivities(data.quizzes, data.course).map((item, index) => (
                <ActivityCard
                  key={`${data.course.memberRole}:${data.course.state}:${item.id}`}
                  item={item}
                  course={data.course}
                  classes={classes}
                  saved={saveActivity}
                  hidden={
                    ((!teacher && !matchesActivityFilter(item, data.course, activityFilter)) ||
                      !matchesActivitySearch(item, quizQuery)) &&
                    item.id !== initialAssignmentId
                  }
                  compact={data.quizzes.length > 8 && index > 0}
                  focused={item.id === initialAssignmentId}
                  scrollRef={scrollRef}
                  contentOffsetYRef={contentOffsetYRef}
                />
              ))
            )}
            {!teacher &&
            data.quizzes.length > 0 &&
            !data.quizzes.some((item) =>
              matchesActivityFilter(item, data.course, activityFilter),
            ) ? (
              <Copy>
                {activityFilter === 'pending'
                  ? '目前沒有待答測驗。可切換「全部」查看其他測驗。'
                  : '尚無已繳交的測驗紀錄。'}
              </Copy>
            ) : null}
          </View>
          {teacher &&
          data.course.state === 'active' &&
          (tab === 'assignments' || tab === 'materials' || tab === 'quizzes') ? (
            <CoursePublishing
              key={`${data.course.memberRole}:${data.course.state}`}
              tab={tab}
              classes={classes}
              course={data.course}
              created={(item) => {
                if (!('instructions' in item) && !('prompt' in item)) {
                  result.reloadAfterMutation();
                  return;
                }
                result.commit((current) => {
                  if (!current) return current;
                  if ('instructions' in item)
                    return {
                      ...current,
                      assignments: [
                        ...current.assignments.filter((entry) => entry.id !== item.id),
                        item,
                      ],
                    };
                  if ('prompt' in item)
                    return {
                      ...current,
                      quizzes: [...current.quizzes.filter((entry) => entry.id !== item.id), item],
                    };
                  return current;
                }, result.version);
              }}
            />
          ) : null}
          {data.course.memberRole === 'owner-teacher' && data.course.state === 'active' ? (
            <Section>
              <Copy title>邀請修課學生</Copy>
              <Copy>邀請碼只會加入修課身分，不會取得共同授課或校方權限。</Copy>
              <MutationForm
                draftKey={`course:${id}:owner-teacher:active:invite`}
                fields={[]}
                label="產生學生邀請碼"
                submit={async (_values, key) => {
                  const invite = await classes.invite(id, key);
                  return `學生邀請碼：${invite.code}`;
                }}
              />
            </Section>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

function MaterialCard({
  material,
  focused = false,
  lookupGeneration,
  scrollRef,
  contentOffsetYRef,
}: {
  material: NuniMaterial;
  focused?: boolean;
  lookupGeneration?: MutableRefObject<number>;
  scrollRef?: RefObject<ScrollView | null>;
  contentOffsetYRef?: MutableRefObject<number>;
}) {
  const cardRef = useRef<View>(null);
  const revealed = useRef(false);
  const revealIntent = useRef(lookupGeneration?.current ?? 0);
  if (focused) revealIntent.current = lookupGeneration?.current ?? revealIntent.current;
  const revealTarget = () => {
    if (!focused || revealed.current) return;
    const scroll = scrollRef?.current;
    const target = cardRef.current;
    if (!scroll || !target) return;
    const intent = revealIntent.current;
    revealed.current = true;
    revealAssignmentSubmitArea(scroll, target, {
      contentOffsetY: contentOffsetYRef?.current ?? 0,
      isActive: () =>
        focused &&
        scrollRef?.current === scroll &&
        cardRef.current === target &&
        (lookupGeneration?.current ?? intent) === intent,
    });
  };
  return (
    <Section>
      <View
        ref={cardRef}
        testID={`material-${material.id}`}
        onLayout={revealTarget}
        style={{ gap: 12 }}
      >
        {focused ? (
          <Text accessibilityLabel={`目標教材：${material.title}`}>目標教材</Text>
        ) : null}
        <Copy title>{material.title}</Copy>
        {material.unitTitle ? <Copy>{material.unitTitle}</Copy> : null}
        <Copy>{material.body}</Copy>
      </View>
    </Section>
  );
}

function ActivityCard({
  item,
  course,
  classes,
  saved,
  hidden = false,
  focused = false,
  compact = false,
  scrollRef,
  contentOffsetYRef,
}: {
  item: Activity;
  course: NuniWorkspace;
  classes: Classes;
  saved(item: Activity): void;
  hidden?: boolean;
  focused?: boolean;
  compact?: boolean;
  scrollRef?: RefObject<ScrollView | null>;
  contentOffsetYRef?: MutableRefObject<number>;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(() => !compact || focused);
  useEffect(() => {
    if (focused) setExpanded(true);
  }, [focused]);
  const assignment = 'instructions' in item;
  const receipt = assignment ? item.mySubmission : item.myResponse;
  const prompt = assignment ? item.instructions : item.prompt;
  const student = course.memberRole === 'student';
  const active = course.state === 'active';
  const canRevise = !assignment || assignmentCanRevise(item.dueAt);
  const canSubmit = student && active && item.state === 'open' && (!assignment || !receipt || canRevise);
  const kind = assignment ? '作業' : '測驗';
  const fileSubmit = assignment && assignmentFileSubmitEnabledNative();
  const [withdrawNotice, setWithdrawNotice] = useState('');
  const [localFiles, setLocalFiles] = useState<LocalNativeFile[]>([]);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [progress, setProgress] = useState<NativeUploadProgress | null>(null);
  const lateOpen = assignment
    ? assignmentLateOpenLabel(item.dueAt, item.state, course.state)
    : null;
  const submitRef = useRef<View>(null);
  const revealed = useRef(false);
  const revealSubmit = () => {
    if (!focused || revealed.current) return;
    const scroll = scrollRef?.current;
    const target = submitRef.current;
    if (!scroll || !target) return;
    revealed.current = true;
    revealAssignmentSubmitArea(scroll, target, {
      contentOffsetY: contentOffsetYRef?.current ?? 0,
      isActive: () => focused && scrollRef?.current === scroll && submitRef.current === target,
    });
  };
  const landKind = assignment ? 'assignment' : 'quiz';
  const landLabel = assignment ? '作業繳交區' : '測驗作答區';
  const submitArea = (
    <>
      {focused ? <Text accessibilityLabel={`${landLabel}：${item.title}`}>{landLabel}</Text> : null}
      {canSubmit && fileSubmit ? (
        <View style={{ gap: 8 }}>
          <Button
            label="拍照"
            onPress={() => void pickAssignmentCamera(localFiles).then(setLocalFiles)}
          />
          <Button
            label="相簿"
            onPress={() => void pickAssignmentAlbum(localFiles).then(setLocalFiles)}
          />
          <Button
            label="檔案"
            onPress={() => void pickAssignmentDocuments(localFiles).then(setLocalFiles)}
          />
          {receipt && 'files' in receipt && receipt.files?.length ? (
            <Copy>重新送出會取代這次繳交；沒有選檔就改交純文字。</Copy>
          ) : null}
          <Copy>網路不穩時再送一次，不會重複交。選好的照片可以刪除或調整順序後再送出。</Copy>
          {progress ? (
            <Copy>
              上傳中 {progress.completed}/{progress.total}，請保持網路連線。
            </Copy>
          ) : null}
          {localFiles.map((file, index) => (
            <View
              key={file.key}
              style={{ flexDirection: 'row', gap: 10, alignItems: 'center', minWidth: 0 }}
            >
              {file.kind === 'image' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`放大預覽 ${file.name}`}
                  onPress={() => setPreviewUri(file.uri)}
                >
                  <Image
                    source={{ uri: file.uri }}
                    accessibilityLabel={file.name}
                    style={{ width: 56, height: 56, borderRadius: 8 }}
                  />
                </Pressable>
              ) : null}
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Copy>{localFileSizeLabel(file)}</Copy>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Button
                    label="上移"
                    onPress={() => setLocalFiles(moveNativeFile(localFiles, index, -1))}
                  />
                  <Button
                    label="下移"
                    onPress={() => setLocalFiles(moveNativeFile(localFiles, index, 1))}
                  />
                  <Button
                    label="刪除"
                    onPress={() => setLocalFiles(removeNativeFile(localFiles, file.key))}
                  />
                </View>
              </View>
            </View>
          ))}
          {previewUri ? (
            <View>
              <Button label="關閉預覽" onPress={() => setPreviewUri(null)} />
              <Image
                source={{ uri: previewUri }}
                accessibilityLabel="放大預覽"
                style={{ width: '100%', height: 280, borderRadius: 8 }}
                resizeMode="contain"
              />
            </View>
          ) : null}
        </View>
      ) : null}
      {withdrawNotice ? <Copy>{withdrawNotice}</Copy> : null}
      {assignment && fileSubmit && receipt && student && active && item.state === 'open' && canRevise ? (
        <MutationForm draftKey={`withdraw:${course.id}:${item.id}:${receipt.submittedAt}`} label="撤回繳交" fields={[]} submit={async (_values, key, stillActive) => {
          const result = await classes.withdrawAssignment(course.id, item.id, receipt.submittedAt, key);
          if (stillActive()) { saved(result); setWithdrawNotice('已撤回，截止前可以重新繳交。'); }
          return '已撤回，截止前可以重新繳交。';
        }} />
      ) : null}
      {assignment && receipt && !canRevise ? <Copy>已過截止時間，這份繳交不能再修改或撤回。</Copy> : null}
      {canSubmit ? (
        <MutationForm
          draftKey={`course:${course.id}:${course.memberRole}:${course.state}:${assignment ? 'assignment' : 'quiz'}:${item.id}:${item.state}`}
          savedContent={{
            values: { body: receipt ? ('body' in receipt ? receipt.body : receipt.answer) : '' },
            revision: JSON.stringify(
              receipt
                ? ['body' in receipt ? receipt.body : receipt.answer, receipt.submittedAt]
                : null,
            ),
          }}
          fields={[
            {
              name: 'body',
              label: `${kind}內容：${item.title}`,
              max: assignment ? 8000 : QUIZ_ANSWER_LIMIT,
              min: fileSubmit ? 0 : 1,
              multiline: true,
              hint: assignment
                ? fileSubmit
                  ? '可寫說明，或直接拍照／選檔後送出。網路不穩時再送一次，不會重複交。'
                  : undefined
                : `最多 ${QUIZ_ANSWER_LIMIT} 字。老師停止收件前仍可修改。`,
            },
          ]}
          label={receipt ? `更新${kind}繳交` : `繳交${kind}`}
          submit={async ({ body }, key, stillActive) => {
            if (assignment && fileSubmit && localFiles.length) {
              try {
                const confirmed = await submitNativeAssignmentFiles(
                  classes,
                  course.id,
                  item.id,
                  body,
                  localFiles,
                  key,
                  setProgress,
                );
                if (stillActive()) {
                  setLocalFiles([]);
                  setPreviewUri(null);
                  saved(confirmed);
                  setWithdrawNotice('');
                }
                return '已收到伺服器繳交紀錄。';
              } finally {
                if (stillActive()) setProgress(null);
              }
            }
            const confirmed = assignment
              ? fileSubmit
                ? await classes.submitFiles(course.id, item.id, { body, fileIds: [], idempotencyKey: key })
                : await classes.submit(course.id, item.id, body, key)
              : await classes.submitQuiz(course.id, item.id, body, key);
            if (stillActive()) { saved(confirmed); setWithdrawNotice(''); }
            return '已收到伺服器繳交紀錄。';
          }}
        />
      ) : null}
    </>
  );
  return (
    <View
      nativeID={`${landKind}-${item.id}`}
      testID={`${landKind}-${item.id}`}
      style={{ display: hidden ? 'none' : 'flex' }}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    >
      <Section>
        <View style={{ gap: 8 }}>
          {item.unitTitle ? (
            <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>
              {item.unitTitle}
            </Text>
          ) : null}
          <Copy title>{item.title}</Copy>
          <Text
            style={{
              color: receipt ? theme.colors.success : theme.colors.muted,
              fontSize: 14,
              lineHeight: 22,
            }}
          >
            {receipt
              ? receiptFeedbackIsStale(receipt)
                ? '已繳交 · 有較早版本的回饋'
                : receipt.teacherFeedback
                  ? '已繳交 · 老師已回饋'
                  : assignment
                    ? '已繳交 · 等待回饋'
                    : '已作答 · 等待回饋'
              : !student
                ? `${assignment ? item.submissionCount : item.responseCount} 份繳交`
                : !active
                  ? '課程已封存'
                  : item.state === 'closed'
                    ? '未繳交 · 已停止收件'
                    : assignment
                      ? '待繳交'
                      : '待作答'}
          </Text>
        </View>
        <Copy>
          {item.dueAt ? `參考期限：${time(item.dueAt)}` : '未設定參考期限'} ·{' '}
          {item.state === 'open' ? '開放繳交' : '已停止收件'}
        </Copy>
        <Button
          label={`${expanded ? '收合' : '展開'}${kind}：${item.title}`}
          expanded={expanded}
          onPress={() => setExpanded((value) => !value)}
        />
        <View
          style={{ display: expanded ? 'flex' : 'none', gap: 12 }}
          accessibilityElementsHidden={!expanded}
          importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
        >
          <Copy>{prompt}</Copy>
          {item.dueAt && item.state === 'open' && active ? (
            <Copy>目前仍開放繳交，收件狀態以老師是否停止收件為準。</Copy>
          ) : null}
          {fileSubmit && lateOpen ? <Copy alert>{lateOpen}</Copy> : null}
          {receipt ? (
            <View style={{ gap: 8 }}>
              <Copy title>
                {assignment
                  ? assignmentReceiptStatusLabel(
                      'late' in receipt
                        ? receipt.late === true ||
                            assignmentSubmissionLate(item.dueAt, receipt.submittedAt)
                        : false,
                    )
                  : '已作答'}
              </Copy>
              <Copy>{time(receipt.submittedAt)}</Copy>
              {assignment && 'files' in receipt && receipt.files?.length
                ? receipt.files.map((file) => (
                    <View
                      key={file.id}
                      style={{ flexDirection: 'row', gap: 10, alignItems: 'center', minWidth: 0 }}
                    >
                      {file.kind === 'image' ? (
                        <Image
                          source={{ uri: assignmentFileDownloadUrl(file) }}
                          accessibilityLabel={file.originalName}
                          style={{ width: 56, height: 56, borderRadius: 8 }}
                        />
                      ) : null}
                      <Copy>
                        {file.originalName} · {file.kind === 'image' ? '照片' : '檔案'}
                      </Copy>
                    </View>
                  ))
                : null}
              <Copy>{'body' in receipt ? receipt.body : receipt.answer}</Copy>
              <Copy>
                {receipt.teacherFeedback
                  ? `老師回饋：${receipt.teacherFeedback}`
                  : '老師尚未留下回饋。'}
              </Copy>
              {receipt.reviewedAt ? <Copy>回饋時間：{time(receipt.reviewedAt)}</Copy> : null}
              {receiptFeedbackIsStale(receipt) ? (
                <Copy>這則回饋早於最近一次繳交，可請老師確認是否仍適用。</Copy>
              ) : null}
            </View>
          ) : null}
          {focused ? (
            <View
              ref={submitRef}
              testID={`${landKind}-submit-${item.id}`}
              nativeID={`${landKind}-submit-${item.id}`}
              onLayout={revealSubmit}
            >
              {submitArea}
            </View>
          ) : (
            submitArea
          )}
          {!active ? <Copy>這門課已封存，現在只能查看保留的紀錄。</Copy> : null}
          {!student ? (
            <TeacherReceipts
              key={`${item.id}:${course.memberRole}:${course.state}`}
              classes={classes}
              course={course}
              item={item}
              scrollRef={scrollRef}
              contentOffsetYRef={contentOffsetYRef}
            />
          ) : null}
        </View>
      </Section>
    </View>
  );
}

function TeacherReceipts({
  classes,
  course,
  item,
  scrollRef,
  contentOffsetYRef,
}: {
  classes: Classes;
  course: NuniWorkspace;
  item: Activity;
  scrollRef?: RefObject<ScrollView | null>;
  contentOffsetYRef?: MutableRefObject<number>;
}) {
  const assignment = 'instructions' in item;
  const [feedbackFilter, setFeedbackFilter] = useState<FeedbackQueueFilter>('needs_feedback');
  const [focusReceiptId, setFocusReceiptId] = useState<string | null>(null);
  const [queueNotice, setQueueNotice] = useState('');
  const seededFilter = useRef(false);
  const receiptsRef = useRef<Receipt[] | null>(null);
  const rowRefs = useRef(new Map<string, View | null>());
  const pendingRevealId = useRef<string | null>(null);
  const revealGeneration = useRef(0);
  const mountedRef = useRef(true);
  const load = useCallback(
    async (): Promise<Receipt[]> =>
      assignment
        ? classes.submissions(course.id, item.id)
        : classes.quizResponses(course.id, item.id),
    [assignment, classes, course.id, item.id],
  );
  const resource = useLoad(load, false);
  const { data: receipts, loading: busy, error } = resource;
  useEffect(() => {
    receiptsRef.current = receipts;
  }, [receipts]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingRevealId.current = null;
      revealGeneration.current += 1;
    };
  }, []);
  useEffect(() => {
    pendingRevealId.current = null;
    revealGeneration.current += 1;
  }, [course.id, item.id, classes]);
  useEffect(() => {
    if (!receipts || seededFilter.current) return;
    seededFilter.current = true;
    setFeedbackFilter(
      receipts.some((entry) => needsFeedbackReview(entry)) ? 'needs_feedback' : 'all',
    );
  }, [receipts]);
  const ordered = useMemo(
    () => (receipts ? sortFeedbackQueue(receipts) : []),
    [receipts],
  );
  const visibleCount = ordered.filter((entry) =>
    matchesFeedbackQueueFilter(entry, feedbackFilter),
  ).length;
  const filterOptions: FeedbackQueueFilter[] = ['all', 'needs_feedback', 'reviewed'];
  const tryReveal = useCallback(
    (accountId: string) => {
      if (!mountedRef.current || pendingRevealId.current !== accountId) return false;
      const scroll = scrollRef?.current;
      const target = rowRefs.current.get(accountId) ?? null;
      if (!scroll || !target) return false;
      const generation = revealGeneration.current;
      const scrollNode = scroll;
      const targetNode = target;
      // Generation + node identity cancel in-flight measures; do not clear pending
      // until scheduling succeeds so a late layout can retry if refs were missing.
      revealAssignmentSubmitArea(scrollNode, targetNode, {
        contentOffsetY: contentOffsetYRef?.current ?? 0,
        isActive: () =>
          mountedRef.current &&
          revealGeneration.current === generation &&
          scrollRef?.current === scrollNode &&
          rowRefs.current.get(accountId) === targetNode,
      });
      return true;
    },
    [contentOffsetYRef, scrollRef],
  );
  /** Queue reveal after React commits filter/focus; never measure the pre-save layout. */
  const requestReveal = (accountId: string) => {
    revealGeneration.current += 1;
    pendingRevealId.current = accountId;
  };
  useLayoutEffect(() => {
    const accountId = pendingRevealId.current;
    if (!accountId || accountId !== focusReceiptId) return;
    const generation = revealGeneration.current;
    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        if (revealGeneration.current !== generation) return;
        if (pendingRevealId.current !== accountId) return;
        if (tryReveal(accountId)) pendingRevealId.current = null;
      });
    });
    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
    };
  }, [focusReceiptId, feedbackFilter, ordered, tryReveal]);
  const advanceAfterSave = (saved: Receipt, latest: Receipt[]) => {
    const next = nextAwaitingFeedbackReview(latest, saved.platformAccountId);
    if (!next) {
      pendingRevealId.current = null;
      revealGeneration.current += 1;
      setFocusReceiptId(null);
      setFeedbackFilter((current) =>
        matchesFeedbackQueueFilter(saved, current) ? current : 'all',
      );
      setQueueNotice('回饋已儲存。目前沒有下一份尚未回饋的繳交。');
      return;
    }
    setFeedbackFilter('needs_feedback');
    setFocusReceiptId(next.platformAccountId);
    setQueueNotice(`回饋已儲存。已移到 ${next.displayName} 的繳交。`);
    requestReveal(next.platformAccountId);
  };
  return (
    <View style={{ gap: 12 }}>
      <Copy>{assignment ? item.submissionCount : item.responseCount} 份繳交</Copy>
      <Button
        label={`查看收件：${item.title}`}
        disabled={busy}
        onPress={() => void resource.refresh()}
      />
      {error ? <Copy alert>{error}</Copy> : null}
      {!busy && !error && receipts?.length === 0 ? <Copy>還沒有收到繳交內容。</Copy> : null}
      <View style={{ display: busy || error || !receipts?.length ? 'none' : 'flex', gap: 14 }}>
        <Copy>預設先看尚未回饋的繳交。儲存後，學生才看得到。</Copy>
        {queueNotice ? <Copy>{queueNotice}</Copy> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {filterOptions.map((value) => {
            const count = receipts?.filter((entry) => matchesFeedbackQueueFilter(entry, value)).length ?? 0;
            return (
              <Button
                key={value}
                label={`${feedbackQueueLabel(value)} ${count}`}
                selected={feedbackFilter === value}
                onPress={() => setFeedbackFilter(value)}
              />
            );
          })}
        </View>
        {visibleCount === 0 ? (
          <Copy>
            「{feedbackQueueLabel(feedbackFilter)}」目前沒有繳交。可改選「全部」查看其他狀態。
          </Copy>
        ) : null}
        {ordered.map((receipt) => {
          const position = awaitingFeedbackPosition(ordered, receipt.platformAccountId);
          const focused = focusReceiptId === receipt.platformAccountId;
          const visible = matchesFeedbackQueueFilter(receipt, feedbackFilter);
          return (
          <View
            key={receipt.platformAccountId}
            ref={(node) => {
              if (node) rowRefs.current.set(receipt.platformAccountId, node);
              else rowRefs.current.delete(receipt.platformAccountId);
            }}
            onLayout={() => {
              if (pendingRevealId.current !== receipt.platformAccountId) return;
              if (tryReveal(receipt.platformAccountId)) pendingRevealId.current = null;
            }}
            testID={`teacher-receipt-${item.id}-${receipt.platformAccountId}`}
            style={{
              display: visible ? 'flex' : 'none',
              gap: 14,
            }}
            // Keep mounted so scoped draftKey editors survive filter switches.
            accessibilityElementsHidden={!visible}
            importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
          >
          <Section>
            <Copy title>{receipt.displayName}</Copy>
            {position ? (
              <Copy>
                待回饋第 {position.index}／{position.total} 份
                {focused ? ' · 目前批改這一份' : ''}
              </Copy>
            ) : focused ? (
              <Copy>目前批改這一份</Copy>
            ) : null}
            <Copy>
              {assignment
                ? assignmentReceiptStatusLabel(
                    'late' in receipt
                      ? receipt.late === true ||
                        assignmentSubmissionLate(item.dueAt, receipt.submittedAt)
                      : false,
                  )
                : '已作答'}
            </Copy>
            <Copy>{time(receipt.submittedAt)}</Copy>
            <Copy>{'body' in receipt ? receipt.body : receipt.answer}</Copy>
            {'files' in receipt && receipt.files?.length
              ? receipt.files.map((file) => (
                  <View
                    key={file.id}
                    style={{ flexDirection: 'row', gap: 10, alignItems: 'center', minWidth: 0 }}
                  >
                    {file.kind === 'image' ? (
                      <Image
                        source={{ uri: assignmentFileDownloadUrl(file) }}
                        accessibilityLabel={file.originalName}
                        style={{ width: 56, height: 56, borderRadius: 8 }}
                      />
                    ) : null}
                    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                      <Copy>{file.originalName}</Copy>
                      <Button
                        label="查看"
                        onPress={() => void Linking.openURL(assignmentFileDownloadUrl(file))}
                      />
                      <Button
                        label="下載"
                        onPress={() => void Linking.openURL(assignmentFileDownloadUrl(file, true))}
                      />
                    </View>
                  </View>
                ))
              : null}
            {receipt.teacherFeedback ? (
              <Copy>已回饋：{receipt.teacherFeedback}</Copy>
            ) : (
              <Copy>尚未回饋</Copy>
            )}
            {receipt.reviewedAt ? <Copy>回饋時間：{time(receipt.reviewedAt)}</Copy> : null}
            {receiptFeedbackIsStale(receipt) ? (
              <Copy>學生在這則回饋之後更新了繳交內容，請確認回饋是否仍適用。</Copy>
            ) : null}
            {course.state === 'active' ? (
              <MutationForm
                draftKey={`course:${course.id}:${course.memberRole}:${course.state}:${assignment ? 'assignment' : 'quiz'}:${item.id}:feedback:${receipt.platformAccountId}`}
                savedContent={{
                  values: { feedback: receipt.teacherFeedback ?? '' },
                  revision: JSON.stringify([
                    'body' in receipt ? receipt.body : receipt.answer,
                    receipt.submittedAt,
                    receipt.teacherFeedback,
                    receipt.reviewedAt,
                  ]),
                }}
                fields={[
                  {
                    name: 'feedback',
                    label: `給 ${receipt.displayName} 的回饋`,
                    max: 4000,
                    multiline: true,
                  },
                ]}
                label="儲存老師回饋"
                secondaryLabel="儲存回饋並查看下一份"
                submit={async ({ feedback }, key, active, intent) => {
                  const result = assignment
                    ? await classes.assignmentFeedback(
                        course.id,
                        item.id,
                        receipt.platformAccountId,
                        feedback,
                        key,
                      )
                    : await classes.quizFeedback(
                        course.id,
                        item.id,
                        receipt.platformAccountId,
                        feedback,
                        key,
                      );
                  if (!active()) return;
                  const latest =
                    (receiptsRef.current ?? []).map((entry) =>
                      entry.platformAccountId === result.platformAccountId ? result : entry,
                    );
                  const nextList = latest.length ? latest : [result];
                  resource.commit(() => nextList, resource.version);
                  receiptsRef.current = nextList;
                  const matched = (result.teacherFeedback ?? '').trim() === feedback.trim();
                  if (intent === 'secondary') {
                    if (!matched) {
                      // Keep this receipt visible with the conflict notice; do not move.
                      setFocusReceiptId(result.platformAccountId);
                      setFeedbackFilter((current) =>
                        matchesFeedbackQueueFilter(result, current) ? current : 'all',
                      );
                      setQueueNotice('');
                      pendingRevealId.current = null;
                      revealGeneration.current += 1;
                      return '這份回饋已有新的內容，上方顯示目前儲存的版本。';
                    }
                    // Advance only after authoritative text matches; other drafts stay mounted.
                    advanceAfterSave(result, nextList);
                    return undefined;
                  }
                  setQueueNotice('');
                  setFocusReceiptId(null);
                  setFeedbackFilter((current) =>
                    matchesFeedbackQueueFilter(result, current) ? current : 'all',
                  );
                  return matched
                    ? '老師回饋已儲存。'
                    : '這份回饋已有新的內容，上方顯示目前儲存的版本。';
                }}
              />
            ) : null}
          </Section>
          </View>
          );
        })}
      </View>
    </View>
  );
}

function CoursePublishing({
  classes,
  course,
  tab,
  created,
}: {
  classes: Classes;
  course: NuniWorkspace;
  tab: 'materials' | 'assignments' | 'quizzes';
  created(item: Activity | NuniMaterial): void;
}) {
  const [open, setOpen] = useNuniDraftState(
    `course:${course.id}:${course.memberRole}:${course.state}:publishing-open`,
    false,
  );
  const kind = tab === 'materials' ? '教材' : tab === 'assignments' ? '作業' : '測驗';
  return (
    <Section>
      <Button label={`新增${kind}`} onPress={() => setOpen((value) => !value)} />
      <View style={{ display: open ? 'flex' : 'none' }}>
        <Copy>發布後本課程成員就能查看。參考期限與單元可在網站設定。</Copy>
        {(['materials', 'assignments', 'quizzes'] as const).map((target) => {
          const title =
            target === 'materials' ? '教材' : target === 'assignments' ? '作業' : '測驗';
          return (
            <View key={target} style={{ display: target === tab ? 'flex' : 'none' }}>
              <MutationForm
                draftKey={`course:${course.id}:${course.memberRole}:${course.state}:publish:${target}`}
                fields={[
                  { name: 'title', label: `${title}標題`, max: 160 },
                  {
                    name: 'body',
                    label: `${title}說明`,
                    max: target === 'quizzes' ? 4000 : 8000,
                    multiline: true,
                  },
                ]}
                label={`發布${title}`}
                submit={async ({ title: name, body }, idempotencyKey, active) => {
                  const result =
                    target === 'materials'
                      ? await classes.createMaterial(course.id, {
                          title: name,
                          body,
                          idempotencyKey,
                        })
                      : target === 'assignments'
                        ? await classes.createAssignment(course.id, {
                            title: name,
                            instructions: body,
                            dueAt: null,
                            idempotencyKey,
                          })
                        : await classes.createQuiz(course.id, {
                            title: name,
                            prompt: body,
                            dueAt: null,
                            idempotencyKey,
                          });
                  if (active()) created(result);
                  return `${title}已發布。`;
                }}
              />
            </View>
          );
        })}
      </View>
    </Section>
  );
}
