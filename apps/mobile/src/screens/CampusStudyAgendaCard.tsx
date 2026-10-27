import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { AIButton, aiTokens } from '../ui/aiFirst';
import { periodLabel, type CampusStudyAgenda } from '../services/campusStudyAgenda';
import type { CampusAssignmentIdentity } from '../services/campusAssignmentTarget';

const OUTSIDE_LABEL = {
  undated: '截止時間未確認',
  'before-window': '截止日在本次規劃之前，請核對狀態',
  'after-window': '截止日在本次規劃之後',
};

export function CampusStudyAgendaCard({ agenda, disabled, onOpenRoute, renderAssignmentAction }: {
  agenda: CampusStudyAgenda;
  disabled: boolean;
  onOpenRoute?: (route: '/classroom' | '/timetable') => void;
  renderAssignmentAction?: (assignment: CampusAssignmentIdentity) => React.ReactNode;
}) {
  const [openDates, setOpenDates] = useState<Set<string>>(() => new Set(
    agenda.days.slice(0, 1).map((day) => day.date),
  ));
  const [showOutside, setShowOutside] = useState(false);
  const toggle = (date: string) => setOpenDates((previous) => {
    const next = new Set(previous);
    if (next.has(date)) next.delete(date); else next.add(date);
    return next;
  });
  return (
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ color: aiTokens.text, fontSize: 16, fontWeight: '700' }}>
        逐日安排
      </Text>
      <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
        台灣時間。課程僅來自手機副本；空堂是節次差集，不代表此刻可用，也未排除私人行程。作業僅限已同步來源。
      </Text>
      {agenda.days.map((day) => {
        const expanded = openDates.has(day.date);
        const classLabel = agenda.timetableAvailable ? day.courses.length + ' 門課' : '課表未知';
        const dueLabel = agenda.assignmentsAvailable ? day.deadlines.length + ' 項截止' : '作業未知';
        return (
          <View key={day.date} style={{ borderWidth: 1, borderColor: aiTokens.border, borderRadius: 12, overflow: 'hidden' }}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={day.label + '逐日安排'}
              accessibilityState={{ expanded, disabled }}
              disabled={disabled}
              onPress={() => toggle(day.date)}
              style={{ minHeight: 52, padding: 13, backgroundColor: aiTokens.panel, gap: 5 }}
            >
              <Text style={{ color: aiTokens.text, fontWeight: '700', fontSize: 14 }}>
                {day.label} {expanded ? '−' : '+'}
              </Text>
              <Text style={{ color: day.conflicts.length ? aiTokens.warning : aiTokens.muted, fontSize: 12 }}>
                {classLabel} · {dueLabel}{day.conflicts.length ? ' · 有課表重疊' : ''}
              </Text>
            </TouchableOpacity>
            {expanded ? (
              <View style={{ padding: 13, gap: 10 }}>
                {day.conflicts.length ? (
                  <Text accessibilityRole="alert" style={{ color: aiTokens.warning, lineHeight: 21, fontSize: 13 }}>
                    課表重疊：{day.conflicts.map(periodLabel).join('、')}。請先核對正式課表，不能當作可安排的空堂。
                  </Text>
                ) : null}
                {!agenda.timetableAvailable ? (
                  <Text style={{ color: aiTokens.muted, fontSize: 13 }}>課表來源不可用，無法判定這天是否有課。</Text>
                ) : day.courses.length ? day.courses.map((course, index) => (
                  <Text key={index} style={{ color: aiTokens.text, fontSize: 13, lineHeight: 22 }}>
                    {periodLabel(course)}｜{course.name}{course.room ? ' · ' + course.room : ''}
                  </Text>
                )) : (
                  <Text style={{ color: aiTokens.muted, fontSize: 13, lineHeight: 21 }}>課表副本未排課，並非已確認整天有空。</Text>
                )}
                {day.gaps.length ? (
                  <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
                    副本課間空堂：{day.gaps.map(periodLabel).join('、')}。尚未換算鐘點，請自行確認是否適合安排複習。
                  </Text>
                ) : null}
                {!agenda.assignmentsAvailable ? (
                  <Text style={{ color: aiTokens.muted, fontSize: 13 }}>作業來源不可用，不能判定是否已全部完成。</Text>
                ) : day.deadlines.length ? day.deadlines.map((task, index) => (
                  <View key={index} style={{ borderTopWidth: 1, borderTopColor: aiTokens.border, paddingTop: 10, gap: 4 }}>
                    <Text style={{ color: aiTokens.text, fontSize: 14, fontWeight: '600' }}>{task.title}</Text>
                    <Text style={{ color: task.overdue ? aiTokens.danger : aiTokens.muted, fontSize: 12, lineHeight: 19 }}>
                      {task.timeLabel} 截止{task.groupName ? ' · ' + task.groupName : ''}{task.overdue ? ' · 期限已過，需核對繳交狀態' : ''}
                    </Text>
                    {renderAssignmentAction?.(task)}
                  </View>
                )) : (
                  <Text style={{ color: aiTokens.muted, fontSize: 12 }}>已同步摘要未列出當日截止作業。</Text>
                )}
                {onOpenRoute ? (
                  <AIButton label={day.deadlines.length ? '核對當日作業' : '核對個人課表'}
                    size="sm" variant="ghost" disabled={disabled}
                    onPress={() => onOpenRoute(day.deadlines.length ? '/classroom' : '/timetable')} />
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
      {agenda.outsideWindow.length ? (
        <View style={{ gap: 9 }}>
          <AIButton label={(showOutside ? '收起' : '查看') + '其他 ' + agenda.outsideWindow.length + ' 項作業'}
            variant="ghost" size="sm" disabled={disabled} onPress={() => setShowOutside((value) => !value)} />
          {showOutside ? agenda.outsideWindow.map((task, index) => (
            <View key={index} style={{ gap: 3, paddingHorizontal: 8 }}>
              <Text style={{ color: aiTokens.text, fontSize: 13 }}>{task.title}</Text>
              <Text style={{ color: aiTokens.muted, fontSize: 12 }}>{OUTSIDE_LABEL[task.reason]}</Text>
              {renderAssignmentAction?.(task)}
            </View>
          )) : null}
        </View>
      ) : null}
      {agenda.ignoredCourses ? (
        <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 19 }}>
          另有 {agenda.ignoredCourses} 筆未排時段或格式不完整的課程，未用來推算空堂。
        </Text>
      ) : null}
    </View>
  );
}
