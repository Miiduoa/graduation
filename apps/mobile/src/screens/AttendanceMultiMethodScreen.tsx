/** Server-confirmed QR attendance. Other verification methods are not enabled here. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { AttendanceSessionConfig } from '@campus/shared';
import { useAuth } from '../state/auth';
import { listAttendanceSessions } from '../data/courseSpaceSource';
import { theme } from '../ui/theme';
import TeacherAttendancePanel from '../components/TeacherAttendancePanel';
import {
  buildLiveAttendanceRequest,
  liveAttendanceErrorMessage,
  parseLiveAttendanceReceipt,
  type LiveAttendanceReceipt,
} from '../services/liveAttendanceReceipt';

type RouteProps = {
  route?: { params?: {
    groupId?: string;
    /** Existing course-space routes use the Firestore group ID in courseId. */
    courseId?: string;
    sessionId?: string;
    sessionConfig?: AttendanceSessionConfig;
  } };
};

type HistoryRow = { id: string; startedAt: Date | null; active: boolean; attendeeCount?: number };

function StudentAttendanceScreen({ route }: RouteProps) {
  const auth = useAuth();
  const groupId = route?.params?.groupId ?? route?.params?.courseId ?? '';
  const routeSessionId = route?.params?.sessionId ?? route?.params?.sessionConfig?.sessionId ?? '';
  const uid = auth.user?.uid ?? '';
  const modeSupported = !route?.params?.sessionConfig || route.params.sessionConfig.method === 'rotating_qr';
  const scopeKey = JSON.stringify([uid, groupId, routeSessionId]);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const mounted = useRef(true);
  const sending = useRef(false);
  const generation = useRef(0);
  const historyGeneration = useRef(0);
  const [sessionId, setSessionId] = useState(routeSessionId);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<LiveAttendanceReceipt | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; historyGeneration.current += 1; };
  }, []);

  useEffect(() => {
    generation.current += 1;
    historyGeneration.current += 1;
    sending.current = false;
    setBusy(false);
    setSessionId(routeSessionId);
    setToken('');
    setReceipt(null);
    setError('');
    setHistory([]);
  }, [scopeKey, routeSessionId]);

  const refreshHistory = useCallback(async () => {
    const requestScope = scopeKey;
    const requestNumber = ++historyGeneration.current;
    if (!uid || !groupId) { setHistoryLoading(false); return; }
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const rows = await listAttendanceSessions(groupId);
      if (!mounted.current || requestScope !== currentScope.current || requestNumber !== historyGeneration.current) return;
      setHistory(rows);
    } catch {
      if (!mounted.current || requestScope !== currentScope.current || requestNumber !== historyGeneration.current) return;
      setHistoryError('出席清單暫時無法載入。這不會改變已確認的簽到紀錄。');
    } finally {
      if (mounted.current && requestScope === currentScope.current && requestNumber === historyGeneration.current) setHistoryLoading(false);
    }
  }, [uid, groupId, scopeKey]);

  useEffect(() => { void refreshHistory(); }, [refreshHistory]);

  const submit = async () => {
    if (sending.current || !modeSupported) return;
    const expected = { uid, groupId, sessionId };
    const request = buildLiveAttendanceRequest(expected, token);
    if (!uid) { setError('請先登入學生帳號。'); return; }
    if (!request) { setError('請確認課程、點名編號與完整 QR 內容。這裡不接受六位示範碼。'); return; }
    const requestScope = scopeKey;
    const requestNumber = ++generation.current;
    sending.current = true;
    setBusy(true);
    setError('');
    setReceipt(null);
    try {
      const { httpsCallable, getFunctions } = await import('firebase/functions');
      const { getFirebaseApp, getCloudFunctionRegion } = await import('../firebase');
      const callable = httpsCallable(getFunctions(getFirebaseApp(), getCloudFunctionRegion()), 'verifyAttendanceClaim');
      const response = await callable(request);
      if (!mounted.current || requestScope !== currentScope.current || requestNumber !== generation.current) return;
      const confirmed = parseLiveAttendanceReceipt(response.data, expected);
      if (!confirmed) throw new Error('Unconfirmed attendance response');
      setReceipt(confirmed);
      // Keep the pasted token in memory for an explicit retry. It is never stored or logged.
      void refreshHistory();
    } catch (cause) {
      if (mounted.current && requestScope === currentScope.current && requestNumber === generation.current) setError(liveAttendanceErrorMessage(cause));
    } finally {
      if (mounted.current && requestScope === currentScope.current && requestNumber === generation.current) {
        sending.current = false;
        setBusy(false);
      }
    }
  };

  const changeSession = (value: string) => { setSessionId(value); setReceipt(null); setError(''); };
  const changeToken = (value: string) => { setToken(value); setReceipt(null); setError(''); };
  const inputStyle = {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6,
    color: theme.colors.text, backgroundColor: theme.colors.surface,
    padding: 12, marginTop: 8, minHeight: 48,
  };
  const textStyle = { color: theme.colors.text, fontSize: 15 };
  const ready = !!uid && modeSupported && buildLiveAttendanceRequest({ uid, groupId, sessionId }, token) !== null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface }}
      contentContainerStyle={{ padding: 20, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={{ ...textStyle, fontSize: 24, fontWeight: '600' }}>課堂簽到</Text>
      <Text style={{ ...textStyle, marginTop: 10, lineHeight: 22 }}>
        課程：{groupId || '尚未選擇'}。貼上老師提供的完整 QR 內容，送出後會顯示伺服器登記時間。
      </Text>
      <Text style={{ color: theme.colors.muted, marginTop: 8, lineHeight: 20 }}>
        本頁只處理 Campus One 課程教室的 QR 點名，不會替 TronClass 或其他校務系統登記出席。
      </Text>
      {!modeSupported && <Text accessibilityRole="alert" style={{ color: theme.colors.danger, marginTop: 16 }}>
        這次點名使用的驗證方式尚未接入後端。請老師改開 QR 點名；本頁不會用本機結果代替正式紀錄。
      </Text>}
      <Text style={{ ...textStyle, marginTop: 24 }}>點名編號</Text>
      <TextInput accessibilityLabel="點名編號" value={sessionId} onChangeText={changeSession}
        editable={!busy} autoCapitalize="none" autoCorrect={false} maxLength={128} style={inputStyle}
        placeholder="老師開啟點名後提供的編號" placeholderTextColor={theme.colors.muted} />
      <Text style={{ ...textStyle, marginTop: 18 }}>完整 QR 內容</Text>
      <TextInput accessibilityLabel="完整 QR 內容" value={token} onChangeText={changeToken}
        editable={!busy} autoCapitalize="none" autoCorrect={false} secureTextEntry maxLength={512}
        style={inputStyle} placeholder="貼上完整內容，不是六位示範碼" placeholderTextColor={theme.colors.muted} />
      <Pressable onPress={submit} disabled={!ready || busy} accessibilityRole="button"
        accessibilityLabel={busy ? '正在確認簽到' : '送出簽到'} accessibilityState={{ disabled: !ready || busy, busy }}
        style={{ marginTop: 24, padding: 14, minHeight: 50, borderRadius: 6,
          backgroundColor: ready ? theme.colors.primary : theme.colors.disabledBg, alignItems: 'center' }}>
        {busy ? <ActivityIndicator color={theme.colors.onAccent} /> :
          <Text style={{ color: ready ? theme.colors.onAccent : theme.colors.disabledText, fontWeight: '600' }}>送出簽到</Text>}
      </Pressable>
      {!!error && <Text accessibilityRole="alert" style={{ color: theme.colors.danger, marginTop: 16, lineHeight: 22 }}>{error}</Text>}
      {receipt && <View accessibilityLiveRegion="polite" style={{ marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
        <Text style={{ ...textStyle, fontWeight: '600' }}>{receipt.alreadyRecorded ? '已查到原本的簽到紀錄' : '伺服器已登記'}</Text>
        <Text style={{ ...textStyle, marginTop: 8 }}>狀態：{receipt.status === 'late' ? '遲到' : '出席'}</Text>
        <Text style={{ ...textStyle, marginTop: 4 }}>登記時間：{new Date(receipt.checkedInAt).toLocaleString('zh-TW')}</Text>
        <Text style={{ ...textStyle, marginTop: 4 }}>點名編號：{receipt.sessionId}</Text>
      </View>}
      <View style={{ marginTop: 32, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 18 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text accessibilityRole="header" style={{ ...textStyle, fontWeight: '600' }}>最近點名</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="重新整理點名清單" onPress={() => void refreshHistory()} disabled={historyLoading}
            style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 }}>
            <Text style={{ color: theme.colors.primary }}>重新整理</Text>
          </Pressable>
        </View>
        {historyLoading && <ActivityIndicator />}
        {!!historyError && <Text style={{ color: theme.colors.danger }}>{historyError}</Text>}
        {!historyLoading && !historyError && history.length === 0 && <Text style={{ color: theme.colors.muted }}>目前沒有可顯示的點名。</Text>}
        {history.slice(0, 5).map((row) => <View key={row.id} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
          <Text style={textStyle}>{row.startedAt ? row.startedAt.toLocaleString('zh-TW') : '未記錄開始時間'}</Text>
          <Text style={{ color: theme.colors.muted, marginTop: 3 }}>{row.active ? '進行中' : '已結束'} · 已登記 {row.attendeeCount ?? '未提供'} 人</Text>
          <Text selectable style={{ color: theme.colors.muted, marginTop: 3 }}>{row.id}</Text>
        </View>)}
      </View>
    </ScrollView>
  );
}

/** Both roles use the same course-space route; UI role selection is not authorization. */
export default function AttendanceMultiMethodScreen(props: RouteProps) {
  const auth = useAuth();
  const groupId = props.route?.params?.groupId ?? props.route?.params?.courseId ?? '';
  const uid = auth.user?.uid ?? '';
  const role = auth.profile?.role;
  if (role === 'teacher' || role === 'professor') {
    return <TeacherAttendancePanel key={JSON.stringify([uid, groupId])} uid={uid} groupId={groupId}
      initialSessionId={props.route?.params?.sessionId} />;
  }
  return <StudentAttendanceScreen key={JSON.stringify([uid, groupId])} {...props} />;
}
