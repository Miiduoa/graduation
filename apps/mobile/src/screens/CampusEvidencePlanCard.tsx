import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AIButton, aiTokens } from '../ui/aiFirst';
import type { CampusEvidencePlan, CampusPlanPriority, CampusPlanRoute } from '../services/offlineCampusPlanner';
import type { CampusSenseSnapshot } from '../services/campusSenseSnapshot';
import type { CampusAssignmentIdentity } from '../services/campusAssignmentTarget';
import type { NuniPlanActivityIdentity } from '../services/nuniPlanAssignmentTarget';
import type { safeNavigate } from '../utils/safeNavigate';
import { CampusAssignmentReminderAction } from './CampusAssignmentReminderAction';
import { CampusStudyAgendaCard } from './CampusStudyAgendaCard';
import { CampusAssignmentOpenButton } from './CampusAssignmentOpenButton';

const PRIORITY: Record<CampusPlanPriority, string> = {
  overdue: '期限已過',
  urgent: '24 小時內',
  soon: '三天內',
  normal: '待安排',
  verify: '需核對',
};

const ROUTE_LABEL: Record<CampusPlanRoute, string> = {
  '/classroom': '課程與作業',
  '/timetable': '我的課表',
  '/announcements': '校園公告',
};

const EVIDENCE_LABEL = {
  'authorized-assignments': '已授權作業摘要',
  'authorized-quizzes': '已授權測驗摘要',
  'saved-timetable': '手機儲存課表',
  'authorized-announcements': '已授權公告摘要',
  verification: '人工核對建議',
};

