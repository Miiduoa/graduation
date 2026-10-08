import React, { useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { safeNavigate } from '../utils/safeNavigate';
import type { ServiceScreenProps } from './UnavailableFeatureScreen';
export function MessagesLandingScreen({ navigation }: ServiceScreenProps) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  return (
    <AIDetailScreen title="訊息" onBack={() => navigation?.goBack?.()}>
      <AICard>
        <Text style={{ color: aiTokens.muted, lineHeight: 24 }}>
          從私訊或群組開啟對話，查看目前帳號可存取的訊息。
        </Text>
      </AICard>
      <AICard title="我的對話">
        <View style={{ gap: 12 }}>
          <AIButton label="開啟私訊" onPress={() => safeNavigate(navigation, 'Dms')} />
          <AIButton
            label="開啟群組"
            variant="ghost"
            onPress={() => safeNavigate(navigation, 'Groups')}
          />
          <AIButton
            label="好友與邀請"
            variant="ghost"
            onPress={() => safeNavigate(navigation, 'FriendsManage')}
          />
        </View>
      </AICard>
    </AIDetailScreen>
  );
}
