import React from 'react';
import { Text, View } from 'react-native';
import { AICard, aiTokens } from '../ui/aiFirst';
import { assignmentDeadlineLabel } from '../services/campusAssignmentQuery';
import {
  buildCampusAttentionFeed, type CampusAttentionPriority,
} from '../services/campusAttentionFeed';
import type { CampusSenseSnapshot } from '../services/campusSenseSnapshot';
import { CampusAssignmentOpenButton } from './CampusAssignmentOpenButton';
import { CampusAssignmentReminderAction } from './CampusAssignmentReminderAction';
import { parseCampusAssignmentSource } from '../services/campusAssignmentSource';
import type { CampusPlanPriority, CampusPlanStep } from '../services/offlineCampusPlanner';
import type { CampusAssignmentWorkbenchContext } from './CampusAssignmentWorkbench';

const PLAN_PRIORITY: Record<CampusAttentionPriority, CampusPlanPriority> = {
  'due-soon': 'urgent',
  'past-due': 'overdue',
  'this-week': 'soon',
  'unknown-date': 'verify',
  later: 'normal',
};

/** Never schedule a reminder from a date-only string or model-authored text. */
function verifiedReminderStep(item: {
  key: string;
  assignment: CampusSenseSnapshot['assignments']['items'][number];
  priority: CampusAttentionPriority;
}): CampusPlanStep | null {
  const dueAt = item.assignment.dueAt;
  if ((item.priority !== 'due-soon' && item.priority !== 'this-week') ||
      !dueAt || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(dueAt) ||
      !parseCampusAssignmentSource(item.assignment.source)) return null;
  return {
    id: 'attention-' + item.key,
    title: item.assignment.title.replace(/\s+/g, ' ').trim().slice(0, 130),
    detail: '依已授權作業的截止時間設定手機提醒。',
    priority: PLAN_PRIORITY[item.priority],
    evidence: 'authorized-assignments',
    route: '/classroom',
    dueAt,
    groupName: item.assignment.groupName,
  };
}

const PRIORITY_LABEL: Record<CampusAttentionPriority, string> = {
  'due-soon': '24 小時內截止',
  'past-due': '期限已過，請核對',
  'this-week': '七天內截止',
  'unknown-date': '截止日期未提供',
  later: '較後的期限',
};

export function CampusAttentionCard({ snapshot, context, disabled }: {
  snapshot: CampusSenseSnapshot | null;
  context: CampusAssignmentWorkbenchContext;
  disabled: boolean;
}) {
  const now = Date.now();
  const feed = buildCampusAttentionFeed({
    snapshot,
    scope: { uid: context.userId, schoolId: context.schoolId },
    now,
  });
  if (!feed?.items.length || !context.isCurrent()) return null;

  const synced = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(feed.checkedAt));

  const reminderContext = {
    userId: context.userId,
    schoolId: context.schoolId,
    snapshot,
    isCurrent: context.isCurrent,
  };

  return (
    <AICard title="先確認這幾件事">
      <View style={{ gap: 11 }}>
        <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 19 }}>
          依 {synced} 已同步的授權作業整理。僅顯示可能需要注意的期限，不代表所有學校系統都已接通或作業尚未繳交。
        </Text>
        {feed.items.map((item) => (
          <View
            key={item.key}
            style={{
              backgroundColor: aiTokens.panel,
              borderColor: aiTokens.border,
              borderWidth: 1,
              borderRadius: 12,
              padding: 13,
              gap: 6,
            }}
          >
            <Text style={{
              color: item.priority === 'due-soon' || item.priority === 'past-due'
                ? aiTokens.warning : aiTokens.muted,
              fontSize: 12, fontWeight: '600',
            }}>
              {PRIORITY_LABEL[item.priority]}
            </Text>
            <Text numberOfLines={2} style={{ color: aiTokens.text, fontWeight: '700', fontSize: 15, lineHeight: 22 }}>
              {item.assignment.title}
            </Text>
            <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 19 }}>
              {item.assignment.groupName || '課程名稱未提供'} · {assignmentDeadlineLabel(item.assignment, now)}
            </Text>
            {context.navigation ? (
              <CampusAssignmentOpenButton
                assignment={item.assignment}
                context={reminderContext}
                navigation={context.navigation}
                disabled={disabled}
              />
            ) : null}
            {verifiedReminderStep(item) ? (
              <CampusAssignmentReminderAction
                step={verifiedReminderStep(item)!}
                snapshot={snapshot}
                userId={context.userId}
                schoolId={context.schoolId}
                isCurrent={context.isCurrent}
                disabled={disabled}
              />
            ) : null}
          </View>
        ))}
        {feed.remainingVisible > 0 ? (
          <Text style={{ color: aiTokens.muted, fontSize: 12 }}>
            還有 {feed.remainingVisible} 筆已同步作業，可在下方作業工作台查看完整清單。
          </Text>
        ) : null}
        {feed.incomplete ? (
          <Text accessibilityRole="alert" style={{ color: aiTokens.warning, fontSize: 12, lineHeight: 19 }}>
            {feed.missingFromSource > 0
              ? '另有 ' + feed.missingFromSource + ' 筆尚未同步，這裡的排序並不完整。'
              : '目前僅取得部分來源，這裡的排序並不完整。'}
          </Text>
        ) : null}
      </View>
    </AICard>
  );
}
