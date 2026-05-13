/* eslint-disable */
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { ScrollView, Text, View, Alert, Linking, TextInput } from 'react-native';
import Constants from 'expo-constants';
import { PROVIDENCE_UNIVERSITY_SCHOOL_CODE } from '@campus/shared/src';
import {
  Screen,
  Button,
  Pill,
  AnimatedCard,
  ListItem,
  SegmentedControl,
  Divider,
} from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme, softShadowStyle } from '../ui/theme';
import { ToggleSwitch } from '../ui/interactive/ToggleSwitch';
import { usePreferences } from '../state/preferences';
import {
  PROVIDENCE_CAMPUS_LATITUDE,
  PROVIDENCE_CAMPUS_LONGITUDE,
} from '../services/weather';
import { useDemo, type DemoMode } from '../state/demo';
import { useThemeMode } from '../state/theme';
import { useSchool } from '../state/school';
import { clearAllCache, getCacheSize } from '../data/cachedSource';
import { getHybridSourceStatus } from '../data/hybridSource';
import { getRuntimeDataSourcePolicy } from '../config/runtime';
import { formatFileSize } from '../utils/format';
import { getLegalUrl, getReleaseConfig } from '../services/release';

const APP_VERSION = Constants.expoConfig?.version ?? Constants.manifest?.version ?? '1.0.0';

