import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Screen, Button } from '../ui/components';
import { theme } from '../ui/theme';
import { MerchantHubScreen } from './MerchantHubScreen';
import { useAuth } from '../state/auth';
import { isDemoUid } from '../services/demoSession';
import { useMerchantOrders } from '../hooks/useMerchantOrders';
import { countOrdersByView, merchantTabLabel } from '../features/merchantOrderViews';
import {
  createShopPost,
  deleteShopMenuItem,
  loadShopMenu,
  loadShopStorefront,
  saveShopMenuItem,
  saveShopStorefront,
  type ShopMenuItem,
  type ShopStorefront,
} from '../services/shopCatalog';
import { parseMenuCsv, storefrontUrlIssue } from '@campus/shared/src/merchantMode';

const TABS = [
  { key: 'pending', label: '待接單' },
  { key: 'kitchen', label: '出餐' },
  { key: 'menu', label: '菜單' },
  { key: 'hours', label: '營業' },
] as const;

function savedCopy(stored: 'cloud' | 'local', message: string) {
  return stored === 'cloud' ? message : `已記在本站。${message}`;
}

export default function ShopDockScreen() {
  const auth = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('pending');
  const assignments = (auth.profile?.merchantAssignments ?? []).filter((item) => item.status === 'active');
  const shop = assignments[0] ?? null;
  const [hubCafeteriaId, setHubCafeteriaId] = useState<string | null>(null);
  const countShop = assignments.find((item) => item.cafeteriaId === hubCafeteriaId) ?? shop;
  // 分頁標題的數字也是即時監聽同一家店，在菜單／營業分頁時新單進來也看得到
  const live = useMerchantOrders({ assignment: countShop, isDemo: isDemoUid(auth.user?.uid) });
  const counts = live.loading || live.error ? null : countOrdersByView(live.orders);
  const tabLabel = (key: (typeof TABS)[number]['key'], label: string) =>
    key === 'pending' || key === 'kitchen' ? merchantTabLabel(key, counts ? counts[key] : null) : label;

  return (
    <Screen title="店家工作台" subtitle="菜單、店面主頁與營業時間寫進本店資料。金流還沒接到，這裡不會收款。">
      <View style={{ flexDirection: 'row', paddingHorizontal: 12, gap: 8 }}>
        {TABS.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => setTab(item.key)}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderBottomWidth: 2,
              borderBottomColor: tab === item.key ? theme.colors.accent : 'transparent',
            }}
          >
            <Text style={{ color: tab === item.key ? theme.colors.text : theme.colors.muted, fontWeight: '700' }}>
              {tabLabel(item.key, item.label)}
            </Text>
          </Pressable>
        ))}
      </View>
      {assignments.length === 0 ? (
        <View style={{ padding: 16 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: 8 }}>這間店還沒接到訂單系統</Text>
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
            這間店還沒接上訂單系統，所以沒有待接單。菜單與營業時間也還沒開放給這支帳號改。
          </Text>
        </View>
      ) : tab === 'pending' || tab === 'kitchen' ? (
        // 待接單只列還沒接的，出餐只列接了還沒取的；兩邊都是即時監聽，同一張單只會在一邊
        <MerchantHubScreen view={tab} onAssignmentChange={setHubCafeteriaId} />
      ) : tab === 'menu' && shop ? (
        <ShopMenuPanel
          schoolId={shop.schoolId}
          cafeteriaId={shop.cafeteriaId}
          cafeteriaName={shop.cafeteriaName}
        />
      ) : shop ? (
        <ShopHoursPanel schoolId={shop.schoolId} cafeteriaId={shop.cafeteriaId} />
      ) : null}
    </Screen>
  );
}

