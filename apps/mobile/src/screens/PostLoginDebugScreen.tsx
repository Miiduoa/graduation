/* eslint-disable */
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, ActivityIndicator } from 'react-native';
import { collection, getDocs, limit, query } from 'firebase/firestore';

import { Screen, AnimatedCard, Divider } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { useTheme } from '../state/theme';
import { useAuth } from '../state/auth';
import { getDb, hasUsableFirebaseConfig } from '../firebase';
import { getPuCacheDebugMetadata } from '../services/puDataCache';
import { getLastPostLoginEngineBootstrap } from '../services/finalizePostLoginClient';

export function PostLoginDebugScreen() {
  const theme = useTheme();
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [runs, setRuns] = useState<Record<string, unknown>[]>([]);
  const [cacheMeta, setCacheMeta] = useState<Awaited<ReturnType<typeof getPuCacheDebugMetadata>>>([]);
  const [bootstrap, setBootstrap] = useState(getLastPostLoginEngineBootstrap());

  const load = useCallback(async () => {
    setBootstrap(getLastPostLoginEngineBootstrap());
    setCacheMeta(await getPuCacheDebugMetadata());
    if (!hasUsableFirebaseConfig() || !user?.uid) {
      setRuns([]);
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
    } catch (e) {
      console.warn('[PostLoginDebug] load runs failed:', e);
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

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
            </View>
          )}
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
