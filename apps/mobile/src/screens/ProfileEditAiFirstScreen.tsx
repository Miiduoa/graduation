import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { AIDetailScreen, AISection, AIButton, aiTokens } from '../ui/aiFirst';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { useAuth, type UserProfile } from '../state/auth';
import { firebaseSource } from '../data/firebaseSource';
import { loadFailureCopy } from '../utils/loadFailureCopy';

export default function ProfileEditAiFirstScreen() {
  const auth = useAuth();
  const navigation = useNavigation();
  const uid = auth.user?.uid;
  const profile = auth.profile?.uid === uid ? auth.profile : null;
  const scope = JSON.stringify([uid, profile?.schoolId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;

  if (!uid || !profile || auth.profileLoading) {
    return (
      <AIDetailScreen title="個人資料" onBack={() => navigation.goBack()}>
        <AISection title="帳號資料">
          {auth.profileLoading ? (
            <ActivityIndicator accessibilityLabel="讀取個人資料" color={aiTokens.ai} />
          ) : (
            <Text style={{ padding: 16, color: aiTokens.textSecondary }}>
              {uid && !auth.profile
                ? auth.error || loadFailureCopy()
                : '目前無法讀取個人資料，請確認登入狀態後重新開啟。'}
            </Text>
          )}
        </AISection>
      </AIDetailScreen>
    );
  }

  return (
    <ProfileForm
      key={scope}
      uid={uid}
      profile={profile}
      email={auth.user?.email || profile.email || ''}
      isCurrent={() => currentScope.current === scope}
      refreshProfile={auth.refreshProfile}
      onBack={() => navigation.goBack()}
    />
  );
}

function ProfileForm({
  uid,
  profile,
  email,
  isCurrent,
  refreshProfile,
  onBack,
}: {
  uid: string;
  profile: UserProfile;
  email: string;
  isCurrent: () => boolean;
  refreshProfile: () => Promise<void>;
  onBack: () => void;
}) {
  const styles = useThemeStyleSheet(createStyles);
  const [name, setName] = useState(profile.displayName ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [savedFields, setSavedFields] = useState({ name, bio, phone });
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const navigation = useNavigation();
  const inputs = useMemo(() => ({ name, bio, phone }), [name, bio, phone]);
  const currentInputs = useRef(inputs);
  const pendingRemoval = useRef<symbol | null>(null);
  const canEdit = !uid.startsWith('demo_');
  const dirty = name !== savedFields.name || bio !== savedFields.bio || phone !== savedFields.phone;
  useLayoutEffect(() => {
    currentInputs.current = inputs;
  }, [inputs]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingRemoval.current = null;
    };
  }, []);

  // Guard native/system back as well as the custom header. A confirmation only
  // authorizes the current account's exact inputs, never a later save or screen.
  usePreventRemove(canEdit && (dirty || saving), ({ data }) => {
    if (!mounted.current || !isCurrent() || inFlight.current || pendingRemoval.current) return;
    const id = Symbol('profile-leave-confirmation');
    const expectedInputs = currentInputs.current;
    pendingRemoval.current = id;
    const release = () => {
      if (pendingRemoval.current === id) pendingRemoval.current = null;
    };
    Alert.alert(
      '尚有未儲存的內容',
      '離開後，這次修改的個人資料將不會儲存。',
      [
        { text: '繼續編輯', style: 'cancel', onPress: release },
        {
          text: '捨棄並離開',
          style: 'destructive',
          onPress: () => {
            if (pendingRemoval.current !== id) return;
            release();
            if (
              !mounted.current ||
              !isCurrent() ||
              inFlight.current ||
              currentInputs.current !== expectedInputs ||
              !navigation.isFocused()
            )
              return;
            navigation.dispatch(data.action);
          },
        },
      ],
      { cancelable: true, onDismiss: release },
    );
  });

  const save = async () => {
    if (!canEdit || !isCurrent() || inFlight.current) return;
    if (!name.trim()) {
      Alert.alert('請填寫顯示名稱', '顯示名稱不能留白。');
      return;
    }
    const patch = { displayName: name.trim(), bio: bio.trim(), phone: phone.trim() };
    pendingRemoval.current = null;
    inFlight.current = true;
    setSaving(true);
    try {
      const updated = await firebaseSource.updateUser(uid, patch);
      if (!mounted.current || !isCurrent()) return;
      if (
        updated.id !== uid ||
        updated.displayName !== patch.displayName ||
        (updated.bio ?? '') !== patch.bio ||
        (updated.phone ?? '') !== patch.phone
      ) {
        throw new Error('profile-update-unconfirmed');
      }
      setName(updated.displayName);
      setBio(updated.bio ?? '');
      setPhone(updated.phone ?? '');
      setSavedFields({
        name: updated.displayName,
        bio: updated.bio ?? '',
        phone: updated.phone ?? '',
      });
      Alert.alert('已儲存', '個人資料已更新。');
      void refreshProfile().catch(() => undefined);
    } catch {
      if (mounted.current && isCurrent()) {
        Alert.alert('無法確認儲存結果', '未收到資料更新的確認，請檢查網路後重試。');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current && isCurrent()) setSaving(false);
    }
  };

  return (
    <AIDetailScreen
      title="個人資料"
      onBack={onBack}
      rightAction={
        canEdit ? (
          <AIButton
            label={saving ? '儲存中…' : '儲存'}
            size="sm"
            disabled={saving}
            onPress={() => void save()}
          />
        ) : undefined
      }
    >
      {!canEdit ? (
        <Text style={styles.notice}>目前帳號僅能查看個人資料，未提供儲存服務。</Text>
      ) : null}
      <AISection title="基本資訊">
        <View style={styles.field}>
          <Text style={styles.label}>顯示名稱</Text>
          <TextInput
            accessibilityLabel="顯示名稱"
            style={styles.input}
            value={name}
            onChangeText={setName}
            editable={canEdit && !saving}
            maxLength={80}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>個人簡介</Text>
          <TextInput
            accessibilityLabel="個人簡介"
            style={[styles.input, styles.multiline]}
            value={bio}
            onChangeText={setBio}
            editable={canEdit && !saving}
            multiline
            maxLength={500}
          />
        </View>
      </AISection>
      <AISection title="學校資料" subtitle="這些資料由目前帳號提供，無法在此修改">
        <ReadonlyField label="學號" value={profile.studentId} />
        <ReadonlyField label="系所" value={profile.department} />
      </AISection>
      <AISection title="聯絡方式">
        <ReadonlyField label="登入電子郵件" value={email} />
        <View style={styles.field}>
          <Text style={styles.label}>電話</Text>
          <TextInput
            accessibilityLabel="電話"
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            editable={canEdit && !saving}
            keyboardType="phone-pad"
            maxLength={40}
          />
        </View>
      </AISection>
    </AIDetailScreen>
  );
}

function ReadonlyField({ label, value }: { label: string; value?: string | null }) {
  const styles = useThemeStyleSheet(createStyles);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value?.trim() || '尚未提供'}</Text>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    field: { padding: 16, gap: 8 },
    label: { fontSize: 13, fontWeight: '600', color: aiTokens.textSecondary },
    value: { fontSize: 15, color: aiTokens.text, lineHeight: 22 },
    input: {
      minHeight: 44,
      backgroundColor: aiTokens.surface,
      borderWidth: 1,
      borderColor: aiTokens.border,
      borderRadius: aiTokens.radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: aiTokens.text,
    },
    multiline: { minHeight: 100, textAlignVertical: 'top' },
    notice: { padding: 22, fontSize: 14, lineHeight: 22, color: aiTokens.muted },
  });
