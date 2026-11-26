import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  ASSISTANT_ROLE_PROFILES, getAssistantRoleProfile, type AssistantRoleProfileId,
} from '@campus/shared/src/assistantRoleProfiles';
import { AICard, AIButton, aiTokens } from '../ui/aiFirst';

// The native planner supports personal working time. Workspace overview reads
// in some Web profile examples require a different adapter.
const personalWork: Record<Exclude<AssistantRoleProfileId, 'student'>, string> = {
  teacher: '一小時備課', merchant: '半小時盤點', club: '一小時社團籌備',
  school: '一小時行政會議', platform: '半小時維護檢查',
};

export function AssistantWorkContextPicker({ profileId, disabled, onChange, onExample, showExamples }: {
  profileId: AssistantRoleProfileId;
  disabled: boolean;
  onChange: (profileId: AssistantRoleProfileId) => void;
  onExample: (prompt: string) => void;
  showExamples: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const profile = getAssistantRoleProfile(profileId)!;
  const example = profileId === 'student' ? null : personalWork[profileId];
  return <AICard>
    <Pressable accessibilityRole="button" accessibilityLabel="切換工作情境"
      accessibilityValue={{ text: profile.label }} accessibilityState={{ expanded, disabled }}
      disabled={disabled} onPress={() => setExpanded(!expanded)}
      style={{ minHeight: 44, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <Text style={{ color: aiTokens.text, fontSize: 16, fontWeight: '600', flexGrow: 1 }}>工作情境 · {profile.label}</Text>
      <Text style={{ color: disabled ? aiTokens.muted : aiTokens.ai }}>{expanded ? '收合' : '切換'}</Text>
    </Pressable>
    {expanded && <View accessibilityRole="radiogroup" accessibilityLabel="工作情境" style={{ gap: 4 }}>
      <Text style={{ color: aiTokens.textSecondary, lineHeight: 22 }}>切換後會開啟新對話，草稿留在原情境。服務權限依帳號核對。</Text>
      {ASSISTANT_ROLE_PROFILES.map((item) => {
        const selected = item.id === profileId;
        return <Pressable key={item.id} accessibilityRole="radio" accessibilityLabel={item.label}
          accessibilityState={{ checked: selected, disabled }} disabled={disabled}
          style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 8,
            backgroundColor: selected ? aiTokens.aiSoft : aiTokens.surface }}
          onPress={() => { setExpanded(false); if (!selected) onChange(item.id); }}>
          <Text style={{ color: selected ? aiTokens.ai : aiTokens.text }}>{selected ? '✓ ' : ''}{item.label}</Text>
        </Pressable>;
      })}
    </View>}
    {disabled && <Text style={{ color: aiTokens.muted }}>請先完成目前的查詢，或處理待確認的行程。</Text>}
    {showExamples && !expanded && example && <View style={{ gap: 6 }}>
      <Text style={{ color: aiTokens.textSecondary, lineHeight: 22 }}>從這台手機已儲存的兩堂課之間找空檔，並避開個人行程。</Text>
      {['找', '安排'].map((verb) => {
        const question = `${verb}明天下午${example}`;
        return <AIButton key={verb} variant="ghost" label={question} onPress={() => onExample(question)} />;
      })}
    </View>}
  </AICard>;
}
