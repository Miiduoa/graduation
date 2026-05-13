/* eslint-disable */
import React, { useCallback, useState } from 'react';
import { ScrollView, Text, View, Switch, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, AnimatedCard, Button } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import {
  applyForegroundCompanionTick,
  getCompanionSnapshot,
  setCompanionHidden,
  isCompanionHidden,
  type CompanionPublicSnapshot,
} from '../services/companionEngine';

export function CampusGardenScreen(props: Record<string, unknown>) {
  const nav = props?.navigation as { goBack?: () => void } | undefined;
  const [snapshot, setSnapshot] = useState<CompanionPublicSnapshot | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const h = await isCompanionHidden();
    setHidden(h);
    if (h) {
      setSnapshot(null);
      setLoading(false);
      return;
    }
    await applyForegroundCompanionTick();
    const snap = await getCompanionSnapshot();
    setSnapshot(snap);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    reload();
  }, [reload]);

  const toggleHide = async (v: boolean) => {
    await setCompanionHidden(v);
    setHidden(v);
    await reload();
  };

  const heatEntries = snapshot
    ? (Object.entries(snapshot.domainHeat) as [string, number][]).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          gap: theme.space.md,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
          paddingHorizontal: theme.space.lg,
        }}
      >
        <AnimatedCard title="校園園地" subtitle="同伴會跟上你在 App 裡做的那些事">
          <Text style={{ color: theme.colors.textSecondary, lineHeight: 20 }}>
            使用 Today、AI、課業、校園地圖、訂餐、失物、訊息等功能時，同伴會長大／換台詞；離線也會緩慢成長（每日有上限）。
          </Text>
        </AnimatedCard>

        <AnimatedCard title="顯示設定" subtitle="不必強迫打卡">
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.colors.text, flex: 1 }}>在 Today 顯示同伴條</Text>
            <Switch
              testID="companion-hide-switch"
              value={!hidden}
              onValueChange={(on) => toggleHide(!on)}
            />
          </View>
        </AnimatedCard>

        {!hidden && loading ? (
          <Text style={{ color: theme.colors.muted }}>載入中…</Text>
        ) : null}

        {!hidden && snapshot ? (
          <>
            <AnimatedCard title={snapshot.petStageTitle} subtitle={snapshot.petStageSubtitle}>
              <Text style={{ color: theme.colors.textSecondary }}>{snapshot.quote}</Text>
              <Text style={{ color: theme.colors.muted, marginTop: 8 }}>
                同伴成長值 {snapshot.petGrowth}% · {snapshot.dailyProgressText}
              </Text>
            </AnimatedCard>

            <AnimatedCard title="小花圃" subtitle="澆灌來自「校園生活」類功能">
              <Text style={{ color: theme.colors.text }}>
                階段：{snapshot.cropStageLabel} · {snapshot.cropGrowth}%
              </Text>
            </AnimatedCard>

            <AnimatedCard title="領域熱度" subtitle="你最近在哪些區域最活躍">
              {heatEntries.slice(0, 8).map(([k, v]) => (
                <View
                  key={k}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    paddingVertical: 6,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.border,
                  }}
                >
                  <Text style={{ color: theme.colors.textSecondary }}>{k}</Text>
                  <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>{Math.round(v)}</Text>
                </View>
              ))}
            </AnimatedCard>
          </>
        ) : null}

        {hidden ? (
          <Text style={{ color: theme.colors.muted, textAlign: 'center', padding: 24 }}>
            已關閉同伴顯示。若要重新開啟，請打開上方開關。
          </Text>
        ) : null}

        <Button text="重新整理狀態" kind="secondary" onPress={() => reload()} />
        <Pressable onPress={() => nav?.goBack?.()} style={{ padding: 12 }}>
          <Text style={{ color: theme.colors.accent, textAlign: 'center' }}>返回</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
