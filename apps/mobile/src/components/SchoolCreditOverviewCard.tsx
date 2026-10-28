import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  PU_CREDIT_OVERVIEW_FIELDS, PU_CREDIT_OVERVIEW_LABELS, PU_CREDIT_OVERVIEW_NOTE,
  PU_CREDIT_REVIEW_URL, type PuCreditOverviewSnapshot,
} from '@campus/shared/src/puCreditOverview';
import { loadOwnedSchoolCreditOverview, SchoolCreditOverviewError } from '../services/ownedSchoolCreditOverview';
import { aiTokens } from '../ui/aiFirst';
import { isProvidenceUniversitySchool } from '../screens/creditAudit/gradeScope';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

type State = {
  scope: string; user: { uid: string }; loading: boolean; snapshot?: PuCreditOverviewSnapshot;
  error?: string; reason?: SchoolCreditOverviewError['reason'];
};
const label = (value: number | null) => value === null ? '未提供' : `${value} 學分`;

export function SchoolCreditOverviewCard({ user, schoolId, onReconnect }: {
  user: { uid: string }; schoolId: string; onReconnect?: () => void;
}) {
  const uid = user.uid;
  const styles = useThemeStyleSheet(createStyles);
  const scope = JSON.stringify([uid, schoolId]);
  const supported = isProvidenceUniversitySchool(schoolId);
  const [state, setState] = useState<State | null>(null);
  const [linkError, setLinkError] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const read = useCallback(async () => {
    if (pending.current || !uid || !supported) return;
    const current = ++generation.current;
    pending.current = true;
    setState((previous) => ({ scope, user, loading: true,
      ...(previous?.scope === scope && previous.user === user && previous.snapshot ? { snapshot: previous.snapshot } : {}),
    }));
    try {
      const snapshot = await loadOwnedSchoolCreditOverview(uid);
      if (snapshot.ownerUid !== uid || snapshot.schoolId !== 'pu') throw new SchoolCreditOverviewError('unavailable');
      if (generation.current === current) setState({ scope, user, loading: false, snapshot });
    } catch (error) {
      if (generation.current !== current) return;
      const transient = error instanceof SchoolCreditOverviewError && error.reason === 'unavailable';
      setState((previous) => ({ scope, user, loading: false,
        error: error instanceof SchoolCreditOverviewError ? error.message : '暫時無法讀取校方學分累計。',
        reason: error instanceof SchoolCreditOverviewError ? error.reason : 'unavailable',
        ...(transient && previous?.scope === scope && previous.user === user && previous.snapshot ? { snapshot: previous.snapshot } : {}),
      }));
    } finally {
      if (generation.current === current) pending.current = false;
    }
  }, [uid, user, scope, supported]);
  useEffect(() => {
    pending.current = false;
    setLinkError(false);
    void read();
    return () => { generation.current += 1; pending.current = false; };
  }, [read]);
  if (!uid || !supported) return null;
  const visible = state?.scope === scope && state.user === user ? state : null;
  const snapshot = visible?.snapshot;
  const loading = !visible || visible.loading;
  const timestamp = snapshot && new Date(snapshot.fetchedAt).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return <View style={styles.card} testID="school-credit-overview">
    <Text style={styles.source}>靜宜 e 校園・學分試算表</Text>
    <Text style={styles.title} accessibilityRole="header">校方回報的學分累計</Text>
    <Text style={styles.note}>直接讀取試算總覽，與下方成績推算及個人規劃分開呈現。</Text>
    {loading && !snapshot && <Text style={styles.note} accessibilityLiveRegion="polite">正在讀取校方學分試算表…</Text>}
    {visible?.error && <Text style={styles.notice} accessibilityLiveRegion="polite">
      {snapshot ? `本次更新未完成，目前顯示 ${timestamp} 取得的資料。` : visible.error}
    </Text>}
    {snapshot && <>
      <Text style={styles.source}>{PU_CREDIT_OVERVIEW_LABELS.subtotal}</Text>
      <Text style={styles.total}>{label(snapshot.overview.totals.subtotal)}</Text>
      <Text style={styles.note}>{PU_CREDIT_OVERVIEW_LABELS.totalRequired}：{label(snapshot.overview.totals.totalRequired)}</Text>
      <View style={styles.rows}>
        {PU_CREDIT_OVERVIEW_FIELDS.filter((field) => field !== 'subtotal' && field !== 'totalRequired')
          .map((field) => <View key={field} style={styles.row}>
            <Text style={styles.rowName}>{PU_CREDIT_OVERVIEW_LABELS[field]}</Text>
            <Text style={styles.rowValue}>{label(snapshot.overview.totals[field])}</Text>
          </View>)}
      </View>
      <Text style={styles.source}>{timestamp} 讀取 · 取得 {8 - snapshot.overview.coverage.missingFields.length}／8 個累計欄位</Text>
    </>}
    <Text style={styles.note}>{PU_CREDIT_OVERVIEW_NOTE}</Text>
    <View style={styles.actions}>
      {!snapshot && onReconnect && (visible?.reason === 'reconnect' || visible?.reason === 'permission') ?
        <Pressable accessibilityRole="button" accessibilityLabel="重新連線學校帳號"
          onPress={onReconnect} style={styles.action}>
          <Text style={styles.actionText}>重新連線學校帳號</Text>
        </Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="更新校方學分累計"
        accessibilityState={{ disabled: loading }} disabled={loading} onPress={() => void read()} style={styles.action}>
        <Text style={[styles.actionText, loading && styles.disabled]}>{loading ? '讀取中…' : '更新學分累計'}</Text>
      </Pressable>
      <Pressable accessibilityRole="link" accessibilityLabel="前往校方學分試算表"
        onPress={() => { setLinkError(false); void Linking.openURL(PU_CREDIT_REVIEW_URL).catch(() => setLinkError(true)); }} style={styles.action}>
        <Text style={styles.actionText}>前往校方試算表 ↗</Text>
      </Pressable>
    </View>
    {linkError && <Text style={styles.notice} accessibilityRole="alert">無法開啟連結，請從 e 校園的教務選單進入學分試算表。</Text>}
  </View>;
}

const createStyles = () => StyleSheet.create({
  card: { margin: aiTokens.space.md, padding: aiTokens.space.lg, borderWidth: 1, borderColor: aiTokens.border, borderRadius: aiTokens.radius.lg, backgroundColor: aiTokens.surface, gap: 10 },
  source: { fontSize: 12, lineHeight: 18, color: aiTokens.muted },
  title: { fontSize: 19, fontWeight: '600', lineHeight: 27, color: aiTokens.text },
  total: { fontSize: 32, fontWeight: '600', color: aiTokens.text, fontVariant: ['tabular-nums'] },
  note: { fontSize: 13, lineHeight: 21, color: aiTokens.muted },
  notice: { fontSize: 13, lineHeight: 21, color: aiTokens.text, paddingVertical: 6 },
  rows: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: aiTokens.border, paddingVertical: 12, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  rowName: { fontSize: 14, color: aiTokens.muted },
  rowValue: { fontSize: 14, fontWeight: '500', color: aiTokens.text, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  action: { minHeight: 44, justifyContent: 'center' },
  actionText: { fontSize: 14, fontWeight: '600', color: aiTokens.ai },
  disabled: { color: aiTokens.muted },
});
