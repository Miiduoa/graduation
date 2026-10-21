import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
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
import { courseRoleLabels } from '@campus/shared/src/nuniCourseTasks';
import { useNuniSession } from '../../state/nuniSession';
import { useNuniDraftState } from '../../state/nuniDrafts';
import { useTheme } from '../../state/theme';
import type { NativeNuniSession } from '../../services/nuniSessionController';
import {
  isPendingActivity,
  matchesActivityFilter,
  prioritizeActivities,
  type ActivityFilter,
} from '../../services/nuniActivityTasks';

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
const time = (value: string) =>
  new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
const feedbackPredatesSubmission = (receipt: Receipt) =>
  !!receipt.teacherFeedback &&
  !!receipt.reviewedAt &&
  Date.parse(receipt.reviewedAt) < Date.parse(receipt.submittedAt);

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
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  selected?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, ...(selected === undefined ? {} : { selected }) }}
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

/** Retry preserves the submitted payload and key until the server confirms the outcome. */
function MutationForm({
  draftKey,
  fields,
  label,
  submit,
  savedContent,
}: {
  draftKey: string;
  fields: Field[];
  label: string;
  savedContent?: { values: Record<string, string>; revision: string };
  submit(
    values: Record<string, string>,
    key: string,
    active: () => boolean,
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
  } | null>(`${draftKey}:intent`, null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(!!storedIntent);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const lock = useRef(false);
  const intent = useRef<{ values: Record<string, string>; signature: string; key: string } | null>(
    storedIntent,
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const send = async () => {
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
    const signature = JSON.stringify(payload);
    if (!intent.current || (!uncertain && intent.current.signature !== signature))
      intent.current = { values: payload, signature, key: randomUUID() };
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
        label={busy ? '正在確認…' : uncertain ? '重試確認這次送出' : label}
        disabled={busy}
        onPress={() => void send()}
      />
    </View>
  );
}

function useLoad<T>(load: () => Promise<T>, automatic = true, clearOnDenied = false) {
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
        const value = await load();
        if (mounted.current && run === generation.current) setData(value);
      } catch (failure) {
        if (mounted.current && run === generation.current) {
          setError(nuniErrorMessage(failure));
          if (
            clearOnDenied &&
            failure instanceof NuniError &&
            (failure.status === 403 || failure.status === 404)
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

export function NuniCourses() {
  const auth = useNuniSession();
  if (!auth.session || auth.loading || auth.pendingLogout) return null;
  return <CourseScope key={auth.session.context} session={auth.session} request={auth.request} />;
}
function CourseScope({
  session,
  request,
}: {
  session: NativeNuniSession;
  request: ReturnType<typeof useNuniSession>['request'];
}) {
  const theme = useTheme();
  const classes = useMemo(
    () =>
      createNuniClasses(
        (path, input, query) =>
          query
            ? request(path, session.context, input, undefined, query)
            : request(path, session.context, input),
        session.platformAccountId,
      ),
    [request, session.context, session.platformAccountId],
  );
  const [selected, setSelected] = useNuniDraftState<string | null>('courses:selected', null);
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 16 }}
      style={{ backgroundColor: theme.colors.bg }}
    >
      {selected ? (
        <CourseDetail
          key={selected}
          id={selected}
          classes={classes}
          onBack={() => setSelected(null)}
        />
      ) : (
        <CourseList classes={classes} open={setSelected} />
      )}
    </ScrollView>
  );
}

function CourseList({ classes, open }: { classes: Classes; open(id: string): void }) {
  const load = useCallback(() => classes.list(), [classes]);
  const result = useLoad(load);
  const [action, setAction] = useNuniDraftState<'join' | 'create' | null>('courses:entry', null);
  return (
    <>
      <Copy title>我的課程</Copy>
      <Copy>選擇課程，查看教材、作業與測驗。</Copy>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button label="加入課程" onPress={() => setAction('join')} />
        <Button label="建立課程" onPress={() => setAction('create')} />
        <Button label="更新課程" onPress={() => void result.refresh()} disabled={result.loading} />
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
      {!result.loading && !result.error && result.data ? (
        <>
          {(['student', 'teaching', 'archived'] as const).map((group) => {
            const rows = result.data!.filter((course) =>
              group === 'archived'
                ? course.state === 'archived'
                : course.state === 'active' &&
                  (group === 'student'
                    ? course.memberRole === 'student'
                    : course.memberRole !== 'student'),
            );
            return (
              <Section key={group}>
                <Copy title>
                  {group === 'student'
                    ? '修習課程'
                    : group === 'teaching'
                      ? '授課與協作'
                      : '封存課程'}{' '}
                  · {rows.length}
                </Copy>
                {rows.length === 0 ? (
                  <Copy>
                    {group === 'student'
                      ? '尚未加入修習課程。請向老師取得邀請碼。'
                      : group === 'teaching'
                        ? '目前沒有負責或共同授課的課程。'
                        : '目前沒有封存課程。'}
                  </Copy>
                ) : (
                  rows.map((course) => (
                    <View key={course.id} style={{ gap: 4 }}>
                      <Button label={course.title} onPress={() => open(course.id)} />
                      <Copy>{courseRoleLabels[course.memberRole]}</Copy>
                    </View>
                  ))
                )}
              </Section>
            );
          })}
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
function CourseDetail({ id, classes, onBack }: { id: string; classes: Classes; onBack(): void }) {
  const pageGeneration = useRef(0);
  const pagePending = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [materialsError, setMaterialsError] = useState('');
  const [materialsDenied, setMaterialsDenied] = useState(false);
  const [cursorInvalid, setCursorInvalid] = useState(false);
  useEffect(
    () => () => {
      pageGeneration.current += 1;
    },
    [classes, id],
  );
  const load = useCallback(async (): Promise<CourseData> => {
    // Reloads and confirmed publication restart at the newest page. An older
    // pending page must never append into this new authority snapshot.
    pageGeneration.current += 1;
    pagePending.current = false;
    setLoadingMore(false);
    setMaterialsError('');
    setMaterialsDenied(false);
    setCursorInvalid(false);
    const course = await classes.get(id);
    const [page, assignments, quizzes] = await Promise.all([
      classes.materialsPage(id),
      classes.assignments(id),
      classes.quizzes(id),
    ]);
    return {
      course,
      materials: page.materials,
      materialsCursor: page.nextCursor,
      assignments,
      quizzes,
    };
  }, [classes, id]);
  const result = useLoad(load, true, true);
  const [tab, setTab] = useNuniDraftState<'assignments' | 'materials' | 'quizzes'>(
    `course:${id}:tab`,
    'assignments',
  );
  const [activityFilter, setActivityFilter] = useNuniDraftState<ActivityFilter>(
    `course:${id}:activity-filter`,
    'all',
  );
  const data = result.data;
  const loadOlderMaterials = async () => {
    if (
      !data?.materialsCursor ||
      result.loading ||
      result.error ||
      cursorInvalid ||
      materialsDenied ||
      pagePending.current
    )
      return;
    const run = pageGeneration.current;
    pagePending.current = true;
    setLoadingMore(true);
    setMaterialsError('');
    try {
      const page = await classes.materialsPage(id, data.materialsCursor);
      if (run !== pageGeneration.current) return;
      result.commit((current) => {
        if (!current || run !== pageGeneration.current) return current;
        const loaded = new Set(current.materials.map((item) => item.id));
        return {
          ...current,
          materials: [
            ...current.materials,
            ...page.materials.filter((item) => !loaded.has(item.id)),
          ],
          materialsCursor: page.nextCursor,
        };
      }, result.version);
    } catch (failure) {
      if (run !== pageGeneration.current) return;
      setMaterialsError(nuniErrorMessage(failure));
      if (failure instanceof NuniError && (failure.status === 403 || failure.status === 404)) {
        pageGeneration.current += 1;
        pagePending.current = false;
        setLoadingMore(false);
        setMaterialsDenied(true);
        result.commit(() => null, result.version);
      } else if (
        failure instanceof NuniError &&
        failure.code === 'CLASS_WORKSPACE_MATERIAL_CURSOR_INVALID'
      ) {
        setCursorInvalid(true);
      }
    } finally {
      if (run === pageGeneration.current) {
        pagePending.current = false;
        setLoadingMore(false);
      }
    }
  };
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
  return (
    <>
      <Button label="返回我的課程" onPress={onBack} />
      {result.loading ? <Copy>正在讀取課程內容…</Copy> : null}
      {result.error ? <Copy alert>{result.error}</Copy> : null}
      {materialsDenied ? <Copy alert>{materialsError}</Copy> : null}
      <Button label="更新內容" onPress={() => void result.refresh()} disabled={result.loading} />
      {data ? (
        <View style={{ gap: 16, display: result.loading || result.error ? 'none' : 'flex' }}>
          <Copy title>{data.course.title}</Copy>
          <Copy>
            {courseRoleLabels[data.course.memberRole]}
            {data.course.state === 'archived' ? ' · 課程已封存' : ''}
          </Copy>
          <Copy>
            {teacher
              ? '教學操作僅限這門課；不代表校方教職員身分。'
              : `待繳作業 ${data.assignments.filter((item) => isPendingActivity(item, data.course)).length} · 待答測驗 ${data.quizzes.filter((item) => isPendingActivity(item, data.course)).length}`}
          </Copy>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button
              label={`作業 ${data.assignments.length}`}
              onPress={() => setTab('assignments')}
              selected={tab === 'assignments'}
            />
            <Button
              label={`教材 ${data.materials.length}${data.materialsCursor ? '+' : ''}`}
              onPress={() => setTab('materials')}
              selected={tab === 'materials'}
            />
            <Button
              label={`測驗 ${data.quizzes.length}`}
              onPress={() => setTab('quizzes')}
              selected={tab === 'quizzes'}
            />
          </View>
          {!teacher && tab !== 'materials' ? (
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
          <View style={{ display: tab === 'assignments' ? 'flex' : 'none', gap: 16 }}>
            {data.assignments.length === 0 ? (
              <Copy>老師尚未發布作業。</Copy>
            ) : (
              prioritizeActivities(data.assignments, data.course).map((item) => (
                <ActivityCard
                  key={`${data.course.memberRole}:${data.course.state}:${item.id}`}
                  item={item}
                  course={data.course}
                  classes={classes}
                  saved={saveActivity}
                  hidden={!teacher && !matchesActivityFilter(item, data.course, activityFilter)}
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
              <Copy>
                {data.materialsCursor
                  ? `已載入 ${data.materials.length} 筆教材，還有較早內容。`
                  : `共 ${data.materials.length} 筆教材。`}
              </Copy>
            ) : null}
            {data.materials.length === 0 ? (
              <Copy>老師尚未發布教材。</Copy>
            ) : (
              data.materials.map((material) => (
                <Section key={material.id}>
                  <Copy title>{material.title}</Copy>
                  {material.unitTitle ? <Copy>{material.unitTitle}</Copy> : null}
                  <Copy>{material.body}</Copy>
                </Section>
              ))
            )}
            {materialsError ? <Copy alert>{materialsError}</Copy> : null}
            {cursorInvalid ? (
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
              prioritizeActivities(data.quizzes, data.course).map((item) => (
                <ActivityCard
                  key={`${data.course.memberRole}:${data.course.state}:${item.id}`}
                  item={item}
                  course={data.course}
                  classes={classes}
                  saved={saveActivity}
                  hidden={!teacher && !matchesActivityFilter(item, data.course, activityFilter)}
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
          {teacher && data.course.state === 'active' ? (
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

function ActivityCard({
  item,
  course,
  classes,
  saved,
  hidden = false,
}: {
  item: Activity;
  course: NuniWorkspace;
  classes: Classes;
  saved(item: Activity): void;
  hidden?: boolean;
}) {
  const assignment = 'instructions' in item;
  const receipt = assignment ? item.mySubmission : item.myResponse;
  const prompt = assignment ? item.instructions : item.prompt;
  const student = course.memberRole === 'student';
  const active = course.state === 'active';
  const canSubmit = student && active && item.state === 'open';
  const kind = assignment ? '作業' : '測驗';
  return (
    <View
      style={{ display: hidden ? 'none' : 'flex' }}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    >
      <Section>
        <Copy title>{item.title}</Copy>
        <Copy>{prompt}</Copy>
        <Copy>
          {item.dueAt ? `參考期限：${time(item.dueAt)}` : '未設定參考期限'} ·{' '}
          {item.state === 'open' ? '開放繳交' : '已停止收件'}
        </Copy>
        {item.dueAt && item.state === 'open' && active ? (
          <Copy>目前仍開放繳交，收件狀態以老師是否停止收件為準。</Copy>
        ) : null}
        {receipt ? (
          <View style={{ gap: 8 }}>
            <Copy title>已繳交</Copy>
            <Copy>{time(receipt.submittedAt)}</Copy>
            <Copy>{'body' in receipt ? receipt.body : receipt.answer}</Copy>
            <Copy>
              {receipt.teacherFeedback
                ? `老師回饋：${receipt.teacherFeedback}`
                : '老師尚未留下回饋。'}
            </Copy>
            {receipt.reviewedAt ? <Copy>回饋時間：{time(receipt.reviewedAt)}</Copy> : null}
            {feedbackPredatesSubmission(receipt) ? (
              <Copy>這則回饋早於最近一次繳交，可請老師確認是否仍適用。</Copy>
            ) : null}
          </View>
        ) : null}
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
                multiline: true,
                hint: assignment
                  ? undefined
                  : `最多 ${QUIZ_ANSWER_LIMIT} 字。老師停止收件前仍可修改。`,
              },
            ]}
            label={receipt ? `更新${kind}繳交` : `繳交${kind}`}
            submit={async ({ body }, key, stillActive) => {
              const confirmed = assignment
                ? await classes.submit(course.id, item.id, body, key)
                : await classes.submitQuiz(course.id, item.id, body, key);
              if (stillActive()) saved(confirmed);
              return '已收到伺服器繳交紀錄。';
            }}
          />
        ) : null}
        {!active ? <Copy>這門課已封存，現在只能查看保留的紀錄。</Copy> : null}
        {!student ? (
          <TeacherReceipts
            key={`${item.id}:${course.memberRole}:${course.state}`}
            classes={classes}
            course={course}
            item={item}
          />
        ) : null}
      </Section>
    </View>
  );
}

function TeacherReceipts({
  classes,
  course,
  item,
}: {
  classes: Classes;
  course: NuniWorkspace;
  item: Activity;
}) {
  const assignment = 'instructions' in item;
  const load = useCallback(
    async (): Promise<Receipt[]> =>
      assignment
        ? classes.submissions(course.id, item.id)
        : classes.quizResponses(course.id, item.id),
    [assignment, classes, course.id, item.id],
  );
  const resource = useLoad(load, false);
  const { data: receipts, loading: busy, error } = resource;
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
      <View style={{ display: busy || error ? 'none' : 'flex', gap: 14 }}>
        {receipts?.map((receipt) => (
          <Section key={receipt.platformAccountId}>
            <Copy title>{receipt.displayName}</Copy>
            <Copy>{time(receipt.submittedAt)}</Copy>
            <Copy>{'body' in receipt ? receipt.body : receipt.answer}</Copy>
            {receipt.teacherFeedback ? (
              <Copy>已回饋：{receipt.teacherFeedback}</Copy>
            ) : (
              <Copy>尚未回饋</Copy>
            )}
            {receipt.reviewedAt ? <Copy>回饋時間：{time(receipt.reviewedAt)}</Copy> : null}
            {feedbackPredatesSubmission(receipt) ? (
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
                submit={async ({ feedback }, key, active) => {
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
                  if (active()) {
                    resource.commit(
                      (current) =>
                        current?.map((entry) =>
                          entry.platformAccountId === result.platformAccountId ? result : entry,
                        ) ?? null,
                      resource.version,
                    );
                  }
                  return result.teacherFeedback === feedback.trim()
                    ? '老師回饋已儲存。'
                    : '這份回饋已有新的內容，上方顯示目前儲存的版本。';
                }}
              />
            ) : null}
          </Section>
        ))}
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
