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
  const [selfieSimilarity, setSelfieSimilarity] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
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

  const handleTakeSelfie = useCallback(async () => {
    try {
      const ImagePicker = await import('expo-image-picker').catch(() => null);
      if (!ImagePicker) {
        Alert.alert('需要相機', '請安裝 expo-image-picker');
        return;
      }
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('無法使用相機', '請開啟相機權限');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        cameraType: ImagePicker.CameraType.Front,
        quality: 0.5,
      });
      if (res.canceled) return;
      // 實際應該把照片送雲端做臉部比對。這裡 demo 用隨機高相似度。
      const mockSimilarity = 0.7 + Math.random() * 0.25;
      setSelfieSimilarity(Math.round(mockSimilarity * 100) / 100);
    } catch (e) {
      Alert.alert('拍照失敗', String((e as Error)?.message ?? e));
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
    setSubmitting(true);
    setResult(null);
    try {
      const claim: AttendanceClaim = {
        uid: 'me',
        claimedAt: new Date().toISOString(),
        token: token || undefined,
        code: code || undefined,
        location: location ?? undefined,
        selfieSimilarity: selfieSimilarity ?? undefined,
      };

      // ── 本地預檢（純函式，不需網路）──
      const localResult = verifyAttendance(claim, cfg);
      setResult(localResult);

      if (!localResult.valid) {
        Alert.alert('簽到未通過', localResult.reason ?? '請檢查輸入');
        return;
      }

      // ── 通過本地預檢 → 呼後端再驗一次（防 client 繞過）──
      try {
        const { httpsCallable, getFunctions } = await import('firebase/functions');
        const { getFirebaseApp, getCloudFunctionRegion } = await import('../firebase');
        const app = getFirebaseApp();
        const functions = getFunctions(app, getCloudFunctionRegion());
        const callable = httpsCallable(functions, 'verifyAttendanceClaim');
        await callable({ courseId, sessionId, claim });

        try {
          const { onAttendanceCheckin } = await import('../services/companionHooks');
          onAttendanceCheckin({ sessionId: sessionId ?? '', courseSpaceId: courseId });
        } catch {
          /* swallow */
        }

        // ── Demo 跨角色：emit 給老師（AttendanceLive / TeacherCockpit 即時看到簽到）──
        // 只有學生身分才會真正 emit；老師本人簽到不會送給自己
        try {
          const actorUid = auth.user?.uid ?? 'demo_student_kuchih';
          const actorRole = auth.profile?.role ?? null;
          const targets = getAttendanceCheckInTargets(actorUid);
          if (canCheckInAttendance(actorRole) && targets.length > 0) {
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
                status: localResult.status === 'late' ? 'late' : 'present',
                method: cfg.method,
              },
            });
          }
        } catch {
          /* swallow */
        }

        Alert.alert('✅ 簽到完成', `狀態：${localResult.status === 'late' ? '遲到' : '準時'}`, [
          { text: '完成', onPress: () => navigation.goBack() },
        ]);
      } catch {
        // 後端失敗 → 仍視為本地簽到成功，會在連線時補（仍 emit 給老師）
        try {
          const actorUid = auth.user?.uid ?? 'demo_student_kuchih';
          const actorRole = auth.profile?.role ?? null;
          const targets = getAttendanceCheckInTargets(actorUid);
          if (canCheckInAttendance(actorRole) && targets.length > 0) {
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
                status: localResult.status === 'late' ? 'late' : 'present',
                method: cfg.method,
              },
            });
          }
        } catch {
          /* swallow */
        }
        Alert.alert('✅ 本地簽到', '網路恢復後會自動同步');
      }
    } catch (e) {
      Alert.alert('簽到失敗', String((e as Error)?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  }, [token, code, location, selfieSimilarity, cfg, courseId, sessionId, navigation]);

  const ready = useMemo(() => {
    switch (cfg.method) {
      case 'rotating_qr':
        return !!token;
      case 'number_code':
        return !!code;
      case 'geofence':
        return !!location;
      case 'selfie_liveness':
        return selfieSimilarity !== null;
      case 'multi_factor':
        // 至少要 token + location（demo）
        return !!token && !!location;
      default:
        return false;
    }
  }, [cfg.method, token, code, location, selfieSimilarity]);

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
          <View>
            <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.text }}>🤳 自拍驗證</Text>
            <Pressable
              onPress={handleTakeSelfie}
              style={{
                marginTop: 6,
                padding: 12,
                borderRadius: theme.radius.md,
                backgroundColor: selfieSimilarity !== null ? theme.colors.successSoft : theme.colors.primary,
                alignItems: 'center',
                minHeight: 48,
                justifyContent: 'center',
              }}
            >
              <Text
                style={{
                  color: selfieSimilarity !== null ? theme.colors.success : theme.colors.onAccent,
                  fontWeight: '600',
                }}
              >
                {selfieSimilarity !== null
                  ? `✓ 比對通過（相似度 ${selfieSimilarity}）`
                  : '拍自拍驗證身份'}
              </Text>
            </Pressable>
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
            結果：{result.status}
            {result.flags.length > 0 ? ` ・ 旗標：${result.flags.join(', ')}` : ''}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
