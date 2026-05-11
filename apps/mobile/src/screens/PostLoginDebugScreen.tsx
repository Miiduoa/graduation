/* eslint-disable */
import React, { useCallback, useEffect, useState } from 'react';
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
    const repairPath =
      schoolId && user?.uid
        ? `schools/${schoolId}/repairRequests（與 Functions submitRepairRequest 寫入同一 collection）`
        : '（需 primarySchoolId / schoolId 才顯示報修路徑）';
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
      setLatestRunSummary('—');
      setLoading(false);
      return;
    }
    try {
      const db = getDb();
      const snap = await getDocs(
        query(collection(db, 'users', user.uid, 'postLoginRuns'), limit(5)),
      );
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => {
        const ta = String((a as { createdAt?: { seconds?: number } }).createdAt?.seconds ?? 0);
        const tb = String((b as { createdAt?: { seconds?: number } }).createdAt?.seconds ?? 0);
        return tb.localeCompare(ta);
      });
      setRuns(rows);
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
      setLatestRunSummary('—');
    } finally {
      setLoading(false);
    }
  }, [user?.uid, profile?.primarySchoolId, profile?.schoolId]);

  useEffect(() => {
    void load();
  }, [load]);

  const textSecondary = { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 };

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
