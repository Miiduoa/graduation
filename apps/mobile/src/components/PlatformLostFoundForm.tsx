import React from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { NUNI_LOST_FOUND_CONTACT_NOTE } from '@campus/shared/src/nuniLostFound';
import type { LostFoundWriteFields } from '@campus/shared/src/lostFoundFields';
import { Button, SegmentedControl } from '../ui/components';
import { theme } from '../ui/theme';
import { platformLostFoundCategories } from '../features/platformLostFound';
import type { PlatformLostFoundDraft } from '../data/platformLostFoundDrafts';

export function PlatformLostFoundForm({
  draft,
  disabled,
  saving,
  error,
  onChange,
  onSave,
  onClose,
  onReload,
}: {
  draft: PlatformLostFoundDraft;
  disabled: boolean;
  saving: boolean;
  error: string;
  onChange: (fields: LostFoundWriteFields) => void;
  onSave: () => void;
  onClose: () => void;
  onReload: () => void;
}) {
  const fields = draft.fields;
  const update = (patch: Partial<LostFoundWriteFields>) => {
    if (!disabled) onChange({ ...fields, ...patch });
  };
  return (
    <View style={{ gap: 16 }}>
      <Text
        accessibilityRole="header"
        style={{ color: theme.colors.text, fontSize: 22, fontWeight: '700' }}
      >
        {draft.mode === 'create' ? '刊登一則資訊' : '編輯刊登'}
      </Text>
      <SegmentedControl
        disabled={disabled}
        options={[
          { id: 'lost', label: '我遺失了' },
          { id: 'found', label: '我拾獲了' },
        ]}
        selected={fields.type}
        onSelect={(value) => update({ type: value as 'lost' | 'found' })}
      />
      {(
        [
          ['title', '物品名稱', '例如：黑色皮夾', 80],
          ['description', '物品描述', '描述外觀與辨識特徵，保留一些細節供認領時核對。', 2000],
          ['location', '遺失或拾獲地點', '例如：圖書館一樓', 120],
          ['date', '發生日期', 'YYYY-MM-DD', 10],
        ] as const
      ).map(([key, label, placeholder, maxLength]) => (
        <View key={key} style={{ gap: 6 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{label}</Text>
          <TextInput
            accessibilityLabel={label}
            value={fields[key]}
            onChangeText={(value) => update({ [key]: value })}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.muted}
            maxLength={maxLength}
            editable={!disabled}
            multiline={key === 'description'}
            autoCapitalize={key === 'date' ? 'none' : 'sentences'}
            style={{
              color: theme.colors.text,
              backgroundColor: theme.colors.surface2,
              borderColor: theme.colors.border,
              borderWidth: 1,
              borderRadius: theme.radius.md,
              padding: 12,
              minHeight: key === 'description' ? 120 : 48,
              textAlignVertical: 'top',
            }}
          />
        </View>
      ))}
      <View style={{ gap: 8 }}>
        <Text style={{ color: theme.colors.text, fontWeight: '600' }}>物品類別</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {platformLostFoundCategories.map(({ id, label }) => (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={`物品類別：${label}`}
              accessibilityState={{ selected: fields.category === id, disabled }}
              disabled={disabled}
              onPress={() => update({ category: id })}
              style={{
                padding: 12,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: fields.category === id ? theme.colors.accent : theme.colors.border,
                backgroundColor:
                  fields.category === id ? theme.colors.accentSoft : theme.colors.surface,
              }}
            >
              <Text style={{ color: theme.colors.text }}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={{ color: theme.colors.text, fontWeight: '600' }}>聯絡方式（選填）</Text>
        <TextInput
          accessibilityLabel="聯絡方式"
          value={fields.contactInfo ?? ''}
          onChangeText={(value) => update({ contactInfo: value })}
          maxLength={200}
          editable={!disabled}
          placeholder="填寫願意公開的聯絡方式"
          placeholderTextColor={theme.colors.muted}
          style={{
            color: theme.colors.text,
            backgroundColor: theme.colors.surface2,
            padding: 12,
            minHeight: 48,
            borderRadius: theme.radius.md,
            borderColor: theme.colors.border,
            borderWidth: 1,
          }}
        />
        <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
          {NUNI_LOST_FOUND_CONTACT_NOTE}
        </Text>
      </View>
      <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.muted }}>
        {saving ? '正在保存本機草稿…' : '草稿只保存在這台手機，依 Google 帳號與校園分開。'}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
          {error}
        </Text>
      ) : null}
      <Button
        text={draft.mode === 'create' ? '確認刊登' : '儲存修改'}
        disabled={disabled}
        onPress={onSave}
      />
      {draft.mode === 'update' && (
        <Button text="重新讀取最新內容" disabled={disabled} onPress={onReload} />
      )}
      <Button text="先保留草稿，回到列表" disabled={disabled} onPress={onClose} />
    </View>
  );
}
