import React from 'react';
import { Text, View } from 'react-native';
import { AIButton, aiTokens } from '../ui/aiFirst';
import type { CampusEvidencePlan, CampusPlanPriority, CampusPlanRoute } from '../services/offlineCampusPlanner';
import type { CampusSenseSnapshot } from '../services/campusSenseSnapshot';
import { CampusAssignmentReminderAction } from './CampusAssignmentReminderAction';

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
  'saved-timetable': '手機儲存課表',
  'authorized-announcements': '已授權公告摘要',
  verification: '人工核對建議',
};

export function CampusEvidencePlanCard({
  plan,
  disabled,
  onOpenRoute,
  reminderContext,
}: {
  plan: CampusEvidencePlan;
  disabled: boolean;
  onOpenRoute?: (route: CampusPlanRoute) => void;
  reminderContext?: {
    userId: string;
    schoolId: string;
    snapshot: CampusSenseSnapshot | null;
    isCurrent: () => boolean;
  };
}) {
  return (
    <View style={{ gap: 12, marginTop: 14 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ color: aiTokens.text, fontSize: 17, fontWeight: '700' }}>
          {plan.title}
        </Text>
        <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 19 }}>
          所有步驟都需要本人核對，不會自動提交、修改校園資料或建立行事曆。
        </Text>
      </View>
      {plan.steps.map((step, index) => {
        const priorityColor = step.priority === 'overdue' || step.priority === 'urgent'
          ? aiTokens.danger : step.priority === 'soon' ? aiTokens.warning : aiTokens.muted;
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
                  {PRIORITY[step.priority]}
                </Text>
              </View>
            </View>
            <Text style={{ color: aiTokens.text, lineHeight: 23, fontSize: 13 }}>
              {step.detail}
            </Text>
            <Text style={{ color: aiTokens.muted, fontSize: 12 }}>
              依據：{EVIDENCE_LABEL[step.evidence]}
            </Text>
            {onOpenRoute ? (
              <AIButton
                label={'開啟' + ROUTE_LABEL[step.route] + '核對'}
                variant="ghost"
                size="sm"
                disabled={disabled}
                onPress={() => onOpenRoute(step.route)}
              />
            ) : null}
            {reminderContext ? (
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
          </View>
        );
      })}
      {plan.limitations.length ? (
        <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
          資料限制：{plan.limitations.slice(0, 3).join(' ')}
        </Text>
      ) : null}
    </View>
  );
}