function parseManualGeo(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

const modes: Array<{ key: DemoMode; label: string; hint: string }> = [
  { key: 'normal', label: '正常', hint: '顯示 mock 列表' },
  { key: 'loading', label: 'Loading', hint: '顯示載入中' },
  { key: 'empty', label: 'Empty', hint: '顯示空狀態' },
  { key: 'error', label: 'Error', hint: '顯示錯誤' },
];

export function SettingsScreen(props: any) {
  const nav = props?.navigation;
  const demo = useDemo();
  const themeMode = useThemeMode();
  const { school } = useSchool();
  const { preferences, updatePreferences } = usePreferences();
  const [latDraft, setLatDraft] = useState('');
  const [lonDraft, setLonDraft] = useState('');

  useEffect(() => {
    setLatDraft(
      preferences.weatherManualLatitude != null ? String(preferences.weatherManualLatitude) : '',
    );
    setLonDraft(
      preferences.weatherManualLongitude != null ? String(preferences.weatherManualLongitude) : '',
    );
  }, [preferences.weatherManualLatitude, preferences.weatherManualLongitude]);

  const commitManualCoords = useCallback(async () => {
    const lat = parseManualGeo(latDraft);
    const lon = parseManualGeo(lonDraft);
    if (lat == null && lon == null) {
      await updatePreferences({
        weatherManualLatitude: null,
        weatherManualLongitude: null,
      });
      return;
    }
    if (lat == null || lon == null) {
      Alert.alert('座標不完整', '請同時填寫緯度與經度，或將兩者清空以使用校園預設座標。');
      return;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      Alert.alert('座標超出範圍', '緯度需在 -90〜90，經度需在 -180〜180。');
      return;
    }
    await updatePreferences({
      weatherManualLatitude: lat,
      weatherManualLongitude: lon,
    });
  }, [latDraft, lonDraft, updatePreferences]);
  const release = getReleaseConfig();
  const [cacheInfo, setCacheInfo] = useState<{ count: number; approximateBytes: number } | null>(
    null,
  );
  const [showDeveloper, setShowDeveloper] = useState(false);
  const [hybridStatus, setHybridStatus] = useState<{
    preferRealApi: boolean;
    fallbackToMock: boolean;
    registeredSchools: string[];
    schoolContextId: string | null;
  } | null>(null);
  const runtimePolicy = useMemo(() => getRuntimeDataSourcePolicy(), []);

  useEffect(() => {
    getCacheSize().then(setCacheInfo);
  }, []);

  useEffect(() => {
    if (!showDeveloper) return;
    setHybridStatus(getHybridSourceStatus());
  }, [showDeveloper, school?.id]);

  const handleClearCache = async () => {
    Alert.alert('清除快取', '確定要清除所有快取資料嗎？這會使 App 在下次開啟時重新載入所有資料。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清除',
        style: 'destructive',
        onPress: async () => {
          await clearAllCache();
          setCacheInfo({ count: 0, approximateBytes: 0 });
          Alert.alert('完成', '快取已清除');
        },
      },
    ]);
  };

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: theme.layout.sectionGap, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        <AnimatedCard title="外觀" subtitle="">
          <View style={{ gap: 0 }}>
            <View style={{ paddingVertical: theme.layout.listItemVertical, paddingHorizontal: theme.layout.screenPadding }}>
              <Text
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: 13,
                  marginBottom: 8,
                  fontWeight: '500',
                }}
              >
                主題模式
              </Text>
              <SegmentedControl
                options={[
                  { key: 'dark', label: '深色' },
                  { key: 'light', label: '淺色' },
                ]}
                selected={themeMode.mode}
                onChange={(k) => themeMode.setMode(k as 'dark' | 'light')}
              />
            </View>
            <Divider spacing={0} />
            <ListItem
              icon="language-outline"
              title="語言設定"
              onPress={() => nav?.navigate?.('LanguageSettings')}
            />
            <ListItem
              icon="accessibility-outline"
              title="無障礙設定"
              onPress={() => nav?.navigate?.('AccessibilitySettings')}
            />
            <ListItem
              icon="color-palette-outline"
              title="主題預覽"
              onPress={() => nav?.navigate?.('ThemePreview')}
            />
            <Divider spacing={0} />
            <ListItem
              icon="hardware-chip-outline"
              title="AI 模型管理"
              onPress={() => nav?.navigate?.('AIModelManager')}
            />
          </View>
        </AnimatedCard>

        <AnimatedCard title="學校" subtitle="" delay={100}>
          {school.themeColor && (
            <View
              style={{
                marginBottom: 12,
                padding: 14,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                ...softShadowStyle(theme.shadows.soft),
              }}
            >
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: theme.radius.full,
                  backgroundColor: school.themeColor,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: theme.colors.onAccent, fontSize: 16, fontWeight: '700' }}>
                  {school.name.charAt(0)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 15 }}>
                  {school.name}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                  主題色：{school.themeColor}
                </Text>
              </View>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: theme.radius.xs,
                  backgroundColor: theme.colors.accent,
                }}
              />
            </View>
          )}

          <View
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.accentSoft,
            }}
          >
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
              目前產品已鎖定為 {school.name}（{PROVIDENCE_UNIVERSITY_SCHOOL_CODE}
              ），此版本不再提供校碼切換與多校模式。
            </Text>
          </View>
        </AnimatedCard>

        <AnimatedCard title="儲存空間" subtitle="" delay={200}>
          <View style={{ gap: 0 }}>
            <ListItem
              icon="folder-outline"
              title="快取資料"
              rightText={
                cacheInfo
                  ? `${cacheInfo.count} 項 · ${formatFileSize(cacheInfo.approximateBytes)}`
                  : '計算中...'
              }
            />
            <Divider spacing={0} />
            <View style={{ paddingVertical: theme.layout.listItemVertical, paddingHorizontal: theme.layout.screenPadding }}>
              <Button
                text="清除快取"
                kind="accent-ghost"
                icon="trash-outline"
                onPress={handleClearCache}
              />
            </View>
          </View>
        </AnimatedCard>

        <AnimatedCard title="天氣與儀表板" subtitle="" delay={250}>
          <View style={{ gap: 0 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: theme.layout.listItemVertical,
                paddingHorizontal: theme.layout.screenPadding,
                gap: theme.space.md,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 15 }}>
                  儀表板天氣效果
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 }}>
                  依天氣微調頂部視覺與一小列天氣資訊；維持白／淺色基底。
                </Text>
              </View>
              <ToggleSwitch
                value={preferences.dashboardWeatherEffects}
                onToggle={(v) => updatePreferences({ dashboardWeatherEffects: v })}
              />
            </View>
            <Divider spacing={0} />
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: theme.layout.listItemVertical,
                paddingHorizontal: theme.layout.screenPadding,
                gap: theme.space.md,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 15 }}>
                  雨天帶傘提醒
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 }}>
                  預報顯示今日可能降雨時主動提示；同一日最多顯示一次。
                </Text>
              </View>
              <ToggleSwitch
                value={preferences.dashboardRainReminders}
                onToggle={(v) => updatePreferences({ dashboardRainReminders: v })}
              />
            </View>
            <Divider spacing={0} />
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: theme.layout.listItemVertical,
                paddingHorizontal: theme.layout.screenPadding,
                gap: theme.space.md,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 15 }}>
                  使用裝置定位查天氣
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 }}>
                  僅在您開啟上述任一項時才會請求定位權限；位置只用於向 Open‑Meteo 查詢鄰近預報，不會經由我們的伺服器中繼。
                </Text>
              </View>
              <ToggleSwitch
                value={preferences.weatherUseDeviceLocation}
                onToggle={(v) => updatePreferences({ weatherUseDeviceLocation: v })}
              />
            </View>

            {!preferences.weatherUseDeviceLocation &&
            (preferences.dashboardWeatherEffects || preferences.dashboardRainReminders) ? (
              <>
                <Divider spacing={0} />
                <View style={{ paddingHorizontal: theme.layout.screenPadding, paddingVertical: 12 }}>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 10 }}>
                    未開啟定位時，可使用下方座標；留白則使用校園預設（約{' '}
                    {PROVIDENCE_CAMPUS_LATITUDE.toFixed(4)}, {PROVIDENCE_CAMPUS_LONGITUDE.toFixed(4)}
                    ）。
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11, marginBottom: 6 }}>
                    緯度（°）
                  </Text>
                  <TextInput
                    value={latDraft}
                    onChangeText={setLatDraft}
                    onBlur={() => void commitManualCoords()}
                    keyboardType="numbers-and-punctuation"
                    placeholder={`例如 ${PROVIDENCE_CAMPUS_LATITUDE.toFixed(4)}`}
                    placeholderTextColor={theme.colors.muted}
                    style={{
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      borderRadius: theme.radius.md,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      color: theme.colors.text,
                      backgroundColor: theme.colors.surface,
                      marginBottom: 12,
                    }}
                  />
                  <Text style={{ color: theme.colors.muted, fontSize: 11, marginBottom: 6 }}>
                    經度（°）
                  </Text>
                  <TextInput
                    value={lonDraft}
                    onChangeText={setLonDraft}
                    onBlur={() => void commitManualCoords()}
                    keyboardType="numbers-and-punctuation"
                    placeholder={`例如 ${PROVIDENCE_CAMPUS_LONGITUDE.toFixed(4)}`}
                    placeholderTextColor={theme.colors.muted}
                    style={{
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      borderRadius: theme.radius.md,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      color: theme.colors.text,
                      backgroundColor: theme.colors.surface,
                    }}
                  />
                </View>
              </>
            ) : null}
          </View>
        </AnimatedCard>

        <AnimatedCard title="帳號與隱私" subtitle="" delay={300}>
          <View style={{ gap: 0 }}>
            <ListItem
              icon="download-outline"
              title="匯出我的資料"
              onPress={() => nav?.navigate?.('DataExport')}
            />
            <Divider spacing={0} />
            <ListItem
              icon="trash-outline"
              title="刪除帳號"
              danger
              onPress={() => nav?.navigate?.('AccountDeletion')}
            />
          </View>
        </AnimatedCard>

        <AnimatedCard title="關於" subtitle="" delay={400}>
          <View style={{ gap: 0 }}>
            <ListItem icon="information-circle-outline" title="版本" rightText={APP_VERSION} />
            <ListItem icon="school-outline" title="開發團隊" rightText="畢業專題團隊" />
            <Divider spacing={4} />
            <ListItem
              icon="chatbubble-outline"
              title="意見回饋"
              onPress={() => nav?.navigate?.('Feedback')}
            />
            <ListItem
              icon="bug-outline"
              title="回報問題"
              onPress={() => nav?.navigate?.('BugReport')}
            />
            <ListItem
              icon="help-circle-outline"
              title="幫助中心"
              onPress={() => nav?.navigate?.('Help')}
            />
            <Divider spacing={4} />
            <ListItem
              icon="document-text-outline"
              title="隱私政策"
              onPress={() => {
                const url = getLegalUrl('privacy');
                if (!url) {
                  Alert.alert('尚未設定', '尚未設定正式隱私政策連結');
                  return;
                }
                Linking.canOpenURL(url).then((supported) => {
                  if (supported) {
                    Linking.openURL(url);
                  } else {
                    Alert.alert('無法開啟', '請稍後再試或聯繫開發團隊');
                  }
                });
              }}
            />
            <ListItem
              icon="shield-checkmark-outline"
              title="使用條款"
              onPress={() => {
                const url = getLegalUrl('terms');
                if (!url) {
                  Alert.alert('尚未設定', '尚未設定正式使用條款連結');
                  return;
                }
                Linking.canOpenURL(url).then((supported) => {
                  if (supported) {
                    Linking.openURL(url);
                  } else {
                    Alert.alert('無法開啟', '請稍後再試或聯繫開發團隊');
                  }
                });
              }}
            />
          </View>
        </AnimatedCard>

        {!release.isReleaseLike && (
          <AnimatedCard title="開發者選項" subtitle="點擊展開進階設定" delay={500}>
            <ListItem
              icon="code-slash-outline"
              title="顯示開發者選項"
              rightIcon={showDeveloper ? 'chevron-up' : 'chevron-down'}
              onPress={() => setShowDeveloper(!showDeveloper)}
            />

            {showDeveloper && (
              <View style={{ marginTop: 14, gap: 16 }}>
                <View>
                  <Text
                    style={{
                      color: theme.colors.textSecondary,
                      fontSize: 13,
                      marginBottom: 8,
                      fontWeight: '500',
                    }}
                  >
                    Demo 模式
                  </Text>
                  <View
                    style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}
                  >
                    <Pill text={`目前：${demo.mode}`} kind="accent" size="sm" />
                  </View>
                  <View style={{ gap: 8 }}>
                    {modes.map((m) => (
                      <Button
                        key={m.key}
                        text={`${m.label}：${m.hint}`}
                        kind={demo.mode === m.key ? 'primary' : 'ghost'}
                        onPress={() => demo.setMode(m.key)}
                      />
                    ))}
                  </View>
                </View>

                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 }}>
                  Demo 模式用於展示不同的 UI 狀態（載入中、空狀態、錯誤）。正式版本應將此功能隱藏。
                </Text>

                <View
                  style={{
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface,
                    padding: 14,
                    gap: 8,
                    ...softShadowStyle(theme.shadows.soft),
                  }}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
                    資料來源診斷
                  </Text>
                  <Divider spacing={4} />
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                    mode: {process.env.EXPO_PUBLIC_DATA_SOURCE_MODE ?? 'auto'}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                    requestedMode: {runtimePolicy.requestedMode}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                    designTarget: {runtimePolicy.designTargetMode}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                    defaultRuntimeMode: {runtimePolicy.defaultRuntimeMode}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                    schoolContext: {hybridStatus?.schoolContextId ?? 'null'}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                    preferRealApi: {String(hybridStatus?.preferRealApi ?? false)}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                    fallbackToMock: {String(hybridStatus?.fallbackToMock ?? true)}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                    adapters: {hybridStatus?.registeredSchools.join(', ') || '(none)'}
                  </Text>
                  <View style={{ marginTop: 4 }}>
                    <Button
                      text="重新整理診斷資訊"
                      kind="accent-ghost"
                      icon="refresh-outline"
                      onPress={() => setHybridStatus(getHybridSourceStatus())}
                    />
                  </View>
                </View>

                <ListItem
                  icon="git-network-outline"
                  title="Post-login 除錯"
                  subtitle="runs、bootstrap、puDataCache v1"
                  onPress={() => nav?.navigate?.('PostLoginDebug')}
                />
              </View>
            )}
          </AnimatedCard>
        )}
      </ScrollView>
    </Screen>
  );
}
