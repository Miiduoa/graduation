import React, { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View, Alert } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Button } from '../ui/components';
import { callClubPortal } from '../services/clubPortal';
export function ClubCheckIn({
  uid,
  schoolId,
  groupId,
  eventId,
  myCode,
  suffix,
  officer,
  onConfirmed,
}: {
  uid: string;
  schoolId: string;
  groupId: string;
  eventId: string;
  myCode?: string;
  suffix?: string;
  officer: boolean;
  onConfirmed: () => void;
}) {
  const key = JSON.stringify(['club-check-in', uid, schoolId, groupId, eventId]);
  const [queue, setQueue] = useState<string[]>([]),
    [code, setCode] = useState(''),
    [expanded, setExpanded] = useState(false),
    [started, setStarted] = useState(false),
    [scanning, setScanning] = useState(false),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [permission, requestPermission] = useCameraPermissions(),
    lock = useRef(false),
    mounted = useRef(true),
    pending = useRef<string[]>([]);
  const save = async (next: string[]) => {
    await AsyncStorage.setItem(key, JSON.stringify(next));
    pending.current = next;
    if (mounted.current) setQueue(next);
  };
  async function send() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    let confirmedMessage = '';
    try {
      while (pending.current.length) {
        const result = await callClubPortal(uid, schoolId, {
          action: 'checkIn',
          groupId,
          eventId,
          checkInCode: pending.current[0],
        });
        confirmedMessage = result.message || '簽到已由伺服器確認';
        await save(pending.current.slice(1));
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      if (mounted.current) {
        setMessage(confirmedMessage);
        onConfirmed();
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
    void AsyncStorage.getItem(key).then((raw) => {
      if (mounted.current) {
        try {
          const parsed = JSON.parse(raw || '[]');
          if (Array.isArray(parsed)) {
            pending.current = parsed.filter((s) => typeof s === 'string');
            setQueue(pending.current);
            if (pending.current.length)
              void NetInfo.fetch().then((state) => {
                if (mounted.current && state.isConnected) void send();
              });
          }
        } catch {}
      }
    });
    const stop = NetInfo.addEventListener((state) => {
      if (state.isConnected && pending.current.length) void send();
    });
    return () => {
      mounted.current = false;
      stop();
    };
  }, [key]);
  async function enqueue(value: string) {
    if (!value.trim() || lock.current) return;
    try {
      await save([...new Set([...pending.current, value.trim()])]);
      setCode('');
      const state = await NetInfo.fetch();
      if (state.isConnected) void send();
    } catch {
      setMessage('無法暫存，請確認裝置儲存空間');
    }
  }
  return (
    <View style={{ gap: 8 }}>
      {myCode ? (
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
          <Button text="開始簽到" onPress={() => setStarted(!started)} />
          {started ? (
            <>
              <Button
                text="相機掃描 QR"
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
                value={code}
                onChangeText={setCode}
              />
              <Button text="確認簽到碼" disabled={busy} onPress={() => void enqueue(code)} />
              <Text>{queue.length} 筆待送出</Text>
              <Button
                text="重送待送出簽到"
                disabled={busy || !queue.length}
                onPress={() => void send()}
              />
              <Button
                text="清除待送出紀錄"
                disabled={busy || !queue.length}
                onPress={() =>
                  Alert.alert('清除待送出紀錄？', '尚未送出的簽到將會移除。', [
                    { text: '取消' },
                    {
                      text: '清除',
                      onPress: () => {
                        void save([]);
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
