import React from 'react';
import { Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useNuniSession } from '../state/nuniSession';
import { AIButton, AICard, AIDetailScreen, aiTokens } from '../ui/aiFirst';
import { CampusAssistantScreen } from './CampusAssistantScreen';
import type { PreAuthStackParamList } from './preAuthTypes';

export function NuniTimetableAssistantScreen(props: NativeStackScreenProps<PreAuthStackParamList, 'NuniTimetableAssistant'>) {
  const platform = useNuniSession();
  if (platform.session && !platform.loading && !platform.error && !platform.pendingLogout) {
    return <CampusAssistantScreen {...props} />;
  }
  return (
    <AIDetailScreen title="課表助理" onBack={props.navigation.goBack}>
      <AICard title={platform.loading ? '正在確認 nuni 帳號…' : '請先確認 nuni 帳號'}>
        <Text style={{ color: aiTokens.textSecondary, lineHeight: 22 }}>
          {platform.loading ? '確認後即可查看自己的課表。' : '回到帳號頁完成登入，即可查詢手機已存的課程。'}
        </Text>
        {!platform.loading && <AIButton label="前往 nuni 帳號" variant="ghost"
          onPress={() => props.navigation.navigate('NuniWorkspace', { tab: 'account' })} />}
      </AICard>
    </AIDetailScreen>
  );
}
