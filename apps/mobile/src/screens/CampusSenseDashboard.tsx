import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { AICard, AIButton, aiTokens } from '../ui/aiFirst';
import type { CampusSenseSnapshot, CampusSenseProgress } from '../services/campusSenseSnapshot';
import { CampusAssignmentCoverage } from './CampusAssignmentCoverage';
import { CampusAssignmentWorkbench, type CampusAssignmentWorkbenchContext } from './CampusAssignmentWorkbench';

function Metric({ label, value, available, detail = '已讀取' }: {
  label: string; value: string; available: boolean; detail?: string;
}) {
  return (
    <View style={{ backgroundColor: aiTokens.panel, minWidth: 86, flexGrow: 1, flexBasis: '28%',
      paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12 }}>
      <Text style={{ color: aiTokens.muted, fontSize: 12, marginBottom: 6 }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: available ? aiTokens.text : aiTokens.warning,
        fontSize: available ? 23 : 14, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: aiTokens.muted, marginTop: 5, fontSize: 11 }}>
        {available ? detail : '無資料來源'}
      </Text>
    </View>
  );
}

export function CampusSenseDashboard({
  snapshot, expired, authenticated, busy, syncBusy, error, onSync, onClear, onBrief, onWeekBrief,
  progress, onCancelSync, assignmentContext, workbenchOpen, onWorkbenchChange,
}: {
  snapshot: CampusSenseSnapshot | null;
  expired: boolean;
  authenticated: boolean;
  busy: boolean;
  syncBusy: boolean;
  error: string;
  onSync: () => void;
  onClear: () => void;
  onBrief: () => void;
  onWeekBrief: () => void;
  progress?: CampusSenseProgress | null;
  onCancelSync?: () => void;
  assignmentContext?: CampusAssignmentWorkbenchContext;
  /** Optional controlled state lets the assistant hide duplicate summary actions. */
  workbenchOpen?: boolean;
  onWorkbenchChange?: (open: boolean) => void;
}) {
  const [internalWorkbenchOpen, setInternalWorkbenchOpen] = useState(false);
  const showWorkbench = workbenchOpen ?? internalWorkbenchOpen;
  const toggleWorkbench = () => {
    const next = !showWorkbench;
    setInternalWorkbenchOpen(next);
    onWorkbenchChange?.(next);
  };
  const freshness = snapshot ? new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(snapshot.checkedAt)) : '';
  const partial = snapshot?.assignments.status === 'available' &&
    snapshot.assignments.count !== snapshot.assignments.items.length;

  return (
    <AICard title="校園感知" badge={snapshot ? partial ? '部分資料' : '已同步' : '待同步'}
      badgeTone={snapshot && !partial ? 'success' : 'muted'}>
      <View style={{ gap: 12 }}>
        <Text style={{ color: aiTokens.text, fontSize: 16, fontWeight: '700' }}>
          {snapshot ? '已取得本次授權資料' : expired
            ? '校園摘要已過期，請重新同步' : '尚未同步校園摘要'}
        </Text>
        {snapshot ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Metric label="待交作業" detail="已接通來源總數"
                available={snapshot.assignments.status === 'available'}
                value={snapshot.assignments.status === 'available' ? String(snapshot.assignments.count) : '不可用'} />
              <Metric label="校園公告"
                available={snapshot.announcements.status === 'available'}
                value={snapshot.announcements.status === 'available' ? String(snapshot.announcements.items.length) : '不可用'} />
              <Metric label="正式課表"
                available={snapshot.schedule.status === 'available'}
                value={snapshot.schedule.status === 'available' ? String(snapshot.schedule.count) : '未接通'} />
            </View>
            <CampusAssignmentCoverage assignments={snapshot.assignments} />
            <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
              同步時間：{freshness}。僅涵蓋已串接且授權的來源，不等於全部學校系統。
            </Text>
          </>
        ) : (
          <Text style={{ color: aiTokens.muted, fontSize: 13, lineHeight: 21 }}>
            授權同步作業與公告摘要，讓手機依照實際資料安排下一步。未同步仍可使用本機課表與文字助理。
          </Text>
        )}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <AIButton label={busy ? '正在整理…' : '今日重點'} style={{ flex: 1 }}
            disabled={!authenticated || busy || syncBusy} onPress={onBrief} />
          <AIButton label="未來七天" style={{ flex: 1 }} variant="ghost"
            disabled={!authenticated || busy || syncBusy} onPress={onWeekBrief} />
        </View>
        <AIButton label={syncBusy ? '正在同步校園資料…' : snapshot ? '重新同步校園資料' : '同步我的校園資料'}
          disabled={!authenticated || busy || syncBusy} onPress={onSync} />
        {syncBusy ? (
          <View style={{ backgroundColor: aiTokens.panel, borderRadius: 12, padding: 12, gap: 8 }}>
            <Text accessibilityLiveRegion="polite" style={{ color: aiTokens.text, fontSize: 13 }}>
              {progress?.total != null
                ? '正在核對作業：' + progress.loaded + ' / ' + progress.total + ' 筆'
                : '正在連線並核對校園資料權限…'}
            </Text>
            {progress && progress.pages > 0 ? <Text style={{ color: aiTokens.muted, fontSize: 12 }}>
              已核對 {progress.pages} 頁；本次最多讀取 {progress.pageLimit} 頁。完成前不會套用部分清單。
            </Text> : null}
            {onCancelSync ? <AIButton label="取消這次同步" size="sm" variant="ghost" onPress={onCancelSync} /> : null}
            <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 19 }}>
              取消會停止後續讀取並忽略晚到結果；已送出的伺服器請求仍可能完成。
            </Text>
          </View>
        ) : null}
        {snapshot && assignmentContext && snapshot.assignments.status === 'available' ? (
          <>
            <AIButton label={showWorkbench ? '收合作業工作台' : '查看與篩選已同步作業'}
              variant="ghost" disabled={busy || syncBusy} onPress={toggleWorkbench} />
            {showWorkbench ? <CampusAssignmentWorkbench
              key={JSON.stringify([assignmentContext.userId, assignmentContext.schoolId, snapshot.checkedAt])}
              snapshot={snapshot} context={assignmentContext} disabled={busy || syncBusy} /> : null}
          </>
        ) : null}
        {snapshot ? (
          <AIButton label="清除本次校園摘要" variant="ghost" size="sm"
            disabled={busy || syncBusy} onPress={onClear} />
        ) : null}
        <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 19 }}>
          同步需要連線及校園存取權限；不會上傳問題或對話。本次資料不寫入儲存，15 分鐘後過期。
        </Text>
        {!authenticated ? <Text style={{ color: aiTokens.muted, fontSize: 12 }}>
          登入並取得校園權限後即可同步；不影響純本機問答。
        </Text> : null}
        {error ? <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>{error}</Text> : null}
      </View>
    </AICard>
  );
}
