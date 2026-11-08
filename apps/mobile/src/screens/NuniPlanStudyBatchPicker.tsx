import React, { useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import type { CampusEvidencePlan } from '../services/offlineCampusPlanner';
import type { NuniPlanAssignmentSource } from '../services/nuniPlanAssignmentTarget';
import { isCourseworkStudyInstant } from '../features/nuniCourseworkStudy';
import { AIButton, aiTokens } from '../ui/aiFirst';

type Candidate = { key: string; title: string; courseName: string; dueAt: string; source: NuniPlanAssignmentSource };
const sourceKey = (source: NuniPlanAssignmentSource) => JSON.stringify([
  source.accountId, source.schoolId, source.academicYear, source.semester, source.workspaceId, source.assignmentId,
]);
const deadlineLabel = (value: string) => new Date(value).toLocaleString('zh-TW', {
  timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});

/** A picker carries only live locators. The batch reader must check every source again. */
export function livePlanStudyCandidates(plan: CampusEvidencePlan, accountId: string, schoolId: string): Candidate[] {
  const rows = [
    ...(plan.agenda?.days.flatMap((day) => day.deadlines) ?? []),
    ...(plan.agenda?.outsideWindow ?? []),
    ...plan.steps.filter((step) => step.evidence === 'authorized-assignments'),
  ];
  const candidates = new Map<string, Candidate>();
  for (const row of rows) {
    const source = row.nuniSource;
    if (row.kind === 'quiz' || !source || source.accountId !== accountId || source.schoolId !== schoolId ||
        !source.academicYear || !source.semester || !source.workspaceId || !source.assignmentId ||
        !row.title?.trim() || !isCourseworkStudyInstant(row.dueAt) || Date.parse(row.dueAt) <= Date.now()) continue;
    const key = sourceKey(source);
    if (!candidates.has(key)) candidates.set(key, {
      key, title: row.title, courseName: row.groupName ?? '', dueAt: row.dueAt, source: { ...source },
    });
  }
  return [...candidates.values()].sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt) ||
    left.key.localeCompare(right.key));
}

export function NuniPlanStudyBatchPicker({ plan, accountId, schoolId, disabled, onPrepare }: {
  plan: CampusEvidencePlan;
  accountId: string;
  schoolId: string;
  disabled: boolean;
  onPrepare: (sources: readonly NuniPlanAssignmentSource[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [visible, setVisible] = useState(8);
  const spacePressed = useRef<string | null>(null);
  const candidates = livePlanStudyCandidates(plan, accountId, schoolId);
  const chosen = candidates.filter((candidate) => selected.includes(candidate.key));
  if (candidates.length < 2) return null;
  const toggle = (key: string) => {
    spacePressed.current = null;
    if (disabled) return;
    setSelected((previous) => {
      const active = previous.filter((value) => candidates.some((candidate) => candidate.key === value));
      return active.includes(key) ? active.filter((value) => value !== key) : active.length < 4 ? [...active, key] : active;
    });
  };
  return <View style={{ gap: 10, marginTop: 16, padding: 14, borderRadius: 14,
    borderWidth: 1, borderColor: aiTokens.border, backgroundColor: aiTokens.panel }}>
    <Text style={{ color: aiTokens.text, fontSize: 17, fontWeight: '700' }}>一起安排作業準備時間</Text>
    <Text style={{ color: aiTokens.textSecondary, lineHeight: 23 }}>
      選 2–4 份作業，各安排 30 分鐘。會重新核對作業、課表與個人行程，先讓你預覽整份安排，再確認建立。
    </Text>
    {candidates.slice(0, visible).map((candidate) => {
      const checked = chosen.some((row) => row.key === candidate.key);
      const unavailable = disabled || (!checked && chosen.length >= 4);
      const keyboard = Platform.OS === 'web' ? {
        onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
          if ((event.key !== ' ' && event.key !== 'Spacebar') || event.target !== event.currentTarget) return;
          event.preventDefault(); event.stopPropagation();
          if (!unavailable && !event.repeat) spacePressed.current = candidate.key;
        },
        onKeyUp: (event: React.KeyboardEvent<HTMLElement>) => {
          if ((event.key !== ' ' && event.key !== 'Spacebar') || event.target !== event.currentTarget) return;
          event.preventDefault(); event.stopPropagation();
          const pressed = spacePressed.current === candidate.key;
          spacePressed.current = null;
          if (pressed && !unavailable) toggle(candidate.key);
        },
        onBlur: () => { spacePressed.current = null; },
      } : {};
      return <Pressable key={candidate.key} accessibilityRole="checkbox"
        accessibilityLabel={`選取作業：${candidate.title}${candidate.courseName ? `（${candidate.courseName}）` : ''}`}
        accessibilityState={{ checked, disabled: unavailable }} disabled={unavailable}
        onPress={() => toggle(candidate.key)} {...keyboard}
        style={{ gap: 4, padding: 12, borderRadius: 10, borderWidth: 1,
          borderColor: checked ? aiTokens.ai : aiTokens.border, opacity: unavailable ? 0.55 : 1 }}>
        <Text style={{ color: aiTokens.text, fontWeight: '600' }}>{checked ? '已選取 · ' : ''}{candidate.title}</Text>
        {candidate.courseName ? <Text style={{ color: aiTokens.textSecondary }}>{candidate.courseName}</Text> : null}
        <Text style={{ color: aiTokens.muted, fontSize: 13 }}>截止：{deadlineLabel(candidate.dueAt)}（台灣時間）</Text>
      </Pressable>;
    })}
    {candidates.length > visible ? <AIButton label={`顯示更多可安排作業（${candidates.length - visible}）`}
      variant="ghost" disabled={disabled} onPress={() => setVisible((count) => count + 8)} /> : null}
    <Text accessibilityLiveRegion="polite" style={{ color: aiTokens.textSecondary }}>
      已選 {chosen.length}／4 份；這一步尚未建立行程。
    </Text>
    <AIButton label={`預覽 ${chosen.length} 份作業的準備安排`} disabled={disabled || chosen.length < 2}
      onPress={() => {
        if (!disabled && chosen.length >= 2 && chosen.length <= 4) onPrepare(chosen.map((candidate) => ({ ...candidate.source })));
      }} />
  </View>;
}
