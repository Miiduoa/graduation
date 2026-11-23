import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import { confirmedTimestamp } from '../services/campusStudyAgenda';
import { AIButton, aiTokens } from '../ui/aiFirst';
import type { AssignmentRead } from '../services/offlineCampusTools';
import type { CampusSenseSnapshot } from '../services/campusSenseSnapshot';
import { campusAssignmentDisplayTitle, resolveCampusAssignmentTarget } from '../services/campusAssignmentTarget';
import { CampusAssignmentOpenButton } from './CampusAssignmentOpenButton';
import { CampusAssignmentReminderAction } from './CampusAssignmentReminderAction';
import type { CampusAssignmentWorkbenchContext } from './CampusAssignmentWorkbench';

export function AssignmentReplyActions({ read, snapshot, context, disabled, onAsk }: {
  read: AssignmentRead;
  snapshot: CampusSenseSnapshot;
  context: CampusAssignmentWorkbenchContext;
  disabled: boolean;
  onAsk: (question: string) => void;
}) {
  if (read.checkedAt !== snapshot.checkedAt || read.userId !== context.userId || read.schoolId !== context.schoolId ||
      !read.items.length) return null;
  const { items, page } = read;
  const single = items.length === 1 && resolveCampusAssignmentTarget({
    assignment: items[0], snapshot, scope: { uid: context.userId, schoolId: context.schoolId },
  }) ? items[0] : null;
  if (items.length === 1 && !single && !page) return null;
  return (
    <View style={{ gap: 8, marginTop: 10 }}>
      {items.length > 1 && (
        <View style={{ gap: 6 }}>
          {items.map((item, index) => {
            const ordinal = '第 ' + (index + 1) + ' 筆';
            const position = (page ? '本頁' : '') + ordinal;
            const course = item.groupName || '未提供課程名稱';
            const title = campusAssignmentDisplayTitle(item.title);
            const due = confirmedTimestamp(item.dueAt);
            const deadline = Number.isFinite(due)
              ? '截止 ' + formatTaipeiDateTime(due, { seconds: false }) : '未提供截止時間';
            return (
              <TouchableOpacity
                key={index}
                accessibilityRole="button"
                accessibilityLabel={`選擇${position}，${course}，${title}`}
                accessibilityValue={{ text: deadline }}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => onAsk(ordinal)}
                style={{
                  minHeight: 44, justifyContent: 'center', gap: 3, paddingVertical: 8, paddingHorizontal: 12,
                  borderWidth: 1, borderRadius: aiTokens.radius.sm, borderColor: aiTokens.border,
                  backgroundColor: aiTokens.surface, opacity: disabled ? 0.5 : 1,
                }}
              >
                <Text style={{ color: aiTokens.textSecondary, fontSize: 13 }}>{position} · {course}</Text>
                <Text style={{ color: aiTokens.text, fontSize: 15, fontWeight: '600' }}>{title}</Text>
                <Text style={{ color: aiTokens.muted, fontSize: 13 }}>{deadline}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {single && (
        <>
          <CampusAssignmentOpenButton assignment={single} context={{ ...context, snapshot }} navigation={context.navigation} disabled={disabled} />
          {single.dueAt && Number.isFinite(confirmedTimestamp(single.dueAt)) && (
            <CampusAssignmentReminderAction step={{ title: campusAssignmentDisplayTitle(single.title), groupName: single.groupName,
              dueAt: single.dueAt, evidence: 'authorized-assignments', route: '/classroom' }}
              reviewOnOpen={read.reviewReminder} snapshot={snapshot} userId={context.userId} schoolId={context.schoolId}
              isCurrent={context.isCurrent} disabled={disabled} />
          )}
        </>
      )}
      {page && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {page.offset > 0 && <AIButton label="上一頁作業" variant="ghost" disabled={disabled} onPress={() => onAsk('上一頁')} />}
          {page.offset + items.length < page.total && <AIButton label="下一頁作業" variant="ghost" disabled={disabled} onPress={() => onAsk('下一頁')} />}
        </View>
      )}
    </View>
  );
}
