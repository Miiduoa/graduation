import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import {
  loadClubSummary,
  clubSummaryEnabled,
  clubRoleLabel,
  type ClubSummaryData,
} from '../services/clubSummary';
import { callClubRegistration, watchClubAccount } from '../services/clubRegistration';
import { Button, Card } from '../ui/components';
export { clubSummaryEnabled } from '../services/clubSummary';
type Scope = { uid: string; schoolId: string; groupId: string };
export function ClubSummary(props: Scope) {
  const [account, setAccount] = useState<string | null>(null);
  useEffect(() => {
    if (clubSummaryEnabled()) return watchClubAccount(setAccount);
  }, []);
  if (account !== props.uid) return null;
  return (
    <ClubSummaryContent
      key={JSON.stringify([props.uid, props.schoolId, props.groupId])}
      {...props}
    />
  );
}
function ClubSummaryContent({
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
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
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
    <Card title="社團活動" subtitle="可在這裡報名或取消；簽到與管理請使用網頁版">
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
          {data.rosterOnly && <Text>活動管理與 CSV 匯出暫時無法使用，社員名單仍可查閱。</Text>}
          {!data.rosterOnly && data.events.length === 0 && <Text>尚無活動</Text>}
          {data.events.map((e) => (
            <ClubEvent
              key={e.id}
              event={e}
              uid={uid}
              schoolId={schoolId}
              groupId={groupId}
              onBusy={setBusy}
              onUncertain={() => setUncertain(true)}
              onDenied={() => {
                setData(null);
                setError('社團資格已失效或登入已過期，請返回上一頁確認資格後再開啟。');
              }}
              busy={busy}
            />
          ))}
        </>
      )}
      <Button
        text="重新整理社團資料"
        disabled={busy || uncertain}
        onPress={() => setRevision((value) => value + 1)}
      />
    </Card>
  );
}

function ClubEvent({
  event,
  uid,
  schoolId,
  groupId,
  onBusy,
  onUncertain,
  onDenied,
  busy,
}: Scope & {
  event: ClubSummaryData['events'][number];
  onBusy: (busy: boolean) => void;
  onUncertain: () => void;
  onDenied: () => void;
  busy: boolean;
}) {
  const [current, setCurrent] = useState(event);
  const [stage, setStage] = useState<'idle' | 'confirm' | 'busy' | 'unknown' | 'rejected' | 'done'>(
    'idle',
  );
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const writeConfirmed = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const closed =
    !Number.isFinite(current.startsAt) || Date.now() >= current.startsAt || current.myCheckIn;
  async function run(readOnly = false) {
    if (busy || lock.current || (!readOnly && stage !== 'confirm')) return;
    if (!readOnly && (closed || Date.now() >= current.startsAt)) {
      setStage('idle');
      return;
    }
    lock.current = true;
    onBusy(true);
    setStage('busy');
    setMessage('');
    try {
      if (!readOnly) {
        writeConfirmed.current = false;
        await callClubRegistration(
          uid,
          schoolId,
          groupId,
          current.mine ? 'cancel' : 'register',
          event.id,
        );
        writeConfirmed.current = true;
      }
      const result = await callClubRegistration(uid, schoolId, groupId, 'read');
      const fresh = result.events.find((row) => row.id === event.id);
      if (!fresh || typeof fresh.mine !== 'boolean') throw new Error('活動狀態無法確認');
      if (!alive.current) return;
      setCurrent(fresh);
      if (writeConfirmed.current) {
        setMessage(fresh.mine ? '已報名，活動資訊就在下方。' : '目前未報名此活動。');
        setStage('done');
      } else {
        setMessage(
          `伺服器當下查詢：${fresh.mine ? '已報名' : '未報名'}。原操作可能仍在處理，結果尚未確定；請稍後再讀取確認，暫不開放再次操作。`,
        );
        setStage('unknown');
      }
    } catch (error) {
      if (alive.current) {
        const code = (error as { code?: string }).code?.replace(/^functions\//, '');
        if (code === 'permission-denied' || code === 'unauthenticated') {
          onDenied();
          return;
        }
        if (
          !readOnly &&
          !writeConfirmed.current &&
          (code === 'not-found' || code === 'failed-precondition')
        ) {
          setMessage(
            code === 'not-found'
              ? '活動或社員資格已不存在，請返回上一頁確認。'
              : '活動已開始、已簽到或目前不允許變更報名，請返回上一頁確認活動資訊。',
          );
          setStage('rejected');
          return;
        }
        if (!writeConfirmed.current) onUncertain();
        setMessage(
          '還無法確認報名結果。請連線後重新讀取，確認前先不要重送。若社團資格已異動，請洽幹部。',
        );
        setStage('unknown');
      }
    } finally {
      lock.current = false;
      if (alive.current) onBusy(false);
    }
  }
  return (
    <Card title={current.title} subtitle={new Date(current.startsAt).toLocaleString('zh-TW')}>
      <Text>{current.location || '地點尚未提供'}</Text>
      <Text>
        報名 {current.registered} 人 · 簽到 {current.checkedIn} 人
      </Text>
      <Text>
        {stage === 'unknown' || stage === 'busy'
          ? '報名狀態待確認'
          : current.mine
            ? '已報名'
            : '尚未報名'}
        {current.myCheckIn ? ' · 已簽到' : ''}
      </Text>
      {message ? <Text accessibilityRole="alert">{message}</Text> : null}
      {stage === 'confirm' ? (
        <>
          <Text>
            {current.mine
              ? `確定取消「${current.title}」的報名？`
              : `確定報名「${current.title}」？`}
          </Text>
          <Button
            text={current.mine ? '確認取消報名' : '確認報名'}
            onPress={() => run()}
            disabled={closed || busy}
          />
          <Button text="先保留原狀" onPress={() => setStage('idle')} />
        </>
      ) : stage === 'unknown' ? (
        <Button text="重新讀取報名狀態" disabled={busy} onPress={() => run(true)} />
      ) : stage === 'rejected' ? (
        <Text>本次操作已被伺服器拒絕。</Text>
      ) : stage === 'busy' ? (
        <Button text="正在確認報名狀態…" loading disabled />
      ) : stage === 'done' ? (
        <Button
          text="回到活動"
          onPress={() => {
            setMessage('');
            setStage('idle');
          }}
        />
      ) : closed ? (
        <Text>活動已開始或已簽到，無法變更報名。</Text>
      ) : (
        <Button
          text={current.mine ? '取消報名' : '報名活動'}
          disabled={busy}
          onPress={() => setStage('confirm')}
        />
      )}
    </Card>
  );
}
