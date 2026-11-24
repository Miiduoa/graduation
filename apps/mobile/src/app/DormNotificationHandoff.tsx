import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getPublicSchoolInfo } from '@campus/shared/src/publicSchoolInfo';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { theme } from '../ui/theme';
import {
  getLastNotificationResponseAsync,
  clearLastNotificationResponseAsync,
} from '../services/notifications';
import { ownsDormAnnouncementTap, isDormTapAccountCurrent } from '../services/dormAnnouncementTap';
import { isStudentIdLoginAvailable } from '../services/schoolLoginAvailability';
import {
  isDormAnnouncementData,
  parseDormAnnouncementTap,
  type DormAnnouncementTap,
} from '../utils/dormAnnouncementPush';
import { SchoolSessionBoundary, hasReadySchoolSession } from './SchoolSessionBoundary';
import {
  publicNavigateSchoolLogin,
  isPublicNavigationReady,
  subscribePublicNavigationReady,
} from './publicNavigation';
import {
  rootNavigateNested,
  rootNavigationRef,
  isSchoolNavigationReady,
  subscribeSchoolNavigationReady,
} from './rootNavigation';
import {
  getNotificationResponseKey,
  usePushNotifications,
  type NotificationResponseLike,
} from './usePushNotifications';

type Pending = { key: string; data: DormAnnouncementTap };
function Action({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.action}>
      <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

/** Mounted above both navigation containers so the tap survives profile hydration and school login. */
export function DormNotificationHandoff({
  children,
  publicContent,
}: {
  children: React.ReactNode;
  publicContent: React.ReactNode;
}) {
  const auth = useAuth();
  const { selectionReady, schoolId, school, setSelection } = useSchool();
  const uid = selectionReady && hasReadySchoolSession(auth, schoolId) ? auth.user!.uid : undefined;
  const scope = JSON.stringify([
    uid,
    schoolId,
    auth.user?.uid,
    auth.profile?.uid,
    auth.tokenExpired,
  ]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [pending, setPending] = useState<Pending | null>(null);
  const current = useRef<Pending | null>(null);
  const handled = useRef<string | null>(null);
  const eventEpoch = useRef(0);
  const [readError, setReadError] = useState(false);
  const [revision, retry] = useReducer((previous: number) => previous + 1, 0);
  const onTap = useCallback((response: NotificationResponseLike | null) => {
    const key = response && getNotificationResponseKey(response);
    const raw = response?.notification?.request?.content?.data;
    if (key && (handled.current === key || current.current?.key === key)) return;
    eventEpoch.current++;
    if (!response && current.current) handled.current = current.current.key;
    const next =
      key && isDormAnnouncementData(raw) ? { key, data: parseDormAnnouncementTap(raw) } : null;
    current.current = next;
    setPending(next);
    setReadError(false);
  }, []);
  usePushNotifications(rootNavigationRef, uid, auth.profile?.role, school.id, onTap);
  useEffect(() => {
    const school = subscribeSchoolNavigationReady(retry);
    const guest = subscribePublicNavigationReady(retry);
    return () => {
      school();
      guest();
    };
  }, []);
  const finish = useCallback((item: Pending) => {
    if (current.current !== item) return;
    const epoch = eventEpoch.current;
    handled.current = item.key;
    current.current = null;
    setPending(null);
    // Other notification handlers share this native slot. Never clear a newer or unrelated tap.
    void getLastNotificationResponseAsync()
      .then((last) => {
        if (
          eventEpoch.current === epoch &&
          !current.current &&
          handled.current === item.key &&
          last &&
          getNotificationResponseKey(last) === item.key
        )
          return clearLastNotificationResponseAsync();
      })
      .catch(() => undefined);
  }, []);
  const destinationSchool = toPublicSchoolId(pending?.data.schoolId);
  const wrongSchool = !!destinationSchool && destinationSchool !== toPublicSchoolId(schoolId);
  const openInbox = (item: Pending) => {
    if (
      !uid ||
      current.current !== item ||
      !isDormTapAccountCurrent(uid) ||
      !isSchoolNavigationReady()
    )
      return;
    if (rootNavigateNested('訊息', 'Notifications')) finish(item);
  };
  useEffect(() => {
    setReadError(false);
    if (!pending || !uid || wrongSchool || !isSchoolNavigationReady()) return;
    let active = true;
    const stillCurrent = () =>
      active && current.current === pending && currentScope.current === scope;
    void ownsDormAnnouncementTap(uid, pending.data)
      .then((owned) => {
        if (!stillCurrent()) return;
        if (!isDormTapAccountCurrent(uid) || !isSchoolNavigationReady()) {
          setReadError(true);
          return;
        }
        const opened = owned
          ? rootNavigateNested('校園', 'Dormitory', {
              notificationView: 'announcements',
              sourceSchoolId: pending.data.schoolId,
              dormAnnouncementId: pending.data.dormAnnouncementId,
            })
          : rootNavigateNested('訊息', 'Notifications');
        if (opened) finish(pending);
        else setReadError(true);
      })
      .catch(() => {
        if (stillCurrent()) setReadError(true);
      });
    return () => {
      active = false;
    };
  }, [pending, uid, wrongSchool, scope, revision, finish]);

  let prompt: React.ReactNode = null;
  if (pending && selectionReady && !auth.loading && !auth.profileLoading) {
    const source = getPublicSchoolInfo(destinationSchool);
    const name = source?.name ?? '原校園';
    if (wrongSchool) {
      prompt = (
        <>
          <Text style={styles.copy}>這則宿舍通知屬於{name}。請切換校園後查看。</Text>
          {source && destinationSchool && isStudentIdLoginAvailable(destinationSchool) && (
            <Action
              title={'切換至' + name}
              onPress={() =>
                setSelection({ schoolId: destinationSchool, code: '', schoolName: name })
              }
            />
          )}
        </>
      );
    } else if (!uid) {
      prompt = (
        <>
          <Text style={styles.copy}>登入收到通知的學校帳號，即可查看本棟公告。</Text>
          {isPublicNavigationReady() &&
            isStudentIdLoginAvailable(toPublicSchoolId(schoolId) || '') && (
              <Action
                title="登入學校帳號"
                onPress={publicNavigateSchoolLogin}
              />
            )}
        </>
      );
    } else if (readError) {
      prompt = (
        <>
          <Text accessibilityRole="alert" style={styles.copy}>
            暫時無法確認這則宿舍通知，請重新連線後再試。
          </Text>
          <Action title="重試" onPress={retry} />
          <Action title="查看我的通知" onPress={() => openInbox(pending)} />
        </>
      );
    }
  }
  return (
    <>
      <SchoolSessionBoundary publicContent={publicContent}>{children}</SchoolSessionBoundary>
      {prompt && pending && (
        <SafeAreaView edges={['bottom']} style={styles.card}>
          <View style={styles.actions}>
            {prompt}
            <Action title="取消開啟" onPress={() => finish(pending)} />
          </View>
        </SafeAreaView>
      )}
    </>
  );
}
const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: theme.colors.surface,
    borderTopColor: theme.colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  copy: { flexBasis: '100%', color: theme.colors.text, fontSize: 15 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 16 },
  action: { minHeight: 44, justifyContent: 'center' },
});
