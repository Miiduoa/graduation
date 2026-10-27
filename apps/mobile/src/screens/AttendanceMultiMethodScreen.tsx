import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { listAttendanceSessions } from '../data/courseSpaceSource';
import { isDemoCourseId } from '../data/demoCoursesAdapter';
import type { AttendanceSession } from '../data/types';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { Button, Card, LoadingState } from '../ui/components';
import { courseChipScrollContentStyle } from '../ui/courseChipShell';
import { theme } from '../ui/theme';
import { safeNavigate } from '../utils/safeNavigate';

type RouteProps = {
  route?: {
    params?: {
      sessionConfig?: { courseId?: string; sessionId?: string };
      courseId?: string;
      sessionId?: string;
    };
  };
};

export default function AttendanceMultiMethodScreen(props: RouteProps) {
  const navigation = useNavigation();
  const auth = useAuth();
  const { school } = useSchool();
  const params = props.route?.params;
  const courseId = params?.courseId ?? params?.sessionConfig?.courseId ?? '';
  const sessionId = params?.sessionId ?? params?.sessionConfig?.sessionId ?? '';
  const userId = auth.user?.uid ?? '';
  const schoolId = school.id ?? auth.profile?.schoolId;
  const supportedCourse =
    !!courseId && courseId !== 'demo' && !courseId.startsWith('tc:') && !isDemoCourseId(courseId);
  const enabled =
    supportedCourse &&
    !!userId &&
    !!schoolId &&
    !auth.loading &&
    !auth.tokenExpired &&
    !auth.tokenError;
  const scope = JSON.stringify([userId, schoolId, courseId, sessionId, !!enabled]);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    scope: string;
    user: typeof auth.user;
    loading: boolean;
    sessions: AttendanceSession[];
    error: boolean;
  }>({ scope, user: auth.user, loading: true, sessions: [], error: false });

  useEffect(() => {
    let cancelled = false;
    setState({ scope, user: auth.user, loading: !!enabled, sessions: [], error: false });
    if (!enabled) return;
    listAttendanceSessions(userId, courseId, schoolId).then(
      (sessions) => {
        if (!cancelled)
          setState({
            scope,
            user: auth.user,
            loading: false,
            sessions: sessions.filter(
              (session) => session.groupId === courseId && session.sourceSystem !== 'tronclass',
            ),
            error: false,
          });
      },
      () => {
        if (!cancelled)
          setState({ scope, user: auth.user, loading: false, sessions: [], error: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [scope, auth.user, enabled, userId, courseId, schoolId, revision]);

  const current = state.scope === scope && state.user === auth.user ? state : null;
  const sessions = current?.sessions ?? [];
  const requestedSession = sessionId
    ? sessions.find((session) => session.id === sessionId && session.active)
    : undefined;
  const activeSessions = sessionId
    ? requestedSession
      ? [requestedSession]
      : []
    : sessions.filter((session) => session.active).slice(0, 1);
  const loading = enabled && (!current || current.loading);
  const refresh = () => setRevision((value) => value + 1);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surfaceMuted }}
      contentContainerStyle={courseChipScrollContentStyle(true)}
      accessibilityLabel="課堂簽到與點名紀錄"
      refreshControl={
        <RefreshControl refreshing={loading && revision > 0} onRefresh={refresh} tintColor={theme.colors.accent} />
      }
    >
      <View style={{ gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: theme.colors.accentSoft }}>
            <Ionicons name="qr-code-outline" color={theme.colors.accent} size={25} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 24, fontWeight: '700', color: theme.colors.text }}>課堂簽到</Text>
            <Text style={{ fontSize: 12, lineHeight: 21, color: theme.colors.muted }}>只顯示授課教師正式開啟的點名</Text>
          </View>
        </View>
        {loading ? (
          <LoadingState title="課堂簽到" subtitle="正在確認課程與點名場次…" rows={2} />
        ) : null}
        {current?.error ? (
          <Card title="無法讀取點名紀錄" subtitle="請確認登入狀態與網路連線後重試。">
            <Button text="重新讀取" kind="ghost" onPress={refresh} />
          </Card>
        ) : !loading && activeSessions.length > 0 ? (
          activeSessions.map((session) => (
            <Card
              key={session.id}
              title={session.groupName}
              subtitle="點名進行中 · 請進入課堂掃描老師顯示的 QR Code。"
            >
              <Text style={{ color: theme.colors.textSecondary, lineHeight: 21, marginBottom: 12 }}>
                {session.startedAt ? `開始時間：${session.startedAt.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}` : '等待開始時間同步'}
              </Text>
              <Button
                text="進入課堂簽到"
                icon="qr-code-outline"
                onPress={() => {
                  safeNavigate(navigation, 'Classroom', {
                    groupId: session.groupId,
                    groupName: session.groupName,
                    sessionId: session.id,
                  });
                }}
              />
            </Card>
          ))
        ) : !loading ? (
          <Card
            title="目前沒有可用的課堂簽到"
            subtitle={
              !userId
                ? '請先登入，再從課程開啟老師發起的點名。'
                : !supportedCourse
                  ? '此入口尚未開放正式簽到。請回到課程，使用老師提供的點名入口。'
                  : sessionId
                    ? '這場點名可能已結束，或尚未開放給目前帳號。請回到課程確認最新場次。'
                    : '請等老師開始點名後重新整理，或從課程開啟目前進行中的課堂。'
            }
          >
            {enabled ? <Button text="重新確認" kind="ghost" onPress={refresh} /> : null}
          </Card>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: 16, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
          <Ionicons name="shield-checkmark-outline" size={21} color={theme.colors.accent} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }}>以伺服器簽到結果為準</Text>
            <Text style={{ color: theme.colors.muted, lineHeight: 21, fontSize: 12 }}>
              此頁不會直接建立出席紀錄。進入課堂掃碼後，請確認出現「已完成簽到」。數字密碼、定位和自拍簽到尚未開放。
            </Text>
          </View>
        </View>
        {!loading && sessions.length > 0 ? (
          <Card title="本課程點名紀錄" subtitle="最近五次點名">
            <View style={{ gap: 12 }}>
              {sessions.slice(0, 5).map((session) => (
                <View key={session.id} style={{ gap: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 }}>
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                      {session.startedAt?.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) ?? '未提供開始時間'}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                      已簽到 {session.attendeeCount ?? 0} 人
                    </Text>
                  </View>
                  <Text style={{ color: session.active ? theme.colors.success : theme.colors.muted, fontSize: 12, fontWeight: '700' }}>
                    {session.active ? '進行中' : '已結束'}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}
      </View>
    </ScrollView>
  );
}
