import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { AICard, AIButton, aiTokens } from '../ui/aiFirst';
import type { CampusSenseSnapshot, CampusSenseProgress } from '../services/campusSenseSnapshot';
import { querySyncedAnnouncements } from '../services/syncedAnnouncementQuery';
import { CampusAnnouncementRows } from './CampusAnnouncementRows';
import { CampusAssignmentCoverage } from './CampusAssignmentCoverage';
import { CampusAssignmentWorkbench, type CampusAssignmentWorkbenchContext } from './CampusAssignmentWorkbench';

function Metric({ label, value, available, detail = '已讀取' }: {
  label: string; value: string; available: boolean; detail?: string;
}) {
  return (
    <View style={{ backgroundColor: aiTokens.panel, minWidth: 86, flexGrow: 1, flexBasis: '28%',
      paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12 }}>
      <Text style={{ color: aiTokens.muted, fontSize: 12, marginBottom: 6 }}>{label}</Text>
      <Text style={{ color: available ? aiTokens.text : aiTokens.warning,
        fontSize: available ? 23 : 14, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: aiTokens.muted, marginTop: 5, fontSize: 11 }}>
        {available ? detail : '無資料來源'}
      </Text>
    </View>
  );
}

type Announcement = CampusSenseSnapshot['announcements']['items'][number];

function AnnouncementDisclosure({ items, available, disabled, onOpenAnnouncement, onOpenAnnouncements }: {
  items: ReadonlyArray<Announcement>;
  available: boolean;
  disabled: boolean;
  onOpenAnnouncement?: (item: Announcement) => void;
  onOpenAnnouncements?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasItems = available && items.length > 0;
  return (
    <View style={{ gap: 8 }}>
      {hasItems ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="本次同步的公告"
          accessibilityState={{ expanded, disabled }} disabled={disabled} onPress={() => setExpanded(!expanded)}
          style={{ minHeight: 48, padding: 12, justifyContent: 'center', borderRadius: 12,
            borderColor: aiTokens.border, borderWidth: 1, opacity: disabled ? 0.6 : 1 }}>
          <Text style={{ color: aiTokens.text, fontSize: 15, fontWeight: '600' }}>
            {expanded ? '收合公告摘要' : `查看本次同步的 ${items.length} 則公告`}
          </Text>
        </TouchableOpacity>
      ) : (
        <Text style={{ color: available ? aiTokens.muted : aiTokens.warning, fontSize: 13 }}>
          {available ? '這次同步沒有可顯示的公告。' : '本次未取得公告來源，無法確認有幾則公告。'}
        </Text>
      )}
      {hasItems && expanded ? (
        <>
          <Text style={{ color: aiTokens.muted, fontSize: 13 }}>僅列出本次同步讀取的公告，發布日期以台灣時間顯示。</Text>
          <CampusAnnouncementRows items={items} disabled={disabled} onOpenAnnouncement={onOpenAnnouncement} />
        </>
      ) : null}
      {(!hasItems || expanded) && onOpenAnnouncements ? (
        <AIButton label="前往公告總覽" variant="ghost" disabled={disabled} onPress={onOpenAnnouncements} />
      ) : null}
    </View>
  );
}

export function CampusSenseDashboard({
  snapshot, expired, authenticated, busy, syncBusy, error, onSync, onClear, onBrief, onWeekBrief,
  progress, onCancelSync, assignmentContext, onOpenAnnouncement, onOpenAnnouncements,
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
  onOpenAnnouncement?: (item: Announcement) => void;
  onOpenAnnouncements?: () => void;
}) {
  const snapshotKey = snapshot ? JSON.stringify([snapshot.userId, snapshot.schoolId, snapshot.checkedAt]) : null;
  const [openWorkbenchFor, setOpenWorkbenchFor] = useState<string | null>(null);
  const showWorkbench = snapshotKey !== null && openWorkbenchFor === snapshotKey;
  const freshness = snapshot ? new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(snapshot.checkedAt)) : '';
  const availableSources = snapshot ? [snapshot.schedule, snapshot.assignments, snapshot.announcements]
    .filter((source) => source.status === 'available').length : 0;
  const partial = availableSources < 3 || (snapshot?.assignments.status === 'available' &&
    snapshot.assignments.count !== snapshot.assignments.items.length);
  const badge = !snapshot ? '待同步' : !availableSources ? '未取得資料' : partial ? '部分資料' : '已同步';
  const announcements = snapshot?.announcements.status === 'available'
    ? querySyncedAnnouncements(snapshot.announcements.items, null, snapshot.checkedAt).items : [];

  return (
    <AICard title="校園感知" badge={badge}
      badgeTone={!snapshot ? 'muted' : partial ? 'warning' : 'success'}>
      <View style={{ gap: 12 }}>
        <Text style={{ color: aiTokens.text, fontSize: 16, fontWeight: '700' }}>
          {snapshot ? (availableSources ? '已取得本次授權資料' : '本次未能讀取校園資料') : expired
            ? '校園摘要已過期，請重新同步' : '尚未同步校園摘要'}
        </Text>
        {snapshot ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Metric label="待交作業" detail="已接通來源總數"
                available={snapshot.assignments.status === 'available'}
                value={snapshot.assignments.status === 'available' ? String(snapshot.assignments.count) : '不可用'} />
              <Metric label="校園公告" detail="本次摘要則數"
                available={snapshot.announcements.status === 'available'}
                value={snapshot.announcements.status === 'available' ? String(announcements.length) : '不可用'} />
              <Metric label="正式課表"
                available={snapshot.schedule.status === 'available'}
                value={snapshot.schedule.status === 'available' ? String(snapshot.schedule.count) : '未接通'} />
            </View>
            {!syncBusy ? (
              <AnnouncementDisclosure key={snapshotKey}
                available={snapshot.announcements.status === 'available'} items={announcements}
                disabled={busy} onOpenAnnouncement={onOpenAnnouncement} onOpenAnnouncements={onOpenAnnouncements} />
            ) : null}
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
              variant="ghost" disabled={busy || syncBusy} onPress={() => setOpenWorkbenchFor(showWorkbench ? null : snapshotKey)} />
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
