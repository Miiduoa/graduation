/**
 * Campus AI-First — AI 對話頁 V2（全屏）
 */
import React, { useCallback, useState } from 'react';
import { Alert, View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { AIDetailScreen, AIMark, AICard, AIButton, AIChip, aiTokens } from '../ui/aiFirst';

type Msg = { role: 'ai' | 'me'; text?: string; card?: any; time: string };

const INITIAL: Msg[] = [
  {
    role: 'ai',
    text: '早安王同學 ☀️ 你今天有 3 堂課、2 份作業。要先看哪一件？',
    time: '09:43',
  },
];

const QUICK = ['下節課', '本週作業', '中午吃什麼', '幫我請假', '期末範圍', '找朋友'];

export default function AIChatAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>(INITIAL);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const now = new Date().toLocaleTimeString('zh-TW', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      setMsgs((prev) => [...prev, { role: 'me', text: trimmed, time: now }]);
      setInput('');
      // 假裝 AI 回應
      setTimeout(() => {
        setMsgs((prev) => [
          ...prev,
          {
            role: 'ai',
            text: `好的，我幫你查「${trimmed}」… 已從教務系統 + 你的偏好抓資料`,
            time: new Date().toLocaleTimeString('zh-TW', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }),
          },
        ]);
      }, 600);
    },
    [],
  );

  return (
    <AIDetailScreen
      title="校園 AI"
      subtitle="線上 · 已連結 7 個系統"
      onBack={() => navigation?.goBack?.()}
      rightAction={
        <TouchableOpacity onPress={() => Alert.alert('清空對話', '本次對話將被刪除', [
          { text: '取消', style: 'cancel' },
          { text: '清空', style: 'destructive', onPress: () => setMsgs(INITIAL) },
        ])} hitSlop={8}>
          <Text style={{ fontSize: 18 }}>🗑</Text>
        </TouchableOpacity>
      }
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ paddingHorizontal: aiTokens.space.md, paddingVertical: aiTokens.space.md, gap: 14 }}>
          {/* AI mark intro */}
          <View style={{ alignItems: 'center', marginVertical: aiTokens.space.md }}>
            <AIMark size={48} />
            <Text style={{ fontSize: 13, color: aiTokens.muted, marginTop: 10, textAlign: 'center' }}>
              問校園 AI 任何事 · AI 不會自動執行危險動作
            </Text>
          </View>

          {msgs.map((m, i) => (
            <Bubble key={i} msg={m} />
          ))}

          {/* Quick chips */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {QUICK.map((q) => (
              <AIChip key={q} label={q} onPress={() => send(q)} />
            ))}
          </View>

          {/* Example slot card */}
          {msgs.length > 1 && (
            <AICard aiGenerated icon="⏰" title="下節課" source="教務系統" confidence="high">
              <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
                資料結構 · 09:10–10:50{'\n'}📍 工程館 302（步行 4 分鐘）
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <AIButton label="🧭 導航" onPress={() => Alert.alert('導航', '已開啟導航')} />
                <AIButton label="📌 釘到 Today" variant="ghost" onPress={() => Alert.alert('已釘', '已固定到 Today')} />
              </View>
            </AICard>
          )}
        </ScrollView>

        {/* Input */}
        <View style={chatStyles.inputBar}>
          <View style={chatStyles.inputRow}>
            <TextInput
              style={chatStyles.input}
              placeholder="問校園 AI..."
              placeholderTextColor={aiTokens.muted}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => send(input)}
              returnKeyType="send"
            />
            <TouchableOpacity
              style={chatStyles.send}
              onPress={() => send(input)}
              disabled={!input.trim()}
            >
              <Text style={{ color: '#fff', fontSize: 16 }}>↑</Text>
            </TouchableOpacity>
          </View>
          <Text style={chatStyles.disclaimer}>
            AI 可能會出錯；任何危險動作都會在執行前再次確認
          </Text>
        </View>
      </KeyboardAvoidingView>
    </AIDetailScreen>
  );
}

function Bubble({ msg }: { msg: Msg }) {
  if (msg.role === 'ai') {
    return (
      <View>
        <View
          style={{
            backgroundColor: aiTokens.aiSurface,
            borderWidth: 1,
            borderColor: aiTokens.border,
            borderRadius: aiTokens.radius.md,
            padding: 12,
            alignSelf: 'flex-start',
            maxWidth: '88%',
          }}
        >
          <Text style={{ fontSize: 14, color: aiTokens.text, lineHeight: 20 }}>{msg.text}</Text>
        </View>
        <Text style={{ fontSize: 10, color: aiTokens.muted, marginTop: 4 }}>
          校園 AI · {msg.time}
        </Text>
      </View>
    );
  }
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <View
        style={{
          backgroundColor: aiTokens.ai,
          padding: 12,
          borderRadius: aiTokens.radius.md,
          alignSelf: 'flex-end',
          maxWidth: '88%',
        }}
      >
        <Text style={{ fontSize: 14, color: '#fff', lineHeight: 20 }}>{msg.text}</Text>
      </View>
      <Text style={{ fontSize: 10, color: aiTokens.muted, marginTop: 4 }}>
        你 · {msg.time}
      </Text>
    </View>
  );
}

const chatStyles = StyleSheet.create({
  inputBar: {
    padding: aiTokens.space.md,
    backgroundColor: aiTokens.surface,
    borderTopWidth: 1,
    borderTopColor: aiTokens.border,
  },
  inputRow: {
    flexDirection: 'row',
    backgroundColor: aiTokens.panel,
    borderRadius: aiTokens.radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: aiTokens.text,
    paddingVertical: 8,
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: aiTokens.ai,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disclaimer: {
    fontSize: 10,
    color: aiTokens.muted,
    marginTop: 8,
    textAlign: 'center',
  },
});
