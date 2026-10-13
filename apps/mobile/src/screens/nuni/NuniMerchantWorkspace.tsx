import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { NuniError } from '@campus/shared/src/nuni';
import { merchantWorkspaceStateLabel } from '@campus/shared/src/nuniMerchant';
import {
  createMerchantOperations,
  NUNI_MERCHANT_TERMS_VERSION,
  validateMerchantInitialMenuInput,
  validateMerchantSettingsInput,
  type NuniMerchantInitialMenuInput,
  type NuniMerchantSettingsInput,
  type NuniMerchantWorkspaceDetail,
} from '@campus/shared/src/nuniMerchantOperations';
import { useNuniSession } from '../../state/nuniSession';
import { useNuniDraftState } from '../../state/nuniDrafts';
import { useTheme } from '../../state/theme';

type MenuItem = {
  name: string;
  description: string;
  price: string;
  stock: string;
  allergens: string;
};
const emptyItem = (): MenuItem => ({
  name: '',
  description: '',
  price: '',
  stock: '',
  allergens: '',
});
const modes = [
  ['pickup', '自取'],
  ['dine-in', '內用'],
  ['delivery', '外送'],
] as const;
const expired = (error: unknown) =>
  error instanceof NuniError && (error.status === 401 || error.code === 'SESSION_CHANGED');
const denied = (error: unknown) => error instanceof NuniError && [403, 404].includes(error.status);
const rejected = (error: unknown) =>
  error instanceof NuniError && [400, 403, 404, 409, 422, 429].includes(error.status);
function settingsOf(value: NuniMerchantWorkspaceDetail): NuniMerchantSettingsInput {
  return {
    serviceModes: value.serviceModes,
    paymentMode: value.onlinePaymentAvailable ? value.paymentMode : 'counter-only',
    termsVersion: NUNI_MERCHANT_TERMS_VERSION,
    expectedVersion: value.readinessVersion,
  };
}

function Copy({
  children,
  title = false,
  alert = false,
}: {
  children: React.ReactNode;
  title?: boolean;
  alert?: boolean;
}) {
  const theme = useTheme();
  return (
    <Text
      accessibilityRole={alert ? 'alert' : title ? 'header' : undefined}
      style={{
        color: alert ? theme.colors.danger : theme.colors.text,
        fontSize: title ? 20 : 16,
        lineHeight: title ? 28 : 24,
        fontWeight: title ? '600' : '400',
      }}
    >
      {children}
    </Text>
  );
}
function Action({
  children,
  onPress,
  disabled = false,
  selected,
}: {
  children: string;
  onPress(): void;
  disabled?: boolean;
  selected?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, ...(selected === undefined ? {} : { selected }) }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 48,
        padding: 12,
        borderWidth: 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        borderRadius: 10,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: theme.colors.text, fontSize: 16 }}>{children}</Text>
    </Pressable>
  );
}
function Check({
  children,
  checked,
  disabled,
  onPress,
}: {
  children: string;
  checked: boolean;
  disabled: boolean;
  onPress(): void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={children}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 48, paddingVertical: 12 }}
    >
      <Text style={{ color: theme.colors.text, fontSize: 16, lineHeight: 24 }}>
        {checked ? '☑' : '□'} {children}
      </Text>
    </Pressable>
  );
}

