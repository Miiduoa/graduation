import React, { useContext, useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AIDetailHeader, aiTokens } from '../ui/aiFirst';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';

export type AssistantPanel = 'chat' | 'tools';

type Props = {
  title: string;
  subtitle: string;
  panel: AssistantPanel;
  onSelect: (panel: AssistantPanel) => void;
  locked: boolean;
  onBack: () => void;
  chatScroll: React.Ref<ScrollView>;
  onChatScrollPosition?: (atLatest: boolean) => void;
  tools: React.ReactNode;
  toolsLabel?: string;
  composer: React.ReactNode;
  children: React.ReactNode;
};

export function AssistantConversationLayout({
  title, subtitle,
  panel,
  onSelect,
  locked,
  onBack,
  chatScroll,
  onChatScrollPosition,
  tools,
  toolsLabel = '校園工具',
  composer,
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  const tabHeight = useContext(BottomTabBarHeightContext);
  const tabPadding = useTabBarContentBottomPadding();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const bottomSpace = keyboardOpen ? 0 : tabHeight ? tabPadding : insets.bottom;
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: aiTokens.bg }}
    >
      <AIDetailHeader title={title} subtitle={subtitle} onBack={onBack} />
      {tools ? <View
        accessibilityRole="tablist"
        style={{
          flexDirection: 'row',
          paddingHorizontal: 16,
          backgroundColor: aiTokens.surface,
          borderBottomWidth: 1,
          borderColor: aiTokens.border,
        }}
      >
        {(['chat', 'tools'] as const).map((id) => {
          const selected = panel === id;
          return (
            <Pressable
              key={id}
              accessibilityRole="tab"
              aria-selected={selected}
              accessibilityState={{ selected, disabled: locked }}
              disabled={locked}
              onPress={() => {
                Keyboard.dismiss();
                onSelect(id);
              }}
              style={{
                flex: 1,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
                borderBottomWidth: 3,
                borderColor: selected ? aiTokens.ai : 'transparent',
              }}
            >
              <Text
                style={{
                  color: selected ? aiTokens.ai : aiTokens.textSecondary,
                  fontSize: 15,
                  fontWeight: selected ? '700' : '500',
                }}
              >
                {id === 'chat' ? '對話' : toolsLabel}
              </Text>
            </Pressable>
          );
        })}
      </View> : null}
      {/* Keep action confirmations and the reading position alive when visiting tools. */}
      <View
        style={{ flex: 1, display: panel === 'chat' ? 'flex' : 'none' }}
        accessibilityElementsHidden={panel !== 'chat'}
        importantForAccessibility={panel === 'chat' ? 'auto' : 'no-hide-descendants'}
      >
        <ScrollView
          ref={chatScroll}
          testID="assistant-conversation-scroll"
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          onScroll={(event) => {
            if (!onChatScrollPosition) return;
            const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
            const distance = contentSize.height - (contentOffset.y + layoutMeasurement.height);
            onChatScrollPosition(distance <= 96);
          }}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingVertical: 12 }}
        >
          {children}
        </ScrollView>
        <View style={{ paddingBottom: bottomSpace, backgroundColor: aiTokens.surface }}>
          {composer}
        </View>
      </View>
      {tools ? <ScrollView
        accessibilityElementsHidden={panel !== 'tools'}
        importantForAccessibility={panel === 'tools' ? 'auto' : 'no-hide-descendants'}
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1, display: panel === 'tools' ? 'flex' : 'none' }}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: bottomSpace + 12 }}
      >
        {tools}
      </ScrollView> : null}
    </KeyboardAvoidingView>
  );
}
