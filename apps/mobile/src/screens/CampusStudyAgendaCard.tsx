import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { AIButton, aiTokens } from '../ui/aiFirst';
import { periodLabel, scheduledClassTimeLabel, type CampusStudyAgenda } from '../services/campusStudyAgenda';
import { inspectCampusClockAvailability } from '../services/campusClockAvailability';
import type { CampusAssignmentIdentity } from '../services/campusAssignmentTarget';
import type { NuniPlanActivityIdentity } from '../services/nuniPlanAssignmentTarget';

const OUTSIDE_LABEL = {
  undated: '截止時間未確認',
  'before-window': '截止日在本次規劃之前，請核對狀態',
  'after-window': '截止日在本次規劃之後',
};

export function CampusStudyAgendaCard({ agenda, disabled, onOpenRoute, renderAssignmentAction }: {
  agenda: CampusStudyAgenda;
  disabled: boolean;
  onOpenRoute?: (route: '/classroom' | '/timetable') => void;
  renderAssignmentAction?: (assignment: CampusAssignmentIdentity & NuniPlanActivityIdentity) => React.ReactNode;
}) {
  const [openDates, setOpenDates] = useState<Set<string>>(() => new Set(
    agenda.days.slice(0, 1).map((day) => day.date),
  ));
  const [showOutside, setShowOutside] = useState(false);
  const hasScheduledClasses = agenda.days.some((day) => day.scheduledClasses !== undefined);
  const includesQuizzes = agenda.quizzesAvailable !== undefined;
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
        {hasScheduledClasses
          ? '台灣時間。課程、課間時段與重疊依手機保存的課表整理；尚未排除私人行程或通勤，也不代表校方即時狀態。'
          : '台灣時間。課程僅來自手機副本；空堂是節次差集，不代表此刻可用，也未排除私人行程。'}
        {includesQuizzes ? '作業與測驗僅限已同步來源；測驗參考期限不是開考時間。' : '作業僅限已同步來源。'}
      </Text>
      {agenda.days.map((day) => {
        const expanded = openDates.has(day.date);
        const scheduled = day.scheduledClasses;
        const clockFormat = scheduled !== undefined;
        const availability = clockFormat ? inspectCampusClockAvailability(
          agenda.timetableAvailable && agenda.ignoredCourses === 0 ? scheduled : null, day.date,
        ) : undefined;
        const classLabel = !agenda.timetableAvailable ? '課表未知'
          : clockFormat ? scheduled.length + ' 堂課' : day.courses.length + ' 門課';
        const hasConflicts = clockFormat ? Boolean(availability?.valid && availability.conflicts.length)
          : day.conflicts.length > 0;
        const quizzes = day.deadlines.filter((task) => task.kind === 'quiz').length;
        const dueLabel = includesQuizzes
          ? (agenda.assignmentsAvailable ? (day.deadlines.length - quizzes) + ' 項作業' : '作業未知') + ' · ' +
            (agenda.quizzesAvailable ? quizzes + ' 項測驗' : '測驗未知')
          : agenda.assignmentsAvailable ? day.deadlines.length + ' 項截止' : '作業未知';
        return (
          <View key={day.date} style={{ borderWidth: 1, borderColor: aiTokens.border, borderRadius: 12, overflow: 'hidden' }}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={day.label + '逐日安排'}
              accessibilityState={{ expanded, disabled }}
              aria-expanded={expanded}
              disabled={disabled}
              onPress={() => toggle(day.date)}
              style={{ minHeight: 52, padding: 13, backgroundColor: aiTokens.panel, gap: 5 }}
            >
              <Text style={{ color: aiTokens.text, fontWeight: '700', fontSize: 14 }}>
                {day.label} {expanded ? '−' : '+'}
              </Text>
              <Text style={{ color: hasConflicts ? aiTokens.warning : aiTokens.muted, fontSize: 12 }}>
                {classLabel} · {dueLabel}{hasConflicts ? ' · 有課表重疊' : ''}
              </Text>
            </TouchableOpacity>
            {expanded ? (
              <View style={{ padding: 13, gap: 10 }}>
                {hasConflicts ? (
                  <Text accessibilityRole="alert" style={{ color: aiTokens.warning, lineHeight: 21, fontSize: 13 }}>
                    課表重疊：{availability?.valid
                      ? availability.conflicts.map((interval) => scheduledClassTimeLabel(interval, day.date)).join('、')
                      : day.conflicts.map(periodLabel).join('、')}。請先核對正式課表，不能當作可安排的空堂。
                  </Text>
                ) : null}
                {!agenda.timetableAvailable ? (
                  <Text style={{ color: aiTokens.muted, fontSize: 13 }}>課表來源不可用，無法判定這天是否有課。</Text>
                ) : clockFormat && scheduled.length ? scheduled.map((course, index) => (
                  <Text key={index} style={{ color: aiTokens.text, fontSize: 13, lineHeight: 22 }}>
                    {scheduledClassTimeLabel(course, day.date)}｜{course.name}{course.room ? ' · ' + course.room : ''}
                  </Text>
                )) : !clockFormat && day.courses.length ? day.courses.map((course, index) => (
                  <Text key={index} style={{ color: aiTokens.text, fontSize: 13, lineHeight: 22 }}>
                    {periodLabel(course)}｜{course.name}{course.room ? ' · ' + course.room : ''}
                  </Text>
                )) : (
                  <Text style={{ color: aiTokens.muted, fontSize: 13, lineHeight: 21 }}>課表副本未排課，並非已確認整天有空。</Text>
                )}
                {availability && agenda.timetableAvailable ? !availability.valid ? (
                  <Text accessibilityRole="alert" style={{ color: aiTokens.warning, fontSize: 13, lineHeight: 21 }}>
                    鐘點課表無法完整核對，暫不推算課間時段或重疊。
                  </Text>
                ) : availability.gaps.length ? (
                  <View style={{ gap: 6 }}>
                    <Text style={{ color: aiTokens.text, fontSize: 13, fontWeight: '600', lineHeight: 21 }}>
                      課間時段（依保存課表）
                    </Text>
                    {availability.gaps.map((interval) => (
                      <Text key={interval.startAt + ':' + interval.endAt} style={{ color: aiTokens.text, fontSize: 13, lineHeight: 21 }}>
                        {scheduledClassTimeLabel(interval, day.date)}
                      </Text>
                    ))}
                    <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
                      尚未排除私人行程、通勤或課表更新，安排前請自行核對。
                    </Text>
                  </View>
                ) : scheduled?.length ? (
                  <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
                    已保存課程之間沒有可列出的課間時段。
                  </Text>
                ) : null : null}
                {!clockFormat && day.gaps.length ? (
                  <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
                    副本課間空堂：{day.gaps.map(periodLabel).join('、')}。尚未換算鐘點，請自行確認是否適合安排複習。
                  </Text>
                ) : null}
                {!agenda.assignmentsAvailable ? (
                  <Text style={{ color: aiTokens.muted, fontSize: 13 }}>作業來源不可用，不能判定是否已全部完成。</Text>
                ) : null}
                {agenda.quizzesAvailable === false ? (
                  <Text style={{ color: aiTokens.muted, fontSize: 13 }}>測驗來源不可用，不能判定是否已全部作答。</Text>
                ) : null}
                {day.deadlines.length ? day.deadlines.map((task, index) => (
                  <View key={index} style={{ borderTopWidth: 1, borderTopColor: aiTokens.border, paddingTop: 10, gap: 4 }}>
                    <Text style={{ color: aiTokens.text, fontSize: 14, fontWeight: '600' }}>{task.title}</Text>
                    <Text style={{ color: task.overdue ? aiTokens.danger : aiTokens.muted, fontSize: 12, lineHeight: 19 }}>
                      {task.kind === 'quiz' ? '測驗參考期限 ' : ''}{task.timeLabel}{task.kind === 'quiz' ? '' : ' 截止'}
                      {task.groupName ? ' · ' + task.groupName : ''}
                      {task.overdue ? task.kind === 'quiz' ? ' · 期限已過，需核對作答狀態' : ' · 期限已過，需核對繳交狀態' : ''}
                    </Text>
                    {renderAssignmentAction?.(task)}
                  </View>
                )) : agenda.assignmentsAvailable || agenda.quizzesAvailable ? (
                  <Text style={{ color: aiTokens.muted, fontSize: 12 }}>
                    {includesQuizzes ? '已取得的來源未列出當日期限的課業；未取得的來源仍需核對。' : '已同步摘要未列出當日截止作業。'}
                  </Text>
                ) : null}
                {onOpenRoute ? (
                  <AIButton label={day.deadlines.length ? includesQuizzes ? '核對當日課業' : '核對當日作業' : '核對個人課表'}
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
          <AIButton label={(showOutside ? '收起' : '查看') + '其他 ' + agenda.outsideWindow.length + (includesQuizzes ? ' 項課業' : ' 項作業')}
            variant="ghost" size="sm" disabled={disabled} onPress={() => setShowOutside((value) => !value)} />
          {showOutside ? agenda.outsideWindow.map((task, index) => (
            <View key={index} style={{ gap: 3, paddingHorizontal: 8 }}>
              <Text style={{ color: aiTokens.text, fontSize: 13 }}>{task.title}</Text>
              <Text style={{ color: aiTokens.muted, fontSize: 12 }}>
                {task.kind === 'quiz' ? '測驗 · ' + OUTSIDE_LABEL[task.reason].replace('截止時間', '參考期限').replace('截止日', '參考期限') : OUTSIDE_LABEL[task.reason]}
              </Text>
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
