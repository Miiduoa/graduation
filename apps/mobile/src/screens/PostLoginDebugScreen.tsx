/* eslint-disable */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, ActivityIndicator } from 'react-native';
import { collection, getDocs, limit, query } from 'firebase/firestore';

import { Screen, AnimatedCard, Divider } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { useTheme } from '../state/theme';
import { useAuth } from '../state/auth';
import { getAuthInstance, getDb, hasUsableFirebaseConfig } from '../firebase';
import { getPostLoginContext } from '../data/postLoginDataRouter';
import { getPuCacheDebugMetadata } from '../services/puDataCache';
import { getLastPostLoginEngineBootstrap } from '../services/postLoginBootstrapStore';
import { getInMemoryPostLoginContext } from '../services/postLoginContextHolder';

/** 掃描本批 agentRuns 的 steps／toolCalls，粗算疑似失敗步驟（供小型日誌分析）。 */
function summarizeAgentRunToolHealth(runs: Record<string, unknown>[]): string {
  let totalSteps = 0;
  let failedSteps = 0;
  const byTool: Record<string, number> = {};
  for (const r of runs) {
    const row = r as { toolCalls?: unknown[]; steps?: unknown[] };
    const steps = Array.isArray(row.toolCalls) ? row.toolCalls : row.steps;
    if (!Array.isArray(steps)) continue;
    for (const step of steps) {
      if (!step || typeof step !== 'object') continue;
      const s = step as Record<string, unknown>;
      const tool = String(s.tool ?? s.name ?? '?');
      totalSteps += 1;
      let out = s.output;
      if (typeof out === 'string') {
        try {
          out = JSON.parse(out) as Record<string, unknown>;
        } catch {
          /* 保留字串 */
        }
      }
      const bad =
        out &&
        typeof out === 'object' &&
        ((out as { success?: boolean }).success === false ||
          (out as { error?: unknown }).error != null ||
          Boolean((out as { errorMessage?: string }).errorMessage));
      if (bad) {
        failedSteps += 1;
        byTool[tool] = (byTool[tool] ?? 0) + 1;
      }
    }
  }
  const top = Object.entries(byTool)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => `${k}×${v}`)
    .join('、');
  return `載入 ${runs.length} 筆 run；tool 步驟 ${totalSteps} 步，其中 output 含 success:false 或 error／errorMessage：${failedSteps} 步${
    top ? `（${top}）` : ''
  }。細節見各筆 JSON 的 toolCalls／steps。`;
}