function ShopMenuPanel({
  schoolId,
  cafeteriaId,
  cafeteriaName,
}: {
  schoolId: string;
  cafeteriaId: string;
  cafeteriaName: string;
}) {
  const [items, setItems] = useState<ShopMenuItem[]>([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [csv, setCsv] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setItems(await loadShopMenu(schoolId, cafeteriaId));
  }, [schoolId, cafeteriaId]);

  useEffect(() => {
    void refresh().catch(() => setNotice('現在讀不到菜單。'));
  }, [refresh]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 80 }}>
      {notice ? <Text style={{ color: theme.colors.text }}>{notice}</Text> : null}
      {items.length === 0 ? (
        <Text style={{ color: theme.colors.muted }}>這間店還沒有菜單品項。</Text>
      ) : (
        items.map((item) => (
          <View key={item.id} style={{ gap: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.separator, paddingBottom: 8 }}>
            <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
              {item.name} {item.price != null ? `$${item.price}` : ''} {item.soldOut ? '（售完）' : ''}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                text={item.soldOut ? '改回供應' : '標售完'}
                onPress={() =>
                  void saveShopMenuItem({
                    schoolId,
                    cafeteriaId,
                    cafeteriaName,
                    item: { ...item, soldOut: !item.soldOut },
                  })
                    .then((result) => {
                      setNotice(savedCopy(result.stored, '菜單已更新。'));
                      return refresh();
                    })
                    .catch(() => setNotice('這次沒寫成。請確認這支帳號是本店人員。'))
                }
              />
              <Button
                text="刪除"
                onPress={() =>
                  void deleteShopMenuItem({ schoolId, cafeteriaId, id: item.id })
                    .then((result) => {
                      setNotice(savedCopy(result.stored, '已從菜單拿掉。'));
                      return refresh();
                    })
                    .catch(() => setNotice('這次沒刪成。'))
                }
              />
            </View>
          </View>
        ))
      )}
      <TextInput
        placeholder="CSV（品名,價格,分類）"
        value={csv}
        onChangeText={setCsv}
        multiline
        style={[field, { minHeight: 72 }]}
      />
      <Button
        text="從 CSV 匯入"
        onPress={() => {
          const rows = parseMenuCsv(csv);
          if (!rows.length) {
            setNotice('CSV 沒有可用的品名。格式例如：品名,價格,分類');
            return;
          }
          void Promise.all(
            rows.map((row, index) =>
              saveShopMenuItem({
                schoolId,
                cafeteriaId,
                cafeteriaName,
                item: {
                  id: `menu_${Date.now().toString(36)}_${index}`,
                  name: row.name,
                  price: row.price,
                  soldOut: false,
                },
              }),
            ),
          )
            .then((results) => {
              setCsv('');
              setNotice(savedCopy(results.some((item) => item.stored === 'local') ? 'local' : 'cloud', '菜單已從 CSV 更新。'));
              return refresh();
            })
            .catch(() => setNotice('這次沒寫成。請確認這支帳號是本店人員。'));
        }}
      />
      <TextInput placeholder="品名" value={name} onChangeText={setName} style={field} />
      <TextInput
        placeholder="價格（可留空）"
        value={price}
        onChangeText={setPrice}
        keyboardType="number-pad"
        style={field}
      />
      <Button
        text="新增品項"
        onPress={() => {
          if (name.trim().length < 1) {
            setNotice('請填品名。沒填不會寫入。');
            return;
          }
          const item: ShopMenuItem = {
            id: `menu_${Date.now().toString(36)}`,
            name: name.trim(),
            price: price.trim() ? Number(price) : null,
            soldOut: false,
          };
          void saveShopMenuItem({ schoolId, cafeteriaId, cafeteriaName, item })
            .then((result) => {
              setName('');
              setPrice('');
              setNotice(savedCopy(result.stored, '菜單已更新。'));
              return refresh();
            })
            .catch(() => setNotice('這次沒寫成。請確認這支帳號是本店人員。'));
        }}
      />
    </ScrollView>
  );
}

