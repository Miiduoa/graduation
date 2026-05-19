/**
 * Campus AI-First — 個人檔案編輯 V2
 */
import React, { useCallback, useState } from 'react';
import { Alert, View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import {
  AIDetailScreen,
  AISection,
  AICard,
  AIButton,
  AILegacyLink,
  aiTokens,
} from '../ui/aiFirst';

export default function ProfileEditAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const [name, setName] = useState('王小明');
  const [bio, setBio] = useState('資訊管理系大三 · 喜歡演算法與咖啡');
  const [email, setEmail] = useState('s1099502@stu.pu.edu.tw');
  const [phone, setPhone] = useState('0987-654-321');
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(() => {
    // 簡單的同步驗證 — 避免送空值上去
    if (!name.trim()) {
      Alert.alert('儲存失敗', '顯示名稱不能為空。');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      Alert.alert('儲存失敗', 'Email 格式不正確。');
      return;
    }
    setSaving(true);
    // 後端 API 串接前先 echo 給使用者
    setTimeout(() => {
      setSaving(false);
      Alert.alert('已儲存', '個人資料已更新。', [
        { text: '好', onPress: () => navigation?.goBack?.() },
      ]);
    }, 350);
  }, [name, email, navigation]);

  const handleAdjustGoals = useCallback(() => {
    Alert.alert(
      '調整學習目標',
      '目前設定：申請研究所 · GPA 衝 3.8+\n\n可在「我的 → AI 偏好」進一步調整。',
    );
  }, []);

  const handleChangeAvatar = useCallback(() => {
    Alert.alert('更換頭像', '選擇來源', [
      { text: '取消', style: 'cancel' },
      { text: '從相簿選擇', onPress: () => {} },
      { text: '用 AI 生成', onPress: () => {} },
    ]);
  }, []);

  return (
    <AIDetailScreen
      title="編輯個人資料"
      onBack={() => navigation?.goBack?.()}
      rightAction={
        <AIButton
          label={saving ? '儲存中…' : '儲存'}
          size="sm"
          onPress={saving ? undefined : handleSave}
        />
      }
    >
      {/* 大頭照區 */}
      <View
        style={{
          alignItems: 'center',
          paddingVertical: aiTokens.space.lg,
          backgroundColor: aiTokens.aiGradientStart,
          marginHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.md,
          borderRadius: aiTokens.radius.lg,
        }}
      >
        <TouchableOpacity
          onPress={handleChangeAvatar}
          accessibilityRole="button"
          accessibilityLabel="更換頭像"
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            backgroundColor: aiTokens.ai,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: aiTokens.ai,
            shadowOpacity: 0.3,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
            elevation: 8,
          }}
        >
          <Text style={{ fontSize: 40, fontWeight: '700', color: '#fff' }}>王</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleChangeAvatar}
          accessibilityRole="button"
          style={{ marginTop: 12 }}
        >
          <Text style={{ fontSize: 13, color: aiTokens.ai, fontWeight: '600' }}>
            ✨ 更換頭像
          </Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 11, color: aiTokens.muted, marginTop: 6 }}>
          AI 可協助生成 avatar / 上傳照片自動裁切
        </Text>
      </View>

      {/* 基本資訊 */}
      <AISection title="基本資訊">
        <Field label="顯示名稱" value={name} onChangeText={setName} required />
        <Field
          label="個人簡介"
          value={bio}
          onChangeText={setBio}
          multiline
          hint="AI 可幫你寫一個亮點版 / 正式版"
        />
      </AISection>

      {/* 學業（唯讀） */}
      <AISection title="學業（教務系統同步 · 唯讀）">
        <ReadonlyField label="學號" value="1099502" />
        <ReadonlyField label="系所" value="資訊管理系" />
        <ReadonlyField label="入學年" value="109" />
      </AISection>

      {/* 聯絡 */}
      <AISection title="聯絡方式">
        <Field label="Email" value={email} onChangeText={setEmail} required />
        <Field label="電話" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      </AISection>

      {/* AI 偏好設定 */}
      <AISection title="AI 偏好" subtitle="影響 AI 給你建議的方式">
        <AICard icon="🎯" title="學習目標">
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            目前設定：申請研究所 · GPA 衝 3.8+
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton
              label="調整目標"
              variant="ghost"
              size="sm"
              onPress={handleAdjustGoals}
            />
          </View>
        </AICard>
        <AICard icon="🍱" title="飲食偏好">
          <Text style={{ fontSize: 13, color: aiTokens.text }}>
            預算 $60–100 · 不吃辣 · 喜歡日式
          </Text>
        </AICard>
      </AISection>

      {/* 完整資料管理（含學歷、家長聯絡）— 舊版已合併進新版，此入口移除 */}
    </AIDetailScreen>
  );
}

function Field({
  label,
  value,
  onChangeText,
  required,
  multiline,
  hint,
  keyboardType,
}: any) {
  return (
    <View style={fieldStyles.wrap}>
      <View style={fieldStyles.labelRow}>
        <Text style={fieldStyles.label}>{label}</Text>
        {required ? <Text style={{ color: aiTokens.danger, fontSize: 11 }}>必填</Text> : null}
      </View>
      <TextInput
        style={[fieldStyles.input, multiline && { minHeight: 80, textAlignVertical: 'top' }]}
        value={value}
        onChangeText={onChangeText}
        multiline={!!multiline}
        keyboardType={keyboardType}
        placeholderTextColor={aiTokens.muted}
      />
      {hint ? <Text style={fieldStyles.hint}>{hint}</Text> : null}
    </View>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <View style={fieldStyles.wrap}>
      <Text style={fieldStyles.label}>{label}</Text>
      <View style={[fieldStyles.input, { backgroundColor: aiTokens.panel }]}>
        <Text style={{ fontSize: 14, color: aiTokens.muted }}>{value}</Text>
      </View>
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  wrap: {
    marginHorizontal: aiTokens.space.md,
    marginBottom: aiTokens.space.md,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: { fontSize: 12, color: aiTokens.muted, fontWeight: '600' },
  input: {
    backgroundColor: aiTokens.surface,
    borderWidth: 1,
    borderColor: aiTokens.border,
    borderRadius: aiTokens.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: aiTokens.text,
  },
  hint: { fontSize: 11, color: aiTokens.muted, marginTop: 4 },
});
