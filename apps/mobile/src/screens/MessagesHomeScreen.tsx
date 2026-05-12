/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
import React, { useMemo, useEffect, useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { collection, query, where, limit, orderBy, onSnapshot } from 'firebase/firestore';
import { Card, Button, Pill, Badge } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme, softShadowStyle } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { getDb, isFirebaseMockMode } from '../firebase';
import { fetchSchoolDirectoryProfiles } from '../services/memberDirectory';
import { formatRelativeTime, toDate } from '../utils/format';

type GroupSummary = {
  id: string;
  name: string;
  type: string;
  unreadCount?: number;
  lastActivity?: Date;
};

type ConversationSummary = {
  id: string;
  peerId?: string;
  participantName: string;
  lastMessage?: string;
  lastMessageAt?: Date;
  unread: boolean;
};

export function MessagesHomeScreen(props: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = props?.navigation as any;
  const auth = useAuth();
  const { school } = useSchool();
  const db = getDb();
  const insets = useSafeAreaInsets();

  const [groupsCount, setGroupsCount] = useState(0);
  const [unreadGroupsCount, setUnreadGroupsCount] = useState(0);
  const [recentGroups, setRecentGroups] = useState<GroupSummary[]>([]);
  const [unreadDmsCount, setUnreadDmsCount] = useState(0);
  const [recentDms, setRecentDms] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [inboxFilter, setInboxFilter] = useState('');

  const filteredRecentGroups = useMemo(() => {
    const q = inboxFilter.trim().toLowerCase();
    if (!q) return recentGroups;
    return recentGroups.filter((g) => (g.name ?? '').toLowerCase().includes(q));
  }, [recentGroups, inboxFilter]);

  const filteredRecentDms = useMemo(() => {
    const q = inboxFilter.trim().toLowerCase();
    if (!q) return recentDms;
    return recentDms.filter(
      (d) =>
        (d.participantName ?? '').toLowerCase().includes(q) ||
        (d.lastMessage ?? '').toString().toLowerCase().includes(q),
    );
  }, [recentDms, inboxFilter]);

  useEffect(() => {
    if (isFirebaseMockMode()) {
      setLoading(false);
      return;
    }
    if (!auth.user) {
      setLoading(false);
      return;
    }

    let unsubscribeGroups: (() => void) | undefined;
    let unsubscribeDms: (() => void) | undefined;

    const loadData = async () => {
      try {
        const groupsRef = collection(db, 'users', auth.user.uid, 'groups');
        const groupsQ = query(
          groupsRef,
          where('schoolId', '==', school.id),
          where('status', '==', 'active'),
          limit(5),
        );

        unsubscribeGroups = onSnapshot(
          groupsQ,
          (snap) => {
            const groups = snap.docs.map((d) => {
              const data = d.data();
              return {
                id: data.groupId,
                name: data.name,
                type: data.type,
                unreadCount: data.unreadCount ?? 0,
                lastActivity: data.lastActivity ? toDate(data.lastActivity) : undefined,
              } as GroupSummary;
            });

            setGroupsCount(snap.size);
            setUnreadGroupsCount(groups.filter((g) => (g.unreadCount ?? 0) > 0).length);
            setRecentGroups(groups.slice(0, 3));
          },
          (error) => {
            console.warn('[MessagesHome] Groups snapshot error:', error);
          },
        );

        const dmsRef = collection(db, 'conversations');
        const dmsQ = query(
          dmsRef,
          where('memberIds', 'array-contains', auth.user.uid),
          where('schoolId', '==', school.id),
          orderBy('updatedAt', 'desc'),
          limit(5),
        );

        unsubscribeDms = onSnapshot(
          dmsQ,
          async (snap) => {
            const conversations = await Promise.all(
              snap.docs.map(async (d) => {
                const data = d.data();
                const memberIds = Array.isArray(data.memberIds)
                  ? data.memberIds
                  : Array.isArray(data.participants)
                    ? data.participants
                    : [];
                const otherUserId = memberIds.find((p: string) => p !== auth.user?.uid);
                let participantName = '未知用戶';

                if (otherUserId) {
                  try {
                    const [profile] = await fetchSchoolDirectoryProfiles(
                      school.id,
                      [otherUserId],
                      db,
                    );
                    participantName = profile?.displayName || '用戶';
                  } catch {
                    // ignore
                  }
                }

                const lastReadAt = data.lastReadBy?.[auth.user?.uid];
                const lastMessageAt = data.lastMessageAt ? toDate(data.lastMessageAt) : undefined;
                const unread =
                  lastMessageAt && lastReadAt
                    ? lastMessageAt > toDate(lastReadAt)!
                    : !!lastMessageAt;

                return {
                  id: d.id,
                  peerId: otherUserId,
                  participantName,
                  lastMessage: data.lastMessage?.content || data.lastMessageText,
                  lastMessageAt:
                    lastMessageAt || (data.updatedAt ? toDate(data.updatedAt) : undefined),
                  unread,
                } as ConversationSummary;
              }),
            );

            setUnreadDmsCount(conversations.filter((c) => c.unread).length);
            setRecentDms(conversations.slice(0, 3));
          },
          (error) => {
            console.warn('[MessagesHome] DMs snapshot error:', error);
          },
        );
      } catch (e) {
        console.warn('[MessagesHome] Failed to load:', e);
      } finally {
        setLoading(false);
      }
    };

    loadData();

    return () => {
      unsubscribeGroups?.();
      unsubscribeDms?.();
    };
  }, [auth.user?.uid, db, school.id]);

  const totalUnread = unreadGroupsCount + unreadDmsCount;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + theme.space.md,
          paddingHorizontal: theme.space.lg,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
          gap: theme.space.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: theme.space.xs }}>
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: theme.typography.overline.fontSize,
              fontWeight: theme.typography.overline.fontWeight ?? '700',
              letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
              textTransform: 'uppercase',
            }}
          >
            訊息
          </Text>
          <Text
            style={{
              color: theme.colors.text,
              fontSize: theme.typography.display.fontSize,
              fontWeight: theme.typography.display.fontWeight ?? '800',
              letterSpacing: theme.typography.display.letterSpacing,
            }}
          >
            對話
          </Text>
        </View>

        <Pressable
          onPress={() => nav?.getParent()?.navigate?.('Today', { screen: 'CampusSocialScreen' })}
          accessibilityRole="button"
          accessibilityLabel="開啟校園社群"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space.md,
            paddingHorizontal: theme.space.md,
            paddingVertical: theme.space.md,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.socialSoft,
            borderWidth: 1,
            borderColor: theme.colors.social + '35',
            opacity: pressed ? 0.88 : 1,
          })}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: theme.colors.social + '22',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="planet-outline" size={20} color={theme.colors.social} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 15 }}>校園社群</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
              動態、看板、即時、學伴
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
        </Pressable>

        {auth.user ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: theme.space.md,
                paddingVertical: theme.space.sm,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.lg,
              }}
            >
              <Ionicons name="search" size={18} color={theme.colors.muted} />
              <TextInput
                value={inboxFilter}
                onChangeText={setInboxFilter}
                placeholder="搜尋此頁群組與私訊預覽"
                placeholderTextColor={theme.colors.muted}
                style={{ flex: 1, paddingVertical: 6, color: theme.colors.text, fontSize: 15 }}
              />
              {inboxFilter.length > 0 && (
                <Pressable hitSlop={8} onPress={() => setInboxFilter('')}>
                  <Ionicons name="close-circle" size={18} color={theme.colors.muted} />
                </Pressable>
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="好友與邀請"
              onPress={() => nav?.navigate?.('FriendsManage')}
              style={({ pressed }) => ({
                width: 46,
                height: 46,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Ionicons name="people-outline" size={22} color={theme.colors.accent} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="搜尋同校聯絡人並加好友"
              onPress={() => nav?.navigate?.('FriendSearch')}
              style={({ pressed }) => ({
                width: 46,
                height: 46,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.accentSoft,
                borderWidth: 1,
                borderColor: theme.colors.accent + '40',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Ionicons name="person-add-outline" size={22} color={theme.colors.accent} />
            </Pressable>
          </View>
        ) : null}

        {auth.user && totalUnread > 0 && (
          <View style={{ gap: theme.space.sm, flexDirection: 'row' }}>
            {unreadGroupsCount > 0 && (
              <View
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space.xs,
                  paddingHorizontal: theme.space.md,
                  paddingVertical: theme.space.sm,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.lg,
                }}
              >
                <Ionicons name="people" size={14} color={theme.colors.accent} />
                <Text style={{ color: theme.colors.accent, fontWeight: '700', fontSize: 13 }}>
                  {unreadGroupsCount}
                </Text>
              </View>
            )}
            {unreadDmsCount > 0 && (
              <View
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space.xs,
                  paddingHorizontal: theme.space.md,
                  paddingVertical: theme.space.sm,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.lg,
                }}
              >
                <Ionicons name="chatbubble" size={14} color={theme.colors.accent} />
                <Text style={{ color: theme.colors.accent, fontWeight: '700', fontSize: 13 }}>
                  {unreadDmsCount}
                </Text>
              </View>
            )}
          </View>
        )}

        {auth.user && recentGroups.length > 0 && (
          <View style={{ gap: theme.space.md }}>
            <Text
              style={{
                color: theme.colors.muted,
                fontSize: theme.typography.overline.fontSize,
                fontWeight: theme.typography.overline.fontWeight ?? '700',
                letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
                textTransform: 'uppercase',
              }}
            >
              群組
            </Text>
            {filteredRecentGroups.length === 0 ? (
              <Text style={{ color: theme.colors.muted, fontSize: 14, paddingHorizontal: 4 }}>
                沒有符合的群組
              </Text>
            ) : (
              filteredRecentGroups.map((g) => (
              <Pressable
                key={g.id}
                onPress={() => nav?.navigate?.('GroupDetail', { groupId: g.id })}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: theme.space.md,
                  paddingVertical: theme.space.md,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: g.unreadCount ? theme.colors.accent + '30' : theme.colors.border,
                  gap: theme.space.md,
                  opacity: pressed ? 0.82 : 1,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: g.type === 'course' ? '#6366f120' : '#22c55e20',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons
                    name={g.type === 'course' ? 'school' : 'people'}
                    size={18}
                    color={g.type === 'course' ? '#6366f1' : '#22c55e'}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}
                    numberOfLines={1}
                  >
                    {g.name}
                  </Text>
                  {g.lastActivity && (
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                      {formatRelativeTime(g.lastActivity)}
                    </Text>
                  )}
                </View>
                {(g.unreadCount ?? 0) > 0 && (
                  <View
                    style={{
                      minWidth: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: theme.colors.accent,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 11 }}>
                      {g.unreadCount! > 99 ? '99+' : g.unreadCount}
                    </Text>
                  </View>
                )}
              </Pressable>
              ))
            )}
            <Pressable
              onPress={() => nav?.navigate?.('Groups')}
              style={({ pressed }) => ({
                paddingHorizontal: theme.space.md,
                paddingVertical: theme.space.md,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                alignItems: 'center',
                opacity: pressed ? 0.82 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <Text style={{ color: theme.colors.accent, fontWeight: '700', fontSize: 15 }}>
                查看全部
              </Text>
            </Pressable>
          </View>
        )}

        {auth.user && recentDms.length > 0 && (
          <View style={{ gap: theme.space.md }}>
            <Text
              style={{
                color: theme.colors.muted,
                fontSize: theme.typography.overline.fontSize,
                fontWeight: theme.typography.overline.fontWeight ?? '700',
                letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
                textTransform: 'uppercase',
              }}
            >
              私訊
            </Text>
            {filteredRecentDms.length === 0 ? (
              <Text style={{ color: theme.colors.muted, fontSize: 14, paddingHorizontal: 4 }}>
                沒有符合的私訊預覽
              </Text>
            ) : (
              filteredRecentDms.map((dm) => (
              <Pressable
                key={dm.id}
                onPress={() => nav?.navigate?.('Chat', { peerId: dm.peerId, conversationId: dm.id })}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: theme.space.md,
                  paddingVertical: theme.space.md,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: dm.unread ? theme.colors.accent + '30' : theme.colors.border,
                  gap: theme.space.md,
                  opacity: pressed ? 0.82 : 1,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: '#3b82f620',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: '#3b82f6', fontWeight: '800', fontSize: 16 }}>
                    {dm.participantName[0]?.toUpperCase() ?? '?'}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontSize: 15,
                      fontWeight: dm.unread ? '800' : '700',
                    }}
                    numberOfLines={1}
                  >
                    {dm.participantName}
                  </Text>
                  {dm.lastMessage && (
                    <Text
                      style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}
                      numberOfLines={1}
                    >
                      {dm.lastMessage}
                    </Text>
                  )}
                </View>
                {dm.unread && (
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: theme.colors.accent,
                    }}
                  />
                )}
              </Pressable>
              ))
            )}
            <Pressable
              onPress={() => nav?.navigate?.('Dms')}
              style={({ pressed }) => ({
                paddingHorizontal: theme.space.md,
                paddingVertical: theme.space.md,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                alignItems: 'center',
                opacity: pressed ? 0.82 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <Text style={{ color: theme.colors.accent, fontWeight: '700', fontSize: 15 }}>
                查看全部
              </Text>
            </Pressable>
          </View>
        )}

        {!auth.user && (
          <View style={{ paddingVertical: theme.space.lg, alignItems: 'center' }}>
            <Text style={{ color: theme.colors.muted, fontSize: 14 }}>請先登入以查看訊息。</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({});