/** Mounted only under the verified account; each location gets a separate component and draft key. */
export function NuniMerchantWorkspace({
  tenantId,
  locationId,
  context,
  onBack,
}: {
  tenantId: string;
  locationId: string;
  context: string;
  onBack(): void;
}) {
  const theme = useTheme();
  const { request, refresh, session } = useNuniSession();
  const operations = useMemo(
    () => createMerchantOperations((path, input, method) => request(path, context, input, method)),
    [request, context],
  );
  const key = `merchant-operations:${session?.platformAccountId}:${tenantId}:${locationId}`;
  const [settingsDraft, setSettingsDraft] = useNuniDraftState<NuniMerchantSettingsInput | null>(
    `${key}:settings`,
    null,
  );
  const [menu, setMenu] = useNuniDraftState<MenuItem[]>(`${key}:menu`, () => [emptyItem()]);
  // Persist write intent before sending. Returning to this screen never silently repeats a non-idempotent write.
  const [menuAttempted, setMenuAttempted] = useNuniDraftState<boolean>(
    `${key}:menu-attempted`,
    false,
  );
  const [reconcile, setReconcile] = useNuniDraftState<boolean>(`${key}:reconcile`, false);
  const [workspace, setWorkspace] = useState<NuniMerchantWorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [agree, setAgree] = useState(false);
  const [confirmMenu, setConfirmMenu] = useState(false);
  const [menuReview, setMenuReview] = useState<NuniMerchantInitialMenuInput | null>(null);
  const [activationReview, setActivationReview] = useState(false);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const lock = useRef(false);
  const invalidate = useCallback(() => ++epoch.current, []);
  const current = (run: number) => mounted.current && run === epoch.current;
  const revoke = useCallback(
    (error: unknown) => {
      setWorkspace(null);
      setBlocked(true);
      setMessage(
        expired(error)
          ? '帳號狀態已變更，請重新確認帳號。'
          : '目前沒有這間門市的管理權限，請向場域管理者確認。',
      );
      if (expired(error)) void refresh();
    },
    [refresh],
  );
  const load = useCallback(async () => {
    if (lock.current) return;
    const run = invalidate();
    lock.current = true;
    setLoading(true);
    setLoadError('');
    setMenuReview(null);
    setActivationReview(false);
    setAgree(false);
    try {
      const value = await operations.get(tenantId, locationId);
      if (!current(run)) return;
      setWorkspace(value);
      setBlocked(false);
      setReconcile(false);
    } catch (error) {
      if (!current(run)) return;
      if (expired(error) || denied(error)) revoke(error);
      else setLoadError('目前無法核對門市狀態。草稿已保留，請重新載入。');
    } finally {
      if (current(run)) {
        lock.current = false;
        setLoading(false);
      }
    }
  }, [operations, tenantId, locationId, revoke, setReconcile, invalidate]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      lock.current = false;
      invalidate();
    };
  }, [load, invalidate]);

  const unavailable = loading || busy || blocked || !!loadError || reconcile || !workspace;
  const setting = settingsDraft ?? (workspace ? settingsOf(workspace) : null);
  const settingsConflict =
    !!settingsDraft && !!workspace && settingsDraft.expectedVersion !== workspace.readinessVersion;
  const changeSettings = (value: Partial<NuniMerchantSettingsInput>) => {
    if (!setting || unavailable) return;
    setSettingsDraft({ ...setting, ...value });
    setAgree(false);
    setActivationReview(false);
    setMessage('');
  };

  async function mutate(
    kind: 'settings' | 'menu' | 'activate' | 'availability',
    action: () => Promise<NuniMerchantWorkspaceDetail | unknown>,
  ) {
    if (unavailable || lock.current) return;
    lock.current = true;
    const run = invalidate();
    setBusy(true);
    setMessage('');
    setReconcile(true);
    if (kind === 'menu') setMenuAttempted(true);
    let menuReceived = false;
    try {
      const result = await action();
      if (!current(run)) return;
      if (kind === 'menu') {
        menuReceived = true;
        setMenuReview(null);
        setConfirmMenu(false);
        setMessage('已收到菜單建立回執，正在核對門市狀態。');
        // A receipt confirms creation, but only a fresh workspace can authorize activation.
        const latest = await operations.get(tenantId, locationId);
        if (!current(run)) return;
        setWorkspace(latest);
        setReconcile(false);
        setMessage('初始菜單已建立。請確認營運條件後再啟用門市。');
      } else {
        setWorkspace(result as NuniMerchantWorkspaceDetail);
        setReconcile(false);
        if (kind === 'settings') {
          setSettingsDraft(null);
          setAgree(false);
        }
        setActivationReview(false);
        setMessage(
          kind === 'settings'
            ? '營運設定已儲存。'
            : kind === 'activate'
              ? '門市已啟用，接單狀態以目前門市資料為準。'
              : '接單狀態已更新。',
        );
      }
    } catch (error) {
      if (!current(run)) return;
      if (expired(error) || denied(error)) {
        revoke(error);
        return;
      }
      if (
        kind === 'menu' &&
        !menuReceived &&
        rejected(error) &&
        !(error instanceof NuniError && error.code === 'FOOD_MERCHANT_INITIAL_MENU_EXISTS')
      ) {
        setMenuAttempted(false);
      }
      setMenuReview(null);
      setActivationReview(false);
      setAgree(false);
      setMessage(
        menuReceived
          ? '菜單建立回執已收到，但目前無法核對門市狀態。請重新載入，不要重複建立。'
          : rejected(error)
            ? '操作未被接受，草稿已保留。請重新載入最新門市狀態，再確認下一步。'
            : '尚未確認這次操作的結果，草稿已保留。請先重新載入核對，不要重複送出。',
      );
    } finally {
      if (current(run)) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  const reviewMenu = () => {
    if (unavailable || menuAttempted) return;
    try {
      const items = menu.map((item) => {
        if (!/^\d+$/.test(item.price.trim()) || !/^\d+$/.test(item.stock.trim()))
          throw new Error('integer');
        return {
          name: item.name,
          description: item.description,
          priceMinor: Number(item.price),
          initialStock: Number(item.stock),
          allergens: item.allergens
            .split(/[,，、\n]/)
            .map((value) => value.trim())
            .filter(Boolean),
        };
      });
      setMenuReview(validateMerchantInitialMenuInput({ items }));
      setConfirmMenu(false);
      setMessage('');
    } catch {
      setMessage(
        '請填寫每項名稱、整數售價（1–10,000,000 元）與初始庫存（1–100,000 份）；過敏原最多 30 種，每種 80 字。',
      );
    }
  };
  const saveSettings = () => {
    if (!setting || !workspace || unavailable || settingsConflict) return;
    if (!agree) {
      setMessage('請先確認營運資訊與店家營運條款。');
      return;
    }
    try {
      const input = validateMerchantSettingsInput(setting);
      setSettingsDraft(input);
      void mutate('settings', () => operations.updateSettings(tenantId, locationId, input));
    } catch {
      setMessage('請至少選擇一種服務方式，並確認收款方式。');
    }
  };
  const menuLocked = unavailable || menuAttempted || !!menuReview;
  const field = (
    index: number,
    name: keyof MenuItem,
    label: string,
    max: number,
    numeric = false,
  ) => (
    <View key={name} style={{ gap: 4 }}>
      <Copy>{label}</Copy>
      <TextInput
        accessibilityLabel={`品項 ${index + 1} ${label}`}
        value={menu[index][name]}
        editable={!menuLocked}
        maxLength={max}
        keyboardType={numeric ? 'number-pad' : 'default'}
        multiline={name === 'description'}
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 8,
          padding: 12,
          minHeight: 48,
          color: theme.colors.text,
          fontSize: 16,
        }}
        onChangeText={(value) =>
          setMenu((previous) =>
            previous.map((item, at) => (at === index ? { ...item, [name]: value } : item)),
          )
        }
      />
    </View>
  );
  const section = { borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 20, gap: 12 };
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 16 }}
    >
      <Action onPress={onBack}>返回我的門市</Action>
      <Copy title>門市開店準備</Copy>
      {message ? <Copy alert>{message}</Copy> : null}
      {loading ? <Copy>正在核對門市狀態…</Copy> : null}
      {loadError ? <Copy alert>{loadError}</Copy> : null}
      {!blocked ? (
        <Action disabled={loading || busy} onPress={() => void load()}>
          重新載入門市狀態
        </Action>
      ) : (
        <Action onPress={onBack}>返回並重新確認權限</Action>
      )}
      {workspace && !blocked && !loading && !loadError ? (
        <>
          <Copy title>{workspace.locationName}</Copy>
          <Copy>
            {workspace.tenantName} · {workspace.campusName}
          </Copy>
          <Copy>{merchantWorkspaceStateLabel(workspace)}</Copy>
          <Copy>{`營運設定：${workspace.managerConfirmed ? '已確認' : '待確認'}\n有庫存的上架品項：${workspace.publishedMenuItems} 項`}</Copy>
          {reconcile ? <Copy alert>畫面尚未核對這次操作後的狀態，請先重新載入。</Copy> : null}
          {!workspace.activated && setting ? (
            <View style={section}>
              <Copy title>1. 確認營運設定</Copy>
              {settingsConflict ? (
                <>
                  <Copy alert>
                    門市設定已由其他操作更新。草稿尚未覆蓋最新設定，請選擇保留或重新填寫。
                  </Copy>
                  <Action
                    disabled={unavailable}
                    onPress={() => {
                      setSettingsDraft({ ...setting, expectedVersion: workspace.readinessVersion });
                      setAgree(false);
                    }}
                  >
                    保留草稿，套用最新版本
                  </Action>
                  <Action
                    disabled={unavailable}
                    onPress={() => {
                      setSettingsDraft(null);
                      setAgree(false);
                    }}
                  >
                    改用最新設定
                  </Action>
                </>
              ) : null}
              <Copy>服務方式</Copy>
              <View style={{ gap: 8, flexDirection: 'row', flexWrap: 'wrap' }}>
                {modes.map(([mode, label]) => (
                  <Action
                    key={mode}
                    selected={setting.serviceModes.includes(mode)}
                    disabled={unavailable || settingsConflict}
                    onPress={() =>
                      changeSettings({
                        serviceModes: setting.serviceModes.includes(mode)
                          ? setting.serviceModes.filter((value) => value !== mode)
                          : [...setting.serviceModes, mode],
                      })
                    }
                  >
                    {label}
                  </Action>
                ))}
              </View>
              <Copy>收款方式</Copy>
              <Action
                disabled={unavailable || settingsConflict}
                selected={setting.paymentMode === 'counter-only'}
                onPress={() => changeSettings({ paymentMode: 'counter-only' })}
              >
                現場櫃檯付款
              </Action>
              {workspace.onlinePaymentAvailable ? (
                <Action
                  disabled={unavailable || settingsConflict}
                  selected={setting.paymentMode === 'online-and-counter'}
                  onPress={() => changeSettings({ paymentMode: 'online-and-counter' })}
                >
                  線上付款與櫃檯付款（需審核）
                </Action>
              ) : (
                <Copy>目前只開放現場櫃檯付款。</Copy>
              )}
              {setting.paymentMode === 'online-and-counter' &&
              workspace.paymentCapabilityState !== 'active' ? (
                <Copy>線上收款資格尚未通過，請等待審核或改用櫃檯付款。</Copy>
              ) : null}
              <Check
                checked={agree}
                disabled={unavailable || settingsConflict}
                onPress={() => setAgree(!agree)}
              >
                我確認營運資訊正確並同意現行店家營運條款
              </Check>
              <Action disabled={unavailable || settingsConflict} onPress={saveSettings}>
                儲存營運設定
              </Action>
            </View>
          ) : null}
          {workspace.activated &&
          !workspace.onlinePaymentAvailable &&
          workspace.paymentMode === 'online-and-counter' ? (
            <View style={section}>
              <Copy>線上付款目前未開放，請改為現場櫃檯付款。</Copy>
              <Action
                disabled={unavailable || workspace.termsVersion !== NUNI_MERCHANT_TERMS_VERSION}
                onPress={() =>
                  void mutate('settings', () =>
                    operations.updateSettings(tenantId, locationId, {
                      ...settingsOf(workspace),
                      serviceModes: workspace.serviceModes,
                      paymentMode: 'counter-only',
                    }),
                  )
                }
              >
                改為只收櫃檯付款
              </Action>
            </View>
          ) : null}
          {!workspace.activated && workspace.publishedMenuItems === 0 ? (
            <View style={section}>
              <Copy title>2. 建立初始菜單</Copy>
              <Copy>
                初始菜單只能建立一次，之後不能在這裡修改。售價以新台幣整數元輸入，每項至少準備 1
                份庫存。
              </Copy>
              {menuAttempted ? (
                <Copy alert>
                  這間門市已有菜單送出紀錄。零個可售品項不代表未收件，請向場域管理者確認菜單或庫存；這裡不會重複送出。
                </Copy>
              ) : null}
              {menu.map((_, index) => (
                <View key={index} style={{ gap: 10 }}>
                  <Copy title>{`品項 ${index + 1}`}</Copy>
                  {field(index, 'name', '名稱', 200)}
                  {field(index, 'description', '說明（選填）', 1000)}
                  {field(index, 'price', '售價（元）', 8, true)}
                  {field(index, 'stock', '初始庫存（份）', 6, true)}
                  {field(index, 'allergens', '過敏原（逗號分隔，可留白）', 2500)}
                  {menu.length > 1 ? (
                    <Action
                      disabled={menuLocked}
                      onPress={() =>
                        setMenu((previous) => previous.filter((_, at) => at !== index))
                      }
                    >{`移除品項 ${index + 1}`}</Action>
                  ) : null}
                </View>
              ))}
              <Action
                disabled={menuLocked || menu.length >= 100}
                onPress={() => setMenu((previous) => [...previous, emptyItem()])}
              >
                新增品項
              </Action>
              {!menuReview ? (
                <Action disabled={menuLocked} onPress={reviewMenu}>
                  檢查初始菜單
                </Action>
              ) : (
                <View style={{ gap: 12 }}>
                  <Copy title>送出前再確認</Copy>
                  {menuReview.items.map((item, index) => (
                    <Copy
                      key={index}
                    >{`${item.name} · NT$${item.priceMinor} · ${item.initialStock} 份\n${item.description || '未填說明'}\n過敏原：${item.allergens?.join('、') || '未填寫'}`}</Copy>
                  ))}
                  <Check
                    checked={confirmMenu}
                    disabled={unavailable}
                    onPress={() => setConfirmMenu(!confirmMenu)}
                  >
                    我已確認品項、售價與庫存，了解初始菜單只能建立一次
                  </Check>
                  <Action
                    disabled={unavailable || !confirmMenu || menuAttempted}
                    onPress={() =>
                      void mutate('menu', () =>
                        operations.createInitialMenu(tenantId, locationId, menuReview),
                      )
                    }
                  >
                    確認建立初始菜單
                  </Action>
                  <Action
                    disabled={unavailable}
                    onPress={() => {
                      setMenuReview(null);
                      setConfirmMenu(false);
                    }}
                  >
                    返回修改菜單
                  </Action>
                </View>
              )}
            </View>
          ) : null}
          {!workspace.activated ? (
            <View style={section}>
              <Copy title>3. 啟用門市</Copy>
              <Copy>啟用後門市會公開並開始接單，請先確認現場已準備好。</Copy>
              <Copy>{`已儲存服務：${workspace.serviceModes.map((mode) => modes.find(([value]) => value === mode)?.[1] ?? mode).join('、')}\n已儲存收款：${workspace.paymentMode === 'counter-only' ? '現場櫃檯付款' : '線上付款與櫃檯付款'}`}</Copy>
              {settingsDraft ? (
                <>
                  <Copy alert>營運設定還有未儲存的草稿，請先儲存或改用最新設定，再啟用門市。</Copy>
                  {!settingsConflict ? (
                    <Action
                      disabled={unavailable}
                      onPress={() => {
                        setSettingsDraft(null);
                        setAgree(false);
                        setActivationReview(false);
                      }}
                    >
                      捨棄設定草稿，改用最新設定
                    </Action>
                  ) : null}
                </>
              ) : null}
              {workspace.missingRequirements.length ? (
                <Copy>請先完成營運設定、有庫存的菜單與收款資格。</Copy>
              ) : null}
              {!activationReview ? (
                <Action
                  disabled={
                    unavailable || !!settingsDraft || workspace.missingRequirements.length > 0
                  }
                  onPress={() => setActivationReview(true)}
                >
                  檢查並啟用門市
                </Action>
              ) : (
                <>
                  <Copy>現在要公開這間門市並開始接單嗎？</Copy>
                  <Action
                    disabled={unavailable || !!settingsDraft}
                    onPress={() =>
                      void mutate('activate', () => operations.activate(tenantId, locationId))
                    }
                  >
                    確認啟用並開始接單
                  </Action>
                  <Action disabled={unavailable} onPress={() => setActivationReview(false)}>
                    稍後啟用
                  </Action>
                </>
              )}
            </View>
          ) : workspace.merchantStatus === 'active' &&
            ['open', 'closed'].includes(workspace.locationStatus) ? (
            <View style={section}>
              <Copy title>接單狀態</Copy>
              <Copy>暫停接單不會取消既有訂單，仍需完成已接受的訂單。</Copy>
              <Action
                disabled={unavailable}
                onPress={() =>
                  void mutate('availability', () =>
                    operations.setAvailability(
                      tenantId,
                      locationId,
                      workspace.locationStatus !== 'open',
                    ),
                  )
                }
              >
                {workspace.locationStatus === 'open' ? '暫停接單' : '恢復接單'}
              </Action>
            </View>
          ) : (
            <Copy>門市目前由場域管理者停權，請聯絡管理者確認。</Copy>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
