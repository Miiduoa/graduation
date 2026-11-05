import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { formatTaipeiDateTime, parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import type { CourseworkChoice, CourseworkRead } from '../features/nuniCourseworkFollowUp';
import { AIButton, aiTokens } from '../ui/aiFirst';

export function courseworkReplyTitle(read: CourseworkRead) {
  if (read.view?.kind === 'priority') return '優先處理的作業';
  if (read.view?.kind === 'receipt' || read.view?.kind === 'choose-receipt') return '作業繳交紀錄';
  return '課堂作業';
}

export function NuniCourseworkReply({ read, busy, latest, onAsk, onSelect, onOpen, onRetry, onLink, onCheckClass }: {
  read: CourseworkRead;
  busy: boolean;
  latest: boolean;
  onAsk: (question: string) => void;
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
  const { view } = read;
  const choosing = view?.kind === 'choose-receipt';
  const outdated = !!read.changedAssignmentId;
  const assignmentsById = new Map(result.assignments.map((item) => [item.id, item]));
  const shown = view ? view.ids.map((id) => assignmentsById.get(id)).filter((item) => !!item) : result.assignments;
  const receiptId = view?.kind === 'receipt' && shown.length === 1 ? shown[0].id : undefined;
  const refreshId = receiptId ?? (outdated ? (read.openedAssignmentId ?? read.changedAssignmentId) : undefined);
  const refreshItem = refreshId && assignmentsById.get(refreshId);
  const refresh = latest && (
    <View style={{ gap: 8 }}>
      {refreshItem && <AIButton label="重新核對繳交紀錄" variant={outdated ? 'primary' : 'ghost'}
        disabled={busy} onPress={() => onSelect({ refreshAssignmentId: refreshItem.id }, '重新核對繳交紀錄')} />}
      {!receiptId && <AIButton label="重新查詢這堂課的作業" variant="ghost" disabled={busy} onPress={onRetry} />}
    </View>
  );
  const actionable = latest && !outdated;
  const comparisonTime = view?.rankedAt ?? read.checkedAt;
  const ranked = view?.rankedAt && formatTaipeiDateTime(view.rankedAt, { seconds: false });
  const sourceTime = read.checkedAt && formatTaipeiDateTime(read.checkedAt, { seconds: false });
  const canAsk = actionable && result.assignments.length > 0;
  const followUps = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {canAsk && !choosing && view?.kind !== 'priority' && <AIButton label="哪個最急？" variant="ghost"
        disabled={busy} onPress={() => onAsk('哪個最急？')} />}
      {canAsk && (!view || (view.kind === 'priority' && shown.length > 0)) && <AIButton label="我交了嗎？" variant="ghost"
        disabled={busy} onPress={() => onAsk('我交了嗎？')} />}
      {actionable && view && <AIButton label="回到這門課的作業" variant="ghost"
        disabled={busy} onPress={() => onAsk('回到這門課的作業')} />}
    </View>
  );
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: aiTokens.text, fontSize: 18, fontWeight: '700' }}>{result.workspace.title}</Text>
      <Text style={secondary}>nuni 課程作業{sourceTime ? ` · ${sourceTime} 查詢（台灣時間）` : ''}</Text>
      {ranked && ranked !== sourceTime && <Text style={secondary}>依 {ranked} 的時間排序（台灣時間）</Text>}
      {outdated && <Text accessibilityRole={latest ? 'alert' : undefined} style={{ color: aiTokens.danger, fontWeight: '600', lineHeight: 22 }}>
        作業已更新，這是上次查詢的紀錄。
      </Text>}
      {outdated && refresh}
      {view && !outdated && !receiptId && <Text style={body}>{view.message}</Text>}
      {result.limited && <Text style={secondary}>已達平台單次查詢上限，這裡顯示本次取得的作業。</Text>}
      {!view && canAsk && followUps}
      {!view && !result.assignments.length && <Text style={body}>這門課目前沒有已發布的 nuni 作業。</Text>}
      {!(outdated && choosing) && shown.slice(0, visibleCount).map((item, index) => {
        const deadline = item.dueAt ? parseTaipeiInstant(item.dueAt) : null;
        const overdue = deadline !== null && !!comparisonTime && deadline < Date.parse(comparisonTime);
        const status = item.submittedAt ? '已繳交' : item.state === 'closed' ? '已停止收件 · 未繳交'
          : overdue ? '已逾期 · 未繳交' : '待繳交';
        const due = item.dueAt ? `截止 ${formatTaipeiDateTime(item.dueAt, { seconds: false })}` : '未設定截止時間';
        const title = choosing ? `第 ${index + 1} 份 · ${item.title}` : item.title;
        const disabled = busy || (!!choosing && (!latest || !!outdated));
        const receipt = receiptId && item.submittedAt
          ? formatTaipeiDateTime(item.submittedAt, { seconds: true }) : null;
        const statusLabel = receiptId && !item.submittedAt ? `尚無繳交紀錄 · ${item.state === 'closed' ? '已停止收件' : '仍在收件'}` : status;
        return (
          <Pressable key={item.id} accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }}
            accessibilityLabel={choosing ? `選擇作業：第 ${index + 1} 份，${item.title}，${due}`
              : `${latest ? '查看作業' : '查看先前的作業'}：${item.title}，${outdated ? '前次狀態 ' : ''}${status}，${due}${receipt ? `，繳交於 ${receipt}` : ''}`}
            onPress={choosing ? () => onSelect({ assignmentId: item.id }, title)
              : () => onOpen(result.workspace.id, item.id)}
            style={({ pressed }) => ({ gap: 5, minHeight: 52, padding: 14, borderRadius: 12, borderWidth: 1,
              borderColor: aiTokens.border, backgroundColor: pressed ? aiTokens.aiSoft : aiTokens.panel })}>
            {!choosing && <Text style={{ color: overdue && !item.submittedAt && item.state === 'open' ? aiTokens.danger : aiTokens.aiStrong,
              fontSize: 14, fontWeight: '600' }}>{outdated ? `前次狀態 · ${statusLabel}` : statusLabel}</Text>}
            <Text style={{ color: aiTokens.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
            {receipt && <Text style={{ color: aiTokens.text, fontSize: 15 }}>繳交於 {receipt}（台灣時間）</Text>}
            <Text style={secondary}>{due}</Text>
            <Text style={{ color: aiTokens.aiStrong, fontSize: 14 }}>{choosing ? '核對這份 ›' : '查看作業 ›'}</Text>
          </Pressable>
        );
      })}
      {!(outdated && choosing) && visibleCount < shown.length && <AIButton label="顯示更多作業" variant="ghost" disabled={busy}
        onPress={() => setVisibleCount((count) => count + 5)} />}
      {view && actionable && followUps}
      {!outdated && refresh}
    </View>
  );
}
