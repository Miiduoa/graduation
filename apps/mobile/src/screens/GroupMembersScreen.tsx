/* eslint-disable */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View, Pressable, Alert, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Card,
  Button,
  Pill,
  LoadingState,
  ErrorState,
  SectionTitle,
  AnimatedCard,
  SearchBar,
  Avatar,
  SegmentedControl,
} from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { getDb, isFirebaseMockMode } from '../firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { useAsyncList } from '../hooks/useAsyncList';
import { loadClubRoster } from '../services/clubRoster';
import { fetchSchoolDirectoryProfiles } from '../services/memberDirectory';
import {
  createGroupOwnershipOrigin,
  isGroupOwnershipOriginCurrent,
  transferGroupOwnership,
  transferGroupOwnershipErrorMessage,
  type GroupOwnershipOrigin,
} from '../services/groupOwnership';

type MemberRole = 'admin' | 'owner' | 'instructor' | 'moderator' | 'member';

type Member = {
  uid: string;
  publicName?: string;
  role?: MemberRole;
  status?: string;
  joinedAt?: any;
};

type UserProfile = {
  uid: string;
  displayName?: string | null;
  department?: string | null;
  avatarUrl?: string | null;
};

type Group = {
  id: string;
  type: 'course' | 'club' | 'admin';
  name: string;
  createdBy?: string;
};

function getRoleLabel(role?: string): string {
  switch (role) {
    case 'owner':
      return '擁有者';
    case 'instructor':
      return '教師';
    case 'admin':
    case 'moderator':
      return '管理員';
    case 'member':
    default:
      return '成員';
  }
}

function getRoleIcon(role?: string): string {
  switch (role) {
    case 'owner':
      return 'star';
    case 'instructor':
      return 'school';
    case 'admin':
    case 'moderator':
      return 'shield-checkmark';
    case 'member':
    default:
      return 'person';
  }
}

