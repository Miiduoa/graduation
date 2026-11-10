import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { PublicCatalogCourse, PublicCourseCatalogResponse } from '@campus/shared/src/publicCourseCatalog';
import { appendPersonalImports, snapshotPersonalImports, undoLastPersonalImport, type PersonalImportScope } from '../services/personalImports';
import { findCatalogTimetableOverlaps, preparePublicCourseTimetableImport, type CatalogTimetableOverlap, type PublicCourseTimetablePreview } from '../services/publicCourseTimetableImport';
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
  | { status: 'review' | 'saving' }
  | { status: 'error'; reason?: 'teacher-change' }
  | { status: 'conflict'; overlaps: CatalogTimetableOverlap[]; recordsJson: string }
  | { status: 'saved'; added: number; duplicates: number; batchId?: string }
  | { status: 'undone'; removed: number };

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
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState(false);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    generation.current += 1;
    pending.current = false;
    setUndoing(false);
    setOutcome((previous) => previous.status === 'saving' ? { status: 'error' } : previous);
    return () => {
      focused.current = false;
      generation.current += 1;
    };
  }, []));

  const active = (run: number) => focused.current && generation.current === run && liveScopeKey.current === scopeKey;
  async function confirm() {
    const run = generation.current;
    if (pending.current || undoing || outcome.status === 'saved' || outcome.status === 'undone' || !active(run)) return;
    pending.current = true;
    const acknowledged = outcome.status === 'conflict' ? outcome : null;
    setOutcome({ status: 'saving' });
    try {
      // A first confirmation reads this owner's own ledger after pending writes.
      // If a different class overlaps, a second explicit acknowledgement is required.
      let recordsJson = acknowledged?.recordsJson;
      if (recordsJson === undefined) {
        const current = await snapshotPersonalImports(scope, () => active(run));
        if (!active(run)) return;
        recordsJson = JSON.stringify(current.records);
        const overlaps = findCatalogTimetableOverlaps(preview.rows, current.records);
        if (overlaps.length) {
          setOutcome({ status: 'conflict', overlaps, recordsJson });
          return;
        }
      }
      // The ledger serializes writes and checks that the reviewed records did
      // not change before committing. Other import drafts are untouched.
      const result = await appendPersonalImports(scope, preview.rows, () => active(run), {
        protectCatalogTimetableSlots: true, expectedRecordsJson: recordsJson,
      });
      if (active(run)) setOutcome({
        status: 'saved', added: result.added, duplicates: result.duplicates,
        batchId: result.added > 0 ? result.ledger.batches[result.ledger.batches.length - 1]?.id : undefined,
      });
    } catch (error) {
      // A same-section instructor change must not silently create another
      // personal course slot. Only surface this known safe, actionable error.
      if (active(run)) setOutcome({
        status: 'error',
        reason: error instanceof Error && error.message ===
          '相同課號、班別與時段已有不同教師的個人紀錄；請先核對原有資料。'
          ? 'teacher-change' : undefined,
      });
    } finally {
      if (active(run)) pending.current = false;
    }
  }
  async function undo() {
    const run = generation.current;
    if (pending.current || undoing || outcome.status !== 'saved' || !outcome.batchId || !active(run)) return;
    pending.current = true;
    setUndoError(false);
    setUndoing(true);
    try {
      // Undo only our exact last batch. Never erase another import or a later edit.
      const result = await undoLastPersonalImport(scope, outcome.batchId, () => active(run));
      if (active(run)) setOutcome({ status: 'undone', removed: result.removed });
    } catch {
      if (active(run)) setUndoError(true);
    } finally {
      if (active(run)) {
        pending.current = false;
        setUndoing(false);
      }
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
    <Text style={body}>僅加入這個帳號在此裝置的個人課表，不代表校方選課成功。衝堂檢查只涵蓋本裝置已匯入的同校同學期時段，不含手動課表、校方正式紀錄或其他裝置；原有草稿不會變更。</Text>
    {preview.issues.map((issue, index) => <Text key={index} style={body}>{issue.message}</Text>)}
    {outcome.status === 'saved' ? <>
      <Text accessibilityLiveRegion="polite" style={body}>
        {outcome.added ? `已加入 ${outcome.added} 個上課時段。` : '這些時段已在個人課表，沒有重複新增。'}
        {outcome.added > 0 && outcome.duplicates > 0 ? `另有 ${outcome.duplicates} 個重複時段未新增。` : ''}
      </Text>
      <Button text="查看個人課表" kind="primary" onPress={() => {
        if (active(generation.current) && !undoing) safeNavigate(navigation, 'PersonalTimetable', {
          term: preview.term, reminderScope: JSON.stringify(scope),
        });
      }} />
      {outcome.added > 0 && outcome.batchId && <Button
        text={undoing ? '正在撤回…' : '撤回這次加入'} kind="ghost" disabled={undoing}
        onPress={() => void undo()} />}
      {undoError && <Text accessibilityRole="alert" style={body}>
        無法安全撤回：課表可能已更新，或剛才的撤回已完成。請先查看個人課表，不會刪除其他批次。
      </Text>}
    </> : outcome.status === 'undone' ? <>
      <Text accessibilityLiveRegion="polite" style={body}>已撤回這次加入的 {outcome.removed} 個上課時段，其他課程不受影響。</Text>
      <Button text="查看個人課表" kind="primary" onPress={() => {
        if (active(generation.current)) safeNavigate(navigation, 'PersonalTimetable', {
          term: preview.term, reminderScope: JSON.stringify(scope),
        });
      }} />
    </> : <>
      {outcome.status === 'conflict' && <>
        <Text accessibilityRole="alert" style={body}>本裝置已匯入課表發現 {outcome.overlaps.length} 個重疊時段{outcome.overlaps.length >= 10 ? '（最多顯示前 10 個）' : ''}。請先核對；兩門課都保留可能衝堂，並不代表校方正式選課。</Text>
        {outcome.overlaps.map((overlap, index) => <Text key={index} style={body}>
          星期{'一二三四五六日'[overlap.dayOfWeek - 1]} · {overlap.incomingTitle} 與 {overlap.existingTitle}（重疊 {overlap.startTime}–{overlap.endTime}）
        </Text>)}
      </>}
      {outcome.status === 'error' && <>
        <Text accessibilityRole="alert" style={body}>
          {outcome.reason === 'teacher-change'
            ? '相同課號、班別與時段的教師與原有個人紀錄不同。為避免重複加入，本次沒有儲存；請先查看個人課表，核對並修正原紀錄。'
            : '未能確認加入結果（資料可能已變動）。請重新核對後重試；相同時段不會重複新增。若仍失敗，請從個人匯入頁核對現有資料。'}
        </Text>
        {outcome.reason === 'teacher-change' && <Button text="查看原有個人課表" kind="ghost" onPress={() => {
          if (active(generation.current)) safeNavigate(navigation, 'PersonalTimetable', {
            term: preview.term, reminderScope: JSON.stringify(scope),
          });
        }} />}
      </>}
      <Button text={outcome.status === 'saving' ? '正在加入…' :
        outcome.status === 'conflict' ? '仍要加入（保留兩門課）' :
        outcome.status === 'error' && outcome.reason === 'teacher-change' ? '重新核對' : '確認加入個人課表'} kind="primary"
        disabled={outcome.status === 'saving'} onPress={() => void confirm()} />
    </>}
    <Button text="收起核對" kind="ghost" disabled={outcome.status === 'saving' || undoing} onPress={onClose} />
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

// The key remounts the review state on every proposal change, even when an
// official course changes A→B→A without a new student tap. It also invalidates
// pending focused work on the old proposal before another can be confirmed.
function CurrentCourseProposal({ schoolId, preview, navigation }: {
  schoolId: Props['schoolId'];
  preview: PublicCourseTimetablePreview;
  navigation: Props['navigation'];
}) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button text="核對並加入課表" kind="primary" onPress={() => setOpen(true)} />;
  return <AccountReview schoolId={schoolId} preview={preview} navigation={navigation}
    onClose={() => setOpen(false)} />;
}

export function PublicCourseImportAction({ schoolId, course, navigation }: Props) {
  const preview = useMemo(() => preparePublicCourseTimetableImport(schoolId, course), [schoolId, course]);
  if (!preview) return null;
  // CSV includes school, term, class identity, instructor and every meeting.
  return <CurrentCourseProposal key={preview.csv} schoolId={schoolId} preview={preview} navigation={navigation} />;
}
