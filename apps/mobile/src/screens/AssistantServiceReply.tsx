import React, { useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { getAssistantService, type AssistantService } from '@campus/shared/src/assistantServices';
import {
  mobileAssistantServiceDestination,
  navigateMobileAssistantService,
  type AssistantServiceSelection,
  type MobileAssistantAudience,
} from '../services/assistantServiceNavigation';
import { AIButton, aiTokens } from '../ui/aiFirst';
import type { ServiceScreenProps } from './UnavailableFeatureScreen';

const categories: Array<{ id: AssistantService['category']; label: string }> = [
  { id: 'study', label: '學習' },
  { id: 'campus', label: '校園' },
  { id: 'life', label: '生活' },
  { id: 'community', label: '交流' },
  { id: 'account', label: '帳號' },
];

export function AssistantServiceReply({ selection, audience, navigation, disabled, isCurrent }: {
  selection: AssistantServiceSelection;
  audience: MobileAssistantAudience;
  navigation: ServiceScreenProps['navigation'];
  disabled: boolean;
  isCurrent: () => boolean;
}) {
  const [category, setCategory] = useState<AssistantService['category']>('study');
  const [error, setError] = useState('');
  const opening = useRef(false);
  const [busy, setBusy] = useState(false);
  const services = selection.serviceIds
    .map((id) => getAssistantService(id))
    .filter((service): service is AssistantService => !!service);
  const shown = selection.kind === 'catalog'
    ? services.filter((service) => service.category === category) : services;
  const rows = shown.map((service) => ({ service,
    destination: mobileAssistantServiceDestination(service.id, audience, navigation, selection.importKind) }));
  const open = async (service: AssistantService) => {
    if (disabled || opening.current || !isCurrent()) return;
    setError('');
    const destination = mobileAssistantServiceDestination(service.id, audience, navigation, selection.importKind);
    if (!destination) return;
    if (destination.kind === 'native') {
      if (!navigateMobileAssistantService(service.id, audience, navigation, selection.importKind) && isCurrent()) {
        setError('目前無法開啟這項服務，請回到對話後再試一次。');
      }
      return;
    }
    opening.current = true;
    setBusy(true);
    try {
      await Linking.openURL(destination.url);
    } catch {
      if (isCurrent()) setError('無法開啟網頁，請確認網路連線後再試一次。');
    } finally {
      opening.current = false;
      if (isCurrent()) setBusy(false);
    }
  };
  return (
    <View style={{ gap: 12 }}>
      {selection.kind === 'catalog' ? (
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {categories.map((item) => (
            <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.label}
              accessibilityState={{ selected: item.id === category, disabled: disabled || busy }} disabled={disabled || busy}
              onPress={() => { if (isCurrent()) { setCategory(item.id); setError(''); } }}
              style={{ minHeight: 44, minWidth: 54, paddingHorizontal: 12, justifyContent: 'center',
                borderRadius: 10, borderWidth: 1, borderColor: aiTokens.border,
                backgroundColor: item.id === category ? aiTokens.aiSoft : aiTokens.panel }}>
              <Text style={{ color: aiTokens.text, fontSize: 14, fontWeight: item.id === category ? '700' : '400' }}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {rows.map(({ service, destination }) => (
        <View key={service.id} style={{ gap: 6, paddingVertical: 10, borderTopWidth: 1, borderColor: aiTokens.border }}>
          <Text style={{ color: aiTokens.text, fontSize: 16, fontWeight: '600' }}>{service.label}</Text>
          <Text style={{ color: aiTokens.textSecondary, fontSize: 14, lineHeight: 22 }}>{service.summary}</Text>
          <AIButton label={`${destination?.kind === 'native' ? '開啟' : '在網頁開啟'}${service.label}`}
            variant="ghost" disabled={disabled || busy || !destination} style={{ alignSelf: 'stretch' }}
            onPress={() => void open(service)} />
        </View>
      ))}
      {rows.some(({ destination }) => destination?.kind === 'web') ? (
        <Text style={{ color: aiTokens.muted, fontSize: 13, lineHeight: 21 }}>
          標示「在網頁開啟」的服務會使用瀏覽器，請在網頁確認登入帳號與學校。
        </Text>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={{ color: aiTokens.danger, lineHeight: 22 }}>{error}</Text> : null}
    </View>
  );
}