export function GroupMembersScreen(props: any) {
  const nav = props?.navigation;
  const groupId: string | undefined = props?.route?.params?.groupId;
  const auth = useAuth();
  const { school } = useSchool();
  const db = getDb();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'instructors' | 'members'>('all');
  const [managingMember, setManagingMember] = useState<string | null>(null);
  const [transferringOwnership, setTransferringOwnership] = useState(false);
  const [pendingTransferTarget, setPendingTransferTarget] = useState<string | null>(null);
  const ownershipGeneration = useRef(0);
  const ownershipMounted = useRef(true);
  useEffect(() => {
    ownershipMounted.current = true;
    ownershipGeneration.current += 1;
    // New scope gets a clean transfer UI; in-flight origins keep their own operationId.
    setTransferringOwnership(false);
    setPendingTransferTarget(null);
    setManagingMember(null);
    return () => {
      ownershipMounted.current = false;
      ownershipGeneration.current += 1;
    };
  }, [auth.user?.uid, school.id, groupId]);

  const { items: groupMeta, reload: reloadGroup } = useAsyncList<Group>(async () => {
    if (isFirebaseMockMode()) return [];
    if (!groupId) return [];
    const snap = await getDoc(doc(db, 'groups', groupId));
    if (!snap.exists()) return [];
    return [{ id: snap.id, ...(snap.data() as any) }];
  }, [db, groupId, auth.user?.uid, school.id]);

  const group = groupMeta[0];

  const { items, loading, error, reload } = useAsyncList<Member>(async () => {
    if (isFirebaseMockMode()) return [];
    if (!groupId || !group || !auth.user) return [];
    if (group.type === 'club') {
      const mine = await getDoc(doc(db, 'groups', groupId, 'members', auth.user.uid));
      if (!['owner', 'admin', 'instructor', 'moderator'].includes(mine.data()?.role)) {
        const roster = await loadClubRoster(auth.user.uid, school.id, groupId);
        return roster.map((m, i) => ({ uid: `public-${i}`, role: m.role, publicName: m.name }));
      }
    }
    const ref = collection(db, 'groups', groupId, 'members');
    const qy = query(ref, where('status', '==', 'active'));
    const snap = await getDocs(qy);
    return snap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
  }, [db, groupId, group?.type, auth.user?.uid, school.id]);

  const { items: myMemberRows, reload: reloadMyMembership } = useAsyncList<{
    role?: MemberRole;
    status?: string;
  }>(async () => {
    if (isFirebaseMockMode()) return [];
    if (!groupId || !auth.user) return [];
    const snap = await getDoc(doc(db, 'groups', groupId, 'members', auth.user.uid));
    if (!snap.exists()) return [];
    return [snap.data() as any];
  }, [db, groupId, auth.user?.uid, school.id]);

  const myRole = myMemberRows[0]?.role;
  const canManageMembers =
    myRole === 'owner' || myRole === 'admin' || myRole === 'instructor' || myRole === 'moderator';

  const { items: userProfiles } = useAsyncList<UserProfile>(async () => {
    if (isFirebaseMockMode()) return [];
    if (items.length === 0 || items[0]?.publicName !== undefined) return [];
    return fetchSchoolDirectoryProfiles(
      school.id,
      items.map((member) => member.uid),
      db,
    );
  }, [db, school.id, items.map((m) => m.uid).join(',')]);

  const profilesById = useMemo(() => {
    const map: Record<string, UserProfile> = {};
    for (const p of userProfiles) {
      map[p.uid] = p;
    }
    return map;
  }, [userProfiles]);

  const rows = useMemo(() => {
    let list = [...items];
    const roleOrder: Record<string, number> = { owner: 0, instructor: 1, moderator: 2, member: 3 };

    if (selectedFilter === 'instructors') {
      list = list.filter(
        (m) => m.role === 'owner' || m.role === 'instructor' || m.role === 'moderator',
      );
    } else if (selectedFilter === 'members') {
      list = list.filter((m) => m.role === 'member' || !m.role);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((m) => {
        const profile = profilesById[m.uid];
        const searchStr =
          `${m.publicName ?? profile?.displayName ?? ''} ${profile?.department ?? ''} ${m.uid}`.toLowerCase();
        return searchStr.includes(q);
      });
    }

    list.sort((a, b) => {
      if (a.uid === auth.user?.uid) return -1;
      if (b.uid === auth.user?.uid) return 1;
      const roleA = roleOrder[a.role ?? 'member'] ?? 3;
      const roleB = roleOrder[b.role ?? 'member'] ?? 3;
      if (roleA !== roleB) return roleA - roleB;
      return a.uid.localeCompare(b.uid);
    });
    return list;
  }, [items, auth.user?.uid, searchQuery, selectedFilter, profilesById]);

  const memberCount = items.length;
  const instructorCount = items.filter((m) => m.role === 'owner' || m.role === 'instructor').length;

  const handleChangeRole = async (uid: string, newRole: MemberRole) => {
    if (!groupId || !auth.user || !canManageMembers) return;

    const member = items.find((m) => m.uid === uid);
    if (member?.role === 'owner' && newRole !== 'owner') {
      Alert.alert('無法更改', '無法降級群組擁有者的權限');
      return;
    }

    // Ownership must go through the privileged transfer callable — never client role writes.
    if (newRole === 'owner') {
      Alert.alert('請使用擁有權轉讓', '請改用「轉讓擁有權」完成轉移，不能直接把角色改成擁有者。');
      return;
    }

    Alert.alert('確認更改角色', `確定要將此成員的角色更改為「${getRoleLabel(newRole)}」嗎？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '確認',
        onPress: async () => {
          try {
            await setDoc(
              doc(db, 'groups', groupId, 'members', uid),
              { role: newRole, updatedAt: serverTimestamp() },
              { merge: true },
            );

            await setDoc(
              doc(db, 'users', uid, 'groups', groupId),
              { role: newRole },
              { merge: true },
            );

            reload();
            setManagingMember(null);
            Alert.alert('成功', '已更新成員角色');
          } catch (e: any) {
            Alert.alert('錯誤', e?.message ?? '更新角色失敗');
          }
        },
      },
    ]);
  };

  const runOwnershipTransfer = async (origin: GroupOwnershipOrigin, displayName: string) => {
    const live = {
      generation: ownershipGeneration.current,
      uid: auth.user?.uid,
      schoolId: school.id,
      groupId,
    };
    if (!isGroupOwnershipOriginCurrent(origin, live) || !ownershipMounted.current) {
      return;
    }
    setTransferringOwnership(true);
    setPendingTransferTarget(origin.targetUid);
    try {
      const result = await transferGroupOwnership({
        groupId: origin.groupId,
        targetUid: origin.targetUid,
        operationId: origin.operationId,
        expectedCurrentOwnerUid: origin.uid,
      });
      if (!ownershipMounted.current || !isGroupOwnershipOriginCurrent(origin, {
        generation: ownershipGeneration.current,
        uid: auth.user?.uid,
        schoolId: school.id,
        groupId,
      })) {
        return;
      }
      // Receipt / callable result is not proof of current ownership — re-read actor seat.
      const actorSnap = await getDoc(doc(db, 'groups', origin.groupId, 'members', origin.uid));
      if (!ownershipMounted.current || !isGroupOwnershipOriginCurrent(origin, {
        generation: ownershipGeneration.current,
        uid: auth.user?.uid,
        schoolId: school.id,
        groupId,
      })) {
        return;
      }
      const actorNow = actorSnap.exists() ? (actorSnap.data() as { role?: string; status?: string }) : {};
      if (actorNow.status !== 'active' || actorNow.role === 'owner') {
        Alert.alert(
          '請更新列表',
          '轉讓已送出，但目前還無法確認你已失去擁有者身分。請更新成員列表後再操作。',
        );
        reload();
        reloadGroup();
        reloadMyMembership();
        return;
      }
      reload();
      reloadGroup();
      reloadMyMembership();
      setManagingMember(null);
      setPendingTransferTarget(null);
      Alert.alert(
        '已轉讓擁有權',
        `「${displayName}」現在是群組擁有者。你的角色已改為「${getRoleLabel(
          typeof result.actorNewRole === 'string' ? result.actorNewRole : actorNow.role || 'member',
        )}」，之後若要退出此群組，可再執行退出。`,
      );
    } catch (error) {
      if (!ownershipMounted.current || !isGroupOwnershipOriginCurrent(origin, {
        generation: ownershipGeneration.current,
        uid: auth.user?.uid,
        schoolId: school.id,
        groupId,
      })) {
        return;
      }
      Alert.alert('轉讓失敗', transferGroupOwnershipErrorMessage(error), [
        { text: '關閉', style: 'cancel' },
        {
          text: '用同一操作重試',
          onPress: () => void runOwnershipTransfer(origin, displayName),
        },
      ]);
    } finally {
      if (
        ownershipMounted.current &&
        isGroupOwnershipOriginCurrent(origin, {
          generation: ownershipGeneration.current,
          uid: auth.user?.uid,
          schoolId: school.id,
          groupId,
        })
      ) {
        setTransferringOwnership(false);
      }
    }
  };

  const promptTransferOwnership = (member: Member) => {
    if (!groupId || !auth.user || myRole !== 'owner') return;
    if (member.uid === auth.user.uid || member.role === 'owner') return;
    if (auth.loading || auth.profileLoading) {
      Alert.alert('請稍候', '正在確認登入身分，請稍後再轉讓擁有權。');
      return;
    }

    const profile = profilesById[member.uid];
    const displayName = profile?.displayName || member.uid.slice(0, 8);
    const origin = createGroupOwnershipOrigin({
      generation: ownershipGeneration.current,
      uid: auth.user.uid,
      schoolId: school.id,
      groupId,
      targetUid: member.uid,
    });

    Alert.alert(
      '確認轉讓擁有權',
      `確定將此群組的擁有權轉給「${displayName}」？\n\n轉讓成功後，對方會成為唯一擁有者；你會改為一般成員，之後才能退出此群組。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '確認轉讓',
          style: 'destructive',
          onPress: () => void runOwnershipTransfer(origin, displayName),
        },
      ],
    );
  };

  const handleRemoveMember = async (uid: string) => {
    if (!groupId || !auth.user || !canManageMembers) return;

    const member = items.find((m) => m.uid === uid);
    if (member?.role === 'owner') {
      Alert.alert('無法移除', '無法移除群組擁有者');
      return;
    }

    const profile = profilesById[uid];
    const displayName = profile?.displayName || uid.slice(0, 8);

    Alert.alert('確認移除成員', `確定要將「${displayName}」從群組中移除嗎？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDoc(doc(db, 'groups', groupId, 'members', uid));
            await deleteDoc(doc(db, 'users', uid, 'groups', groupId));
            reload();
            setManagingMember(null);
            Alert.alert('成功', '已移除成員');
          } catch (e: any) {
            Alert.alert('錯誤', e?.message ?? '移除成員失敗');
          }
        },
      },
    ]);
  };

  return (
    <Screen>
      {loading ? (
        <LoadingState title="成員" subtitle="載入中..." rows={4} />
      ) : error ? (
        <ErrorState
          title="成員"
          subtitle="讀取成員失敗"
          hint={error}
          actionText="重試"
          onAction={reload}
        />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
        >
          <AnimatedCard
            title={group?.name ?? '群組成員'}
            subtitle={`共 ${memberCount} 人${instructorCount > 0 ? ` · 教師 ${instructorCount} 人` : ''}`}
          >
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View
                style={{
                  flex: 1,
                  alignItems: 'center',
                  padding: 12,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.accentSoft,
                }}
              >
                <Text style={{ color: theme.colors.accent, fontWeight: '700', fontSize: 24 }}>
                  {memberCount}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                  總人數
                </Text>
              </View>
              <View
                style={{
                  flex: 1,
                  alignItems: 'center',
                  padding: 12,
                  borderRadius: theme.radius.md,
                  backgroundColor: `${theme.colors.success}15`,
                }}
              >
                <Text style={{ color: theme.colors.success, fontWeight: '700', fontSize: 24 }}>
                  {instructorCount}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                  教師/管理員
                </Text>
              </View>
              <View
                style={{
                  flex: 1,
                  alignItems: 'center',
                  padding: 12,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface2,
                }}
              >
                <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 24 }}>
                  {memberCount - instructorCount}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                  一般成員
                </Text>
              </View>
            </View>

            {canManageMembers && (
              <View
                style={{
                  marginTop: 12,
                  padding: 10,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.accentSoft,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="shield-checkmark" size={16} color={theme.colors.accent} />
                  <Text style={{ color: theme.colors.accent, fontWeight: '600', fontSize: 13 }}>
                    你擁有管理成員的權限
                  </Text>
                </View>
              </View>
            )}
          </AnimatedCard>

          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="搜尋成員（姓名、系所、UID）"
          />

          <SegmentedControl
            options={[
              { key: 'all', label: `全部 (${items.length})` },
              { key: 'instructors', label: `教師 (${instructorCount})` },
              { key: 'members', label: `成員 (${items.length - instructorCount})` },
            ]}
            selected={selectedFilter}
            onChange={(k) => setSelectedFilter(k as any)}
          />

          {rows.map((m, idx) => {
            const isMe = m.uid === auth.user?.uid;
            const profile = profilesById[m.uid];
            const displayName = m.publicName ?? profile?.displayName ?? `${m.uid.slice(0, 8)}…`;
            const subtitle =
              m.publicName !== undefined
                ? ''
                : [profile?.department, m.uid.slice(0, 8)].filter(Boolean).join('｜');
            const isManaging = managingMember === m.uid;

            return (
              <AnimatedCard key={m.uid} delay={idx * 30}>
                <Pressable
                  onPress={() => {
                    if (!auth.user) return;
                    if (canManageMembers && !isMe) {
                      setManagingMember(isManaging ? null : m.uid);
                    } else if (!isMe && m.publicName === undefined) {
                      nav?.navigate?.('Chat', { kind: 'dm', peerId: m.uid });
                    }
                  }}
                  style={{
                    padding: 14,
                    borderRadius: theme.radius.lg,
                    borderWidth: 1,
                    borderColor: isMe
                      ? 'rgba(124,92,255,0.45)'
                      : isManaging
                        ? theme.colors.accent
                        : theme.colors.border,
                    backgroundColor: isMe ? theme.colors.accentSoft : theme.colors.surface,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ position: 'relative' }}>
                      {profile?.avatarUrl ? (
                        <Avatar name={displayName} size={48} imageUrl={profile.avatarUrl} />
                      ) : (
                        <View
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: 24,
                            backgroundColor: theme.colors.surface2,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Text
                            style={{ color: theme.colors.accent, fontWeight: '700', fontSize: 18 }}
                          >
                            {displayName[0]?.toUpperCase() ?? '?'}
                          </Text>
                        </View>
                      )}
                      {(m.role === 'owner' || m.role === 'instructor') && (
                        <View
                          style={{
                            position: 'absolute',
                            bottom: -2,
                            right: -2,
                            width: 20,
                            height: 20,
                            borderRadius: 10,
                            backgroundColor: m.role === 'owner' ? '#FF9500' : theme.colors.accent,
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderWidth: 2,
                            borderColor: theme.colors.bg,
                          }}
                        >
                          <Ionicons
                            name={m.role === 'owner' ? 'star' : 'school'}
                            size={10}
                            color="#fff"
                          />
                        </View>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                        }}
                      >
                        <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 16 }}>
                          {displayName}
                        </Text>
                        {isMe && <Pill text="我" kind="accent" />}
                        <Pill
                          text={getRoleLabel(m.role)}
                          kind={
                            m.role === 'owner' || m.role === 'instructor' ? 'accent' : 'default'
                          }
                        />
                      </View>
                      {subtitle && (
                        <Text style={{ color: theme.colors.muted, marginTop: 4 }}>{subtitle}</Text>
                      )}
                    </View>
                    <Ionicons
                      name={isManaging ? 'chevron-up' : 'chevron-forward'}
                      size={20}
                      color={theme.colors.muted}
                    />
                  </View>

                  {isManaging && canManageMembers && !isMe && (
                    <View
                      style={{
                        marginTop: 14,
                        paddingTop: 14,
                        borderTopWidth: 1,
                        borderTopColor: theme.colors.border,
                      }}
                    >
                      <Text
                        style={{ color: theme.colors.muted, fontWeight: '600', marginBottom: 10 }}
                      >
                        管理成員
                      </Text>

                      <View style={{ gap: 8 }}>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>更改角色：</Text>
                        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                          {(['member', 'moderator', 'instructor'] as MemberRole[]).map((role) => (
                            <Pressable
                              key={role}
                              onPress={() => handleChangeRole(m.uid, role)}
                              style={{
                                paddingHorizontal: 14,
                                paddingVertical: 8,
                                borderRadius: theme.radius.md,
                                borderWidth: 1,
                                borderColor:
                                  m.role === role ? theme.colors.accent : theme.colors.border,
                                backgroundColor:
                                  m.role === role ? theme.colors.accentSoft : theme.colors.surface2,
                              }}
                            >
                              <Text
                                style={{
                                  color: m.role === role ? theme.colors.accent : theme.colors.text,
                                  fontWeight: '600',
                                  fontSize: 13,
                                }}
                              >
                                {getRoleLabel(role)}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>

                      {myRole === 'owner' && m.role !== 'owner' && (
                        <View style={{ marginTop: 12 }}>
                          <Button
                            text={
                              transferringOwnership && pendingTransferTarget === m.uid
                                ? '轉讓中...'
                                : '轉讓擁有權'
                            }
                            kind="outline"
                            disabled={
                              transferringOwnership ||
                              Boolean(auth.loading) ||
                              Boolean(auth.profileLoading)
                            }
                            onPress={() => promptTransferOwnership(m)}
                          />
                          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 6 }}>
                            轉讓後對方會成為唯一擁有者；你會改為一般成員。
                          </Text>
                        </View>
                      )}

                      <View
                        style={{ marginTop: 14, flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}
                      >
                        <Button
                          text="私訊"
                          kind="primary"
                          onPress={() => nav?.navigate?.('Chat', { kind: 'dm', peerId: m.uid })}
                        />
                        {m.role !== 'owner' && (
                          <Pressable
                            onPress={() => handleRemoveMember(m.uid)}
                            style={{
                              paddingVertical: 14,
                              paddingHorizontal: 20,
                              borderRadius: theme.radius.md,
                              borderWidth: 1,
                              borderColor: theme.colors.danger,
                              backgroundColor: `${theme.colors.danger}10`,
                            }}
                          >
                            <Text style={{ color: theme.colors.danger, fontWeight: '700' }}>
                              移除成員
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  )}

                  {!isManaging &&
                    !isMe &&
                    auth.user &&
                    !canManageMembers &&
                    m.publicName === undefined && (
                      <View
                        style={{ marginTop: 12, flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}
                      >
                        <Button
                          text="私訊"
                          kind="primary"
                          onPress={() => nav?.navigate?.('Chat', { kind: 'dm', peerId: m.uid })}
                        />
                      </View>
                    )}
                </Pressable>
              </AnimatedCard>
            );
          })}

          {rows.length === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Ionicons name="people-outline" size={48} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted, marginTop: 12, textAlign: 'center' }}>
                {searchQuery ? '找不到符合的成員' : '目前沒有成員'}
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}
