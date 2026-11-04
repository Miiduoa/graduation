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

export function AssignmentReplyActions({ read, snapshot, context, disabled, onSelect }: {
  read: AssignmentRead;
  snapshot: CampusSenseSnapshot;
  context: CampusAssignmentWorkbenchContext;
  disabled: boolean;
  onSelect: (index: number) => void;
}) {
  if (read.checkedAt !== snapshot.checkedAt || read.userId !== context.userId || read.schoolId !== context.schoolId ||
      !read.items.length) return null;
  if (read.items.length > 1) return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
      {read.items.map((item, index) => (
        <AIButton key={index} label={'第 ' + (index + 1) + ' 筆' + (read.reviewReminder ? ' · ' + (item.groupName || item.title) : '')} variant="ghost" disabled={disabled}
          onPress={() => onSelect(index)} />
      ))}
    </View>
  );
  const item = read.items[0];
  if (!resolveCampusAssignmentTarget({ assignment: item, snapshot, scope: { uid: context.userId, schoolId: context.schoolId } })) return null;
  return (
    <View style={{ gap: 8, marginTop: 10 }}>
      <CampusAssignmentOpenButton assignment={item} context={{ ...context, snapshot }} navigation={context.navigation} disabled={disabled} />
      {item.dueAt && Number.isFinite(confirmedTimestamp(item.dueAt)) && (
        <CampusAssignmentReminderAction step={{ title: campusAssignmentDisplayTitle(item.title), groupName: item.groupName, dueAt: item.dueAt,
          evidence: 'authorized-assignments', route: '/classroom' }}
          reviewOnOpen={read.reviewReminder} snapshot={snapshot} userId={context.userId} schoolId={context.schoolId}
          isCurrent={context.isCurrent} disabled={disabled} />
      )}
    </View>
  );
}
