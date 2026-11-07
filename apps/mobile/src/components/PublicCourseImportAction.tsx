import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { PublicCatalogCourse, PublicCourseCatalogResponse } from '@campus/shared/src/publicCourseCatalog';
import { appendPersonalImports, type PersonalImportScope } from '../services/personalImports';
import { preparePublicCourseTimetableImport, type PublicCourseTimetablePreview } from '../services/publicCourseTimetableImport';
import { usePersonalImportScope } from '../state/personalImportScope';
import { Button } from '../ui/components';
import { theme } from '../ui/theme';
import { safeNavigate } from '../utils/safeNavigate';

type Props = {
  schoolId: PublicCourseCatalogResponse['schoolId'];
  course: PublicCatalogCourse;
  navigation?: Parameters<typeof safeNavigate>[0];
};
type Outcome =
  | { status: 'review' | 'saving' | 'error' }
  | { status: 'saved'; added: number; duplicates: number };

type ReviewProps = {
  preview: PublicCourseTimetablePreview;
  navigation: Props['navigation'];
  onClose(): void;
};

function ScopedReview({ preview, scope, scopeKey, liveScopeKey, navigation, onClose }: ReviewProps & {
  scope: PersonalImportScope;
  scopeKey: string;
  liveScopeKey: React.MutableRefObject<string | null>;
}) {
  const [outcome, setOutcome] = useState<Outcome>({ status: 'review' });
  const focused = useRef(false);
  const generation = useRef(0);
  const pending = useRef(false);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    generation.current += 1;
    pending.current = false;
    setOutcome((previous) => previous.status === 'saving' ? { status: 'error' } : previous);
    return () => {
      focused.current = false;
      generation.current += 1;
    };
  }, []));

  const active = (run: number) => focused.current && generation.current === run && liveScopeKey.current === scopeKey;
  async function confirm() {
    const run = generation.current;
    if (pending.current || outcome.status === 'saved' || !active(run)) return;
    pending.current = true;
    setOutcome({ status: 'saving' });
    try {
      // The ledger serializes writes, rejects metadata conflicts and deduplicates
      // retries. It does not touch either of the existing import draft stores.
      const result = await appendPersonalImports(scope, preview.rows, () => active(run));
      if (active(run)) setOutcome({ status: 'saved', added: result.added, duplicates: result.duplicates });
    } catch {
      if (active(run)) setOutcome({ status: 'error' });
    } finally {
      if (active(run)) pending.current = false;
    }
  }
  const body = { color: theme.colors.textSecondary, lineHeight: 22 };
  return <View style={{ gap: 10, padding: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10 }}>
    <Text accessibilityRole="header" style={{ color: theme.colors.text, fontWeight: '600' }}>加入前核對</Text>
    <Text style={body}>{preview.schoolName} · {preview.academicYear} 學年度第 {preview.semester} 學期</Text>
    {preview.rows.map((row) => <Text key={row.id} style={body}>
      {row.title} · 星期{row.dayOfWeek ? '一二三四五六日'[row.dayOfWeek - 1] : '待確認'} {row.startTime}–{row.endTime}
      {row.location ? ` · ${row.location}` : ' · 教室未提供'}
    </Text>)}
    <Text style={body}>僅加入這個帳號在此裝置的個人課表，不代表校方選課成功。請核對修課資格與衝堂；原有匯入草稿不會變更。</Text>
    {preview.issues.map((issue, index) => <Text key={index} style={body}>{issue.message}</Text>)}
    {outcome.status === 'saved' ? <>
      <Text accessibilityLiveRegion="polite" style={body}>
        {outcome.added ? `已加入 ${outcome.added} 個上課時段。` : '這些時段已在個人課表，沒有重複新增。'}
        {outcome.added > 0 && outcome.duplicates > 0 ? `另有 ${outcome.duplicates} 個重複時段未新增。` : ''}
      </Text>
      <Button text="查看個人課表" kind="primary" onPress={() => {
        if (active(generation.current)) safeNavigate(navigation, 'PersonalTimetable', {
          term: preview.term, reminderScope: JSON.stringify(scope),
        });
      }} />
    </> : <>
      {outcome.status === 'error' ? <Text accessibilityRole="alert" style={body}>
        未能確認加入結果。請重試；相同時段不會重複新增。若仍失敗，請從個人匯入頁核對現有資料。
      </Text> : null}
      <Button text={outcome.status === 'saving' ? '正在加入…' : '確認加入個人課表'} kind="primary"
        disabled={outcome.status === 'saving'} onPress={() => void confirm()} />
    </>}
    <Button text="收起核對" kind="ghost" disabled={outcome.status === 'saving'} onPress={onClose} />
  </View>;
}

function AccountReview({ schoolId, ...props }: ReviewProps & { schoolId: Props['schoolId'] }) {
  const scope = usePersonalImportScope();
  const scopeKey = scope && scope.schoolId === schoolId ? JSON.stringify([scope.owner, scope.schoolId]) : null;
  const liveScopeKey = useRef(scopeKey);
  liveScopeKey.current = scopeKey;
  if (!scope || !scopeKey) return <View style={{ gap: 8 }}>
    <Text accessibilityRole="alert" style={{ color: theme.colors.textSecondary, lineHeight: 22 }}>
      請先確認目前帳號與所選學校，再加入個人課表。仍可使用複製匯入資料。
    </Text>
    <Button text="收起核對" kind="ghost" onPress={props.onClose} />
  </View>;
  return <ScopedReview key={JSON.stringify([scopeKey, props.preview.csv])} {...props}
    scope={scope} scopeKey={scopeKey} liveScopeKey={liveScopeKey} />;
}

export function PublicCourseImportAction({ schoolId, course, navigation }: Props) {
  const [open, setOpen] = useState(false);
  const preview = useMemo(() => preparePublicCourseTimetableImport(schoolId, course), [schoolId, course]);
  if (!preview) return null;
  // Subscribe to private account state only after the student chooses to review.
  if (!open) return <Button text="核對並加入課表" kind="primary" onPress={() => setOpen(true)} />;
  return <AccountReview schoolId={schoolId} preview={preview} navigation={navigation} onClose={() => setOpen(false)} />;
}
