/**
 * 學分試算總覽：只用自己的修課紀錄算，沒有紀錄就照實說。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AIDetailScreen, AISection, aiTokens } from '../ui/aiFirst';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { getDataSource, hasDataSource } from '../data';
import type { Grade } from '../data/types';
import {
  PU_CATEGORY_COLORS,
  PU_CATEGORY_LABELS,
  matchDepartment,
  mapCourseTypeDetailed,
  type PUCreditCat,
} from '../data/puGradRequirements';

const SHOWN: PUCreditCat[] = ['required', 'elective', 'general', 'common', 'free'];

function passed(grade: Grade) {
  const score = grade.grade ?? grade.score ?? 0;
  return Number(score) >= 60;
}

export default function CreditSummaryScreen(props: any) {
  const navigation = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();
  const uid = auth.user?.uid;
  const [grades, setGrades] = useState<Grade[] | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!uid || !hasDataSource()) {
        setGrades([]);
        return;
      }
      let alive = true;
      getDataSource()
        .listGrades(uid, undefined, school.id)
        .then((rows) => {
          if (alive) {
            setGrades(rows);
            setFailed(false);
          }
        })
        .catch(() => {
          if (alive) {
            setGrades([]);
            setFailed(true);
          }
        });
      return () => {
        alive = false;
      };
    }, [uid, school.id]),
  );

  const dept = useMemo(() => matchDepartment(auth.profile?.department), [auth.profile?.department]);

  const summary = useMemo(() => {
    const earned: Record<PUCreditCat, number> = {
      required: 0,
      elective: 0,
      general: 0,
      common: 0,
      pe: 0,
      service: 0,
      free: 0,
    };
    let total = 0;
    for (const grade of grades || []) {
      if (!passed(grade)) continue;
      const cat = mapCourseTypeDetailed(grade.courseType, grade.courseName);
      earned[cat] += Number(grade.credits) || 0;
      total += Number(grade.credits) || 0;
    }
    return { earned, total };
  }, [grades]);

  const need = dept.totalCredits;
  const pct = need > 0 ? Math.min(100, Math.round((summary.total / need) * 100)) : 0;
  const hasRecords = (grades?.length || 0) > 0;

  return (
    <AIDetailScreen
      title="學分試算"
      subtitle={hasRecords ? `已修 ${summary.total} / ${need} 學分` : '還沒有修課紀錄'}
      onBack={() => navigation?.goBack?.()}
    >
      {grades === null ? (
        <Text style={{ margin: aiTokens.space.md, color: aiTokens.muted }}>讀取中…</Text>
      ) : !hasRecords ? (
        <View style={{ margin: aiTokens.space.md, gap: 8 }}>
          <Text style={{ fontSize: 15, color: aiTokens.text, lineHeight: 22 }}>
            {failed ? '現在讀不到你的修課紀錄，請稍後再試。' : '還沒有修課紀錄，所以沒辦法試算。'}
          </Text>
          <Text style={{ fontSize: 13, color: aiTokens.muted, lineHeight: 19 }}>
            學校成績系統還沒接，可以先在完整試算裡自己加修過的課。
          </Text>
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
            <Text style={{ fontSize: 12, color: aiTokens.ai, fontWeight: '700' }}>畢業學分</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4, gap: 6 }}>
              <Text style={{ fontSize: 48, fontWeight: '700', color: aiTokens.text }}>{summary.total}</Text>
              <Text style={{ fontSize: 18, color: aiTokens.text }}>/ {need}</Text>
            </View>
            <Text style={{ fontSize: 13, color: aiTokens.muted, marginTop: 6 }}>
              {need - summary.total > 0 ? `還差 ${need - summary.total} 學分` : '總學分已達標'} · {dept.name}
            </Text>
            <View style={{ marginTop: 12, height: 10, backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 5, overflow: 'hidden' }}>
              <View style={{ width: `${pct}%`, height: '100%', backgroundColor: aiTokens.ai }} />
            </View>
          </View>

          <AISection title="各類別">
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
              {SHOWN.filter((cat) => dept.credits[cat] > 0).map((cat) => (
                <CategoryBar
                  key={cat}
                  name={PU_CATEGORY_LABELS[cat]}
                  total={dept.credits[cat]}
                  done={summary.earned[cat]}
                  color={PU_CATEGORY_COLORS[cat]}
                />
              ))}
            </View>
          </AISection>
          <Text style={{ marginHorizontal: aiTokens.space.md, fontSize: 12, color: aiTokens.muted, lineHeight: 18 }}>
            只算你自己的修課紀錄，正式結果以學校畢業審查為準。
          </Text>
        </>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={() => navigation?.navigate?.('CreditAuditLegacy' as never)}
        style={{ margin: aiTokens.space.md, minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={{ color: aiTokens.ai, fontWeight: '700' }}>看完整試算與各學期明細 →</Text>
      </Pressable>
    </AIDetailScreen>
  );
}

function CategoryBar({ name, total, done, color }: { name: string; total: number; done: number; color: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: aiTokens.text }}>{name}</Text>
        <Text style={{ fontSize: 12, color: aiTokens.muted }}>
          {done} / {total}
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: aiTokens.panel, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color }} />
      </View>
    </View>
  );
}
