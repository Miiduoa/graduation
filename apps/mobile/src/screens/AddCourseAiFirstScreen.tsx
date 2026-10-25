import React, { useState, useSyncExternalStore } from 'react';
import { Linking, Text, View } from 'react-native';
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { isProvidenceSchoolId, resolveOfficialCourseQueryLink } from '@campus/shared/src';
import { useSchool } from '../state/school';
import { safeNavigate } from '../utils/safeNavigate';
import type { ServiceScreenProps } from './UnavailableFeatureScreen';

export default function AddCourseAiFirstScreen({ navigation }: ServiceScreenProps) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { school } = useSchool();
  const [error, setError] = useState('');
  const officialCatalog = resolveOfficialCourseQueryLink(school.id);
  const openWebsite = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      setError('無法開啟校方網站，請確認網路後重試。');
    }
  };
  return (
    <AIDetailScreen title="查課與加退選" onBack={() => navigation?.goBack?.()}>
      <AICard title="先確認課程安排">
        <Text style={{ color: aiTokens.text, lineHeight: 24 }}>
          可以查詢課程內容與上課時間。正式加退選、候補與審核結果，請以校方選課系統為準。
        </Text>
      </AICard>
      <AICard title="課程查詢">
        <View style={{ gap: 12 }}>
          <AIButton
            label="查詢課程與安排"
            onPress={() => safeNavigate(navigation, 'AICourseAdvisor')}
          />
          <AIButton
            label="查看我的課表"
            variant="ghost"
            onPress={() => safeNavigate(navigation, 'CourseSchedule')}
          />
          {officialCatalog ? (
            <AIButton
              label={`開啟${officialCatalog.label}`}
              variant="ghost"
              onPress={() => void openWebsite(officialCatalog.url)}
            />
          ) : (
            <Text style={{ color: aiTokens.muted }}>
              目前尚未提供這所學校的選課網站連結，請從校方入口網站辦理。
            </Text>
          )}
          {error ? (
            <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
              {error}
            </Text>
          ) : null}
        </View>
      </AICard>
      <AICard title="正式加退選">
        <View style={{ gap: 12 }}>
          <Text style={{ color: aiTokens.muted, lineHeight: 24 }}>
            請登入校方入口網站，再進入「教務」的選課系統。Campus One
            目前不會代送加退選申請，也不會把課表上的個人安排當成選課完成。
          </Text>
          {isProvidenceSchoolId(school.id) ? (
            <AIButton
              label="開啟校方登入"
              variant="ghost"
              onPress={() =>
                void openWebsite('https://www.pu.edu.tw/app/index.php?Action=mobilelogin')
              }
            />
          ) : null}
        </View>
      </AICard>
    </AIDetailScreen>
  );
}
