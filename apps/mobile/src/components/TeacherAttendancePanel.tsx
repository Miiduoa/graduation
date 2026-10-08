import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { collection, doc, getDoc, getDocs, getFirestore, limit, orderBy, query } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseApp, getCloudFunctionRegion } from '../firebase';
import { theme } from '../ui/theme';
import { attendanceQr } from '../services/attendanceQr';
import { createTeacherAttendance, type TeacherState } from '../services/teacherAttendance';

type Props = { uid: string; groupId: string; initialSessionId?: string };
export default function TeacherAttendancePanel({ uid, groupId, initialSessionId = '' }: Props) {
  const createController = useCallback(() => createTeacherAttendance({ uid, groupId }, {
    now: Date.now,
    start: async (id) => (await httpsCallable(getFunctions(getFirebaseApp(), getCloudFunctionRegion()), 'startLiveSession')({ groupId: id, qrExpiryMinutes: 5 })).data,
    end: async (id, sessionId) => (await httpsCallable(getFunctions(getFirebaseApp(), getCloudFunctionRegion()), 'endLiveSession')({ groupId: id, sessionId })).data,
    read: async (id, sessionId) => {
      const db = getFirestore(getFirebaseApp());
      const [live, attendance] = await Promise.all([
        getDoc(doc(db, 'groups', id, 'liveSessions', sessionId)),
        getDoc(doc(db, 'groups', id, 'attendanceSessions', sessionId)),
      ]);
      if (!live.exists() || !attendance.exists()) throw new Error('Session missing');
      const a = live.data(); const b = attendance.data();
      if ((a.groupId !== undefined && a.groupId !== id) || b.groupId !== id || b.sessionId !== sessionId || b.liveSessionId !== sessionId || b.teacherId !== a.teacherId ||
          typeof a.active !== 'boolean' || typeof b.active !== 'boolean' || a.active !== b.active) throw new Error('Session mismatch');
      return { groupId: a.groupId ?? id, sessionId: a.sessionId, teacherId: a.teacherId,
        active: a.active, attendeeCount: b.attendeeCount };
    },
  }), [uid, groupId]);
  const scopeKey = JSON.stringify([uid, groupId, initialSessionId]);
  const controller = useRef<ReturnType<typeof createTeacherAttendance> | null>(null);
  const [view, setView] = useState<{ scope: string; data: TeacherState } | null>(null);
  const state: TeacherState = view?.scope === scopeKey ? view.data : { phase: 'idle', sessionId: '', token: '', expiresAt: '', count: null, error: '' };
  const [lookup, setLookup] = useState(initialSessionId);
  const [recent, setRecent] = useState<{ scope: string; ids: string[]; error: string }>({ scope: '', ids: [], error: '' });
  const [recentVersion, setRecentVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!uid || !groupId) return;
    void (async () => {
      try {
        const result = await getDocs(query(collection(getFirestore(getFirebaseApp()), 'groups', groupId, 'liveSessions'), orderBy('startedAt', 'desc'), limit(20)));
        if (!cancelled) setRecent({ scope: scopeKey, ids: result.docs.filter((row) => row.data().teacherId === uid).map((row) => row.id), error: '' });
      } catch {
        if (!cancelled) setRecent({ scope: scopeKey, ids: [], error: '點名清單暫時無法讀取。請確認連線與課程權限。' });
      }
    })();
    return () => { cancelled = true; };
  }, [uid, groupId, scopeKey, recentVersion, state.phase]);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const active = createController();
    controller.current = active;
    const unsubscribe = active.subscribe((data) => setView({ scope: scopeKey, data }));
    if (initialSessionId) void active.inspect(initialSessionId);
    const timer = setInterval(() => { setNow(Date.now()); active.tick(); }, 1000);
    const refresh = setInterval(() => {
      if (AppState.currentState === 'active' && active.getState().phase === 'active') void active.inspect();
    }, 5000);
    const appState = AppState.addEventListener('change', (value) => {
      setForeground(value === 'active');
      if (value === 'active') { active.tick(); void active.inspect(); }
    });
    return () => { unsubscribe(); clearInterval(timer); clearInterval(refresh); appState.remove(); active.dispose(); if (controller.current === active) controller.current = null; };
  }, [createController, initialSessionId, scopeKey]);
  const visibleToken = foreground && state.phase === 'active' ? state.token : '';
  const matrix = useMemo(() => visibleToken ? attendanceQr(visibleToken) : null, [visibleToken]);
  const pending = state.phase === 'starting' || state.phase === 'ending';
  const canStart = state.phase === 'idle' || state.phase === 'closed';
  const text = { color: theme.colors.text, fontSize: 15 };
  const action = { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, padding: 13, marginTop: 14, minHeight: 48 };
  return <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface }} contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
    <Text accessibilityRole="header" style={{ ...text, fontSize: 24, fontWeight: '600' }}>課堂點名</Text>
    <Text selectable style={{ ...text, marginTop: 10 }}>課程教室：{groupId || '未選擇'}</Text>
    <Text style={{ color: theme.colors.muted, marginTop: 8, lineHeight: 21 }}>僅適用 Campus One 課程教室。授課資格由伺服器確認；不會寫入 TronClass。</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="開啟五分鐘 QR 點名" disabled={!canStart || pending || !uid || !groupId} onPress={() => void controller.current?.start()} style={{ ...action, opacity: canStart && !pending ? 1 : 0.45 }}>
      <Text style={text}>開啟五分鐘 QR 點名</Text>
    </Pressable>
    {pending && <ActivityIndicator style={{ marginTop: 16 }} />}
    {!!state.sessionId && <View style={{ marginTop: 22 }}>
      <Text style={{ ...text, fontWeight: '600' }}>點名編號</Text>
      <Text selectable style={{ ...text, marginTop: 6 }}>{state.sessionId}</Text>
      <Text style={{ ...text, marginTop: 8 }}>伺服器已登記：{state.count ?? '尚未核對'} 人</Text>
    </View>}
    {matrix && <View style={{ marginTop: 20, alignItems: 'center' }}>
      <View accessible accessibilityLabel="本次點名 QR；亦可選取下方完整內容" style={{ padding: 24, backgroundColor: '#fff' }}>
        {matrix.map((row, r) => <View key={r} style={{ flexDirection: 'row' }}>
          {row.map((dark, c) => <View key={c} style={{ width: 6, height: 6, backgroundColor: dark ? '#000' : '#fff' }} />)}
        </View>)}
      </View>
      <Text style={{ ...text, marginTop: 12 }}>剩餘 {Math.max(0, Math.ceil((Date.parse(state.expiresAt) - now) / 1000))} 秒</Text>
      <Text selectable style={{ ...text, marginTop: 8 }}>{visibleToken}</Text>
      <Text style={{ color: theme.colors.muted, marginTop: 8, lineHeight: 21 }}>學生須選相同課程並填入上方點名編號，再貼上完整 QR 內容。這不是六位密碼；本頁沒有自動防截圖或到場證明。</Text>
    </View>}
    {state.phase === 'closed' && <Text style={{ ...text, marginTop: 20 }}>伺服器已確認點名結束。</Text>}
    {!!state.error && <Text accessibilityRole="alert" style={{ color: theme.colors.danger, marginTop: 18, lineHeight: 22 }}>{state.error}</Text>}
    {!!state.sessionId && state.phase !== 'closed' && <Pressable accessibilityRole="button" disabled={pending} onPress={() => void controller.current?.end()} style={action}><Text style={text}>結束這次點名</Text></Pressable>}
    <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, marginTop: 30, paddingTop: 18 }}>
      <Text style={{ ...text, fontWeight: '600' }}>重新開啟 App 或遺失 QR</Text>
      <Text style={{ color: theme.colors.muted, marginTop: 8, lineHeight: 21 }}>從最近點名清單取得編號，載入後結束舊點名再重開。不能從群組文件還原 token。</Text>
      <Pressable accessibilityRole="button" onPress={() => setRecentVersion((v) => v + 1)} style={action}><Text style={text}>重新讀取點名清單</Text></Pressable>
      {recent.scope === scopeKey && !!recent.error && <Text style={{ color: theme.colors.danger, marginTop: 8 }}>{recent.error}</Text>}
      {recent.scope === scopeKey && recent.ids.map((id) => <Pressable key={id} disabled={pending} accessibilityRole="button" onPress={() => { setLookup(id); void controller.current?.inspect(id); }} style={action}><Text selectable style={text}>{id}</Text><Text style={{ color: theme.colors.muted }}>載入這次點名</Text></Pressable>)}
      <Text style={{ color: theme.colors.muted, marginTop: 8 }}>上方只列最近 20 次課堂 session 中由你開啟的點名；也可直接輸入其他點名編號。</Text>
      <TextInput accessibilityLabel="要核對的點名編號" value={lookup} onChangeText={setLookup} editable={!pending} autoCapitalize="none" autoCorrect={false} maxLength={128} style={{ ...action, ...text }} />
      <Pressable accessibilityRole="button" accessibilityLabel="核對既有點名" disabled={pending || !lookup.trim()} onPress={() => void controller.current?.inspect(lookup.trim())} style={action}><Text style={text}>核對既有點名</Text></Pressable>
    </View>
  </ScrollView>;
}
