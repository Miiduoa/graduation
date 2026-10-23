import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Linking, Platform, Text, View } from 'react-native';
import { AIDetailScreen, AICard, AISection, AIRow, AIButton } from '../ui/aiFirst';
import { useTheme } from '../state/theme';

type Props = { navigation?: { goBack?: () => void; navigate?: (screen: string) => void } };
type SystemStatus = 'loading' | 'enabled' | 'disabled' | 'unavailable';
const statusLabels: Record<SystemStatus, string> = {
  loading: '正在讀取…',
  enabled: '已開啟',
  disabled: '未開啟',
  unavailable: '目前無法讀取',
};

export function AccessibilitySettingsScreen({ navigation }: Props) {
  const theme = useTheme();
  const [reader, setReader] = useState<SystemStatus>('loading');
  const [motion, setMotion] = useState<SystemStatus>('loading');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let readerChanged = false;
    let motionChanged = false;
    const readerSubscription = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      (enabled) => {
        readerChanged = true;
        if (active) setReader(enabled ? 'enabled' : 'disabled');
      },
    );
    const motionSubscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        motionChanged = true;
        if (active) setMotion(enabled ? 'enabled' : 'disabled');
      },
    );
    void AccessibilityInfo.isScreenReaderEnabled().then(
      (enabled) => {
        if (active && !readerChanged) setReader(enabled ? 'enabled' : 'disabled');
      },
      () => {
        if (active && !readerChanged) setReader('unavailable');
      },
    );
    void AccessibilityInfo.isReduceMotionEnabled().then(
      (enabled) => {
        if (active && !motionChanged) setMotion(enabled ? 'enabled' : 'disabled');
      },
      () => {
        if (active && !motionChanged) setMotion('unavailable');
      },
    );
    return () => {
      active = false;
      readerSubscription.remove();
      motionSubscription.remove();
    };
  }, []);
  const openSettings = async () => {
    setError('');
    try {
      await Linking.openSettings();
    } catch {
      setError('無法直接開啟設定，請從裝置的「設定」進入「輔助使用」或「無障礙」。');
    }
  };
  return (
    <AIDetailScreen title="無障礙設定" onBack={() => navigation?.goBack?.()}>
      <AICard title="閱讀與操作">
        <Text style={{ ...theme.typography.bodySmall, color: theme.colors.muted }}>
          文字大小、螢幕閱讀器與其他輔助功能，可在裝置的「輔助使用」或「無障礙」設定中調整。
        </Text>
      </AICard>
      <AISection title="裝置目前的狀態">
        <AIRow
          title={
            Platform.OS === 'ios'
              ? 'VoiceOver 螢幕閱讀器'
              : Platform.OS === 'android'
                ? 'TalkBack 螢幕閱讀器'
                : '螢幕閱讀器'
          }
          subtitle={statusLabels[reader]}
          static
        />
        <AIRow title="減少動態效果" subtitle={statusLabels[motion]} static />
      </AISection>
      <AISection title="在 App 內調整">
        <AIRow
          title="外觀"
          subtitle="選擇淺色或深色模式"
          onPress={() => navigation?.navigate?.('ThemePreview')}
        />
        <AIRow
          title="回報閱讀或操作問題"
          subtitle="告訴我們遇到問題的頁面與操作方式"
          onPress={() => navigation?.navigate?.('Feedback')}
        />
      </AISection>
      <AICard title="前往裝置設定">
        <View style={{ gap: theme.space.md }}>
          <Text style={{ ...theme.typography.bodySmall, color: theme.colors.muted }}>
            下方按鈕會開啟 Campus One 的系統設定。輔助使用選項請從裝置設定的主畫面進入。
          </Text>
          <AIButton label="開啟 App 系統設定" onPress={() => void openSettings()} />
          {error ? (
            <Text
              accessibilityRole="alert"
              style={{ ...theme.typography.bodySmall, color: theme.colors.danger }}
            >
              {error}
            </Text>
          ) : null}
        </View>
      </AICard>
    </AIDetailScreen>
  );
}
