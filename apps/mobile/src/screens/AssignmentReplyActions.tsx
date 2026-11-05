import React from 'react';
import { View } from 'react-native';
import { confirmedTimestamp } from '../services/campusStudyAgenda';
import { AIButton } from '../ui/aiFirst';
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
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {items.map((item, index) => {
            const ordinal = '第 ' + (index + 1) + ' 筆';
            return (
              <AIButton key={index} variant="ghost" disabled={disabled}
                label={(page ? '本頁' : '') + ordinal + (read.reviewReminder ? ' · ' + (item.groupName || item.title) : '')}
                onPress={() => onAsk(ordinal)} />
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
