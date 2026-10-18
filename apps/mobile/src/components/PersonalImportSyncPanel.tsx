import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import type { PersonalImportSyncChoices } from '@campus/shared/src/imports/sync';
import { personalImportSyncErrorMessage } from '@campus/shared/src/imports/sync';
import { useNuniSession } from '../state/nuniSession';
import { Button } from '../ui/components';
import { theme } from '../ui/theme';
import {
  personalImportStorageKey,
  snapshotPersonalImports,
  subscribePersonalImports,
  type PersonalImportScope,
  type PersonalImportLedger,
} from '../services/personalImports';
import {
  canSyncPersonalImports,
  personalImportSyncStatus,
  setPersonalImportSyncEnabled,
  subscribePersonalImportSync,
  syncPersonalImports,
  type ImportSyncStatus,
} from '../services/personalImportSync';
import type { PersonalImportRecord } from '@campus/shared';

type Props = {
  scope: PersonalImportScope;
  active?: () => boolean;
  available?: boolean;
  onSynced?: () => void;
};
const textStyle = { color: theme.colors.text, lineHeight: 23 };
const describe = (rows: PersonalImportRecord[]) =>
  rows.length
    ? rows
        .map((row) =>
          [
            row.title,
            `${row.academicYear}/${row.semester}`,
            row.grade && `成績 ${row.grade}`,
            row.credits !== undefined && `${row.credits} 學分`,
            row.date,
            row.startTime,
            row.endTime,
            row.dayOfWeek && `星期${row.dayOfWeek}`,
            row.startPeriod && `${row.startPeriod}–${row.endPeriod}節`,
            row.location,
            row.teacher,
            row.className,
            row.linkedCourseId && '含個人課班連結',
          ]
            .filter(Boolean)
            .join(' · '),
        )
        .join('\n')
    : '已刪除這筆資料';

