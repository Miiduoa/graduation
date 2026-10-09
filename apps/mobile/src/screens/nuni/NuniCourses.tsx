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
import { courseRoleLabels, matchesAssignmentFilter } from '@campus/shared/src/nuniCourseTasks';
import { useNuniSession } from '../../state/nuniSession';
import { useTheme } from '../../state/theme';
import type { NativeNuniSession } from '../../services/nuniSessionController';

type Classes = ReturnType<typeof createNuniClasses>;
type Field = { name: string; label: string; max: number; multiline?: boolean; min?: number };
type Activity = NuniAssignment | NuniQuiz;
type Receipt = NuniSubmission | NuniQuizResponse;
const time = (value: string) =>
  new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

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
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        paddingHorizontal: 14,
        paddingVertical: 12,
        backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
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
  fields,
  label,
  submit,
}: {
  fields: Field[];
  label: string;
  submit(
    values: Record<string, string>,
    key: string,
    active: () => boolean,
  ): Promise<string | void>;
}) {
  const theme = useTheme();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const lock = useRef(false);
  const intent = useRef<{ values: Record<string, string>; signature: string; key: string } | null>(
    null,
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const send = async () => {
    if (lock.current || !mounted.current) return;
    const payload = Object.fromEntries(
      fields.map((field) => [field.name, (values[field.name] ?? '').trim()]),
    );
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
        setUncertain(false);
        setNotice(typeof confirmed === 'string' ? confirmed : '已確認儲存。');
      }
    } catch (failure) {
      if (mounted.current) {
        const unknown =
          !(failure instanceof NuniError) || failure.status === 0 || failure.status >= 500;
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
      {fields.map((field) => (
        <View key={field.name} style={{ gap: 6 }}>
          <Copy>{field.label}</Copy>
          <TextInput
            accessibilityLabel={field.label}
            value={values[field.name] ?? ''}
            editable={!busy && !uncertain}
            maxLength={field.max}
            multiline={field.multiline}
            autoCapitalize="none"
            textAlignVertical="top"
            onChangeText={(value) => setValues((current) => ({ ...current, [field.name]: value }))}
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

function useLoad<T>(load: () => Promise<T>, automatic = true) {
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
        if (mounted.current && run === generation.current) setError(nuniErrorMessage(failure));
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
    [load],
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
  return { data, commit, error, loading, refresh, version: generation.current };
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
        (path, input) => request(path, session.context, input),
        session.platformAccountId,
      ),
    [request, session.context, session.platformAccountId],
  );
  const [selected, setSelected] = useState<string | null>(null);
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
  const [action, setAction] = useState<'join' | 'create' | null>(null);
  return (
    <>
      <Copy title>我的課程</Copy>
      <Copy>修課與授課依每門課的身分顯示。建立課程不會取得校方教職員權限。</Copy>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button label="加入課程" onPress={() => setAction('join')} />
        <Button label="建立課程" onPress={() => setAction('create')} />
        <Button label="更新課程" onPress={() => void result.refresh()} disabled={result.loading} />
      </View>
      <View style={{ display: action === 'join' ? 'flex' : 'none' }}>
        <MutationForm
          fields={[{ name: 'code', label: '老師提供的邀請碼', max: 24, min: 6 }]}
          label="確認加入"
          submit={async ({ code }, key, active) => {
            const course = await classes.join(code, key);
            if (active()) open(course.id);
          }}
        />
      </View>
      <View style={{ display: action === 'create' ? 'flex' : 'none' }}>
        <MutationForm
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
  assignments: NuniAssignment[];
  quizzes: NuniQuiz[];
};
function CourseDetail({ id, classes, onBack }: { id: string; classes: Classes; onBack(): void }) {
  const load = useCallback(async (): Promise<CourseData> => {
    const course = await classes.get(id);
    const [materials, assignments, quizzes] = await Promise.all([
      classes.materials(id),
      classes.assignments(id),
      classes.quizzes(id),
    ]);
    return { course, materials, assignments, quizzes };
  }, [classes, id]);
  const result = useLoad(load);
  const [tab, setTab] = useState<'assignments' | 'materials' | 'quizzes'>('assignments');
  const data = result.data;
  const saveActivity = (item: Activity) =>
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
  const teacher = data && data.course.memberRole !== 'student';
  return (
    <>
      <Button label="返回我的課程" onPress={onBack} />
      {result.loading ? <Copy>正在讀取課程內容…</Copy> : null}
      {result.error ? <Copy alert>{result.error}</Copy> : null}
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
              : `${data.assignments.filter((item) => matchesAssignmentFilter(item, data.course, 'pending')).length} 份待繳作業`}
          </Copy>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button
              label={`作業 ${data.assignments.length}`}
              onPress={() => setTab('assignments')}
            />
            <Button label={`教材 ${data.materials.length}`} onPress={() => setTab('materials')} />
            <Button label={`測驗 ${data.quizzes.length}`} onPress={() => setTab('quizzes')} />
          </View>
          <View style={{ display: tab === 'assignments' ? 'flex' : 'none', gap: 16 }}>
            {data.assignments.length === 0 ? (
              <Copy>老師尚未發布作業。</Copy>
            ) : (
              data.assignments.map((item) => (
                <ActivityCard
                  key={`${data.course.memberRole}:${data.course.state}:${item.id}`}
                  item={item}
                  course={data.course}
                  classes={classes}
                  saved={saveActivity}
                />
              ))
            )}
          </View>
          <View style={{ display: tab === 'materials' ? 'flex' : 'none', gap: 16 }}>
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
          </View>
          <View style={{ display: tab === 'quizzes' ? 'flex' : 'none', gap: 16 }}>
            {data.quizzes.length === 0 ? (
              <Copy>老師尚未發布測驗。</Copy>
            ) : (
              data.quizzes.map((item) => (
                <ActivityCard
                  key={`${data.course.memberRole}:${data.course.state}:${item.id}`}
                  item={item}
                  course={data.course}
                  classes={classes}
                  saved={saveActivity}
                />
              ))
            )}
          </View>
          {teacher && data.course.state === 'active' ? (
            <CoursePublishing
              key={`${data.course.memberRole}:${data.course.state}`}
              tab={tab}
              classes={classes}
              course={data.course}
              created={(item) =>
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
                  return {
                    ...current,
                    materials: [...current.materials.filter((entry) => entry.id !== item.id), item],
                  };
                }, result.version)
              }
            />
          ) : null}
          {data.course.memberRole === 'owner-teacher' && data.course.state === 'active' ? (
            <Section>
              <Copy title>邀請修課學生</Copy>
              <Copy>邀請碼只會加入修課身分，不會取得共同授課或校方權限。</Copy>
              <MutationForm
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
}: {
  item: Activity;
  course: NuniWorkspace;
  classes: Classes;
  saved(item: Activity): void;
}) {
  const assignment = 'instructions' in item;
  const receipt = assignment ? item.mySubmission : item.myResponse;
  const prompt = assignment ? item.instructions : item.prompt;
  const student = course.memberRole === 'student';
  const active = course.state === 'active';
  const canSubmit = student && active && item.state === 'open';
  const kind = assignment ? '作業' : '測驗';
  return (
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
        </View>
      ) : null}
      {canSubmit ? (
        <MutationForm
          fields={[
            {
              name: 'body',
              label: `${kind}內容：${item.title}`,
              max: assignment ? 8000 : 4000,
              multiline: true,
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
            {course.state === 'active' ? (
              <MutationForm
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
                  return '老師回饋已儲存。';
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
  const [open, setOpen] = useState(false);
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
