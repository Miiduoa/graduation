import React, { useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import type { CampusPlanRoute } from '../services/offlineCampusPlanner';
import type { SavedCampusPlan } from '../services/savedCampusPlans';
import { CampusEvidencePlanCard } from './CampusEvidencePlanCard';

type Props = {
  plans: SavedCampusPlan[];
  loading: boolean;
  busy: boolean;
  error: string;
  onRetry: () => void;
  onDelete: (id: string) => void;
  onToggleStep: (id: string, stepId: string, done: boolean) => void;
  onReplan: (saved: SavedCampusPlan) => void;
  onOpenRoute: (route: CampusPlanRoute) => void;
};

const taipeiTimestamp = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const taipeiDate = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
});

function planDates(saved: SavedCampusPlan): string {
  const days = saved.plan.agenda?.days;
  if (days?.length) {
    const first = days[0].date.replace(/-/g, '/');
    const last = days[days.length - 1].date.replace(/-/g, '/');
    return first === last ? first : first + '–' + last;
  }
  return taipeiDate.format(new Date(saved.plan.checkedAt));
}

/** Saved plans are personal checklists, never restored authorization snapshots. */
export function SavedCampusPlansPanel({
  plans, loading, busy, error, onRetry, onDelete, onToggleStep, onReplan, onOpenRoute,
}: Props) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const locked = busy || loading;
  return (
    <AICard title="已儲存計畫" badge={plans.length ? String(plans.length) : undefined} badgeTone="muted">
      <View style={{ gap: 12 }}>
        <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
          留在這台手機，之後可回來接著處理。登出時會清除。
        </Text>
        {loading ? (
          <Text accessibilityLiveRegion="polite" style={{ color: aiTokens.muted, fontSize: 13, lineHeight: 21 }}>
            正在讀取已儲存計畫…
          </Text>
        ) : null}
        {error ? (
          <View style={{ gap: 8 }}>
            <Text accessibilityRole="alert" style={{ color: aiTokens.danger, fontSize: 13, lineHeight: 21 }}>
              {error}
            </Text>
            <AIButton label="重新讀取已儲存計畫" size="sm" variant="ghost" disabled={locked} onPress={onRetry} />
          </View>
        ) : null}
        {!loading && !error && !plans.length ? (
          <Text style={{ color: aiTokens.textSecondary, fontSize: 13, lineHeight: 22 }}>
            尚未儲存計畫。先在對話取得今日或七日計畫，再點「儲存這份計畫」。
          </Text>
        ) : null}
        {plans.map((saved) => {
          const expanded = expandedId === saved.id;
          const dates = planDates(saved);
          const completed = saved.plan.steps.filter((step) => saved.completedStepIds.includes(step.id)).length;
          const progress = '已處理 ' + completed + ' / ' + saved.plan.steps.length;
          const confirmingDelete = deleteId === saved.id;
          return (
            <View key={saved.id} style={{
              borderWidth: 1, borderColor: aiTokens.border, borderRadius: 14, overflow: 'hidden',
            }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={(expanded ? '收起' : '查看') + saved.plan.title + '，' + dates + '，' + progress}
                accessibilityHint="查看儲存時的計畫內容與個人處理進度"
                accessibilityState={{ expanded, disabled: locked }}
                aria-expanded={expanded}
                disabled={locked}
                onPress={() => {
                  if (locked) return;
                  setExpandedId(expanded ? null : saved.id);
                  setDeleteId(null);
                }}
                style={({ pressed }) => ({
                  minHeight: 72, padding: 13, gap: 6,
                  backgroundColor: pressed ? aiTokens.aiSoft : aiTokens.panel,
                  opacity: locked ? 0.6 : 1,
                })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                  <Text style={{ flex: 1, minWidth: 0, color: aiTokens.text, fontSize: 15, fontWeight: '700', lineHeight: 23 }}>
                    {saved.plan.title}
                  </Text>
                  <Text style={{ color: aiTokens.ai, fontSize: 12, lineHeight: 23 }}>
                    {expanded ? '收起' : '查看'}
                  </Text>
                </View>
                <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 19 }}>
                  原規劃日期：{dates}
                </Text>
                <Text style={{ color: aiTokens.textSecondary, fontSize: 12, fontWeight: '600', lineHeight: 19 }}>
                  {progress}
                </Text>
              </Pressable>
              {expanded ? (
                <View style={{ padding: 13, gap: 10, borderTopWidth: 1, borderTopColor: aiTokens.border }}>
                  <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
                    儲存於 {taipeiTimestamp.format(new Date(saved.savedAt))}（台灣時間）
                  </Text>
                  <View style={{ gap: 4, padding: 10, borderRadius: 10, backgroundColor: aiTokens.panel }}>
                    <Text style={{ color: aiTokens.textSecondary, fontSize: 12, lineHeight: 20 }}>
                      整理時間：{taipeiTimestamp.format(new Date(saved.plan.checkedAt))}（台灣時間）
                    </Text>
                    <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
                      課表、期限與公告仍是當時資料，使用前請重新核對。
                    </Text>
                  </View>
                  <View style={{ gap: 4 }}>
                    <Text style={{ color: aiTokens.textSecondary, fontSize: 12, fontWeight: '600' }}>當時的問題</Text>
                    <Text selectable style={{ color: aiTokens.text, fontSize: 14, lineHeight: 23 }}>{saved.question}</Text>
                  </View>
                  <CampusEvidencePlanCard
                    plan={saved.plan}
                    historical
                    disabled={locked}
                    progress={{
                      completedStepIds: saved.completedStepIds,
                      onToggleStep: (stepId, done) => {
                        if (!locked) onToggleStep(saved.id, stepId, done);
                      },
                    }}
                    onOpenRoute={(route) => { if (!locked) onOpenRoute(route); }}
                  />
                  <View style={{ borderTopWidth: 1, borderTopColor: aiTokens.border, paddingTop: 14, gap: 9 }}>
                    <AIButton
                      label="依目前資料重新規劃"
                      size="sm"
                      disabled={locked}
                      onPress={() => { if (!locked) onReplan(saved); }}
                    />
                    <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
                      以現在為基準建立新計畫，這份計畫與處理進度會保留。
                    </Text>
                    {confirmingDelete ? (
                      <View style={{ padding: 12, gap: 10, borderRadius: 10, backgroundColor: aiTokens.dangerSoft }}>
                        <Text accessibilityRole="alert" style={{ color: aiTokens.text, fontSize: 13, lineHeight: 22 }}>
                          刪除這份計畫和處理進度？已設定的作業提醒會保留。
                        </Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          <AIButton label="保留計畫" size="sm" variant="ghost" disabled={locked}
                            onPress={() => setDeleteId(null)} />
                          <AIButton label="確認刪除" size="sm" variant="danger" disabled={locked}
                            onPress={() => { if (!locked) onDelete(saved.id); }} />
                        </View>
                      </View>
                    ) : (
                      <AIButton label="刪除計畫" size="sm" variant="ghost" disabled={locked}
                        onPress={() => setDeleteId(saved.id)} />
                    )}
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </AICard>
  );
}
