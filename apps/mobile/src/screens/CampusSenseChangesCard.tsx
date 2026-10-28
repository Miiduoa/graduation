import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { compareCampusAssignments, type CampusAssignmentChanges, type CampusAssignmentChangeKind } from '../services/campusSenseChanges';
import { CAMPUS_SENSE_MAX_AGE_MS, validCampusSenseSnapshot, type CampusSenseSnapshot } from '../services/campusSenseSnapshot';
import type { safeNavigate } from '../utils/safeNavigate';
import { CampusAssignmentOpenButton } from './CampusAssignmentOpenButton';

const LABEL: Record<CampusAssignmentChangeKind, string> = {
  added: '新增作業',
  'deadline-earlier': '截止提前',
  'deadline-later': '截止延後',
  'deadline-added': '新增截止時間',
  'deadline-removed': '截止時間待確認',
  'details-updated': '作業資訊更新',
  'no-longer-listed': '本次清單未列出',
};
const REASON: Record<CampusAssignmentChanges['reason'], string> = {
  'first-sync': '已建立本次畫面的比較基準；再次同步時，可查看作業新增與改期。',
  complete: '只比對兩次已授權、完整的來源清單；不是背景監控或校方變更紀錄。',
  'partial-data': '這次或上次資料不完整，暫不判斷新增、移除或已完成。',
  'source-unavailable': '作業來源未取得，無法比較變更。',
  'identity-unavailable': '來源缺少可唯一核對的作業識別碼，暫不猜測哪些作業變更。',
  'scope-or-age': '先前基準已過期或帳號／學校不同，這次不使用舊資料比較。',
  'out-of-order': '資料時間順序無法確認，這次不顯示變更結論。',
};
function displayTime(value: string | null): string {
  if (!value) return '未提供';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

/** Comparison is memory-only and disappears with the conversation scope. */
export function CampusSenseChangesCard({ snapshot, userId, schoolId, disabled, isCurrent, navigation }: {
  snapshot: CampusSenseSnapshot | null;
  userId: string;
  schoolId: string;
  disabled: boolean;
  isCurrent: () => boolean;
  navigation?: Parameters<typeof safeNavigate>[0];
}) {
  const previous = useRef<CampusSenseSnapshot | null>(null);
  const [comparison, setComparison] = useState<{
    snapshot: CampusSenseSnapshot; result: CampusAssignmentChanges;
  } | null>(null);
  const [limit, setLimit] = useState(5);
  useEffect(() => {
    if (!snapshot) {
      previous.current = null;
      setComparison(null);
      return;
    }
    if (previous.current === snapshot) return;
    const result = compareCampusAssignments({
      previous: previous.current, next: snapshot, scope: { uid: userId, schoolId },
    });
    previous.current = snapshot;
    setComparison({ snapshot, result });
    setLimit(5);
  }, [snapshot, userId, schoolId]);

  useEffect(() => {
    if (!comparison?.result.from) return;
    const expiresAt = Date.parse(comparison.result.from) + CAMPUS_SENSE_MAX_AGE_MS;
    const expiry = setTimeout(() => {
      // A fresh snapshot must not extend the lifetime of older comparison rows.
      setComparison((current) => current === comparison ? {
        snapshot: current.snapshot,
        result: { ...current.result, status: 'not-comparable', reason: 'scope-or-age', from: null, changes: [] },
      } : current);
    }, Math.max(0, expiresAt - Date.now()) + 1);
    return () => clearTimeout(expiry);
  }, [comparison]);

  // Never paint the preceding scope/result while the comparison effect catches up.
  if (!snapshot || comparison?.snapshot !== snapshot ||
      !validCampusSenseSnapshot(snapshot, { uid: userId, schoolId })) return null;
  const { result } = comparison;
  const expired = result.from !== null && Date.now() - Date.parse(result.from) > CAMPUS_SENSE_MAX_AGE_MS;
  return (
    <AICard title="本次同步變更" badge={result.status === 'compared' && !expired ? `${result.changes.length} 項` : '尚不比較'}>
      <View style={{ gap: 12 }}>
        <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
          {REASON[expired ? 'scope-or-age' : result.reason]}
        </Text>
        {result.status === 'compared' && !expired ? (
          <>
            <Text style={{ color: aiTokens.muted, fontSize: 12 }}>
              比較時間：{displayTime(result.from)} → {displayTime(result.to)}
            </Text>
            {result.changes.length === 0 ? (
              <Text style={{ color: aiTokens.text, fontSize: 13 }}>兩次已取得的作業清單沒有變更。</Text>
            ) : result.changes.slice(0, limit).map((change) => (
              <View key={change.id} style={{ padding: 13, gap: 7, borderRadius: 12, backgroundColor: aiTokens.panel }}>
                <Text style={{ color: change.kind === 'deadline-earlier' ? aiTokens.warning : aiTokens.muted, fontSize: 12, fontWeight: '600' }}>
                  {LABEL[change.kind]}
                </Text>
                <Text style={{ color: aiTokens.text, fontWeight: '700', fontSize: 14 }}>{change.assignment.title}</Text>
                {change.assignment.groupName ? <Text style={{ color: aiTokens.muted, fontSize: 12 }}>{change.assignment.groupName}</Text> : null}
                {change.kind === 'no-longer-listed' ? (
                  <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
                    可能是繳交、刪除或來源調整，不能據此判定已完成；請至課程頁核對。
                  </Text>
                ) : (
                  <>
                    <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
                      {change.kind.startsWith('deadline-')
                        ? `截止：${displayTime(change.previousDueAt)} → ${displayTime(change.assignment.dueAt)}`
                        : `目前截止：${displayTime(change.assignment.dueAt)}`}
                    </Text>
                    {navigation ? (
                      <CampusAssignmentOpenButton assignment={change.assignment} navigation={navigation} disabled={disabled}
                        context={{ userId, schoolId, snapshot, isCurrent }} />
                    ) : null}
                  </>
                )}
              </View>
            ))}
            {result.changes.length > limit ? (
              <AIButton label={`再顯示變更（尚有 ${result.changes.length - limit} 項）`} variant="ghost" size="sm"
                disabled={disabled} onPress={() => setLimit((value) => value + 10)} />
            ) : null}
          </>
        ) : null}
      </View>
    </AICard>
  );
}
