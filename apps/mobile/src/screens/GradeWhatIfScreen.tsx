/**
 * Grade What-If Screen — 成績試算（TronClass 沒有）
 *
 * 學生用滑桿模擬「如果這份作業/考試拿 N 分，總成績會變多少」，
 * 並查看「想拿 80 分，剩下要平均幾分」。
 */
import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';

import {
  predictCurrent,
  simulateWhatIf,
  requiredToReach,
  commonTargets,
  type PredictorItem,
  type WhatIfOverride,
} from '@campus/shared';

import {
  DEMO_COURSES,
  getDemoScoreItemsByCourse,
} from '../data/demoCoursesMock';
import { theme } from '../ui/theme';
import { Card, Pill, Screen } from '../ui/components';
import { aiCommentOnWhatIf } from '../services/aiOrchestrator';

export default function GradeWhatIfScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const initialCourseId = Number(route?.params?.courseId ?? DEMO_COURSES[0].id);

  const [courseId, setCourseId] = useState<number>(initialCourseId);
  const [overrides, setOverrides] = useState<WhatIfOverride[]>([]);
  const [targetText, setTargetText] = useState<string>('80');

  const course = DEMO_COURSES.find((c) => c.id === courseId) ?? DEMO_COURSES[0];
  const items: PredictorItem[] = useMemo(() => {
    const scoreItems = getDemoScoreItemsByCourse(courseId);
    return scoreItems.map(
      (s): PredictorItem => ({
        id: String(s.id),
        title: s.name,
        weight: s.weight,
        maxScore: s.totalScore,
        score: s.studentScore,
        graded: s.studentScore !== null,
      }),
    );
  }, [courseId]);

  const baseline = useMemo(() => predictCurrent(items), [items]);
  const whatIf = useMemo(
    () => simulateWhatIf(items, overrides),
    [items, overrides],
  );
  const targets = useMemo(() => commonTargets(items), [items]);

  const target = Number(targetText) || 0;
  const required = useMemo(() => {
    const futureItemIds = items.filter((i) => !i.graded).map((i) => i.id);
    return requiredToReach(items, { targetPercent: target, futureItemIds });
  }, [items, target]);

  // ── AI 即時評論：基於最新 override 給回饋 ──
  const aiComment = useMemo(() => {
    if (overrides.length === 0) {
      return whatIf.likelyCase !== null
        ? `🤖 目前預估 ${whatIf.likelyCase}% · 試試調整下方分數看影響`
        : '🤖 還沒有評分項目可以試算';
    }
    const last = overrides[overrides.length - 1];
    const item = items.find((i) => i.id === last.itemId);
    if (!item) return '';
    return '🤖 ' + aiCommentOnWhatIf({
      itemTitle: item.title,
      newScore: last.assumedScore,
      newTotal: item.maxScore ?? null,
      oldGrade: baseline.likelyCase,
      newGrade: whatIf.likelyCase,
    });
  }, [overrides, items, baseline.likelyCase, whatIf.likelyCase]);

  const setOverride = (itemId: string, value: string) => {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      setOverrides((prev) => prev.filter((o) => o.itemId !== itemId));
      return;
    }
    const item = items.find((i) => i.id === itemId);
    const clamped = Math.max(0, Math.min(n, item?.maxScore ?? 100));
    setOverrides((prev) => {
      const filtered = prev.filter((o) => o.itemId !== itemId);
      return [...filtered, { itemId, assumedScore: clamped }];
    });
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surfaceMuted }}
      contentContainerStyle={{ padding: 16, paddingBottom: 80, gap: 14 }}
    >
      {/* 1. 課程切換 */}
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {DEMO_COURSES.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => {
              setCourseId(c.id);
              setOverrides([]);
            }}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: courseId === c.id ? theme.colors.primary : theme.colors.surface2,
              borderWidth: 1,
              borderColor: courseId === c.id ? theme.colors.primary : theme.colors.border,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text
              style={{
                color: courseId === c.id ? theme.colors.onAccent : theme.colors.text,
                fontSize: 12,
                fontWeight: '600',
              }}
            >
              {c.iconEmoji} {c.name.slice(0, 6)}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* 2. 主預測卡 */}
      <Card title={`📊 ${course.name}`} subtitle="What-if 試算">
        <View style={{ gap: 12 }}>
          {/* 三個情境 */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Box label="悲觀" value={`${whatIf.worstCase}%`} tone="danger" />
            <Box label="預估" value={whatIf.likelyCase !== null ? `${whatIf.likelyCase}%` : '—'} tone="primary" big />
            <Box label="樂觀" value={`${whatIf.bestCase}%`} tone="success" />
          </View>
          {whatIf.letterGrade && (
            <Text style={{ textAlign: 'center', color: theme.colors.text, fontSize: 18 }}>
              預估等第：<Text style={{ fontWeight: '800' }}>{whatIf.letterGrade}</Text>
            </Text>
          )}
          {whatIf.delta !== null && whatIf.delta !== 0 && (
            <Text
              style={{
                textAlign: 'center',
                color: whatIf.delta > 0 ? '#16A34A' : '#DC2626',
                fontSize: 13,
                fontWeight: '600',
              }}
            >
              {whatIf.delta > 0 ? '↑' : '↓'} 與基準相比 {Math.abs(whatIf.delta)}%
            </Text>
          )}
          {/* AI 即時評論 */}
          {aiComment ? (
            <View
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 10,
                backgroundColor: theme.colors.surface2,
                borderLeftWidth: 3,
                borderLeftColor: theme.colors.accent,
              }}
            >
              <Text
                style={{
                  color: theme.colors.text,
                  fontSize: 12,
                  lineHeight: 18,
                }}
              >
                {aiComment}
              </Text>
            </View>
          ) : null}
        </View>
      </Card>

      {/* 3. 評分項目滑桿 */}
      <Card title="🎚 假設分數" subtitle="輸入想模擬的分數">
        <View style={{ gap: 10 }}>
          {items.map((it) => {
            const override = overrides.find((o) => o.itemId === it.id);
            const currentValue =
              override !== undefined
                ? String(override.assumedScore)
                : it.score !== null
                  ? String(it.score)
                  : '';
            return (
              <View
                key={it.id}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  backgroundColor: theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ flex: 1, fontWeight: '600', color: theme.colors.text, fontSize: 13 }} numberOfLines={1}>
                    {it.title}
                  </Text>
                  <Pill text={`${it.weight}%`} kind={it.graded ? 'success' : 'default'} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TextInput
                    keyboardType="numeric"
                    value={currentValue}
                    placeholder={it.graded ? '已批改' : '請輸入'}
                    placeholderTextColor={theme.colors.muted}
                    onChangeText={(t) => setOverride(it.id, t)}
                    style={{
                      flex: 1,
                      padding: 8,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surface,
                      color: theme.colors.text,
                      fontSize: 14,
                    }}
                  />
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>/ {it.maxScore ?? 100}</Text>
                </View>
                {!it.graded && override === undefined && (
                  <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>
                    尚未批改；可在此假設分數試算
                  </Text>
                )}
              </View>
            );
          })}
          {overrides.length > 0 && (
            <Pressable
              onPress={() => setOverrides([])}
              style={({ pressed }) => ({
                padding: 10,
                borderRadius: 8,
                alignItems: 'center',
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: theme.colors.accent, fontSize: 13 }}>清除所有假設</Text>
            </Pressable>
          )}
        </View>
      </Card>

      {/* 4. 想拿 X 分 */}
      <Card title="🎯 目標倒推" subtitle="想拿 N 分，剩下要平均幾分">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Text style={{ color: theme.colors.text }}>想拿</Text>
          <TextInput
            keyboardType="numeric"
            value={targetText}
            onChangeText={setTargetText}
            style={{
              width: 80,
              padding: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
              color: theme.colors.text,
              fontSize: 16,
              fontWeight: '700',
              textAlign: 'center',
            }}
          />
          <Text style={{ color: theme.colors.text }}>分</Text>
        </View>
        <View
          style={{
            padding: 12,
            borderRadius: 10,
            backgroundColor:
              required.feasibility === 'easy' ? '#DCFCE7'
              : required.feasibility === 'doable' ? '#FEF3C7'
              : required.feasibility === 'hard' ? '#FED7AA'
              : '#FEE2E2',
          }}
        >
          <Text
            style={{
              color:
                required.feasibility === 'easy' ? '#15803D'
                : required.feasibility === 'doable' ? '#854D0E'
                : required.feasibility === 'hard' ? '#9A3412'
                : '#991B1B',
              fontWeight: '700',
              fontSize: 14,
              marginBottom: 4,
            }}
          >
            {required.feasibility === 'easy' ? '輕鬆達標'
              : required.feasibility === 'doable' ? '需要用心'
              : required.feasibility === 'hard' ? '挑戰'
              : '無法達成'}
          </Text>
          <Text style={{ color: theme.colors.text, fontSize: 13, lineHeight: 19 }}>
            {required.explanation}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>
            最高可達上限：{required.ceiling}%
          </Text>
        </View>
      </Card>

      {/* 5. 常用目標一覽 */}
      <Card title="🪜 60 / 70 / 80 / 90 一覽">
        <View style={{ gap: 6 }}>
          {targets.map(({ target: t, result: r }) => (
            <View
              key={t}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: 10,
                borderRadius: 8,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Text style={{ fontWeight: '800', color: theme.colors.text, width: 50, fontSize: 14 }}>
                {t} 分
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontSize: 12 }}>
                  {r.requiredAveragePercent !== null
                    ? `剩餘平均要拿 ${r.requiredAveragePercent}%`
                    : r.explanation}
                </Text>
              </View>
              <Pill
                text={
                  r.feasibility === 'easy' ? '輕鬆'
                  : r.feasibility === 'doable' ? '可行'
                  : r.feasibility === 'hard' ? '挑戰'
                  : '不行'
                }
                kind={
                  r.feasibility === 'easy' ? 'success'
                  : r.feasibility === 'doable' ? 'accent'
                  : r.feasibility === 'hard' ? 'warning'
                  : 'default'
                }
              />
            </View>
          ))}
        </View>
      </Card>
    </ScrollView>
  );
}

function Box(props: { label: string; value: string; tone: 'success' | 'danger' | 'primary'; big?: boolean }) {
  const color =
    props.tone === 'success' ? '#16A34A'
    : props.tone === 'danger' ? '#DC2626'
    : theme.colors.primary;
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        padding: 12,
        borderRadius: 10,
        backgroundColor: color + '10',
        borderWidth: 1,
        borderColor: color + '30',
      }}
    >
      <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{props.label}</Text>
      <Text style={{ color, fontSize: props.big ? 30 : 20, fontWeight: '800', marginTop: 2 }}>
        {props.value}
      </Text>
    </View>
  );
}
