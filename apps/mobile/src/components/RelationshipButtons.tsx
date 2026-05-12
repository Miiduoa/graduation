/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert, StyleSheet, type ViewStyle } from 'react-native';
import { theme } from '../ui/theme';
import {
  sendFriendRequest,
  acceptFriendRequest,
  removeFriendship,
  getFriendshipBetween,
  blockFromPending,
  type Friendship,
} from '../services/friends';
import { useSchool } from '../state/school';
import { isFirebaseMockMode } from '../firebase';

export type RelationshipButtonsProps = {
  profileUid: string;
  myUid: string;
  friendship: Friendship | null | undefined;
  loadingRel: boolean;
  navigation: unknown;
  onFriendshipChange: (uid: string, f: Friendship | null) => void;
  /** 已是好友時是否顯示「解除」 */
  showUnfriend?: boolean;
  style?: ViewStyle;
};

export function RelationshipButtons(props: RelationshipButtonsProps) {
  const {
    profileUid,
    myUid,
    friendship,
    loadingRel,
    navigation: navigationProp,
    onFriendshipChange,
    showUnfriend = false,
    style,
  } = props;
  const nav = navigationProp as any;
  const { school } = useSchool();
  const [busy, setBusy] = useState(false);

  const status = friendship?.status;
  const isIncomingPending =
    status === 'pending' &&
    friendship &&
    friendship.toUid === myUid &&
    friendship.fromUid !== myUid;
  const isOutgoingPending =
    status === 'pending' &&
    friendship &&
    friendship.fromUid === myUid &&
    friendship.toUid === profileUid;
  const isFriend = status === 'accepted';
  const isBlocked = status === 'blocked';

  const onAddFriend = async () => {
    if (!school?.id) return;
    setBusy(true);
    try {
      await sendFriendRequest(school.id, myUid, profileUid);
      const next = await getFriendshipBetween(school.id, myUid, profileUid);
      onFriendshipChange(profileUid, next);
      Alert.alert('已送出邀請');
    } catch (e: any) {
      Alert.alert('無法送出', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const onAccept = async () => {
    if (!friendship?.id || !school?.id) return;
    setBusy(true);
    try {
      await acceptFriendRequest(friendship.id);
      const next = await getFriendshipBetween(school.id, myUid, profileUid);
      onFriendshipChange(profileUid, next);
    } catch (e: any) {
      Alert.alert('接受失敗', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const onBlockIncoming = () => {
    if (!friendship?.id || !school?.id) return;
    Alert.alert('封鎖對方', '對方將無法再以這筆邀請與你互動（可稍後移除封鎖紀錄）。', [
      { text: '取消', style: 'cancel' },
      {
        text: '封鎖',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await blockFromPending(friendship.id);
            const next = await getFriendshipBetween(school.id, myUid, profileUid);
            onFriendshipChange(profileUid, next);
          } catch (e: any) {
            Alert.alert('封鎖失敗', e?.message ?? String(e));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const onRemove = () => {
    if (!friendship?.id) return;
    Alert.alert('確定要移除此筆關係？', '撤回邀請、略過邀請或解除好友皆會刪除這筆紀錄。', [
      { text: '取消', style: 'cancel' },
      {
        text: '確定',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await removeFriendship(friendship.id);
            onFriendshipChange(profileUid, null);
          } catch (e: any) {
            Alert.alert('操作失敗', e?.message ?? String(e));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const onMessage = () => {
    nav?.navigate?.('Chat', { peerId: profileUid });
  };

  if (isFirebaseMockMode()) {
    return <Text style={styles.meta}>模擬模式</Text>;
  }

  return (
    <View style={[styles.row, style]}>
      {loadingRel ? (
        <ActivityIndicator size="small" color={theme.colors.accent} />
      ) : isBlocked ? (
        <View style={styles.inline}>
          <Text style={styles.meta}>你已封鎖此對象</Text>
          <Pressable onPress={onRemove} style={[styles.btn, styles.btnOutline]} disabled={busy}>
            <Text style={styles.btnOutlineText}>移除封鎖</Text>
          </Pressable>
        </View>
      ) : isFriend ? (
        <View style={styles.inline}>
          <Pressable onPress={onMessage} style={[styles.btn, styles.btnPrimary]} disabled={busy}>
            <Text style={styles.btnPrimaryText}>私訊</Text>
          </Pressable>
          {showUnfriend ? (
            <Pressable onPress={onRemove} style={[styles.btn, styles.btnOutline]} disabled={busy}>
              <Text style={styles.btnOutlineText}>解除</Text>
            </Pressable>
          ) : null}
        </View>
      ) : isIncomingPending ? (
        <View style={styles.inline}>
          <Pressable onPress={onAccept} style={[styles.btn, styles.btnPrimary]} disabled={busy}>
            <Text style={styles.btnPrimaryText}>接受好友</Text>
          </Pressable>
          <Pressable onPress={onRemove} style={[styles.btn, styles.btnGhost]} disabled={busy}>
            <Text style={styles.btnGhostText}>略過</Text>
          </Pressable>
          <Pressable onPress={onBlockIncoming} style={[styles.btn, styles.btnOutline]} disabled={busy}>
            <Text style={[styles.btnOutlineText, { color: theme.colors.danger }]}>封鎖</Text>
          </Pressable>
        </View>
      ) : isOutgoingPending ? (
        <View style={styles.inline}>
          <Text style={styles.meta}>邀請已送出</Text>
          <Pressable onPress={onRemove} style={[styles.btn, styles.btnOutline]} disabled={busy}>
            <Text style={styles.btnOutlineText}>撤回</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Pressable onPress={onAddFriend} style={[styles.btn, styles.btnOutline]} disabled={busy}>
            <Text style={styles.btnOutlineText}>加好友</Text>
          </Pressable>
          <Pressable onPress={onMessage} style={[styles.btn, styles.btnGhost]} disabled={busy}>
            <Text style={styles.btnGhostText}>私訊</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  btn: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10 },
  btnOutline: {
    borderWidth: 1,
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.bg,
  },
  btnOutlineText: { color: theme.colors.accent, fontWeight: '800', fontSize: 13 },
  btnPrimary: { backgroundColor: theme.colors.accent },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  btnGhost: { backgroundColor: theme.colors.surface2 },
  btnGhostText: { color: theme.colors.text, fontWeight: '700', fontSize: 13 },
  meta: { color: theme.colors.muted, fontSize: 13 },
});
