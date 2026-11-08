import React, { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { classDate } from '@campus/shared/src/timetable/classExceptions';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import type { CourseworkRead, CourseworkRequests } from '../features/nuniCourseworkFollowUp';
import {
  CourseworkStudyError, confirmCourseworkStudyDraft, prepareCourseworkStudyDraft, isCourseworkStudyInstant,
  type CourseworkStudyDraft, type CourseworkStudyTime,
} from '../features/nuniCourseworkStudy';
import { sameAssistantCalendarEvent, type AssistantCalendarContext, type AssistantCalendarTask } from '../services/assistantCalendarExecution';
import { AIButton, aiTokens } from '../ui/aiFirst';

export type NuniCourseworkStudyActionProps = {
  read: CourseworkRead;
  assignmentIds: readonly string[];
  initialTime?: CourseworkStudyTime;
  context: AssistantCalendarContext;
  requests?: CourseworkRequests;
  disabled?: boolean;
  latest: boolean;
  task?: AssistantCalendarTask;
  sourceCheckedAt?: string;
  onTask: (task: AssistantCalendarTask, sourceCheckedAt?: string, assignmentId?: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onRefresh?: () => void;
  onOpenAssignment?: (workspaceId: string, assignmentId: string) => void;
  onRecheckOperations?: () => void;
};

type Stage =
  | { kind: 'editing'; error?: string }
  | { kind: 'review' | 'saving'; draft: CourseworkStudyDraft }
  | { kind: 'blocked'; message: string; refreshed?: CourseworkRead }
  | { kind: 'cancelled' | 'stopped' | 'handed-off' };

const DAY = 86_400_000;
const EMPTY_TIME: CourseworkStudyTime = { date: '', startTime: '', endTime: '' };
const SOURCE_CHANGED = '作業來源或帳號狀態已變更，請重新查詢作業後再安排。';
const RETRY_SOURCE = '目前無法核對這次處理結果。請重新查詢作業；若已送出行程，可在行程紀錄中核對。';

function sourceIdentity(props: NuniCourseworkStudyActionProps): string {
  const { read, context } = props;
  return JSON.stringify([
    context.uid, context.schoolId, context.platformTimetable?.accountId,
    read.anchor, read.checkedAt, read.changedAssignmentId,
    read.selectedWorkspaceId, read.expectedReviewed, read.expectedLinkedWorkspaceId,
    read.result, props.assignmentIds, props.initialTime,
  ]);
}

function sourceScopeCurrent(props: NuniCourseworkStudyActionProps): boolean {
  const { context, read } = props;
  const platform = context.platformTimetable;
  try {
    return !!platform && !context.uid && !!platform.accountId && context.isCurrent() && platform.isCurrent() &&
      !read.anchor.uid && read.anchor.owner === `nuni:${platform.accountId}` &&
      read.anchor.schoolId === context.schoolId;
  } catch { return false; }
}

function errorMessage(error: unknown): string {
  return error instanceof CourseworkStudyError ? error.message : '無法預覽這份準備行程，請核對作業、日期與起訖時間。';
}

/** Only the caller's conversation owns execution results and their existing calendar cards. */
export function NuniCourseworkStudyAction(props: NuniCourseworkStudyActionProps) {
  const live = useRef(props);
  live.current = props;
  const identity = sourceIdentity(props);
  return <StudyActionInstance key={identity} props={props} live={live} identity={identity} />;
}

function StudyActionInstance({ props, live, identity }: {
  props: NuniCourseworkStudyActionProps;
  live: React.MutableRefObject<NuniCourseworkStudyActionProps>;
  identity: string;
}) {
  const mounted = useRef(true);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const releaseBusy = useRef<(() => void) | null>(null);
  const current = () => mounted.current && sourceIdentity(live.current) === identity &&
    live.current.latest && !live.current.task && !live.current.read.changedAssignmentId && sourceScopeCurrent(live.current);
  const { read } = props;
  const assignments = read.result.kind === 'assignments' ? read.result.assignments : [];
  const ids = [...new Set(props.assignmentIds)];
  const candidates = ids.map((id) => assignments.filter((row) => row.id === id))
    .filter((rows) => rows.length === 1).map((rows) => rows[0]!);
  const validChoices = ids.length > 0 && candidates.length === ids.length;
  const [selectedId, setSelectedId] = useState(validChoices && candidates.length === 1 ? candidates[0]!.id : '');
  const [time, setTime] = useState<CourseworkStudyTime>(() => ({ ...(props.initialTime ?? EMPTY_TIME) }));
  const makeDraft = (id: string, value: CourseworkStudyTime) => {
    if (!current()) throw new Error(SOURCE_CHANGED);
    return prepareCourseworkStudyDraft(read, id, value, { ...props.context, isCurrent: current });
  };
  const initialStage = (id: string): Stage => {
    if (props.task) return { kind: 'handed-off' };
    if (!id || !props.initialTime?.date || !props.initialTime.startTime || !props.initialTime.endTime || !current())
      return { kind: 'editing' };
    try { return { kind: 'review', draft: makeDraft(id, props.initialTime) }; }
    catch (error) { return { kind: 'editing', error: errorMessage(error) }; }
  };
  const [stage, setStage] = useState<Stage>(() => initialStage(selectedId));
  const [pending, setPending] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      releaseBusy.current?.();
      releaseBusy.current = null;
    };
  }, []);
  useEffect(() => {
    if (!current()) controller.current?.abort();
  });

  const preview = () => {
    if (props.disabled || lock.current || !current() || !selectedId) return;
    try { setStage({ kind: 'review', draft: makeDraft(selectedId, time) }); }
    catch (error) { setStage({ kind: 'editing', error: errorMessage(error) }); }
  };
  const confirm = async () => {
    if (live.current.disabled || lock.current || !current() || stage.kind !== 'review') return;
    lock.current = true;
    const draft = stage.draft;
    const abort = new AbortController();
    controller.current = abort;
    const notifying = live.current.onBusyChange;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      notifying?.(false);
    };
    releaseBusy.current = release;
    const executionCurrent = () => current() && !abort.signal.aborted;
    setPending(true);
    setStage({ kind: 'saving', draft });
    notifying?.(true);
    try {
      const result = await confirmCourseworkStudyDraft(draft,
        { ...props.context, isCurrent: executionCurrent }, props.requests, { signal: abort.signal });
      if (result.kind === 'calendar') {
        // A stop revokes later writes, not the ability to show the original
        // operation's uncertain result while this source and scope still exist.
        if (!current()) return;
        // Never turn an unexpected intermediate result into an unrelated generic write button.
        if (!['verified', 'unknown', 'blocked'].includes(result.task.state) ||
            result.task.proposal.owner !== draft.source.owner || result.task.proposal.schoolId !== draft.source.schoolId ||
            !sameAssistantCalendarEvent(result.task.proposal.event, draft.event)) {
          setStage({ kind: 'blocked', message: RETRY_SOURCE });
          return;
        }
        setStage({ kind: 'handed-off' });
        live.current.onTask(result.task, result.sourceCheckedAt, draft.source.assignmentId);
      } else {
        if (!executionCurrent()) return;
        setStage({ kind: 'blocked', message: result.message, refreshed: result.refreshed });
      }
    } catch {
      if (executionCurrent()) setStage({ kind: 'blocked', message: RETRY_SOURCE });
    } finally {
      if (controller.current === abort) controller.current = null;
      lock.current = false;
      release();
      if (releaseBusy.current === release) releaseBusy.current = null;
      if (mounted.current) setPending(false);
    }
  };
  const stop = () => {
    if (!controller.current || controller.current.signal.aborted) return;
    controller.current.abort();
    setStage({ kind: 'stopped' });
  };
  const refresh = () => {
    if (live.current.latest && !props.disabled && !pending && sourceScopeCurrent(live.current)) live.current.onRefresh?.();
  };
  const body = { color: aiTokens.text, fontSize: 16, lineHeight: 24 };
  const secondary = { color: aiTokens.textSecondary, fontSize: 14, lineHeight: 22 };
  const inputStyle = { color: aiTokens.text, backgroundColor: aiTokens.panel, borderColor: aiTokens.border,
    borderWidth: 1, borderRadius: 10, minHeight: 46, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 };
  const unavailable = !sourceScopeCurrent(props);
  if (unavailable) return <Text accessibilityRole="alert" style={secondary}>{SOURCE_CHANGED}</Text>;

  const outdated = !props.latest || !!read.changedAssignmentId;
  const locked = !!props.disabled || pending || outdated;
  const selected = candidates.find((item) => item.id === selectedId);
  const review = stage.kind === 'review' || stage.kind === 'saving' ? stage.draft : null;
  const title = review?.source.title ?? selected?.title;
  const courseName = review?.source.courseName ?? (read.result.kind === 'assignments' ? read.result.workspace.title : '');
  const dueAt = review?.source.dueAt ?? selected?.dueAt;
  const checkedAt = review?.source.checkedAt ?? read.checkedAt;
  const sourceProblem = !isCourseworkStudyInstant(checkedAt) ? '來源查詢時間無法核對，請重新查詢作業。'
    : selected?.submittedAt ? '這份作業已有繳交紀錄，請先到原作業確認。'
      : selected?.state === 'closed' ? '這份作業已停止收件，請先到原作業確認。'
        : selected && !isCourseworkStudyInstant(dueAt) ? '這份作業沒有可核對的明確截止時間，請先到原作業確認。' : undefined;
  const refreshed = stage.kind === 'blocked' ? stage.refreshed : undefined;
  const freshAssignment = refreshed?.result.kind === 'assignments'
    ? refreshed.result.assignments.find((item) => item.id === selectedId) : undefined;
  const refreshButton = props.onRefresh ? <AIButton label="重新查詢作業" variant="ghost" disabled={!!props.disabled || pending || !props.latest}
    onPress={refresh} /> : null;
  const recheckButton = props.onRecheckOperations ? <AIButton label="核對行程紀錄" variant="ghost" disabled={!!props.disabled || pending}
    onPress={() => {
      if (!live.current.disabled && !pending && sourceScopeCurrent(live.current)) live.current.onRecheckOperations?.();
    }} /> : null;
  return <View style={{ gap: 10, marginTop: 10 }}>
    <Text style={{ ...body, fontWeight: '700', fontSize: 18 }}>安排作業準備時間</Text>
    {!!courseName && <Text style={secondary}>課程：{courseName}</Text>}
    {!!title && <Text style={{ ...body, fontWeight: '600' }}>作業：{title}</Text>}
    {!!selected && <Text style={secondary}>查詢時狀態：{selected.submittedAt ? '已有繳交紀錄' : selected.state === 'closed'
      ? '已停止收件 · 未見繳交紀錄' : '仍在收件 · 未見繳交紀錄'}</Text>}
    {!!selected && <Text style={secondary}>{isCourseworkStudyInstant(dueAt)
      ? `作業參考期限：${formatTaipeiDateTime(dueAt, { seconds: false })}（台灣時間）` : '作業參考期限：尚無可核對的明確時間'}</Text>}
    {isCourseworkStudyInstant(checkedAt) && <Text style={secondary}>來源查詢時間：{formatTaipeiDateTime(checkedAt, { seconds: true })}（台灣時間）</Text>}
    {isCourseworkStudyInstant(props.sourceCheckedAt) && <Text style={secondary}>建立前核對作業：{formatTaipeiDateTime(props.sourceCheckedAt, { seconds: true })}（台灣時間）</Text>}
    {!!selected && props.onOpenAssignment && read.result.kind === 'assignments' && <AIButton label="查看原作業" variant="ghost"
      disabled={!!props.disabled || pending} onPress={() => {
        if (!live.current.disabled && !pending && sourceScopeCurrent(live.current) && read.result.kind === 'assignments')
          live.current.onOpenAssignment?.(read.result.workspace.id, selected.id);
      }} />}
    {props.task ? <>
      {!!read.changedAssignmentId && <Text style={secondary}>原作業後來有更新；上方保留當時安排的來源資料，行程狀態請以下方核對結果為準。</Text>}
    </> : outdated ? <>
      <Text accessibilityRole="alert" style={secondary}>{read.changedAssignmentId
        ? '作業已更新，這是先前預覽的來源。若剛才已按確認，請先核對行程紀錄，再依最新作業決定下一步。'
        : '這是先前查詢的作業，請重新查詢後再安排準備時間。'}</Text>
      {!!read.changedAssignmentId && recheckButton}
      {refreshButton}
    </> : !validChoices ? <>
      <Text accessibilityRole="alert" style={secondary}>無法核對選取的作業，請重新查詢。</Text>
      {refreshButton}
    </> : sourceProblem ? <>
      <Text accessibilityRole="alert" style={secondary}>{sourceProblem}</Text>
      {refreshButton}
    </> : !selected ? <>
      <Text style={body}>要安排哪一份作業的準備時間？</Text>
      {candidates.map((item, index) => <AIButton key={item.id} variant="ghost" disabled={locked}
        label={`第 ${index + 1} 份：${item.title} · ${isCourseworkStudyInstant(item.dueAt) ? `截止 ${formatTaipeiDateTime(item.dueAt, { seconds: false })}` : '截止時間待核對'}`}
        onPress={() => {
          if (locked || !current()) return;
          setSelectedId(item.id);
          setStage(initialStage(item.id));
        }} />)}
    </> : stage.kind === 'editing' ? <>
      <Text style={secondary}>請填寫你想投入的時間，日期與鐘點皆為台灣時間。</Text>
      <Text style={secondary}>日期（YYYY-MM-DD）</Text>
      <TextInput accessibilityLabel="準備行程日期" placeholder="YYYY-MM-DD" value={time.date} editable={!locked}
        autoCapitalize="none" autoCorrect={false} maxLength={10} style={inputStyle}
        onChangeText={(date) => setTime((value) => ({ ...value, date }))} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {[['今天', 0], ['明天', 1]].map(([label, offset]) => <AIButton key={label} label={String(label)} variant="ghost" disabled={locked}
          onPress={() => { if (!locked && current()) setTime((value) => ({ ...value, date: classDate(new Date(Date.now() + Number(offset) * DAY)) })); }} />)}
      </View>
      <Text style={secondary}>開始時間（HH:mm）</Text>
      <TextInput accessibilityLabel="準備行程開始時間" placeholder="HH:mm" value={time.startTime} editable={!locked}
        autoCapitalize="none" autoCorrect={false} maxLength={5} style={inputStyle}
        onChangeText={(startTime) => setTime((value) => ({ ...value, startTime }))} />
      <Text style={secondary}>結束時間（HH:mm）</Text>
      <TextInput accessibilityLabel="準備行程結束時間" placeholder="HH:mm" value={time.endTime} editable={!locked}
        autoCapitalize="none" autoCorrect={false} maxLength={5} style={inputStyle}
        onChangeText={(endTime) => setTime((value) => ({ ...value, endTime }))} />
      {!!stage.error && <Text accessibilityRole="alert" style={{ ...secondary, color: aiTokens.danger }}>{stage.error}</Text>}
      <AIButton label="預覽準備行程" disabled={locked} onPress={preview} />
      <AIButton label="先不要" variant="ghost" disabled={locked} onPress={() => { if (!locked && current()) setStage({ kind: 'cancelled' }); }} />
    </> : review ? <>
      <Text style={{ ...body, fontWeight: '600' }}>{review.event.title}</Text>
      <Text style={body}>{review.event.date} · {review.event.startTime}–{review.event.endTime}（台灣時間）</Text>
      <Text style={secondary}>確認時會重新核對這份作業，再加入目前帳號與學校的個人行事曆，並讀回核對保存結果。請自行核對這段時間是否適合，這裡沒有判定課表空堂。</Text>
      {stage.kind === 'saving' ? <>
        <Text accessibilityLiveRegion="polite" style={body}>正在重新核對作業並處理準備行程…</Text>
        <AIButton label="停止後續處理" variant="ghost" onPress={stop} />
      </> : <>
        <AIButton label="確認建立準備行程" disabled={locked} onPress={() => void confirm()} />
        <AIButton label="修改日期與時間" variant="ghost" disabled={locked}
          onPress={() => { if (!locked && current()) setStage({ kind: 'editing' }); }} />
        <AIButton label="先不要" variant="ghost" disabled={locked}
          onPress={() => { if (!locked && current()) setStage({ kind: 'cancelled' }); }} />
      </>}
    </> : stage.kind === 'blocked' ? <>
      <Text accessibilityRole="alert" style={secondary}>{stage.message}</Text>
      {freshAssignment && <View style={{ gap: 5 }}>
        <Text style={{ ...secondary, fontWeight: '600' }}>這次重新查到的作業：{freshAssignment.title}</Text>
        <Text style={secondary}>{freshAssignment.submittedAt ? '已有繳交紀錄' : freshAssignment.state === 'closed'
          ? '已停止收件 · 未見繳交紀錄' : '仍在收件 · 未見繳交紀錄'}</Text>
        <Text style={secondary}>{isCourseworkStudyInstant(freshAssignment.dueAt)
          ? `目前期限：${formatTaipeiDateTime(freshAssignment.dueAt, { seconds: false })}（台灣時間）` : '目前期限：尚無可核對的明確時間'}</Text>
      </View>}
      {refreshButton}
    </> : <Text accessibilityLiveRegion="polite" style={secondary}>{stage.kind === 'cancelled'
      ? '已取消這份準備行程草稿，尚未送出建立。' : stage.kind === 'stopped'
        ? '已停止後續處理。若行程已送出，請在找回的行程紀錄或個人行事曆核對；停止不會刪除已保存的行程。'
        : '請查看行程卡上的保存與核對結果。'}</Text>}
    {!props.task && stage.kind === 'stopped' && recheckButton}
    <Text style={{ ...secondary, fontSize: 13 }}>準備行程只記錄你安排的時間，不代表作業已完成或已繳交，也不會設定手機通知。</Text>
  </View>;
}
