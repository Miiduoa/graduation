import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Screen } from '../ui/components';
import { theme } from '../ui/theme';
import { MerchantHubScreen } from './MerchantHubScreen';
import { useAuth } from '../state/auth';

const TABS = [
  { key: 'pending', label: '待接單' },
  { key: 'kitchen', label: '出餐' },
  { key: 'menu', label: '菜單' },
  { key: 'hours', label: '營業' },
] as const;

export default function ShopDockScreen() {
  const auth = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('pending');
  const assignments = (auth.profile?.merchantAssignments ?? []).filter((item) => item.status === 'active');

  return (
    <Screen title="店家工作台" subtitle="這四頁只處理本店訂單與菜單">
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
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {assignments.length === 0 ? (
        <View style={{ padding: 16 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: 8 }}>這間店還沒接到訂單系統</Text>
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
            沒有商家綁定時，這裡不會假裝有待接單。菜單與營業時間也還沒開放給這支帳號改。
          </Text>
        </View>
      ) : tab === 'pending' || tab === 'kitchen' ? (
        <MerchantHubScreen />
      ) : (
        <View style={{ padding: 16 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
            {tab === 'menu' ? '菜單' : '營業'}
          </Text>
          <Text style={{ color: theme.colors.muted, marginTop: 8, lineHeight: 22 }}>
            這邊還沒接到可寫入的菜單或營業時間。成功寫入時只會顯示「已記在本站」，在那之前不會說已經改好。
          </Text>
        </View>
      )}
    </Screen>
  );
}
