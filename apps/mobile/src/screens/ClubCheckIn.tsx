import React, { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View, Alert } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import NetInfo from '@react-native-community/netinfo';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Button } from '../ui/components';
import { callClubPortal } from '../services/clubPortal';
import { loadPersistedRawValue, savePersistedValue } from '../services/persistedStorage';
export function ClubCheckIn({
  uid,
  schoolId,
  groupId,
  eventId,
  myCode,
  suffix,
  officer,
  acceptingCheckIns = true,
  onConfirmed,
}: {
  uid: string;
  schoolId: string;
  groupId: string;
  eventId: string;
  myCode?: string;
  suffix?: string;
  officer: boolean;
  acceptingCheckIns?: boolean;
  onConfirmed: () => void;
}) {
  const key = JSON.stringify(['club-check-in', uid, schoolId, groupId, eventId]);
  const [queue, setQueue] = useState<string[]>([]),
    [code, setCode] = useState(''),
    [expanded, setExpanded] = useState(false),
    [started, setStarted] = useState(false),
    [scanning, setScanning] = useState(false),
    [failures, setFailures] = useState<Record<string, string>>({}),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions(),
    lock = useRef(false),
    ready = useRef<string | null>(null),
    mounted = useRef(true),
    pending = useRef<string[]>([]),
    writes = useRef<Promise<void>>(Promise.resolve());
  // Compute each change after the preceding durable write, including removals.
  const save = (change: (current: string[]) => string[]) => {
    const write = writes.current.then(async () => {
      const next = change(pending.current);
      await savePersistedValue(key, next);
      pending.current = next;
      if (mounted.current) setQueue(next);
    });
    writes.current = write.catch(() => {});
    return write;
  };
  async function send() {
    if (ready.current !== key || lock.current) return;
    lock.current = true;
    setBusy(true);
    let confirmedMessage = '';
    try {
      const failed: Record<string, string> = {};
      // Visit each entry once so retained failures cannot block later entries.
      for (const checkInCode of [...pending.current]) {
        let result;
        try {
          result = await callClubPortal(uid, schoolId, {
            action: 'checkIn',
            groupId,
            eventId,
            checkInCode,
          });
        } catch (err) {
          failed[checkInCode] = err instanceof Error ? err.message : '尚未送出，請重試';
          if (mounted.current) setFailures({ ...failed });
          continue;
        }
        confirmedMessage = result.message || '簽到已由伺服器確認';
        await save((current) => current.filter((entry) => entry !== checkInCode));
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      if (mounted.current) {
        setFailures(failed);
        setMessage(
          Object.keys(failed).length ? '部分簽到未完成，請重試或刪除失敗紀錄' : confirmedMessage,
        );
        if (confirmedMessage) onConfirmed();
      }
    } catch (err) {
      if (mounted.current) setMessage(err instanceof Error ? err.message : '尚未送出');
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    ready.current = null;
    setLoadedKey(null);
    pending.current = [];
    setQueue([]);
    // Initial hydration shares the durable-write sequence, so it cannot overwrite an enqueue.
    const load = writes.current.then(async () => {
      try {
        const raw = await loadPersistedRawValue(key);
        if (cancelled) return;
        const parsed = JSON.parse(raw || '[]');
        if (!Array.isArray(parsed)) throw new Error('Invalid queue');
        pending.current = parsed.filter((entry) => typeof entry === 'string');
        setQueue(pending.current);
        ready.current = key;
        setLoadedKey(key);
      } catch {
        if (!cancelled) setMessage('無法讀取暫存，請關閉後重新開啟此頁');
      }
    });
    writes.current = load;
    void load
      .then(async () => {
        if (cancelled || ready.current !== key || !pending.current.length) return;
        const state = await NetInfo.fetch();
        if (!cancelled && state.isConnected) void send();
      })
      .catch(() => {});
    const stop = NetInfo.addEventListener((state) => {
      if (state.isConnected && pending.current.length) void send();
    });
    return () => {
      cancelled = true;
      mounted.current = false;
      stop();
    };
  }, [key]);
  async function enqueue(value: string) {
    if (ready.current !== key || !acceptingCheckIns || !value.trim() || lock.current) return;
    try {
      await save((current) => [...new Set([...current, value.trim()])]);
      setCode('');
      const state = await NetInfo.fetch();
      if (state.isConnected) void send();
    } catch {
      setMessage('無法暫存，請確認裝置儲存空間');
    }
  }
  return (
    <View style={{ gap: 8 }}>
      {myCode && acceptingCheckIns ? (
        <>
          <Button text="我的簽到碼" onPress={() => setExpanded(!expanded)} />
          {expanded ? (
            <>
              <QRCode value={myCode} size={256} />
              <Text style={{ fontSize: 34, fontFamily: 'monospace' }}>
                {suffix || '未提供學號'}
              </Text>
            </>
          ) : null}
        </>
      ) : null}
      {officer ? (
        <>
          <Button
            text={acceptingCheckIns ? '開始簽到' : '管理待送出簽到'}
            onPress={() => setStarted(!started)}
          />
          {started ? (
            <>
              {acceptingCheckIns ? (
                <>
                  <Button
                    text="相機掃描 QR"
                    disabled={loadedKey !== key}
                    onPress={async () => {
                      const result = permission?.granted ? permission : await requestPermission();
                      if (result.granted) setScanning(!scanning);
                      else setMessage('未開放相機，仍可輸入學號後四碼');
                    }}
                  />
                  {scanning ? (
                    <CameraView
                      style={{ height: 260 }}
                      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                      onBarcodeScanned={({ data }) => {
                        setScanning(false);
                        void enqueue(data);
                      }}
                    />
                  ) : null}
                  <TextInput
                    accessibilityLabel="學號後四碼或簽到碼"
                    placeholder="學號後四碼或簽到碼"
                    editable={loadedKey === key}
                    value={code}
                    onChangeText={setCode}
                  />
                  <Button
                    text="確認簽到碼"
                    disabled={busy || loadedKey !== key}
                    onPress={() => void enqueue(code)}
                  />
                </>
              ) : null}
              {loadedKey !== key ? <Text>正在載入待送出紀錄…</Text> : null}
              <Text>{queue.length} 筆待送出</Text>
              {queue.map((entry, index) =>
                failures[entry] ? (
                  <View key={entry}>
                    <Text>
                      第 {index + 1} 筆：{failures[entry]}
                    </Text>
                    <Button
                      text={`刪除第 ${index + 1} 筆失敗簽到`}
                      disabled={busy || loadedKey !== key}
                      onPress={() => {
                        void save((current) => current.filter((value) => value !== entry)).catch(
                          () => setMessage('無法更新暫存，請重試'),
                        );
                      }}
                    />
                  </View>
                ) : null,
              )}
              <Button
                text="重送待送出簽到"
                disabled={busy || loadedKey !== key || !queue.length}
                onPress={() => void send()}
              />
              <Button
                text="清除待送出紀錄"
                disabled={busy || loadedKey !== key || !queue.length}
                onPress={() =>
                  Alert.alert('清除待送出紀錄？', '尚未送出的簽到將會移除。', [
                    { text: '取消' },
                    {
                      text: '清除',
                      onPress: () => {
                        void save(() => []);
                      },
                    },
                  ])
                }
              />
              <Text accessibilityRole="alert">{message}</Text>
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
