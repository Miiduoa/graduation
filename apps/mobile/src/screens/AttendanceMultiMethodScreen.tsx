/**
 * Attendance Multi-Method Screen — 5 種點名方式的學生簽到頁
 *
 * 學生視角：依 session.method 渲染對應 UI
 *   - rotating_qr      → 開相機掃描
 *   - number_code      → 輸入數字框
 *   - geofence         → 取得 GPS 並顯示距離
 *   - selfie_liveness  → 拍臉（簡化版：用 expo-image-picker 拍照）
 *   - multi_factor     → 依序執行子方法
 *
 * 整合 attendanceEngine 在 client 端先預檢 → 通過後呼 verifyAttendanceClaim cloud function。
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import {
  verifyAttendance,
  type AttendanceSessionConfig,
  type AttendanceClaim,
} from '@campus/shared';
import AttendanceMethodPicker from '../components/AttendanceMethodPicker';
import { listAttendanceSessions } from '../data/courseSpaceSource';
import {
  isDemoCourseId,
  demoListAttendanceSessions,
  toDemoCourseId,
} from '../data/demoCoursesAdapter';
import { useAuth } from '../state/auth';
import { emitAttendanceCheckedIn } from '../services/roleEventBus';
import {
  isAttendanceMethodSupported,
  parseAttendanceConfirmation,
} from '../services/attendanceConfirmation';
import {
  canCheckInAttendance,
  getAttendanceCheckInTargets,
} from '../services/roleEventTargets';
import { DEMO_COURSES } from '../data/demoCoursesMock';
import { theme } from '../ui/theme';
import { Skeleton } from '../ui/components';
import { CourseChipHeader, CourseDemoDataRibbon, courseChipScrollContentStyle } from '../ui/courseChipShell';

function attendanceStatusLabel(
  s: 'present' | 'late' | 'absent' | 'excused' | null | undefined,
): { text: string; color: string } {
  switch (s) {
    case 'present':
      return { text: '出席', color: theme.colors.success };
    case 'late':
      return { text: '遲到', color: theme.colors.warning };
    case 'absent':
      return { text: '缺席', color: theme.colors.danger };
    case 'excused':
      return { text: '核准假', color: theme.colors.info };
    default:
      return { text: '—', color: theme.colors.muted };
  }
}

type RouteProps = {
  route?: {
    params?: {
      sessionConfig?: AttendanceSessionConfig;
      courseId?: string;
      sessionId?: string;
    };
  };
};

const DEMO_CFG: AttendanceSessionConfig = {
  sessionId: 'demo',
  courseId: 'demo',
  method: 'rotating_qr',
  classStartAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  lateAfterAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  secret: 'demo-secret-1234',
};

export default function AttendanceMultiMethodScreen(props: RouteProps) {
  const navigation = useNavigation();
  const auth = useAuth();
  const cfg = props.route?.params?.sessionConfig ?? DEMO_CFG;
  const courseId = props.route?.params?.courseId ?? cfg.courseId;
  const sessionId = props.route?.params?.sessionId ?? cfg.sessionId;

  const [token, setToken] = useState('');
  const [code, setCode] = useState('');
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracyMeters?: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverConfirmed, setServerConfirmed] = useState(false);
  const [result, setResult] = useState<{ status: string; flags: string[]; valid: boolean; reason?: string } | null>(
    null,
  );

  // 課程歷史出席記錄
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyRefreshing, setHistoryRefreshing] = useState(false);
  const [history, setHistory] = useState<
    Array<{
      id: string;
      startedAt: Date | null;
      active: boolean;
      attendeeCount?: number;
      myStatus?: 'present' | 'late' | 'absent' | 'excused' | null;
      totalCount?: number;
    }>
  >([]);

  const fetchHistoryData = useCallback(async () => {
    const demoId = toDemoCourseId(courseId);
    if (isDemoCourseId(demoId)) {
      const demoSessions = demoListAttendanceSessions(demoId);
      setHistory(
        demoSessions.map((s) => ({
          id: s.id,
          startedAt: s.startedAt,
          active: s.active,
          attendeeCount: s.attendeeCount,
          totalCount: s.totalCount,
          myStatus: s.myStatus,
        })),
      );
    } else {
      const sessions = await listAttendanceSessions(courseId);
      setHistory(
        sessions.map((s) => ({
          id: s.id,
          startedAt: s.startedAt,
          active: s.active,
          attendeeCount: s.attendeeCount,
        })),
      );
    }
  }, [courseId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setHistoryLoading(true);
      try {
        await fetchHistoryData();
      } catch {
        /* swallow */
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchHistoryData]);

  const onRefreshHistory = useCallback(async () => {
    setHistoryRefreshing(true);
    try {
      await fetchHistoryData();
    } catch {
      /* swallow */
    } finally {
      setHistoryRefreshing(false);
    }
  }, [fetchHistoryData]);

  const hasActiveSession = history.some((h) => h.active);

  const handleGetLocation = useCallback(async () => {
    try {
      const Location = await import('expo-location').catch(() => null);
      if (!Location) {
        Alert.alert('需要定位權限', '請安裝 expo-location');
        return;
      }
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('無法取得位置', '請開啟位置權限');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setLocation({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyMeters: pos.coords.accuracy ?? undefined,
      });
    } catch (e) {
      Alert.alert('取得位置失敗', String((e as Error)?.message ?? e));
    }
  }, []);

  const handleScanQr = useCallback(() => {
    Alert.alert('QR 掃描', 'demo 模式：請手動輸入老師螢幕上的 6 位 token', [
      {
        text: 'OK',
      },
    ]);
  }, []);

  const submitAttendance = useCallback(async () => {
    if (submitting) return;
    if (!isAttendanceMethodSupported(cfg.method, cfg.multiFactorMethods)) {
      Alert.alert('無法使用此簽到方式', '此畫面沒有實作可信的自拍活體辨識或指定的多因素組合，請聯絡授課老師。');
      return;
    }

    const actorUid = auth.user?.uid?.trim();
    if (!actorUid || !canCheckInAttendance(auth.profile?.role)) {
      Alert.alert('無法簽到', '請以已登入的學生身分操作。');
      return;
    }

    setSubmitting(true);
    setServerConfirmed(false);
    setResult(null);
    try {
      const claim: AttendanceClaim = {
        uid: actorUid,
        claimedAt: new Date().toISOString(),
        token: token || undefined,
        code: code || undefined,
        location: location ?? undefined,
      };

      // Local validation is a preflight only; it must never publish attendance.
      const localResult = verifyAttendance(claim, cfg);
      setResult(localResult);
      if (!localResult.valid) {
        Alert.alert('簽到未通過', localResult.reason ?? '請檢查輸入');
        return;
      }

      try {
        const { httpsCallable, getFunctions } = await import('firebase/functions');
        const { getFirebaseApp, getCloudFunctionRegion } = await import('../firebase');
        const app = getFirebaseApp();
        const callable = httpsCallable(
          getFunctions(app, getCloudFunctionRegion()),
          'verifyAttendanceClaim',
        );
        const response = await callable({ courseId, sessionId, claim });
        const confirmation = parseAttendanceConfirmation(response.data);
        if (!confirmation) {
          throw new Error('Attendance was not confirmed by the server');
        }

        setServerConfirmed(true);
        setResult({ ...localResult, status: confirmation.status });

        try {
          const { onAttendanceCheckin } = await import('../services/companionHooks');
          onAttendanceCheckin({ sessionId: sessionId ?? '', courseSpaceId: courseId });
        } catch {
          // Companion hints do not affect the verified attendance result.
        }

        // Local demo inbox notification only; never target a demo teacher for real courses.
        if (isDemoCourseId(toDemoCourseId(courseId))) {
          try {
            const targets = getAttendanceCheckInTargets(actorUid);
            if (targets.length > 0) {
              const numericCourseId = Number(String(courseId).replace(/^tc:/, '')) || 0;
              const courseName = DEMO_COURSES.find((c) => c.id === numericCourseId)?.name ?? '課程';
              await emitAttendanceCheckedIn({
                actorUid,
                actorName: auth.profile?.displayName ?? '學生',
                targetUids: targets,
                courseId: numericCourseId,
                courseName,
                payload: {
                  sessionId: sessionId ?? '',
                  studentName: auth.profile?.displayName ?? '學生',
                  status: confirmation.status,
                  method: cfg.method,
                },
              });
            }
          } catch {
            // A local demo notification failure must not undo the server result.
          }
        }

        Alert.alert('簽到完成', `伺服器已確認：${confirmation.status === 'late' ? '遲到' : '出席'}`, [
          { text: '完成', onPress: () => navigation.goBack() },
        ]);
      } catch {
        setServerConfirmed(false);
        setResult({
          ...localResult,
          valid: false,
          reason: 'server_not_confirmed',
          flags: [...localResult.flags, 'server_not_confirmed'],
        });
        Alert.alert(
          '尚未完成簽到',
          '本機檢查通過，但伺服器沒有確認出席紀錄。沒有自動補傳機制，請重試或聯絡授課老師。',
        );
      }
    } catch (e) {
      Alert.alert('簽到失敗', String((e as Error)?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  }, [
    token,
    code,
    location,
    cfg,
    courseId,
    sessionId,
    navigation,
    submitting,
    auth.user?.uid,
    auth.profile?.role,
    auth.profile?.displayName,
  ]);

  const ready = useMemo(() => {
    if (!isAttendanceMethodSupported(cfg.method, cfg.multiFactorMethods)) return false;
    switch (cfg.method) {
      case 'rotating_qr':
        return !!token;
      case 'number_code':
        return !!code;
      case 'geofence':
        return !!location;
      case 'multi_factor':
        // 至少要 token + location（demo）
        return !!token && !!location;
      default:
        return false;
    }
  }, [cfg.method, cfg.multiFactorMethods, token, code, location]);

  const demoCourse = isDemoCourseId(toDemoCourseId(courseId));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surfaceMuted }}
      contentContainerStyle={courseChipScrollContentStyle(true)}
      accessibilityLabel="智慧簽到與出席紀錄"
      refreshControl={
        <RefreshControl
          refreshing={historyRefreshing}
          title="重新整理"
          tintColor={theme.colors.primary}
          accessibilityLabel="重新整理出席紀錄"
          onRefresh={onRefreshHistory}
        />
      }
    >
      {demoCourse ? (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: theme.space.sm }}>
          <CourseDemoDataRibbon />
        </View>
      ) : null}
      <CourseChipHeader
        emoji="✅"
        eyebrow="智慧簽到"
        title="課堂簽到"
        meta={courseId ? `課程 ${String(courseId)}` : undefined}
      />

      {/* ── 課程歷史出席（最上方） ── */}
      {historyLoading ? (
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            padding: theme.space.md,
            marginBottom: theme.space.lg,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
          accessibilityLabel="載入出席紀錄"
        >
          <Skeleton height={14} width={140} />
          {[0, 1, 2].map((i) => (
            <View key={`h-sk-${i}`} style={{ marginTop: theme.space.md }}>
              <Skeleton height={40} />
            </View>
          ))}
        </View>
      ) : null}

      {!historyLoading && history.length > 0 && (
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            padding: 12,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.text, marginBottom: 8 }}>
            📊 本課程出席紀錄
          </Text>
          {history.slice(0, 5).map((h) => {
            const mine = attendanceStatusLabel(h.myStatus);
            return (
              <View
                key={h.id}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  paddingVertical: 8,
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.separator,
                  gap: 8,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                    {h.startedAt ? h.startedAt.toLocaleString('zh-TW') : '—'}
                  </Text>
                  <Text style={{ fontSize: 11, color: mine.color, fontWeight: '600', marginTop: 4 }}>
                    我的狀態 · {mine.text}
                  </Text>
                </View>
                <Text
                  style={{
                    fontSize: 12,
                    color: h.active ? theme.colors.danger : theme.colors.success,
                    fontWeight: '600',
                    textAlign: 'right',
                  }}
                >
                  {h.active ? '進行中' : `✓ ${h.attendeeCount ?? '—'} 人`}
                </Text>
              </View>
            );
          })}
          {history.length > 5 && (
            <Text style={{ fontSize: 11, color: theme.colors.muted, marginTop: 4 }}>
              共 {history.length} 次點名，僅顯示最近 5 次
            </Text>
          )}
        </View>
      )}

      {!historyLoading && history.length === 0 && (
        <View
          style={{
            backgroundColor: theme.colors.gentleWarnSoft,
            borderRadius: theme.radius.lg,
            padding: 12,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: `${theme.colors.gentleWarn}44`,
          }}
        >
          <Text style={{ fontSize: 13, color: theme.colors.text, lineHeight: 20 }}>
            本課程目前尚無點名紀錄。老師開啟 Session 後，此處會顯示週次與你的出席狀態摘要。
          </Text>
        </View>
      )}

      {!hasActiveSession && history.length > 0 && (
        <View
          style={{
            backgroundColor: theme.colors.calmSoft,
            borderRadius: theme.radius.lg,
            padding: 12,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: `${theme.colors.calm}44`,
          }}
        >
          <Text style={{ fontSize: 13, color: theme.colors.text, lineHeight: 20 }}>
            目前沒有進行中的點名。下方仍可依教師設定預覽簽到方式；正式簽到請在開課時操作。
          </Text>
        </View>
      )}

      <AttendanceMethodPicker selected={cfg.method} readonly />

      <View style={{ marginTop: 20, gap: 12 }}>
        {(cfg.method === 'rotating_qr' || cfg.method === 'multi_factor') && (
          <View>
            <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.text }}>📱 QR token</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              <TextInput
                value={token}
                onChangeText={setToken}
                placeholder="輸入 6 位 token"
                placeholderTextColor={theme.colors.muted}
                autoCapitalize="characters"
                maxLength={6}
                accessibilityLabel="QR 簽到 token"
                style={{
                  flex: 1,
                  padding: 10,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  fontSize: 16,
                  color: theme.colors.text,
                }}
              />
              <Pressable
                onPress={handleScanQr}
                accessibilityRole="button"
                accessibilityLabel="掃描 QR"
                style={{
                  minWidth: 48,
                  minHeight: 48,
                  paddingHorizontal: 14,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="scan-outline" size={20} color={theme.colors.onAccent} />
              </Pressable>
            </View>
          </View>
        )}

        {cfg.method === 'number_code' && (
          <View>
            <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.text }}>🔢 數字密碼</Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="輸入老師唸的數字"
              placeholderTextColor={theme.colors.muted}
              keyboardType="number-pad"
              maxLength={6}
              accessibilityLabel="數字簽到密碼"
              style={{
                marginTop: 6,
                padding: 10,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                fontSize: 18,
                textAlign: 'center',
                letterSpacing: 8,
                color: theme.colors.text,
              }}
            />
          </View>
        )}

        {(cfg.method === 'geofence' || cfg.method === 'multi_factor') && (
          <View>
            <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.text }}>📍 GPS 位置</Text>
            <Pressable
              onPress={handleGetLocation}
              style={{
                marginTop: 6,
                padding: 12,
                borderRadius: theme.radius.md,
                backgroundColor: location ? theme.colors.successSoft : theme.colors.primary,
                alignItems: 'center',
                minHeight: 48,
                justifyContent: 'center',
              }}
            >
              <Text
                style={{
                  color: location ? theme.colors.success : theme.colors.onAccent,
                  fontWeight: '600',
                }}
              >
                {location
                  ? `✓ 已取得位置 (精度 ${Math.round(location.accuracyMeters ?? 0)}m)`
                  : '點此取得目前位置'}
              </Text>
            </Pressable>
          </View>
        )}

        {cfg.method === 'selfie_liveness' && (
          <View style={{ padding: 12, backgroundColor: theme.colors.gentleWarnSoft, borderRadius: theme.radius.md }}>
            <Text style={{ color: theme.colors.text, lineHeight: 20 }}>
              自拍活體驗證尚未接入可信的身分辨識服務，這裡不會使用隨機分數判定通過。請改用授課老師提供的其他簽到方式。
            </Text>
          </View>
        )}

        <Pressable
          onPress={submitAttendance}
          disabled={!ready || submitting}
          accessibilityRole="button"
          accessibilityLabel={ready ? '送出簽到' : '請先完成簽到所需輸入'}
          style={{
            marginTop: 20,
            padding: 14,
            borderRadius: theme.radius.lg,
            backgroundColor: ready ? theme.colors.success : theme.colors.disabledBg,
            alignItems: 'center',
            opacity: submitting ? 0.7 : 1,
            minHeight: 52,
            justifyContent: 'center',
          }}
        >
          {submitting ? (
            <ActivityIndicator color={theme.colors.onAccent} />
          ) : (
            <Text
              style={{
                color: ready ? theme.colors.onAccent : theme.colors.disabledText,
                fontSize: 16,
                fontWeight: '700',
              }}
            >
              {ready ? '送出簽到' : '請完成上方輸入'}
            </Text>
          )}
        </Pressable>
      </View>

      {result && (
        <View
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: theme.radius.md,
            backgroundColor: result.valid ? theme.colors.successSoft : theme.colors.dangerSoft,
            borderWidth: 1,
            borderColor: result.valid ? `${theme.colors.success}44` : `${theme.colors.danger}44`,
          }}
        >
          <Text
            style={{
              fontSize: 13,
              color: result.valid ? theme.colors.success : theme.colors.danger,
              fontWeight: '500',
            }}
          >
            {serverConfirmed ? '伺服器已確認簽到' : result.valid ? '本機預檢通過，仍待伺服器確認' : '簽到未完成'}：{result.status}
            {result.flags.length > 0 ? ` ・ 旗標：${result.flags.join(', ')}` : ''}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
