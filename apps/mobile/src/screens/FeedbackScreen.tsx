import React, { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { randomUUID } from 'expo-crypto';
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { submitGeneralFeedback, type GeneralFeedbackInput } from '../services/generalFeedback';

type FeedbackType = GeneralFeedbackInput['feedbackType'];
type Prefill = {
  title?: string;
  description?: string;
  feedbackType?: FeedbackType;
  source?: string;
};
type Props = { navigation?: { goBack?: () => void }; route?: { params?: { prefill?: Prefill } } };
const feedbackTypes: Array<{ key: FeedbackType; label: string }> = [
  { key: 'bug', label: '問題回報' },
  { key: 'feature', label: '功能建議' },
  { key: 'improvement', label: '改善建議' },
  { key: 'other', label: '其他' },
];

export function FeedbackScreen({ navigation, route }: Props) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { user } = useAuth();
  const { school } = useSchool();
  const scope = JSON.stringify([user?.uid, school.id]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const initialScope = useRef(scope);
  if (!user)
    return (
      <AIDetailScreen title="意見回饋" onBack={() => navigation?.goBack?.()}>
        <AICard title="請先登入">
          <Text style={{ color: aiTokens.muted }}>登入後即可送出回饋。</Text>
        </AICard>
      </AIDetailScreen>
    );
  return (
    <FeedbackEditor
      key={scope}
      uid={user.uid}
      email={user.email ?? ''}
      schoolId={school.id}
      isScopeCurrent={() => currentScope.current === scope}
      prefill={initialScope.current === scope ? route?.params?.prefill : undefined}
      navigation={navigation}
    />
  );
}

function FeedbackEditor({
  uid,
  email,
  schoolId,
  isScopeCurrent,
  prefill,
  navigation,
}: {
  uid: string;
  email: string;
  schoolId: string;
  isScopeCurrent: () => boolean;
  prefill?: Prefill;
  navigation?: Props['navigation'];
}) {
  const [feedbackType, setFeedbackType] = useState<FeedbackType>(
    prefill?.feedbackType && feedbackTypes.some((item) => item.key === prefill.feedbackType)
      ? prefill.feedbackType
      : 'feature',
  );
  const [title, setTitle] = useState(prefill?.title ?? '');
  const [description, setDescription] = useState(prefill?.description ?? '');
  const [contactEmail, setContactEmail] = useState(email);
  const [rating, setRating] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<string | null>(null);
  const requestId = useRef<{ id: string; fingerprint: string } | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const stackNavigation = useNavigation();
  const draft = useMemo(
    () => ({ feedbackType, title, description, contactEmail, rating }),
    [feedbackType, title, description, contactEmail, rating],
  );
  const [initialDraft, setInitialDraft] = useState(draft);
  const currentDraft = useRef(draft);
  const pendingRemoval = useRef<symbol | null>(null);
  const dirty =
    feedbackType !== initialDraft.feedbackType ||
    title !== initialDraft.title ||
    description !== initialDraft.description ||
    contactEmail !== initialDraft.contactEmail ||
    rating !== initialDraft.rating;
  useLayoutEffect(() => {
    currentDraft.current = draft;
  }, [draft]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingRemoval.current = null;
    };
  }, []);
  const current = () => mounted.current && isScopeCurrent();
  usePreventRemove(!receipt && (dirty || busy), ({ data }) => {
    if (!current() || lock.current || pendingRemoval.current) return;
    const id = Symbol('feedback-leave-confirmation');
    const expectedDraft = currentDraft.current;
    pendingRemoval.current = id;
    const release = () => {
      if (pendingRemoval.current === id) pendingRemoval.current = null;
    };
    Alert.alert(
      '尚有未送出的回饋',
      '離開後，這次填寫的回饋將不會保留。',
      [
        { text: '繼續編輯', style: 'cancel', onPress: release },
        {
          text: '捨棄並離開',
          style: 'destructive',
          onPress: () => {
            if (pendingRemoval.current !== id) return;
            release();
            if (
              !current() ||
              lock.current ||
              currentDraft.current !== expectedDraft ||
              !stackNavigation.isFocused()
            )
              return;
            stackNavigation.dispatch(data.action);
          },
        },
      ],
      { cancelable: true, onDismiss: release },
    );
  });
  const change = (update: () => void) => {
    if (lock.current || !current()) return;
    pendingRemoval.current = null;
    setError('');
    update();
  };
  const submit = async () => {
    if (lock.current || !current() || !title.trim() || !description.trim()) return;
    if (contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) {
      setError('請填寫有效的聯絡電子郵件，或留空。');
      return;
    }
    pendingRemoval.current = null;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const draft: Omit<GeneralFeedbackInput, 'requestId'> = {
        schoolId,
        kind: 'general',
        feedbackType,
        title: title.trim(),
        description: description.trim(),
        rating,
        contactEmail: contactEmail.trim() || null,
      };
      const fingerprint = JSON.stringify(draft);
      if (requestId.current?.fingerprint !== fingerprint) {
        requestId.current = { id: randomUUID(), fingerprint };
      }
      const result = await submitGeneralFeedback(
        { ...draft, requestId: requestId.current.id },
        uid,
        current,
      );
      if (current()) setReceipt(result.feedbackId);
    } catch {
      if (current()) setError('尚未確認回饋已送出，內容已保留。請確認網路後重試。');
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };
  const inputStyle = {
    color: aiTokens.text,
    backgroundColor: aiTokens.surface,
    borderColor: aiTokens.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    minHeight: 48,
  };
  if (receipt)
    return (
      <AIDetailScreen title="意見回饋" onBack={() => navigation?.goBack?.()}>
        <AICard title="回饋已送出">
          <View style={{ gap: 12 }}>
            <Text style={{ color: aiTokens.text, lineHeight: 22 }}>
              已確認收到這則回饋。謝謝你告訴我們使用時遇到的問題。
            </Text>
            <Text selectable style={{ color: aiTokens.muted }}>
              回饋編號：{receipt}
            </Text>
            <AIButton label="返回" onPress={() => navigation?.goBack?.()} />
            <AIButton
              label="提交另一則回饋"
              variant="ghost"
              onPress={() => {
                pendingRemoval.current = null;
                requestId.current = null;
                setReceipt(null);
                setTitle('');
                setDescription('');
                setRating(0);
                setFeedbackType('feature');
                setInitialDraft({
                  feedbackType: 'feature',
                  title: '',
                  description: '',
                  contactEmail,
                  rating: 0,
                });
              }}
            />
          </View>
        </AICard>
      </AIDetailScreen>
    );
  return (
    <AIDetailScreen
      title="意見回饋"
      onBack={() => {
        if (current() && !lock.current) navigation?.goBack?.();
      }}
    >
      <AICard title="意見回饋">
        <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
          描述遇到的問題或想改善的地方。若希望收到回覆，可以留下聯絡電子郵件。
        </Text>
      </AICard>
      <AICard title="回饋類型">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {feedbackTypes.map((item) => (
            <AIButton
              key={item.key}
              label={item.label}
              disabled={busy}
              variant={feedbackType === item.key ? 'primary' : 'ghost'}
              onPress={() => change(() => setFeedbackType(item.key))}
            />
          ))}
        </View>
      </AICard>
      <AICard title="詳細內容">
        <View style={{ gap: 12 }}>
          <TextInput
            accessibilityLabel="回饋標題"
            placeholder="簡短描述你的回饋"
            placeholderTextColor={aiTokens.muted}
            value={title}
            maxLength={160}
            editable={!busy}
            onChangeText={(value) => change(() => setTitle(value))}
            style={inputStyle}
          />
          <TextInput
            accessibilityLabel="回饋詳細內容"
            placeholder="描述發生的情況或你的想法"
            placeholderTextColor={aiTokens.muted}
            value={description}
            maxLength={4000}
            editable={!busy}
            multiline
            onChangeText={(value) => change(() => setDescription(value))}
            style={{ ...inputStyle, minHeight: 140, textAlignVertical: 'top' }}
          />
          <TextInput
            accessibilityLabel="聯絡電子郵件"
            placeholder="聯絡電子郵件（選填）"
            placeholderTextColor={aiTokens.muted}
            value={contactEmail}
            maxLength={320}
            editable={!busy}
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={(value) => change(() => setContactEmail(value))}
            style={inputStyle}
          />
        </View>
      </AICard>
      <AICard title="整體評價（選填）">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[1, 2, 3, 4, 5].map((value) => (
            <AIButton
              key={value}
              label={`${value} 分`}
              variant={rating === value ? 'primary' : 'ghost'}
              disabled={busy}
              onPress={() => change(() => setRating(rating === value ? 0 : value))}
            />
          ))}
        </View>
      </AICard>
      <AICard>
        <View style={{ gap: 12 }}>
          {error ? (
            <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
              {error}
            </Text>
          ) : null}
          <AIButton
            label={busy ? '正在提交…' : error ? '重試提交' : '提交回饋'}
            disabled={busy || !title.trim() || !description.trim()}
            onPress={() => void submit()}
          />
        </View>
      </AICard>
    </AIDetailScreen>
  );
}