export function PersonalImportSyncPanel(props: Props) {
  const auth = useNuniSession();
  const context = auth.session?.context;
  const scopeKey = personalImportStorageKey(props.scope);
  const latest = useRef({ props, auth });
  latest.current = { props, auth };
  const alive = useRef(true);
  const [ledger, setLedger] = useState<PersonalImportLedger | null>(null);
  const [status, setStatus] = useState<ImportSyncStatus>(() =>
    personalImportSyncStatus(props.scope),
  );
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<PersonalImportSyncChoices>({});
  const command = useRef(false),
    loadGeneration = useRef(0);
  const active = () =>
    alive.current &&
    latest.current.props.available !== false &&
    (latest.current.props.active?.() ?? true) &&
    latest.current.auth.session?.context === context &&
    !latest.current.auth.loading &&
    !latest.current.auth.pendingLogout &&
    latest.current.props.scope.owner === `nuni:${latest.current.auth.session?.platformAccountId}` &&
    personalImportStorageKey(latest.current.props.scope) === scopeKey;
  useEffect(() => {
    alive.current = true;
    setLedger(null);
    setMessage('');
    setChoices({});
    async function refresh() {
      const run = ++loadGeneration.current;
      if (!active()) return;
      setStatus(personalImportSyncStatus(props.scope));
      try {
        const value = await snapshotPersonalImports(props.scope, active);
        if (active() && run === loadGeneration.current) setLedger(value);
      } catch (error) {
        if (active()) setMessage(personalImportSyncErrorMessage(error));
      }
    }
    void refresh();
    const stopLedger = subscribePersonalImports((change) => {
      if (personalImportStorageKey(change.scope) === scopeKey) {
        void refresh();
        if (change.source === 'sync' && active()) latest.current.props.onSynced?.();
      }
    });
    const stopStatus = subscribePersonalImportSync((key) => {
      if (key === scopeKey && active()) {
        setStatus(personalImportSyncStatus(props.scope));
        setMessage('');
      }
    });
    return () => {
      alive.current = false;
      loadGeneration.current += 1;
      stopLedger();
      stopStatus();
    };
  }, [scopeKey, context, props.available, auth.loading]);
  useEffect(() => {
    setChoices({});
  }, [status.result?.review]);
  async function run(operation: 'enable' | 'pause' | 'sync' | 'resolve') {
    if (command.current || !active()) return;
    command.current = true;
    setBusy(true);
    setMessage('');
    try {
      if (operation === 'pause') {
        await setPersonalImportSyncEnabled(props.scope, false, active);
        if (active()) setMessage('已暫停自動同步。裝置與帳號資料都保留；重新開啟後會先核對差異。');
        return;
      }
      if (operation === 'enable') await setPersonalImportSyncEnabled(props.scope, true, active);
      const network = await NetInfo.fetch();
      if (!active()) return;
      if (network.isConnected === false || network.isInternetReachable === false) {
        setMessage('目前離線，資料保留在裝置上；連線後會繼續同步。');
        return;
      }
      const review = operation === 'resolve' ? status.result?.review : undefined;
      await syncPersonalImports(
        props.scope,
        (path, input) => latest.current.auth.request(path, context!, input),
        active,
        review ? { ...review, choices } : undefined,
      );
    } catch (error) {
      if (active()) setMessage(personalImportSyncErrorMessage(error));
    } finally {
      command.current = false;
      if (alive.current) setBusy(false);
    }
  }
  if (
    !canSyncPersonalImports(props.scope) ||
    props.scope.owner !== `nuni:${auth.session?.platformAccountId}`
  )
    return (
      <Text style={textStyle}>
        登入平台帳號並選擇校園後，可在自己的裝置之間同步；目前資料仍留在這台裝置。
      </Text>
    );
  const conflicts = status.result?.conflicts || [];
  return (
    <View style={{ gap: 10, paddingVertical: 14 }}>
      <Text style={{ ...textStyle, fontWeight: '700', fontSize: 18 }}>
        帳號同步 · {props.scope.schoolId}
      </Text>
      <Text style={textStyle}>
        開啟後，這個帳號與校園的課表、成績、活動、來源文字及個人課班連結會儲存到帳號。原始截圖不會上傳，也不會分享給同學或老師。
      </Text>
      <Text style={textStyle}>
        {ledger?.sync?.enabled
          ? '已開啟：App 在前景且連線時，自動核對其他裝置的變更。'
          : '尚未開啟同步，資料只保存在這台裝置。'}
      </Text>
      {!ledger?.sync?.enabled ? (
        <Button
          text="開啟此帳號與校園的同步"
          disabled={busy || !ledger || !active()}
          onPress={() => void run('enable')}
        />
      ) : (
        <>
          <Button
            text="立即同步"
            disabled={busy || status.running || !active()}
            onPress={() => void run('sync')}
          />
          <Button text="暫停同步" disabled={busy || !active()} onPress={() => void run('pause')} />
        </>
      )}
      {conflicts.map((conflict) => (
        <View
          key={conflict.key}
          style={{
            gap: 8,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 8,
            padding: 12,
          }}
        >
          <Text style={{ ...textStyle, fontWeight: '700' }}>需要核對：{conflict.title}</Text>
          <Text style={textStyle}>這台裝置：{describe(conflict.local)}</Text>
          <Text style={textStyle}>帳號中的資料：{describe(conflict.remote)}</Text>
          <Button
            text={choices[conflict.key] === 'local' ? '已選：保留這台裝置' : '保留這台裝置'}
            disabled={busy || status.running}
            onPress={() => setChoices((value) => ({ ...value, [conflict.key]: 'local' }))}
          />
          <Button
            text={choices[conflict.key] === 'remote' ? '已選：保留帳號資料' : '保留帳號資料'}
            disabled={busy || status.running}
            onPress={() => setChoices((value) => ({ ...value, [conflict.key]: 'remote' }))}
          />
        </View>
      ))}
      {!!conflicts.length && (
        <Button
          text="確認這些選擇並同步"
          disabled={
            busy ||
            status.running ||
            !ledger?.sync?.enabled ||
            conflicts.some((item) => !choices[item.key])
          }
          onPress={() => void run('resolve')}
        />
      )}
      {!!(message || status.message) && (
        <Text accessibilityLiveRegion="polite" style={textStyle}>
          {message || status.message}
        </Text>
      )}
      <Text style={{ color: theme.colors.muted }}>
        兩台裝置同時修改或刪除同一筆時會先請你核對，不會默默覆蓋。暫停同步不會刪除帳號中的副本。
      </Text>
    </View>
  );
}
