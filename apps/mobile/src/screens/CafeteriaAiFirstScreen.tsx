import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Text, TextInput, View } from 'react-native';
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import {
  loadDiningCatalog,
  watchDiningReceipt,
  loadDiningIntent,
  prepareDiningIntent,
  submitDiningIntent,
  diningTotal,
  DiningError,
  ORDER_NOT_SENT_TEXT,
  type DiningScope,
  type DiningCatalog,
  type DiningIntent,
  type DiningMenu,
  type DiningReceipt,
} from '../features/dining';
import { describePickupNumber } from '@campus/shared/src/ordering/pickupNumber';

type Props = { navigation?: { goBack?: () => void } };
const statuses: Record<string, string> = {
  pending: '等待店家確認',
  confirmed: '店家已確認',
  preparing: '準備中',
  ready: '可以取餐',
  completed: '已完成',
  cancelled: '已取消',
};
export default function CafeteriaAiFirstScreen({ navigation }: Props) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { user } = useAuth();
  const { school } = useSchool();
  const scope = { userId: user?.uid ?? '', schoolId: school.id };
  const scopeKey = JSON.stringify(scope);
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  return (
    <DiningContent
      key={scopeKey}
      scope={scope}
      scopeKey={scopeKey}
      activeScope={activeScope}
      navigation={navigation}
    />
  );
}
function DiningContent({
  scope,
  scopeKey,
  activeScope,
  navigation,
}: Props & {
  scope: DiningScope;
  scopeKey: string;
  activeScope: React.MutableRefObject<string>;
}) {
  const [catalog, setCatalog] = useState<DiningCatalog | null>(null);
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<DiningMenu | null>(null);
  const [pending, setPending] = useState<DiningIntent | null>(null);
  const [receipt, setReceipt] = useState<DiningReceipt | null>(null);
  const [loading, setLoading] = useState(Boolean(scope.userId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const lock = useRef(false);
  const generation = useRef(0);
  const isCurrent = () => mounted.current && activeScope.current === scopeKey;
  const load = async () => {
    if (!scope.userId || !isCurrent() || lock.current) return;
    const request = ++generation.current;
    setLoading(true);
    setError('');
    setCatalog(null);
    try {
      const [next, saved] = await Promise.all([
        loadDiningCatalog(scope, isCurrent),
        loadDiningIntent(scope, isCurrent),
      ]);
      if (isCurrent() && request === generation.current) {
        setCatalog(next);
        setPending(saved);
      }
    } catch (reason) {
      if (isCurrent() && request === generation.current)
        setError(
          reason instanceof DiningError
            ? reason.message
            : '目前無法取得餐廳資料，請確認連線後重試。',
        );
    } finally {
      if (isCurrent() && request === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
    // This content remounts for every account and school change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const submit = async () => {
    if (!isCurrent() || lock.current || (!pending && !selected)) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const intent = pending ?? (await prepareDiningIntent(scope, selected!, isCurrent));
      if (!isCurrent()) return;
      setPending(intent);
      setSelected(null);
      const next = await submitDiningIntent(intent, isCurrent);
      if (isCurrent()) {
        setReceipt(next);
        setPending(null);
      }
    } catch (reason) {
      if (isCurrent()) {
        setError(
          reason instanceof DiningError ? reason.message : ORDER_NOT_SENT_TEXT,
        );
        if (reason instanceof DiningError && reason.kind === 'not-sent') {
          setPending(null);
          setSelected(null);
          setCatalog(null);
        }
      }
    } finally {
      if (isCurrent()) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  const visibleMenus = (catalog?.menus ?? []).filter(
    (menu) =>
      menu.name.includes(keyword.trim()) ||
      catalog?.venues.find((venue) => venue.id === menu.cafeteriaId)?.name.includes(keyword.trim()),
  );
  const venueName = (menu: DiningMenu) =>
    catalog?.venues.find((venue) => venue.id === menu.cafeteriaId)?.name ?? '未提供餐廳資料';
  // 號碼還沒拿到時盯著這筆訂單，店家按「給號碼」後換成真的號碼
  const receiptId = receipt?.id ?? null;
  const waitingForNumber = Boolean(receipt && receipt.queueNumber == null);
  useEffect(() => {
    if (!receiptId || !waitingForNumber || !scope.userId) return;
    const stop = watchDiningReceipt({ ...scope, orderId: receiptId }, (patch) => {
      if (!isCurrent()) return;
      setReceipt((current) =>
        current && current.id === receiptId
          ? { ...current, queueNumber: patch.queueNumber, status: patch.status ?? current.status }
          : current,
      );
    });
    return () => stop?.();
    // scope is fixed for this mounted content (remounts on account/school change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId, waitingForNumber]);
  const pickup = receipt ? describePickupNumber(receipt) : null;
  const quote = selected?.price != null ? diningTotal(selected.price) : null;
  return (
    <AIDetailScreen
      title="校園餐廳"
      subtitle="看看餐點，確認店家是否開放接單。"
      onBack={() => navigation?.goBack?.()}
    >
      {!scope.userId ? (
        <AICard title="登入後查看菜單">
          <Text style={{ color: aiTokens.muted }}>請先登入學校帳號，再查看餐廳與訂單。</Text>
        </AICard>
      ) : (
        <>
          {receipt ? (
            <AICard title={statuses[receipt.status] ?? '訂單紀錄'}>
              <Text style={{ color: aiTokens.text }}>
                {receipt.label} · 訂單金額 NT${receipt.total}
              </Text>
              {pickup?.state === 'assigned' ? (
                <Text
                  accessibilityLabel={pickup.text}
                  style={{ color: aiTokens.text, fontSize: 20, fontWeight: '700', marginTop: 8 }}
                >
                  {pickup.text}
                </Text>
              ) : pickup ? (
                <View style={{ marginTop: 8, gap: 4 }}>
                  <Text style={{ color: aiTokens.text, fontWeight: '700' }}>{pickup.text}</Text>
                  {pickup.detail ? (
                    <Text selectable style={{ color: aiTokens.text }}>
                      {pickup.detail}
                    </Text>
                  ) : null}
                  <Text style={{ color: aiTokens.muted }}>狀態：{pickup.label}</Text>
                </View>
              ) : null}
              <Text selectable style={{ color: aiTokens.muted, marginTop: 8 }}>
                訂單編號：{receipt.id}
              </Text>
            </AICard>
          ) : null}
          {pending ? (
            <AICard title={busy ? '訂單送出中' : '訂單沒送出去'}>
              <View style={{ gap: 12 }}>
                {busy ? null : (
                  <Text accessibilityRole="alert" style={{ color: aiTokens.text, fontWeight: '700' }}>
                    {error || ORDER_NOT_SENT_TEXT}
                  </Text>
                )}
                <Text style={{ color: aiTokens.text }}>
                  {pending.label} · 到店應付 NT${pending.expectedTotal}
                </Text>
                <Text style={{ color: aiTokens.muted }}>
                  再試一次會沿用同一個訂單編號，不會重複下單。
                </Text>
                <AIButton
                  label={busy ? '送出中' : '再試一次'}
                  disabled={busy}
                  onPress={() => void submit()}
                />
              </View>
            </AICard>
          ) : null}
          <AICard title="找餐點">
            <View style={{ gap: 12 }}>
              <TextInput
                accessibilityLabel="餐點或店名"
                value={keyword}
                maxLength={100}
                onChangeText={setKeyword}
                placeholder="搜尋餐點或店名"
                placeholderTextColor={aiTokens.muted}
                style={{
                  color: aiTokens.text,
                  borderColor: aiTokens.border,
                  borderWidth: 1,
                  borderRadius: 12,
                  padding: 12,
                  minHeight: 48,
                }}
              />
              <AIButton
                label={loading ? '讀取中' : '更新菜單'}
                variant="ghost"
                disabled={loading || busy}
                onPress={() => void load()}
              />
              <Text style={{ color: aiTokens.muted }}>
                目前僅提供已開通店家的到店付款。線上付款尚未開放。
              </Text>
              {loading ? (
                <ActivityIndicator accessibilityLabel="讀取餐廳" color={aiTokens.ai} />
              ) : null}
              {error && !pending ? (
                <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
                  {error}
                </Text>
              ) : null}
            </View>
          </AICard>
          {catalog ? (
            <>
              {visibleMenus.length === 0 ? (
                <AICard title="目前沒有符合的餐點">
                  <Text style={{ color: aiTokens.muted }}>試著換個關鍵字，或稍後更新菜單。</Text>
                </AICard>
              ) : (
                visibleMenus.map((menu) => (
                  <AICard key={menu.id} title={menu.name} source={venueName(menu)}>
                    <View style={{ gap: 10 }}>
                      <Text style={{ color: aiTokens.text }}>
                        {menu.price === null ? '價格未提供' : `NT$${menu.price}`}
                      </Text>
                      {menu.description ? (
                        <Text style={{ color: aiTokens.muted }}>{menu.description}</Text>
                      ) : null}
                      {menu.orderable ? (
                        <AIButton
                          label={`選擇${menu.name}`}
                          disabled={busy || Boolean(pending)}
                          onPress={() => {
                            if (isCurrent()) setSelected(menu);
                          }}
                        />
                      ) : (
                        <Text style={{ color: aiTokens.muted }}>
                          此餐點目前未開放線上訂購，請向店家確認。
                        </Text>
                      )}
                    </View>
                  </AICard>
                ))
              )}
              {catalog.venues.map((venue) => (
                <AICard key={venue.id} title={venue.name}>
                  <Text style={{ color: aiTokens.muted }}>
                    {venue.location || '位置資訊未提供'}
                  </Text>
                </AICard>
              ))}
            </>
          ) : null}
          <Modal
            visible={Boolean(selected)}
            transparent
            animationType="fade"
            onRequestClose={() => {
              if (!busy) setSelected(null);
            }}
          >
            <View
              style={{
                flex: 1,
                justifyContent: 'center',
                backgroundColor: 'rgba(0,0,0,0.35)',
                padding: 20,
              }}
            >
              <View
                accessibilityViewIsModal
                style={{
                  backgroundColor: aiTokens.surface,
                  borderRadius: 16,
                  padding: 24,
                  gap: 16,
                }}
              >
                <Text style={{ color: aiTokens.text, fontSize: 20, fontWeight: '600' }}>
                  確認餐點
                </Text>
                <Text style={{ color: aiTokens.text }}>{selected?.name} · 1 份</Text>
                <Text style={{ color: aiTokens.muted }}>{selected ? venueName(selected) : ''}</Text>
                <Text style={{ color: aiTokens.text }}>
                  餐點 NT${quote?.subtotal} + 稅額 NT${quote?.tax}
                </Text>
                <Text style={{ color: aiTokens.text, fontWeight: '600' }}>
                  到店付款合計 NT${quote?.total}
                </Text>
                {error ? (
                  <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
                    {error}
                  </Text>
                ) : null}
                <AIButton
                  label={busy ? '送出中' : '送出訂單，到店付款'}
                  disabled={busy}
                  onPress={() => void submit()}
                />
                <AIButton
                  label="返回菜單"
                  variant="ghost"
                  disabled={busy}
                  onPress={() => setSelected(null)}
                />
              </View>
            </View>
          </Modal>
        </>
      )}
    </AIDetailScreen>
  );
}
