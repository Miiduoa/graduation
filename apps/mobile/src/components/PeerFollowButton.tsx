/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { theme } from '../ui/theme';
import { useSchool } from '../state/school';
import { followUser, unfollowUser, isFollowing } from '../services/follows';
import { isFirebaseMockMode } from '../firebase';

type Props = {
  myUid: string;
  peerUid: string;
  compact?: boolean;
};

export function PeerFollowButton(props: Props) {
  const { myUid, peerUid, compact } = props;
  const { school } = useSchool();
  const sid = school?.id;
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!sid || !myUid || peerUid === myUid || isFirebaseMockMode()) {
      setOn(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setOn(await isFollowing(sid, myUid, peerUid));
    } catch {
      setOn(false);
    } finally {
      setLoading(false);
    }
  }, [sid, myUid, peerUid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = async () => {
    if (!sid || peerUid === myUid || !myUid) return;
    if (isFirebaseMockMode()) {
      Alert.alert('模擬模式', '無法寫入追蹤');
      return;
    }
    setBusy(true);
    try {
      if (on) await unfollowUser(sid, myUid, peerUid);
      else await followUser(sid, myUid, peerUid);
      setOn(!on);
    } catch (e: any) {
      Alert.alert('操作失敗', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!sid || peerUid === myUid) return null;
  if (loading) {
    return <ActivityIndicator size="small" color={theme.colors.accent} style={{ marginTop: 6 }} />;
  }

  return (
    <Pressable
      onPress={() => void toggle()}
      disabled={busy}
      style={[
        styles.btn,
        compact && styles.btnCompact,
        on ? styles.btnOn : styles.btnOff,
        busy && { opacity: 0.65 },
      ]}
    >
      <Text style={[styles.txt, on && styles.txtOn]}>{on ? '已追蹤' : '追蹤'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  btnCompact: { paddingVertical: 6, paddingHorizontal: 10 },
  btnOff: { borderColor: theme.colors.border, backgroundColor: theme.colors.surface2 },
  btnOn: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
  txt: { fontSize: 13, fontWeight: '700', color: theme.colors.textSecondary },
  txtOn: { color: theme.colors.accent },
});
