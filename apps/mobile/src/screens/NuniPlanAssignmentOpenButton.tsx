import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AIButton, aiTokens } from '../ui/aiFirst';
import { safeNavigate } from '../utils/safeNavigate';
import type { CampusAssignmentIdentity } from '../services/campusAssignmentTarget';
import type {
  NuniPlanAssignmentSource,
  NuniPlanAssignmentTargetInput,
  readNuniPlanAssignmentTarget,
} from '../services/nuniPlanAssignmentTarget';

export type NuniPlanAssignmentOpenContext = Pick<NuniPlanAssignmentTargetInput,
  'accountId' | 'schoolId' | 'isCurrent' | 'request' | 'bffRequest'> & {
  readTarget: typeof readNuniPlanAssignmentTarget;
};

export type NuniPlanAssignmentNavigation = NonNullable<Parameters<typeof safeNavigate>[0]> & {
  isFocused?: () => boolean;
  addListener?: (event: 'focus' | 'blur', listener: () => void) => () => void;
};

const CHANGED = '作業來源或課程連結已變更，請重新核對，或從課程與作業入口確認。';
const UNAVAILABLE = '暫時無法核對這份作業，請稍後重試，或從課程與作業入口確認。';
const NAVIGATION_FAILED = '目前無法開啟這份作業，請重試，或從課程與作業入口確認。';

/** Only a live locator is shown here; its format and current authority are checked by the reader. */
function visibleSource(value: NuniPlanAssignmentSource | undefined, context: NuniPlanAssignmentOpenContext): NuniPlanAssignmentSource | null {
  if (!value || typeof value !== 'object' ||
      ![value.accountId, value.schoolId, value.academicYear, value.semester, value.workspaceId, value.assignmentId]
        .every((field) => typeof field === 'string' && field.trim().length > 0) ||
      value.accountId !== context.accountId || value.schoolId !== context.schoolId) return null;
  return { accountId: value.accountId, schoolId: value.schoolId, academicYear: value.academicYear,
    semester: value.semester, workspaceId: value.workspaceId, assignmentId: value.assignmentId };
}

export function NuniPlanAssignmentOpenButton({ assignment, context, navigation, disabled }: {
  assignment: CampusAssignmentIdentity & { nuniSource?: NuniPlanAssignmentSource };
  context: NuniPlanAssignmentOpenContext;
  navigation: NuniPlanAssignmentNavigation | null | undefined;
  disabled: boolean;
}) {
  const source = visibleSource(assignment.nuniSource, context);
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
      const result = await context.readTarget({ source, accountId: context.accountId, schoolId: context.schoolId,
        request: context.request, bffRequest: context.bffRequest, isCurrent: active, signal: controller.signal });
      if (!active()) return;
      if (result.kind === 'ready') {
        const params = result.params;
        // The reader cannot turn a selected row into another assignment or account's route.
        if (params.tab !== 'courses' || params.workspaceId !== source.workspaceId ||
            params.assignmentId !== source.assignmentId || params.assistantAccountId !== context.accountId) {
          setError(CHANGED);
          return;
        }
        if (!safeNavigate(latest.current.navigation, 'NuniWorkspace', params, { fallbackMessage: null })) {
          setError(NAVIGATION_FAILED);
        }
      } else if (result.kind === 'changed') setError(CHANGED);
      else if (result.kind === 'session-changed') setError('登入狀態已變更，請重新登入後核對這份作業。');
      else if (result.kind === 'cancelled') setError('已取消核對，可重新確認這份作業。');
      else setError(UNAVAILABLE);
    } catch {
      if (active()) setError(UNAVAILABLE);
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
      <AIButton label={opening ? '正在核對作業…' : error ? '重新核對這份作業' : '查看這份作業'}
        size="sm" disabled={disabled || opening} onPress={() => { void open(); }} />
      <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 18 }}>
        開啟前會重新核對帳號、課程與作業；不會自動送出。
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: aiTokens.warning, fontSize: 12, lineHeight: 19 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
