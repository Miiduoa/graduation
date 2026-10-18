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
            `名稱：${row.title}`,
            `資料類型：${{ timetable: '課表', grades: '成績', events: '活動' }[row.kind]}`,
            `學年度：${row.academicYear || '未填'}`,
            `學期：${row.semester || '未填'}`,
            `課程代碼：${row.courseCode || '未填'}`,
            `教師：${row.teacher || '未填'}`,
            `班別：${row.className || '未填'}`,
            `地點：${row.location || '未填'}`,
            `星期：${row.dayOfWeek ?? '未填'}`,
            `開始節次：${row.startPeriod ?? '未填'}`,
            `結束節次：${row.endPeriod ?? '未填'}`,
            `原始節次：${row.periodLabel || '未填'}`,
            `開始時間：${row.startTime || '未填'}`,
            `結束時間：${row.endTime || '未填'}`,
            `學分：${row.credits ?? '未填'}`,
            `成績：${row.grade || '未填'}`,
            `日期：${row.date || '未填'}`,
            `結束日期：${row.endDate || '未填'}`,
            `全天：${row.allDay === undefined ? '未填' : row.allDay ? '是' : '否'}`,
            `課班連結：${row.linkedCourseId || '未填'}`,
            `來源類型：${{ paste: '貼上文字', file: '檔案', screenshot: '截圖' }[row.source.type]}`,
            `來源檔名：${row.source.name || '未填'}`,
            `來源列：${row.source.line}`,
            `來源文字：${row.source.rawText || '未填'}`,
            `匯入時間：${row.importedAt}`,
          ].join('\n'),
        )
        .join('\n\n')
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
          {conflict.reason === 'unconfirmed' && (
            <Text style={textStyle}>
              無法確認上次同步是否已送達。請先匯出完整備份，再核對這個校園的全部紀錄。保留這台裝置會取代帳號上的完整內容；保留帳號資料會取代本機完整內容。未選擇前，兩邊的資料都會保留。
            </Text>
          )}
          <Text style={textStyle}>這台裝置：{describe(conflict.local)}</Text>
          <Text style={textStyle}>帳號中的資料：{describe(conflict.remote)}</Text>
          <Button
            text={choices[conflict.key] === 'local' ? '已選：保留這台裝置' : '保留這台裝置'}
            disabled={busy || status.running || !active()}
            onPress={() => setChoices((value) => ({ ...value, [conflict.key]: 'local' }))}
          />
          <Button
            text={choices[conflict.key] === 'remote' ? '已選：保留帳號資料' : '保留帳號資料'}
            disabled={busy || status.running || !active()}
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
            !active() ||
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