function ShopHoursPanel({ schoolId, cafeteriaId }: { schoolId: string; cafeteriaId: string }) {
  const [storefront, setStorefront] = useState<ShopStorefront>({
    openingHours: '',
    intro: '',
    location: '',
    websiteUrl: '',
    orderingUrl: '',
    merchantMode: 'info_only',
  });
  const [postTitle, setPostTitle] = useState('');
  const [postText, setPostText] = useState('');
  const [notice, setNotice] = useState('');
  const [websiteError, setWebsiteError] = useState('');
  const [orderingError, setOrderingError] = useState('');

  useEffect(() => {
    void loadShopStorefront(schoolId, cafeteriaId)
      .then(setStorefront)
      .catch(() => setNotice('現在讀不到店面資料。'));
  }, [schoolId, cafeteriaId]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 80 }}>
      {notice ? <Text style={{ color: theme.colors.text }}>{notice}</Text> : null}
      <Text style={{ color: theme.colors.muted }}>
        學生在店面頁看到封面介紹、營業時間與貼文。沒有接上我們點餐系統的店，可以只放外連訂餐網址。貼網址時前後空白會自動去掉，不會當成錯誤。金流還沒接到，這裡不會收款。
      </Text>
      <View>
        <Text style={{ color: theme.colors.text, fontWeight: '600', marginBottom: 8 }}>營業時間</Text>
        <Text style={{ color: theme.colors.muted, marginBottom: 8 }}>例如「週一至週五 11:00–19:00」。</Text>
        <TextInput
          value={storefront.openingHours}
          onChangeText={(openingHours) => setStorefront((current) => ({ ...current, openingHours }))}
          multiline
          style={[field, { minHeight: 64 }]}
        />
      </View>
      <View>
        <Text style={{ color: theme.colors.text, fontWeight: '600', marginBottom: 8 }}>地點</Text>
        <TextInput
          placeholder="店家位置"
          value={storefront.location}
          onChangeText={(location) => setStorefront((current) => ({ ...current, location }))}
          style={field}
        />
      </View>
      <View>
        <Text style={{ color: theme.colors.text, fontWeight: '600', marginBottom: 8 }}>店面介紹</Text>
        <TextInput
          placeholder="店面介紹"
          value={storefront.intro}
          onChangeText={(intro) => setStorefront((current) => ({ ...current, intro }))}
          multiline
          style={[field, { minHeight: 80 }]}
        />
      </View>
      <View testID="website-field">
        <Text style={{ color: theme.colors.text, fontWeight: '600', marginBottom: 8 }}>店家網站</Text>
        <TextInput
          placeholder="店家網站（https）"
          value={storefront.websiteUrl}
          onChangeText={(websiteUrl) => setStorefront((current) => ({ ...current, websiteUrl }))}
          autoCapitalize="none"
          style={field}
        />
        {websiteError ? <Text style={{ color: theme.colors.danger, marginTop: 8 }}>{websiteError}</Text> : null}
      </View>
      <View testID="ordering-field">
        <Text style={{ color: theme.colors.text, fontWeight: '600', marginBottom: 8 }}>外連訂餐網址</Text>
        <TextInput
          placeholder="外連訂餐網址（https，選填）"
          value={storefront.orderingUrl}
          onChangeText={(orderingUrl) => setStorefront((current) => ({ ...current, orderingUrl }))}
          autoCapitalize="none"
          style={field}
        />
        {orderingError ? <Text style={{ color: theme.colors.danger, marginTop: 8 }}>{orderingError}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          text={storefront.merchantMode === 'showcase_link' ? '已設為外連訂餐' : '改成外連訂餐'}
          onPress={() =>
            setStorefront((current) => ({
              ...current,
              merchantMode: current.merchantMode === 'showcase_link' ? 'info_only' : 'showcase_link',
            }))
          }
        />
      </View>
      <Button
        text="儲存店面"
        onPress={() => {
          const websiteIssue = storefrontUrlIssue(storefront.websiteUrl);
          const orderingIssue = storefrontUrlIssue(storefront.orderingUrl);
          setWebsiteError(websiteIssue || '');
          setOrderingError(orderingIssue || '');
          if (websiteIssue || orderingIssue) {
            return;
          }
          void saveShopStorefront({ schoolId, cafeteriaId, storefront })
            .then((result) => {
              setWebsiteError('');
              setOrderingError('');
              setNotice(savedCopy(result.stored, '店面資料已更新。'));
            })
            .catch((error) =>
              setNotice(
                error instanceof Error && error.message
                  ? error.message
                  : '這次沒寫成。請確認這支帳號是本店人員。',
              ),
            );
        }}
      />
      <Text style={{ color: theme.colors.text, fontWeight: '700', marginTop: 8 }}>發一則店家貼文</Text>
      <TextInput placeholder="標題（可留空）" value={postTitle} onChangeText={setPostTitle} style={field} />
      <TextInput
        placeholder="貼文內容"
        value={postText}
        onChangeText={setPostText}
        multiline
        style={[field, { minHeight: 80 }]}
      />
      <Button
        text="發布貼文"
        onPress={() => {
          if (!postText.trim()) {
            setNotice('請填貼文內容。沒填不會寫入。');
            return;
          }
          void createShopPost({
            schoolId,
            cafeteriaId,
            title: postTitle,
            text: postText,
            kind: 'post',
          })
            .then((result) => {
              setPostTitle('');
              setPostText('');
              setNotice(savedCopy(result.stored, '貼文已發布。追蹤這間店的學生會收到通知。'));
            })
            .catch(() => setNotice('這次沒發成功。請確認這支帳號是本店人員。'));
        }}
      />
    </ScrollView>
  );
}

const field = {
  borderWidth: 1,
  borderColor: theme.colors.separator,
  borderRadius: 10,
  padding: 12,
  color: theme.colors.text,
};
