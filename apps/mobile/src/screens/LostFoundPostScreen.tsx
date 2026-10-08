import React, { useCallback, useRef, useState } from 'react';
import {
  ScrollView,
  Text,
  View,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Screen, AnimatedCard, Button, SegmentedControl } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';
import type { LostFoundCategory, LostFoundItem } from '../data/types';
import {
  LOST_FOUND_CATEGORIES,
  lostFoundDataSource,
  useLostFoundScope,
  useLostFoundLoad,
} from '../features/lostFound';

type Props = {
  navigation?: { goBack?: () => void };
  route?: { params?: { id?: string; type?: 'lost' | 'found' } };
};
function Field({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.muted}
        maxLength={multiline ? 2000 : 200}
        style={{
          padding: 12,
          minHeight: multiline ? 100 : 46,
          color: theme.colors.text,
          borderColor: theme.colors.border,
          borderWidth: 1,
          backgroundColor: theme.colors.surface2,
          borderRadius: theme.radius.md,
          textAlignVertical: 'top',
        }}
      />
    </View>
  );
}
function localDate() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value);
}
function Editor({
  item,
  initialType,
  uid,
  schoolId,
  isCurrent,
  navigation,
}: {
  item: LostFoundItem | null;
  initialType: 'lost' | 'found';
  uid: string;
  schoolId: string;
  isCurrent: () => boolean;
  navigation?: Props['navigation'];
}) {
  const [type, setType] = useState(item?.type ?? initialType);
  const [title, setTitle] = useState(item?.title ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [category, setCategory] = useState<LostFoundCategory>(item?.category ?? 'other');
  const [location, setLocation] = useState(item?.location ?? '');
  const [date, setDate] = useState(item?.date.slice(0, 10) ?? localDate());
  const [contactInfo, setContactInfo] = useState(item?.contactInfo ?? '');
  const [submitting, setSubmitting] = useState(false);
  const locked = useRef(false);
  const [saved, setSaved] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const submit = async () => {
    if (!isCurrent() || locked.current || saved || unconfirmed) return;
    if (
      title.trim().length < 2 ||
      description.trim().length < 10 ||
      !location.trim() ||
      !validDate(date)
    ) {
      Alert.alert(
        '請確認刊登內容',
        '標題至少 2 字、描述至少 10 字，並填寫地點與有效日期（YYYY-MM-DD）。',
      );
      return;
    }
    locked.current = true;
    setSubmitting(true);
    try {
      const data = {
        type,
        title: title.trim(),
        description: description.trim(),
        category,
        location: location.trim(),
        date,
        contactInfo: contactInfo.trim(),
        reporterId: uid,
        schoolId,
      };
      const source = lostFoundDataSource();
      const result = item
        ? await source.updateLostFoundItem(item.id, data, schoolId)
        : await source.createLostFoundItem(data);
      if (!isCurrent()) return;
      if (
        !result?.id ||
        (item && result.id !== item.id) ||
        result.reporterId !== uid ||
        result.schoolId !== schoolId ||
        result.title !== data.title
      )
        throw new Error('無法確認刊登結果。');
      setSaved(true);
      Alert.alert(item ? '已更新刊登' : '已發布刊登', '可返回列表查看最新資訊。', [
        {
          text: '返回列表',
          onPress: () => {
            if (isCurrent()) navigation?.goBack?.();
          },
        },
      ]);
    } catch (error) {
      if (isCurrent()) {
        const uncertain = (error as { code?: string })?.code === 'lost-found-write-unconfirmed';
        if (uncertain) setUnconfirmed(true);
        Alert.alert(
          '無法確認刊登結果',
          uncertain
            ? '資料已送出，請先返回列表重新整理，避免重複刊登。'
            : '請確認服務連線。內容仍保留，可以稍後重試。',
        );
      }
    } finally {
      locked.current = false;
      if (isCurrent()) setSubmitting(false);
    }
  };
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        <AnimatedCard
          title={item ? '編輯失物招領' : '發布失物招領'}
          subtitle="提供清楚的物品特徵與聯絡方式，方便彼此核對。"
        >
          <View style={{ gap: 16 }}>
            <SegmentedControl
              options={[
                { id: 'lost', label: '遺失物品' },
                { id: 'found', label: '拾獲物品' },
              ]}
              selected={type}
              onSelect={setType}
            />
            <Field label="物品名稱" value={title} onChange={setTitle} />
            <Field label="物品描述" value={description} onChange={setDescription} multiline />
            <Text style={{ color: theme.colors.text, fontWeight: '600' }}>物品類別</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {LOST_FOUND_CATEGORIES.map((option) => (
                <Button
                  key={option.id}
                  text={option.label}
                  size="small"
                  kind={category === option.id ? 'primary' : 'secondary'}
                  onPress={() => setCategory(option.id)}
                />
              ))}
            </View>
            <Field label="遺失或拾獲地點" value={location} onChange={setLocation} />
            <Field
              label="日期（YYYY-MM-DD）"
              value={date}
              onChange={setDate}
              placeholder="例如 2026-10-08"
            />
            <Field label="聯絡方式（選填）" value={contactInfo} onChange={setContactInfo} />
            <Text style={{ color: theme.colors.muted, lineHeight: 21 }}>
              填寫的刊登與聯絡資訊會公開給查看物品的人，請勿提供證件號碼或其他敏感資料。完成交接後，可由本人在詳情頁結案。
            </Text>
            <Button
              text={
                unconfirmed ? '請先回列表確認' : saved ? '已儲存' : item ? '儲存變更' : '發布刊登'
              }
              kind="primary"
              loading={submitting}
              disabled={saved || unconfirmed}
              onPress={submit}
            />
            {(saved || unconfirmed) && (
              <Button
                text="返回列表"
                onPress={() => {
                  if (isCurrent()) navigation?.goBack?.();
                }}
              />
            )}
          </View>
        </AnimatedCard>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
export function LostFoundPostScreen({ navigation, route }: Props) {
  useThemeMode();
  const id = route?.params?.id ?? '';
  const { uid, schoolId, scope, isCurrent } = useLostFoundScope(id);
  const loader = useCallback(async () => {
    if (!id || !uid) return null;
    const item = await lostFoundDataSource().getLostFoundItem(id, schoolId);
    if (!item || item.schoolId !== schoolId || item.reporterId !== uid)
      throw new Error('無法編輯這則刊登。');
    return item;
  }, [id, uid, schoolId]);
  const { state, refresh } = useLostFoundLoad(scope, loader, isCurrent);
  if (!uid)
    return (
      <Screen>
        <AnimatedCard title="請先登入" subtitle="登入後即可發布失物招領資訊。" />
      </Screen>
    );
  if (state.status === 'loading')
    return (
      <Screen>
        <AnimatedCard title="正在準備刊登資料" />
      </Screen>
    );
  if (state.status === 'error')
    return (
      <Screen>
        <AnimatedCard title="無法讀取刊登資料" subtitle="請確認這是本人於目前學校發布的資訊。">
          <Button text="重新讀取" onPress={refresh} />
        </AnimatedCard>
      </Screen>
    );
  return (
    <Screen>
      <Editor
        key={scope}
        item={state.data ?? null}
        initialType={route?.params?.type === 'found' ? 'found' : 'lost'}
        uid={uid}
        schoolId={schoolId}
        isCurrent={isCurrent}
        navigation={navigation}
      />
    </Screen>
  );
}
