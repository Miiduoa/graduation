import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { formatTaipeiDateTime, parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import type { CourseworkChoice, CourseworkRead } from '../features/nuniCourseworkFollowUp';
import { AIButton, aiTokens } from '../ui/aiFirst';

export function NuniCourseworkReply({ read, busy, latest, onSelect, onOpen, onRetry, onLink, onCheckClass }: {
  read: CourseworkRead;
  busy: boolean;
  latest: boolean;
  onSelect: (choice: CourseworkChoice, label: string) => void;
  onOpen: (workspaceId: string, assignmentId: string) => void;
  onRetry: () => void;
  onLink: () => void;
  onCheckClass: () => void;
}) {
  const [visibleCount, setVisibleCount] = useState(5);
  const { result, anchor } = read;
  const secondary = { color: aiTokens.textSecondary, fontSize: 14 };
  const body = { color: aiTokens.text, fontSize: 16, lineHeight: 24 };
  if (result.kind === 'choose-class') return (
    <View style={{ gap: 8 }}>
      <Text style={body}>這個時段有多堂課，想查哪一堂的作業？</Text>
      {anchor.classes.map((item, classIndex) => {
        const label = `${item.name} · ${item.startTime}–${item.endTime} · ${item.room || '教室未填'}`;
        return <AIButton key={JSON.stringify([item.courseId, item.date, item.startTime])} label={label} variant="ghost"
          disabled={busy || !latest} onPress={() => onSelect({ classIndex }, label)} />;
      })}
    </View>
  );
  const name = anchor.classes[0].name;
  if (result.kind === 'choose') {
    const choices = result.workspaces.map((course) => {
      const info = course.reviewed;
      const term = info?.semester === 'summer' ? '暑期' : info?.semester ? `第${info.semester}學期` : '';
      const detail = info ? [info.academicYear && `${info.academicYear}學年度`, term, info.className, info.teacher, info.courseCode]
        .filter(Boolean).join(' · ') : '';
      const section = info && [info.className, info.teacher].filter(Boolean).join(' · ');
      const caption = info && [info.academicYear && `${info.academicYear}學年度`, term, info.courseCode].filter(Boolean).join(' · ');
      return { ...course, detail, section, caption };
    });
    return (
      <View style={{ gap: 8 }}>
        <Text style={body}>「{name}」還沒有連結 nuni 課程。請確認這次要查的課程。</Text>
        {choices.map((course) => {
          const suffix = course.id.slice(-8);
          const needsId = choices.length > 1 && (!course.detail || choices.some((other) =>
            other.id !== course.id && other.detail === course.detail && other.title === course.title));
          const uniqueSuffix = !choices.some((other) => other.id !== course.id && other.id.endsWith(suffix));
          const code = needsId && (uniqueSuffix ? suffix : course.id);
          const unknown = !course.reviewed && choices.length > 1 && '學期與班別未核對';
          const label = [course.title, course.detail || unknown, code].filter(Boolean).join(' · ');
          const caption = [course.caption || unknown, code].filter(Boolean).join(' · ');
          return (
            <Pressable key={course.id} accessibilityRole="button" accessibilityLabel={label}
              accessibilityState={{ disabled: busy || !latest }} disabled={busy || !latest}
              onPress={() => onSelect({ workspaceId: course.id }, label)}
              style={({ pressed }) => ({ minHeight: 48, padding: 12, gap: 4, justifyContent: 'center',
                borderRadius: 10, borderWidth: 1, borderColor: aiTokens.border, backgroundColor: pressed ? aiTokens.aiSoft : aiTokens.panel })}>
              <Text style={{ color: aiTokens.text, fontSize: 16, fontWeight: '700' }}>{course.section || course.title}</Text>
              {!!caption && <Text style={secondary}>{caption}</Text>}
            </Pressable>
          );
        })}
        <AIButton label="前往匯入資料核對連結" variant="ghost" disabled={busy} onPress={onLink} />
      </View>
    );
  }
  if (result.kind !== 'assignments') return (
    <View style={{ gap: 8 }}>
      <Text style={body}>{result.kind === 'unlinked' ? `「${name}」目前找不到可核對的 nuni 課程。可以到匯入資料選擇對應課程。`
        : result.kind === 'changed' ? '剛才選的課堂或課程連結已變更，請重新查課並核對。'
        : `暫時無法取得「${name}」的 nuni 作業，請稍後再試。`}</Text>
      {result.kind === 'unlinked' && <AIButton label="前往匯入資料核對連結" variant="ghost" disabled={busy} onPress={onLink} />}
      {result.kind === 'changed' && latest && <AIButton label={anchor.currentAt ? '重新查現在的課' : '重新查下一堂課'} variant="ghost" disabled={busy} onPress={onCheckClass} />}
      {result.kind === 'unavailable' && latest && <AIButton label="重新查詢課堂作業" variant="ghost" disabled={busy} onPress={onRetry} />}
    </View>
  );
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: aiTokens.text, fontSize: 18, fontWeight: '700' }}>{result.workspace.title}</Text>
      <Text style={secondary}>nuni 課程作業{read.checkedAt ? ` · ${formatTaipeiDateTime(read.checkedAt, { seconds: false })} 查詢（台灣時間）` : ''}</Text>
      {!result.assignments.length && <Text style={body}>這門課目前沒有已發布的 nuni 作業。</Text>}
      {result.assignments.slice(0, visibleCount).map((item) => {
        const deadline = item.dueAt ? parseTaipeiInstant(item.dueAt) : null;
        const overdue = deadline !== null && !!read.checkedAt && deadline < Date.parse(read.checkedAt);
        const status = item.submittedAt ? '已繳交' : item.state === 'closed' ? '已停止收件 · 未繳交'
          : overdue ? '已逾期 · 未繳交' : '待繳交';
        const due = item.dueAt ? `截止 ${formatTaipeiDateTime(item.dueAt, { seconds: false })}` : '未設定截止時間';
        return (
          <Pressable key={item.id} accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }}
            accessibilityLabel={`查看作業：${item.title}，${status}，${due}`}
            onPress={() => onOpen(result.workspace.id, item.id)}
            style={({ pressed }) => ({ gap: 5, minHeight: 52, padding: 14, borderRadius: 12, borderWidth: 1,
              borderColor: aiTokens.border, backgroundColor: pressed ? aiTokens.aiSoft : aiTokens.panel })}>
            <Text style={{ color: overdue && !item.submittedAt && item.state === 'open' ? aiTokens.danger : aiTokens.aiStrong,
              fontSize: 14, fontWeight: '600' }}>{status}</Text>
            <Text style={{ color: aiTokens.text, fontSize: 17, fontWeight: '700' }}>{item.title}</Text>
            <Text style={secondary}>{due}</Text>
            <Text style={{ color: aiTokens.aiStrong, fontSize: 14 }}>查看作業 ›</Text>
          </Pressable>
        );
      })}
      {visibleCount < result.assignments.length && <AIButton label="顯示更多作業" variant="ghost" disabled={busy}
        onPress={() => setVisibleCount((count) => count + 5)} />}
      {result.limited && <Text style={secondary}>已達平台單次查詢上限，這裡顯示本次取得的作業。</Text>}
    </View>
  );
}
