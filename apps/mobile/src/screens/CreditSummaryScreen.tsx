/**
 * 學分試算總覽：只顯示目前帳號／目前學校的修課粗估，不捏造正式畢業認定。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AIDetailScreen, AISection, aiTokens } from '../ui/aiFirst';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import type { Grade } from '../data/types';
import {
  PU_CATEGORY_COLORS,
  PU_CATEGORY_LABELS,
  matchDepartment,
  type PUCreditCat,
} from '../data/puGradRequirements';
import { computeCreditTotals } from './creditAudit/creditMath';
import { isProvidenceUniversitySchool } from './creditAudit/gradeScope';
import { loadCreditRecords } from './creditAudit/loadCreditRecords';

const SHOWN: PUCreditCat[] = ['required', 'elective', 'general', 'common', 'free'];

type NavigationLike = {
  navigate?: (name: string, params?: unknown) => void;
  goBack?: () => void;
};

type Props = {
  navigation?: NavigationLike;
};

export default function CreditSummaryScreen(props: Props) {
  const navigation = props.navigation;
  const auth = useAuth();
  const { school } = useSchool();
  const uid = auth.user?.uid ?? null;
  const schoolId = school.id;
  const isPu = isProvidenceUniversitySchool(schoolId);

  const [grades, setGrades] = useState<Grade[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const requestGen = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGen.current += 1;
    };
  }, []);

  const load = useCallback(async () => {
    const gen = ++requestGen.current;
    setLoading(true);

    const result = await loadCreditRecords({ uid, schoolId });

    if (!mountedRef.current || gen !== requestGen.current) return;

    if (result.ok === false) {
      setError(result.errorMessage);
      setGrades([]);
      setLoading(false);
      return;
    }

    setGrades(result.grades);
    setError(null);
    setLoading(false);
  }, [uid, schoolId]);

  useFocusEffect(
    useCallback(() => {
      setGrades(null);
      setError(null);
      void load();
      return () => {
        requestGen.current += 1;
      };
    }, [load]),
  );

  // 學校／帳號切換時立即清掉上一份私人資料（即使尚未 focus 回調）
  useEffect(() => {
    setGrades(null);
    setError(null);
    setLoading(true);
  }, [uid, schoolId]);

  const dept = useMemo(
    () => (isPu ? matchDepartment(auth.profile?.department) : null),
    [auth.profile?.department, isPu],
  );
  const deptUnknown = Boolean(dept && dept.id === 'default');

  const summary = useMemo(
    () => computeCreditTotals(grades || [], dept),
    [grades, dept],
  );

  const need = dept?.totalCredits ?? 0;
  const total = summary.totalEarned;
  const pct = isPu && need > 0 ? Math.min(100, Math.round((total / need) * 100)) : 0;
  const hasRecords = (grades?.length || 0) > 0;
  const showLoading = loading || grades === null;

  return (
    <AIDetailScreen
      title="學分試算"
      subtitle={
        showLoading
          ? '讀取中…'
          : error
            ? '讀取失敗'
            : hasRecords
              ? isPu
                ? `粗估已修 ${total}${need > 0 ? ` / ${need}` : ''} 學分`
                : `粗估已修 ${total} 學分`
              : '還沒有修課紀錄'
      }
      onBack={() => navigation?.goBack?.()}
    >
      {showLoading ? (
        <Text style={{ margin: aiTokens.space.md, color: aiTokens.muted, fontSize: 15 }}>
          讀取修課紀錄中…
        </Text>
      ) : error ? (
        <View style={{ margin: aiTokens.space.md, gap: 12 }} accessibilityRole="alert">
          <Text style={{ fontSize: 15, color: aiTokens.text, lineHeight: 22 }}>{error}</Text>
          <Text style={{ fontSize: 13, color: aiTokens.muted, lineHeight: 19 }}>
            這不是「沒有成績」，而是這次讀取沒有成功。請稍後再試。
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重新讀取修課紀錄"
            onPress={() => void load()}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ color: aiTokens.ai, fontWeight: '700', fontSize: 15 }}>重新讀取</Text>
          </Pressable>
        </View>
      ) : !hasRecords ? (
        <View style={{ margin: aiTokens.space.md, gap: 8 }}>
          <Text style={{ fontSize: 15, color: aiTokens.text, lineHeight: 22 }}>
            你在「{school.name}」尚無可用的修課紀錄。
          </Text>
          <Text style={{ fontSize: 13, color: aiTokens.muted, lineHeight: 19 }}>
            若成績剛發布或同步，請稍後重新讀取。
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重新讀取修課紀錄"
            onPress={() => void load()}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ color: aiTokens.ai, fontWeight: '700', fontSize: 15 }}>重新讀取</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View
            style={{
              marginHorizontal: aiTokens.space.md,
              marginTop: aiTokens.space.sm,
              padding: aiTokens.space.lg,
              backgroundColor: aiTokens.aiGradientStart,
              borderRadius: aiTokens.radius.lg,
            }}
          >
            <Text style={{ fontSize: 13, color: aiTokens.ai, fontWeight: '700' }}>
              {isPu ? '參考學分進度（靜宜模型）' : '修課學分加總'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4, gap: 6 }}>
              <Text style={{ fontSize: 48, fontWeight: '700', color: aiTokens.text }}>{total}</Text>
              {isPu && need > 0 ? (
                <Text style={{ fontSize: 18, color: aiTokens.text }}>/ {need}</Text>
              ) : null}
            </View>
            <Text style={{ fontSize: 14, color: aiTokens.muted, marginTop: 6, lineHeight: 20 }}>
              {isPu && dept
                ? deptUnknown
                  ? `系所尚未對應，數字僅供粗估，不是自動官方偵測或已驗證門檻。· ${dept.name}`
                  : need - total > 0
                    ? `粗估還差約 ${need - total} 學分 · ${dept.name}`
                    : `粗估總學分已達參考門檻 · ${dept.name}`
                : `僅加總目前學校通過課程，未套用畢業門檻。`}
            </Text>
            {isPu && need > 0 && !deptUnknown ? (
              <View
                style={{
                  marginTop: 12,
                  height: 10,
                  backgroundColor: 'rgba(255,255,255,0.6)',
                  borderRadius: 5,
                  overflow: 'hidden',
                }}
              >
                <View style={{ width: `${pct}%`, height: '100%', backgroundColor: aiTokens.ai }} />
              </View>
            ) : null}
          </View>

          <AISection title={isPu ? '各類別（參考）' : '各類別加總'}>
            <View
              style={{
                marginHorizontal: aiTokens.space.md,
                padding: aiTokens.space.lg,
                backgroundColor: aiTokens.surface,
                borderRadius: aiTokens.radius.lg,
                borderWidth: 1,
                borderColor: aiTokens.border,
              }}
            >
              {isPu && dept
                ? SHOWN.filter(
                    (cat) => dept.credits[cat] > 0 || summary.byCategory[cat].earned > 0,
                  ).map((cat) => (
                    <CategoryBar
                      key={cat}
                      name={PU_CATEGORY_LABELS[cat]}
                      total={dept.credits[cat]}
                      done={summary.byCategory[cat].earned}
                      color={PU_CATEGORY_COLORS[cat]}
                      showRequirement
                    />
                  ))
                : SHOWN.filter((cat) => summary.byCategory[cat].courses > 0).map((cat) => (
                    <CategoryBar
                      key={cat}
                      name={PU_CATEGORY_LABELS[cat]}
                      total={0}
                      done={summary.byCategory[cat].earned}
                      color={PU_CATEGORY_COLORS[cat]}
                      showRequirement={false}
                    />
                  ))}
            </View>
          </AISection>
          <Text
            style={{
              marginHorizontal: aiTokens.space.md,
              fontSize: 13,
              color: aiTokens.muted,
              lineHeight: 20,
            }}
          >
            {isPu
              ? '依靜宜參考模型試算。通過學分以60分或來源明示通過加總；入學年度、學制、重修與抵免規則請以學校審查為準。'
              : '此校尚未設定畢業規則，目前未套用畢業門檻。參考通過學分以60分或來源明示通過加總，請核對你的學制及課程規定。'}
          </Text>
        </>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="規劃未來每學期課程"
        onPress={() => navigation?.navigate?.('CreditPlanning')}
        style={{
          marginHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.lg,
          minHeight: 64,
          justifyContent: 'center',
          paddingHorizontal: aiTokens.space.lg,
          borderRadius: aiTokens.radius.lg,
          backgroundColor: aiTokens.aiGradientStart,
          borderWidth: 1,
          borderColor: aiTokens.border,
        }}
      >
        <Text style={{ color: aiTokens.text, fontSize: 16, fontWeight: '700' }}>規劃未來每學期課程 →</Text>
        <Text style={{ color: aiTokens.muted, fontSize: 12, marginTop: 5 }}>
          安排候選課程、試算目標並與 Web 交換 JSON 備份
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="查看完整試算與各學期明細"
        onPress={() => navigation?.navigate?.('CreditAuditLegacy')}
        style={{ margin: aiTokens.space.md, minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={{ color: aiTokens.ai, fontWeight: '700', fontSize: 15 }}>
          看完整試算與各學期明細 →
        </Text>
      </Pressable>
    </AIDetailScreen>
  );
}

function CategoryBar({
  name,
  total,
  done,
  color,
  showRequirement,
}: {
  name: string;
  total: number;
  done: number;
  color: string;
  showRequirement: boolean;
}) {
  const pct =
    showRequirement && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : done > 0 ? 100 : 0;
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: aiTokens.text }}>{name}</Text>
        <Text style={{ fontSize: 13, color: aiTokens.muted }}>
          {showRequirement ? `${done} / ${total}` : `${done} 學分`}
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: aiTokens.panel, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color }} />
      </View>
    </View>
  );
}