export function CampusEvidencePlanCard({
  plan,
  disabled,
  onOpenRoute,
  reminderContext,
  navigation,
  historical = false,
  progress,
  renderAssignmentAction,
}: {
  plan: CampusEvidencePlan;
  disabled: boolean;
  onOpenRoute?: (route: CampusPlanRoute) => void;
  navigation?: Parameters<typeof safeNavigate>[0];
  /** Saved copies retain their original dates and never restore a live data grant. */
  historical?: boolean;
  /** Live actions come from the current session, never from a saved plan's evidence. */
  renderAssignmentAction?: (assignment: CampusAssignmentIdentity & NuniPlanActivityIdentity) => React.ReactNode;
  progress?: {
    completedStepIds: string[];
    onToggleStep: (stepId: string, done: boolean) => void;
  };
  reminderContext?: {
    userId: string;
    schoolId: string;
    snapshot: CampusSenseSnapshot | null;
    isCurrent: () => boolean;
  };
}) {
  const [showAllLimitations, setShowAllLimitations] = useState(false);
  const assignmentAction = (assignment: CampusAssignmentIdentity & NuniPlanActivityIdentity) => {
    if (historical) return null;
    if (renderAssignmentAction) return renderAssignmentAction(assignment);
    if (assignment.kind === 'quiz') return null;
    return reminderContext && navigation ? (
      <CampusAssignmentOpenButton
        assignment={assignment}
        context={reminderContext}
        navigation={navigation}
        disabled={disabled}
      />
    ) : null;
  };
  return (
    <View style={{ gap: 12, marginTop: 14 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ color: aiTokens.text, fontSize: 17, fontWeight: '700' }}>
          {plan.title}
        </Text>
        <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 19 }}>
          {progress ? plan.agenda?.quizzesAvailable !== undefined
            ? '勾選只記錄你自己的處理進度。作業繳交與測驗作答紀錄，請到課程頁核對。'
            : '勾選只記錄你自己的處理進度。作業是否繳交，請到課程頁核對。'
            : '開啟對應服務確認內容，再決定要處理的事。'}
        </Text>
      </View>
      {plan.steps.map((step, index) => {
        const priorityColor = historical ? aiTokens.muted : step.priority === 'overdue' || step.priority === 'urgent'
          ? aiTokens.danger : step.priority === 'soon' ? aiTokens.warning : aiTokens.muted;
        const done = progress?.completedStepIds.includes(step.id) ?? false;
        return (
          <View key={step.id} style={{
            backgroundColor: aiTokens.panel,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: aiTokens.border,
            paddingVertical: 14,
            paddingHorizontal: 14,
            gap: 8,
          }}>
            <View style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-start' }}>
              <Text style={{
                color: aiTokens.ai, fontWeight: '700', fontSize: 14,
                minWidth: 24, marginTop: 1,
              }}>
                {index + 1}.
              </Text>
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={{ color: aiTokens.text, fontSize: 15, fontWeight: '700' }}>
                  {step.title}
                </Text>
                <Text style={{ color: priorityColor, fontSize: 12, fontWeight: '600' }}>
                  {historical ? '規劃當時：' : ''}{PRIORITY[step.priority]}{step.kind === 'quiz' ? ' · 測驗參考期限' : ''}
                </Text>
              </View>
            </View>
            <Text style={{ color: aiTokens.text, lineHeight: 23, fontSize: 13 }}>
              {step.detail}
            </Text>
            <Text style={{ color: aiTokens.muted, fontSize: 12 }}>
              依據：{EVIDENCE_LABEL[step.evidence]}
            </Text>
            {step.evidence === 'authorized-assignments' || step.evidence === 'authorized-quizzes' ? assignmentAction(step) : null}
            {onOpenRoute ? (
              <AIButton
                label={'開啟' + ROUTE_LABEL[step.route] + '核對'}
                variant="ghost"
                size="sm"
                disabled={disabled}
                onPress={() => onOpenRoute(step.route)}
              />
            ) : null}
            {!historical && reminderContext && step.kind !== 'quiz' ? (
              <CampusAssignmentReminderAction
                key={step.id + ':' + step.dueAt}
                step={step}
                snapshot={reminderContext.snapshot}
                userId={reminderContext.userId}
                schoolId={reminderContext.schoolId}
                isCurrent={reminderContext.isCurrent}
                disabled={disabled}
              />
            ) : null}
            {progress ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={'我已處理：' + step.title}
                accessibilityState={{ checked: done, disabled }}
                aria-checked={done}
                disabled={disabled}
                onPress={() => progress.onToggleStep(step.id, !done)}
                style={{ minHeight: 44, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <View style={{ width: 22, height: 22, borderWidth: 1, borderRadius: 6,
                  borderColor: done ? aiTokens.success : aiTokens.muted,
                  backgroundColor: done ? aiTokens.successSoft : aiTokens.surface,
                  alignItems: 'center', justifyContent: 'center' }}>
                  {done ? <Text style={{ color: aiTokens.success, fontWeight: '700' }}>✓</Text> : null}
                </View>
                <Text style={{ color: done ? aiTokens.success : aiTokens.textSecondary, fontSize: 14 }}>
                  {done ? '我已處理' : '標記為我已處理'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      {plan.agenda ? (
        <CampusStudyAgendaCard
          key={plan.checkedAt + ':' + plan.title}
          agenda={plan.agenda}
          disabled={disabled}
          onOpenRoute={onOpenRoute}
          renderAssignmentAction={assignmentAction}
        />
      ) : null}
      {plan.limitations.length ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
            資料限制：{(showAllLimitations ? plan.limitations : plan.limitations.slice(0, 3)).join(' ')}
          </Text>
          {plan.limitations.length > 3 ? (
            <Pressable accessibilityRole="button"
              accessibilityLabel={showAllLimitations ? '收起資料限制' : `查看全部 ${plan.limitations.length} 項資料限制`}
              accessibilityState={{ expanded: showAllLimitations, disabled }} aria-expanded={showAllLimitations}
              disabled={disabled} onPress={() => setShowAllLimitations((value) => !value)}
              style={{ minHeight: 44, padding: 10, borderWidth: 1, borderColor: aiTokens.border, borderRadius: 10,
                justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}>
              <Text style={{ color: aiTokens.textSecondary, fontSize: 13, lineHeight: 20 }}>
                {showAllLimitations ? '收起資料限制' : `查看全部 ${plan.limitations.length} 項資料限制`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
