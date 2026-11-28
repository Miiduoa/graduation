import React, { useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AssistantWorkContext } from '@campus/shared/src/assistantRoleWorkflows';
import { safeNavigate } from '../utils/safeNavigate';
import { mobileWorkspaceSuggestions, workspaceDraftParams } from '../services/workspaceEntry';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

type Props = {
  navigation: Parameters<typeof safeNavigate>[0];
  scope: string;
  workContext?: AssistantWorkContext;
  assistantRoute?: 'AIChat' | 'NuniTimetableAssistant';
  compact?: boolean;
};

const titles: Record<AssistantWorkContext, string> = {
  student: '今天想完成什麼？',
  teacher: '讓教學，從容開始',
  merchant: '今天的門市，從這裡開始',
  club: '接著，一起把活動做好',
  staff: '接續今天的校務工作',
  operator: '掌握平台，接續工作',
};

/** Identity/school changes remount the composer before a previous draft can render. */
export function WorkspaceStart(props: Props) {
  return <WorkspaceComposer key={JSON.stringify([props.scope, props.workContext, props.assistantRoute])} {...props} />;
}

function WorkspaceComposer({ navigation, workContext = 'student', assistantRoute = 'AIChat', compact = false }: Props) {
  const s = useThemeStyleSheet(createStyles);
  const input = useRef<TextInput>(null);
  const [draft, setDraft] = useState('');
  const [composerOpen, setComposerOpen] = useState(!compact);
  const open = () => {
    if (!draft.trim()) return;
    Keyboard.dismiss();
    safeNavigate(navigation, assistantRoute, workspaceDraftParams(draft, workContext));
  };
  return (
    <View style={[s.start, compact && s.compact]} testID="workspace-start">
      <View style={s.heading}>
        <Text accessibilityRole="header" style={s.title}>{titles[workContext]}</Text>
        <Text style={s.caption}>查資料、整理安排，接著完成下一步。</Text>
      </View>
      {compact ? (
        <Pressable accessibilityRole="button" accessibilityLabel="展開 nuni 工作輸入"
          accessibilityState={{ expanded: composerOpen }} onPress={() => setComposerOpen((current) => !current)} style={s.compactToggle}>
          <Text style={s.exploreText}>{composerOpen ? '收起問題輸入' : '問 nuni，接著處理'}</Text>
        </Pressable>
      ) : null}
      {composerOpen ? <View style={s.composer}>
        <TextInput
          ref={input}
          accessibilityLabel="想交給 nuni 的事"
          placeholder={workContext === 'student' ? '問課表、找服務，或安排今天…' : mobileWorkspaceSuggestions(workContext, assistantRoute === 'NuniTimetableAssistant')[0]}
          placeholderTextColor={theme.colors.muted}
          value={draft}
          onChangeText={setDraft}
          maxLength={1000}
          multiline
          scrollEnabled={false}
          textAlignVertical="top"
          style={s.input}
        />
        <View style={s.composerFooter}>
          <Text style={s.draftHint}>下一步先核對問題</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="帶著問題開啟 nuni"
            accessibilityState={{ disabled: !draft.trim() }} disabled={!draft.trim()}
            onPress={open} style={({ pressed }) => [s.submit, !draft.trim() && s.disabled, pressed && s.pressed]}>
            <Text style={s.submitText}>繼續</Text>
          </Pressable>
        </View>
      </View> : null}
      {!compact && (
        <View style={s.examples}>
          {mobileWorkspaceSuggestions(workContext, assistantRoute === 'NuniTimetableAssistant').map((prompt) => (
            <Pressable key={prompt} accessibilityRole="button" accessibilityLabel={`填入問題：${prompt}`}
              onPress={() => { setDraft(prompt); input.current?.focus(); }}
              style={({ pressed }) => [s.example, pressed && s.pressed]}>
              <Text style={s.exampleText}>{prompt}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Pressable accessibilityRole="button" accessibilityLabel="探索更多 nuni 用法"
        onPress={() => { Keyboard.dismiss(); safeNavigate(navigation, 'Explore', { workContext }); }}
        style={({ pressed }) => [s.explore, pressed && s.pressed]}>
        <Ionicons name="compass-outline" size={18} color={theme.colors.accent} />
        <Text style={s.exploreText}>探索更多用法</Text>
      </Pressable>
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  start: { gap: 12, paddingTop: 20, paddingBottom: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  compact: { paddingTop: 12, paddingBottom: 12 },
  compactToggle: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  heading: { gap: 6 },
  title: { color: theme.colors.text, fontSize: 23, lineHeight: 31, fontWeight: '600' },
  caption: { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 22 },
  composer: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 18, padding: 14, gap: 8, backgroundColor: theme.colors.surface },
  input: { color: theme.colors.text, fontSize: 17, lineHeight: 25, minHeight: 58, maxHeight: 170, padding: 0 },
  composerFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  draftHint: { flex: 1, color: theme.colors.muted, fontSize: 13, lineHeight: 19 },
  submit: { minHeight: 44, minWidth: 70, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22, backgroundColor: theme.colors.accent },
  submitText: { color: theme.colors.onAccent, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
  examples: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  example: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: 16, justifyContent: 'center', flexShrink: 1 },
  exampleText: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21 },
  explore: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 8 },
  exploreText: { color: theme.colors.accent, fontSize: 15, fontWeight: '500' },
});
