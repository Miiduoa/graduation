import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import {
  loadClubSummary,
  clubSummaryEnabled,
  clubRoleLabel,
  type ClubSummaryData,
} from '../services/clubSummary';
import { Button, Card } from '../ui/components';
export { clubSummaryEnabled } from '../services/clubSummary';
export function ClubSummary({
  uid,
  schoolId,
  groupId,
}: {
  uid: string;
  schoolId: string;
  groupId: string;
}) {
  const [data, setData] = useState<ClubSummaryData | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    async function load() {
      const result = await loadClubSummary(uid, schoolId, groupId);
      if (active) setData(result);
    }
    if (clubSummaryEnabled())
      void load().catch(() => {
        if (active) setError('無法確認社團資料，請重試');
      });
    return () => {
      active = false;
    };
  }, [uid, schoolId, groupId, revision]);
  if (!clubSummaryEnabled()) return null;
  return (
    <Card title="社團後台" subtitle="唯讀檢視；報名、簽到與管理請使用網頁版">
      {error ? (
        <Text accessibilityRole="alert">{error}</Text>
      ) : !data ? (
        <Text>正在讀取社團資料…</Text>
      ) : (
        <>
          <Text>
            社員 {data.members.length} 位{!data.rosterOnly && ` · 活動 ${data.events.length} 場`}
          </Text>
          {data.members.map((m) => (
            <Text key={m.id}>
              {m.name} · {clubRoleLabel(m.role)}
            </Text>
          ))}
          {data.rosterOnly && <Text>活動資料暫時無法取得</Text>}
          {!data.rosterOnly && data.events.length === 0 && <Text>尚無活動</Text>}
          {data.events.map((e) => (
            <Text key={e.id}>
              {e.title} · {new Date(e.startsAt).toLocaleString('zh-TW')} · 報名 {e.registered} 人 ·
              簽到 {e.checkedIn} 人
            </Text>
          ))}
        </>
      )}
      <Button text="重新整理社團資料" onPress={() => setRevision((value) => value + 1)} />
    </Card>
  );
}
