import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AIButton, aiTokens } from '../ui/aiFirst';
import { safeNavigate } from '../utils/safeNavigate';
import type { CampusAssignmentIdentity } from '../services/campusAssignmentTarget';
import type {
  NuniPlanActivityIdentity,
  NuniPlanAssignmentSource,
  NuniPlanQuizSource,
  NuniPlanAssignmentTargetInput,
  readNuniPlanAssignmentTarget,
  readNuniPlanQuizTarget,
} from '../services/nuniPlanAssignmentTarget';

export type NuniPlanAssignmentOpenContext = Pick<NuniPlanAssignmentTargetInput,
  'accountId' | 'schoolId' | 'isCurrent' | 'request' | 'bffRequest'> & {
  readTarget: typeof readNuniPlanAssignmentTarget;
  readQuizTarget?: typeof readNuniPlanQuizTarget;
};

export type NuniPlanAssignmentNavigation = NonNullable<Parameters<typeof safeNavigate>[0]> & {
  isFocused?: () => boolean;
  addListener?: (event: 'focus' | 'blur', listener: () => void) => () => void;
};

type VisibleSource = { kind: 'assignment'; source: NuniPlanAssignmentSource }
  | { kind: 'quiz'; source: NuniPlanQuizSource };

/** Only a live locator is shown here; its format and current authority are checked by the reader. */
function visibleSource(activity: NuniPlanActivityIdentity, context: NuniPlanAssignmentOpenContext): VisibleSource | null {
  const quiz = activity.kind === 'quiz';
  if (quiz && !context.readQuizTarget) return null;
  const value = quiz ? activity.nuniQuizSource : activity.nuniSource;
  const activityId = quiz ? activity.nuniQuizSource?.quizId : activity.nuniSource?.assignmentId;
  if (!value || typeof value !== 'object' ||
      ![value.accountId, value.schoolId, value.academicYear, value.semester, value.workspaceId, activityId]
        .every((field) => typeof field === 'string' && field.trim().length > 0) ||
      value.accountId !== context.accountId || value.schoolId !== context.schoolId) return null;
  const common = { accountId: value.accountId, schoolId: value.schoolId, academicYear: value.academicYear,
    semester: value.semester, workspaceId: value.workspaceId };
  return quiz ? { kind: 'quiz', source: { ...common, quizId: activityId! } }
    : { kind: 'assignment', source: { ...common, assignmentId: activityId! } };
}

export function NuniPlanAssignmentOpenButton({ assignment, context, navigation, disabled }: {
  assignment: CampusAssignmentIdentity & NuniPlanActivityIdentity;
  context: NuniPlanAssignmentOpenContext;
  navigation: NuniPlanAssignmentNavigation | null | undefined;
  disabled: boolean;
}) {
  const source = visibleSource(assignment, context);
  const label = assignment.kind === 'quiz' ? '測驗' : '作業';
  const changed = `${label}來源或課程連結已變更，請重新核對，或從課程與作業入口確認。`;
  const unavailable = `暫時無法核對這份${label}，請稍後重試，或從課程與作業入口確認。`;
  const sourceKey = JSON.stringify([context.accountId, context.schoolId, source]);
  const current = context.isCurrent();
  const visible = !!source && current && typeof navigation?.navigate === 'function';
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const focused = useRef(true);
  const inFlight = useRef<AbortController | null>(null);
  const latest = useRef({ sourceKey, context, navigation, disabled, visible });
  latest.current = { sourceKey, context, navigation, disabled, visible };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, []);
  useEffect(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    setOpening(false);
    setError('');
  }, [sourceKey]);
  useEffect(() => {
    if (visible && !disabled) return;
    inFlight.current?.abort();
    inFlight.current = null;
    setOpening(false);
  }, [disabled, visible]);
  useEffect(() => {
    // A pushed screen can leave this component mounted. Leaving it revokes the tap,
    // even if the user returns before an old source read finishes.
    focused.current = true;
    setOpening(false);
    const unsubscribeBlur = navigation?.addListener?.('blur', () => {
      focused.current = false;
      inFlight.current?.abort();
      inFlight.current = null;
      if (mounted.current) setOpening(false);
    });
    const unsubscribeFocus = navigation?.addListener?.('focus', () => {
      focused.current = true;
    });
    return () => {
      focused.current = false;
      inFlight.current?.abort();
      inFlight.current = null;
      unsubscribeBlur?.();
      unsubscribeFocus?.();
    };
  }, [navigation]);

  const open = async () => {
    const focusedNow = () => focused.current && navigation?.isFocused?.() !== false;
    if (!source || disabled || !visible || inFlight.current || !mounted.current || !context.isCurrent() ||
        latest.current.navigation !== navigation || !focusedNow()) return;
    const controller = new AbortController();
    inFlight.current = controller;
    const active = () => mounted.current && inFlight.current === controller && !controller.signal.aborted &&
      latest.current.sourceKey === sourceKey && latest.current.visible && !latest.current.disabled &&
      latest.current.navigation === navigation && focusedNow() &&
      context.isCurrent() && latest.current.context.isCurrent();
    setOpening(true);
    setError('');
    try {
      const lookup = { accountId: context.accountId, schoolId: context.schoolId,
        request: context.request, bffRequest: context.bffRequest, isCurrent: active, signal: controller.signal };
      const result = source.kind === 'quiz'
        ? await context.readQuizTarget!({ ...lookup, source: source.source })
        : await context.readTarget({ ...lookup, source: source.source });
      if (!active()) return;
      if (result.kind === 'ready') {
        const params = result.params;
        // The reader cannot turn a selected row into another assignment or account's route.
        const activityId = source.kind === 'quiz' ? source.source.quizId : source.source.assignmentId;
        if (params.tab !== 'courses' || params.workspaceId !== source.source.workspaceId ||
            params.assignmentId !== activityId || params.assistantAccountId !== context.accountId) {
          setError(changed);
          return;
        }
        if (!safeNavigate(latest.current.navigation, 'NuniWorkspace', params, { fallbackMessage: null })) {
          setError(`目前無法開啟這份${label}，請重試，或從課程與作業入口確認。`);
        }
      } else if (result.kind === 'changed') setError(changed);
      else if (result.kind === 'session-changed') setError(`登入狀態已變更，請重新登入後核對這份${label}。`);
      else if (result.kind === 'cancelled') setError(`已取消核對，可重新確認這份${label}。`);
      else setError(unavailable);
    } catch {
      if (active()) setError(unavailable);
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        if (mounted.current && latest.current.sourceKey === sourceKey) setOpening(false);
      }
    }
  };

  if (!visible) return null;
  return (
    <View style={{ gap: 6 }}>
      <AIButton label={opening ? `正在核對${label}…` : error ? `重新核對這份${label}` : `查看這份${label}`}
        size="sm" disabled={disabled || opening} onPress={() => { void open(); }} />
      <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 18 }}>
        {assignment.kind === 'quiz' ? '開啟前會重新核對帳號、課程與測驗；作答與交卷由你決定。'
          : '開啟前會重新核對帳號、課程與作業；不會自動送出。'}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: aiTokens.warning, fontSize: 12, lineHeight: 19 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