export function PostLoginDebugScreen() {
  const theme = useTheme();
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [runs, setRuns] = useState<Record<string, unknown>[]>([]);
  const [agentRuns, setAgentRuns] = useState<Record<string, unknown>[]>([]);
  const [cacheMeta, setCacheMeta] = useState<Awaited<ReturnType<typeof getPuCacheDebugMetadata>>>([]);
  const [bootstrap, setBootstrap] = useState(getLastPostLoginEngineBootstrap());
  const [claimsText, setClaimsText] = useState<string>('—');
  const [plcMemoryText, setPlcMemoryText] = useState<string>('—');
  const [plcCacheText, setPlcCacheText] = useState<string>('—');
  const [latestRunSummary, setLatestRunSummary] = useState<string>('—');

  const load = useCallback(async () => {
    setBootstrap(getLastPostLoginEngineBootstrap());
    setCacheMeta(await getPuCacheDebugMetadata());
    const schoolId = profile?.primarySchoolId ?? profile?.schoolId ?? null;
    const mem = getInMemoryPostLoginContext();
    setPlcMemoryText(mem ? JSON.stringify({ primary: mem.roles.primaryRole, source: mem.roles.source, builtAt: mem.builtAt }, null, 2) : '（無記憶體 PostLoginContext）');
    if (schoolId) {
      try {
        const fromCache = await getPostLoginContext(schoolId);
        setPlcCacheText(
          fromCache
            ? JSON.stringify({ primary: fromCache.roles.primaryRole, source: fromCache.roles.source, builtAt: fromCache.builtAt }, null, 2)
            : '（快取無 PostLoginContext）',
        );
      } catch (e) {
        setPlcCacheText(`讀取失敗: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      setPlcCacheText('（無 schoolId，略過 getPostLoginContext）');
    }

    const au = getAuthInstance().currentUser;
    if (au) {
      try {
        const tr = await au.getIdTokenResult();
        setClaimsText(JSON.stringify({ role: tr.claims.role, roles: tr.claims.roles, schoolId: tr.claims.schoolId }, null, 2));
      } catch (e) {
        setClaimsText(`getIdTokenResult 失敗: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      setClaimsText('（未登入 Firebase）');
    }

    if (!hasUsableFirebaseConfig() || !user?.uid) {
      setRuns([]);
      setAgentRuns([]);
      setLatestRunSummary('—');
      setLoading(false);
      return;
    }
    try {
      const db = getDb();
      const [snapPl, snapAr] = await Promise.all([
        getDocs(query(collection(db, 'users', user.uid, 'postLoginRuns'), limit(5))),
        getDocs(query(collection(db, 'users', user.uid, 'agentRuns'), limit(25))),
      ]);
      const rows = snapPl.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => {
        const ta = String((a as { createdAt?: { seconds?: number } }).createdAt?.seconds ?? 0);
        const tb = String((b as { createdAt?: { seconds?: number } }).createdAt?.seconds ?? 0);
        return tb.localeCompare(ta);
      });
      setRuns(rows);

      const ar = snapAr.docs.map((d) => ({ id: d.id, ...d.data() }));
      ar.sort((a, b) => {
        const ta = String((a as { updatedAt?: { seconds?: number } }).updatedAt?.seconds ?? 0);
        const tb = String((b as { updatedAt?: { seconds?: number } }).updatedAt?.seconds ?? 0);
        return tb.localeCompare(ta);
      });
      setAgentRuns(ar);
      const latest = rows[0] as {
        outputs?: {
          puCourseCount?: number;
          tcCourseCount?: number;
          rosterCourses?: number;
          partial?: boolean;
          tronCoursesFailed?: boolean;
          tronRostersFailed?: boolean;
          puCoursesFailed?: boolean;
          sourcesUsed?: Record<string, boolean>;
        };
        errors?: unknown[];
      } | undefined;
      if (latest?.outputs) {
        const o = latest.outputs;
        setLatestRunSummary(
          `puCourses=${o.puCourseCount ?? '—'} tcCourses=${o.tcCourseCount ?? '—'} rosters=${o.rosterCourses ?? '—'} | partial=${String(o.partial ?? false)} puFail=${String(o.puCoursesFailed ?? false)} tronCoursesFail=${String(o.tronCoursesFailed ?? false)} tronRostersFail=${String(o.tronRostersFailed ?? false)} | sources=${JSON.stringify(o.sourcesUsed ?? {})} | errors=${latest.errors?.length ?? 0} 筆`,
        );
      } else {
        setLatestRunSummary('（無 outputs）');
      }
    } catch (e) {
      console.warn('[PostLoginDebug] load runs failed:', e);
      setRuns([]);
      setAgentRuns([]);
      setLatestRunSummary('—');
    } finally {
      setLoading(false);
    }
  }, [user?.uid, profile?.primarySchoolId, profile?.schoolId]);

  useEffect(() => {
    void load();
  }, [load]);

  const agentRunToolSummary = useMemo(() => summarizeAgentRunToolHealth(agentRuns), [agentRuns]);

  const textSecondary = { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 };
  const schoolIdForRepair = profile?.primarySchoolId ?? profile?.schoolId ?? null;
  const repairFirestorePath =
    schoolIdForRepair && user?.uid
      ? `schools/${schoolIdForRepair}/repairRequests`
      : null;

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 14, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        <AnimatedCard title="Post-login 除錯" subtitle="本機 bootstrap + puDataCache v1 + Firestore runs">
          {loading ? (
            <ActivityIndicator color={theme.colors.accent} />
          ) : (
            <View style={{ gap: 10 }}>
              <Text style={{ color: theme.colors.text, fontWeight: '600' }}>目前使用者</Text>
              <Text style={textSecondary}>uid: {user?.uid ?? '—'}</Text>
              <Text style={textSecondary}>role: {profile?.role ?? '—'}</Text>
              <Text style={textSecondary}>
                postLoginRoles: {profile?.postLoginRoles?.join(', ') || '—'}
              </Text>
              <Text style={{ ...textSecondary, marginTop: 8 }}>Firebase custom claims</Text>
              <Text style={textSecondary}>{claimsText}</Text>
            </View>
          )}
        </AnimatedCard>

        <AnimatedCard title="角色對照（profile vs claims vs PostLoginContext）" subtitle="不同步時請看此區">
          <Text style={textSecondary}>記憶體 PostLoginContext（builtAt / primary / source）</Text>
          <Text style={textSecondary}>{plcMemoryText}</Text>
          <Text style={{ ...textSecondary, marginTop: 8 }}>快取 PostLoginContext（getPostLoginContext）</Text>
          <Text style={textSecondary}>{plcCacheText}</Text>
        </AnimatedCard>

        <AnimatedCard title="最近一次 finalize run 摘要" subtitle="Firestore postLoginRuns[0].outputs">
          <Text style={textSecondary}>{latestRunSummary}</Text>
        </AnimatedCard>

        <AnimatedCard title="本機引擎 bootstrap" subtitle="最近一次 routePostLoginData 寫入">
          <Text style={textSecondary}>
            {bootstrap
              ? JSON.stringify(bootstrap, null, 2)
              : '（尚無，請先完成一次登入與 routePostLoginData）'}
          </Text>
        </AnimatedCard>

        <AnimatedCard title="puDataCache（服務層 v1）" subtitle="課表／TronClass 等條目">
          {cacheMeta.map((row) => (
            <View key={row.key} style={{ marginBottom: 8 }}>
              <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '600' }}>
                {row.key}
              </Text>
              <Text style={textSecondary}>
                fetchedAt: {row.fetchedAt ?? '—'} | source: {row.source ?? '—'} | ttlMs:{' '}
                {row.ttlMs ?? '—'}
              </Text>
            </View>
          ))}
        </AnimatedCard>

        <AnimatedCard
          title="AI 報修 / Cloud agent 對照"
            subtitle="Console：與 App 寫入同一 repairRequests；Functions log 搜 createDormRepairRequest 或 submitRepairRequest（callable）"
        >
          <Text style={textSecondary}>
            Firestore 報修 collection：{repairFirestorePath ?? '（無 schoolId）'}
          </Text>
          <Text style={{ ...textSecondary, marginTop: 8 }}>
            agentRuns 內 steps／toolCalls 可查是否呼叫工具與 output（payload）；若 tool 回傳 JSON 內含 error
            鍵，後續模型仍宣稱成功，代表最終文案未吃 tool result。
          </Text>
        </AnimatedCard>

        <AnimatedCard title="Firestore agentRuns" subtitle="最近 25 筆 campus assistant／agent 執行（新→舊）">
          <Text style={{ ...textSecondary, marginBottom: 8 }}>{agentRunToolSummary}</Text>
          <Text style={textSecondary}>
            大量抽樣請用 Firebase Console 或見 docs/agentruns-sampling.md。
          </Text>
          <Divider spacing={8} />
          {agentRuns.length === 0 ? (
            <Text style={textSecondary}>無資料或尚未產生 run</Text>
          ) : (
            agentRuns.map((r) => (
              <View key={String((r as { id?: string }).id)} style={{ marginBottom: 12 }}>
                <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '700' }}>
                  {(r as { id?: string }).id}
                </Text>
                <Text style={textSecondary}>{JSON.stringify(r, null, 2)}</Text>
              </View>
            ))
          )}
        </AnimatedCard>

        <AnimatedCard title="Firestore postLoginRuns" subtitle="最近 5 筆（新→舊）">
          <Divider spacing={8} />
          {runs.length === 0 ? (
            <Text style={textSecondary}>無資料或無權限讀取</Text>
          ) : (
            runs.map((r) => (
              <View key={String((r as { id?: string }).id)} style={{ marginBottom: 12 }}>
                <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '700' }}>
                  {(r as { id?: string }).id}
                </Text>
                <Text style={textSecondary}>{JSON.stringify(r, null, 2)}</Text>
              </View>
            ))
          )}
        </AnimatedCard>
      </ScrollView>
    </Screen>
  );
}
