/**
 * Pomodoro Session Screen — 學生專注計時器（demo）
 *
 * 設計：
 *  - 25 分鐘專注 + 5 分鐘休息（可配置）
 *  - 大型倒數圓圈、現代簡約風（呼應 cockpitShell）
 *  - 完成時記錄 study_event signal 並提示 AI 重排 plan
 *  - 暫停 / 繼續 / 放棄
 *  - 連續完成 4 個番茄 → 觸發 long break (15 min) 提示
 *  - 純前端，無 push notification（demo 簡化）
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, Alert, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';

import { theme, softShadowStyle } from '../ui/theme';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';

type Phase = 'focus' | 'short_break' | 'long_break' | 'idle' | 'done';

const FOCUS_SECONDS = 25 * 60;
const SHORT_BREAK_SECONDS = 5 * 60;
const LONG_BREAK_SECONDS = 15 * 60;
const POMODOROS_BEFORE_LONG_BREAK = 4;

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${pad(m)}:${pad(s)}`;
}

export default function PomodoroSessionScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const courseName = (route?.params?.courseName as string | undefined) ?? null;
  const bottomPad = useTabBarContentBottomPadding();

  const [phase, setPhase] = useState<Phase>('idle');
  const [secondsLeft, setSecondsLeft] = useState<number>(FOCUS_SECONDS);
  const [running, setRunning] = useState<boolean>(false);
  const [completedFocus, setCompletedFocus] = useState<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 計時器邏輯 ──
  useEffect(() => {
    if (!running) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          // 階段結束
          onPhaseEnd();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const onPhaseEnd = () => {
    setRunning(false);
    if (phase === 'focus') {
      const next = completedFocus + 1;
      setCompletedFocus(next);
      // 連續 4 顆番茄 → long break
      if (next % POMODOROS_BEFORE_LONG_BREAK === 0) {
        setPhase('long_break');
        setSecondsLeft(LONG_BREAK_SECONDS);
        Alert.alert(
          '🎉 完成 4 顆番茄！',
          '辛苦了，享受 15 分鐘長休息。可以站起來走走、喝水、看遠方。',
        );
      } else {
        setPhase('short_break');
        setSecondsLeft(SHORT_BREAK_SECONDS);
        Alert.alert('✅ 番茄完成', '休息 5 分鐘，下一回合準備好再開始。');
      }
    } else {
      // 休息結束 → 回到 focus
      setPhase('focus');
      setSecondsLeft(FOCUS_SECONDS);
      Alert.alert('🍅 休息結束', '回到專注時段了！');
    }
  };

  const start = () => {
    if (phase === 'idle') setPhase('focus');
    setRunning(true);
  };
  const pause = () => setRunning(false);
  const reset = () => {
    setRunning(false);
    setPhase('idle');
    setSecondsLeft(FOCUS_SECONDS);
  };
  const skip = () => {
    onPhaseEnd();
  };

  const total =
    phase === 'long_break' ? LONG_BREAK_SECONDS
    : phase === 'short_break' ? SHORT_BREAK_SECONDS
    : FOCUS_SECONDS;
  const progress = phase === 'idle' ? 0 : 1 - secondsLeft / total;

  const phaseColor =
    phase === 'focus' ? theme.colors.accent
    : phase === 'short_break' ? theme.colors.success
    : phase === 'long_break' ? theme.colors.warning
    : theme.colors.muted;

  const phaseLabel =
    phase === 'focus' ? '專注中'
    : phase === 'short_break' ? '短休息'
    : phase === 'long_break' ? '長休息'
    : '準備';

  // ── 番茄記錄 ──
  const dots = useMemo(() => {
    const list: ('done' | 'pending')[] = [];
    for (let i = 0; i < POMODOROS_BEFORE_LONG_BREAK; i++) {
      list.push(i < (completedFocus % POMODOROS_BEFORE_LONG_BREAK) ? 'done' : 'pending');
    }
    return list;
  }, [completedFocus]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingTop: theme.space.lg,
          paddingBottom: bottomPad,
          alignItems: 'center',
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* 課程名 / eyebrow */}
        <Text
          style={{
            fontSize: theme.typography.labelSmall.fontSize,
            color: theme.colors.muted,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            marginBottom: theme.space.xs,
          }}
        >
          {courseName ? `${courseName} · 專注時段` : '番茄專注時段'}
        </Text>
        <Text
          style={{
            fontSize: theme.typography.h1.fontSize,
            fontWeight: '700',
            color: theme.colors.text,
            marginBottom: theme.space.xl,
            letterSpacing: -0.4,
          }}
        >
          {phaseLabel}
        </Text>

        {/* 大型圓圈計時器（純 CSS 圓） */}
        <View
          style={{
            width: 260,
            height: 260,
            borderRadius: 130,
            borderWidth: 8,
            borderColor: theme.colors.border,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: theme.space.xl,
            backgroundColor: theme.colors.surface,
            ...softShadowStyle(theme.shadows.soft),
          }}
        >
          {/* 進度環內圈（用 absolute overlay 模擬，不用 SVG） */}
          <View
            style={{
              position: 'absolute',
              top: -8,
              left: -8,
              right: -8,
              bottom: -8,
              borderRadius: 138,
              borderWidth: 8,
              borderColor: 'transparent',
              borderTopColor: phaseColor,
              transform: [{ rotate: `${progress * 360 - 90}deg` }],
              opacity: phase === 'idle' ? 0 : 0.4,
            }}
          />
          <Text
            style={{
              fontSize: 64,
              fontWeight: '300',
              color: theme.colors.text,
              letterSpacing: -2,
              fontVariant: ['tabular-nums'] as any,
            }}
          >
            {formatTime(secondsLeft)}
          </Text>
          <Text
            style={{
              fontSize: theme.typography.labelSmall.fontSize,
              color: theme.colors.muted,
              marginTop: theme.space.xs,
              letterSpacing: 0.4,
            }}
          >
            {phase === 'focus' ? '不要分心 · 深呼吸' : phase === 'idle' ? '點擊開始' : '放鬆一下'}
          </Text>
        </View>

        {/* 連續番茄 indicator */}
        <View style={{ flexDirection: 'row', gap: theme.space.sm, marginBottom: theme.space.xl }}>
          {dots.map((d, i) => (
            <View
              key={i}
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: d === 'done' ? theme.colors.accent : theme.colors.border,
              }}
            />
          ))}
        </View>
        <Text
          style={{
            fontSize: theme.typography.bodySmall.fontSize,
            color: theme.colors.muted,
            marginBottom: theme.space.xl,
          }}
        >
          今日已完成 {completedFocus} 顆番茄
        </Text>

        {/* 控制按鈕 */}
        <View style={{ flexDirection: 'row', gap: theme.space.md, marginBottom: theme.space.lg }}>
          {!running ? (
            <Pressable
              onPress={start}
              style={({ pressed }) => ({
                paddingHorizontal: theme.space.xl,
                paddingVertical: theme.space.md,
                borderRadius: theme.radius.full,
                backgroundColor: theme.colors.text,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space.xs,
                opacity: pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <Ionicons name="play" size={18} color={theme.colors.bg} />
              <Text style={{ color: theme.colors.bg, fontSize: 16, fontWeight: '700' }}>
                {phase === 'idle' ? '開始 25 分鐘' : '繼續'}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={pause}
              style={({ pressed }) => ({
                paddingHorizontal: theme.space.xl,
                paddingVertical: theme.space.md,
                borderRadius: theme.radius.full,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space.xs,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Ionicons name="pause" size={18} color={theme.colors.text} />
              <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700' }}>
                暫停
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={skip}
            disabled={phase === 'idle'}
            style={({ pressed }) => ({
              paddingHorizontal: theme.space.lg,
              paddingVertical: theme.space.md,
              borderRadius: theme.radius.full,
              backgroundColor: theme.colors.surface,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              opacity: phase === 'idle' ? 0.4 : pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: theme.colors.muted, fontSize: 14, fontWeight: '600' }}>
              跳過
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => {
            if (running || completedFocus > 0) {
              Alert.alert('結束本次 session？', '已完成的番茄會被保留。', [
                { text: '繼續專注', style: 'cancel' },
                {
                  text: '結束',
                  style: 'destructive',
                  onPress: () => {
                    reset();
                    navigation.goBack();
                  },
                },
              ]);
            } else {
              navigation.goBack();
            }
          }}
          style={({ pressed }) => ({
            opacity: pressed ? 0.6 : 1,
            paddingVertical: theme.space.sm,
          })}
        >
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: theme.typography.bodySmall.fontSize,
              textDecorationLine: 'underline',
            }}
          >
            離開
          </Text>
        </Pressable>

        {/* AI 小提示 */}
        <View
          style={{
            marginTop: theme.space.xl,
            padding: theme.space.md,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            width: '100%',
          }}
        >
          <Text
            style={{
              fontSize: theme.typography.labelSmall.fontSize,
              color: theme.colors.muted,
              letterSpacing: 0.3,
              textTransform: 'uppercase',
              marginBottom: theme.space.xs,
            }}
          >
            🤖 AI 提醒
          </Text>
          <Text
            style={{
              fontSize: theme.typography.bodySmall.fontSize,
              color: theme.colors.text,
              lineHeight: theme.typography.bodySmall.lineHeight + 4,
            }}
          >
            {phase === 'focus'
              ? '把手機翻面、關掉 IG 通知。25 分鐘比 2 小時邊滑邊讀有效。'
              : phase === 'short_break'
                ? '別碰社群媒體；起來伸展、補水即可。'
                : phase === 'long_break'
                  ? '長休息可以走走、看遠方；不要躺平不然會睡著。'
                  : completedFocus > 0
                    ? `已累積 ${completedFocus} 顆，今日專注度 ${Math.min(100, completedFocus * 20)}%。`
                    : '建議從一個 25 分鐘番茄開始。每完成 4 顆會有 15 分鐘長休息。'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
