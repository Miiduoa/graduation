import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import {
  analyzeCreditPlan,
} from '@campus/shared/src/creditPlanInsights';
import { formatCredits, type CreditPlan } from '@campus/shared/src/creditPlanner';
import { theme } from '../../ui/theme';

function numberOrDash(number: number | null) {
  return number === null ? '—' : formatCredits(number);
}

/**
 * Projection data is deliberately separated from official academic records:
 * planned courses are always conditional, and "extra" credits have no term.
 */
export function CreditPlanFeasibilityCard({ plan }: { plan: CreditPlan }) {
  const report = useMemo(() => analyzeCreditPlan(plan), [plan]);
  const colors = theme.colors;

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 5 }}>
        <Text style={{ fontSize: 19, fontWeight: '700', color: colors.text }}>
          學期負擔與下一步
        </Text>
        <Text style={{ fontSize: 12, lineHeight: 19, color: colors.muted }}>
          根據個人輸入做條件式試算。規劃課程與選課紀錄均不代表正式取得學分。
        </Text>
      </View>
      <View style={{
        gap: 14, padding: 18, borderRadius: 17,
        backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          <View style={{ flex: 1, minWidth: 126, gap: 6 }}>
            <Text style={{ color: colors.muted, fontSize: 12 }}>平均每學期還需</Text>
            <Text style={{ color: colors.text, fontSize: 26, fontWeight: '700' }}>
              {numberOrDash(report.averageNeededPerTerm)}
              <Text style={{ fontSize: 12, color: colors.muted }}> 學分</Text>
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 126, gap: 6 }}>
            <Text style={{ color: colors.muted, fontSize: 12 }}>尚未排入學期</Text>
            <Text style={{ color: colors.text, fontSize: 26, fontWeight: '700' }}>
              {numberOrDash(report.creditsWithoutSemester)}
              <Text style={{ fontSize: 12, color: colors.muted }}> 學分</Text>
            </Text>
          </View>
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
          平均量是以個人目標扣除已確認學分後，分攤到規劃學期的數學下限，並非學校修課規定；尚未排入學期的數字包含其他預計修習學分。
        </Text>
        <View style={{ height: 1, backgroundColor: colors.border }} />
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>
          假設全部排定課程都通過
        </Text>
        {report.terms.map((entry) => (
          <View key={entry.term} style={{
            flexDirection: 'row', justifyContent: 'space-between',
            alignItems: 'center', gap: 10, minHeight: 44,
          }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
                未來第 {entry.term} 學期
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                規劃 {formatCredits(entry.plannedCredits)} 學分
              </Text>
            </View>
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>
              累積 {numberOrDash(entry.cumulativeIfPassed)}
            </Text>
          </View>
        ))}
        <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 19 }}>
          學期推演不會把「其他預計學分」自行分配到學期，也不代表學校認列或開課保證。
        </Text>
      </View>
      <View style={{
        gap: 11, padding: 18, borderRadius: 17,
        backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>
          優先處理事項
        </Text>
        {report.guidance.map((item, index) => (
          <View key={index} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <View style={{
              height: 22, width: 22, borderRadius: 8,
              backgroundColor: colors.surface2, justifyContent: 'center', alignItems: 'center',
            }}>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>
                {index + 1}
              </Text>
            </View>
            <Text style={{ color: colors.text, fontSize: 13, lineHeight: 20, flex: 1 }}>
              {item}
            </Text>
          </View>
        ))}
        <Text style={{ color: colors.muted, fontSize: 11, lineHeight: 19 }}>
          是否符合系所必修、抵免及畢業規定，仍須依入學年度與學校正式審查。
        </Text>
      </View>
    </View>
  );
}
