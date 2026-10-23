import React from 'react';
import { Linking, Text, View } from 'react-native';
import { Screen, Button } from '../ui/components';
import { theme } from '../ui/theme';
import {
  EXTERNAL_ORDER_HONEST_TEXT,
  SHOWCASE_ORDER_BUTTON_TEXT,
  SHOWCASE_ORDER_CAPTION,
  buildShowcaseOrderingUrl,
  isHttpsOrderingUrl,
} from '@campus/shared/src/merchantMode';
import { useSchool } from '../state/school';

type Props = {
  navigation?: { goBack?: () => void };
  route?: { params?: { cafeteriaId?: string; orderingUrl?: string } };
};

export default function HonestOrderScreen({ navigation, route }: Props) {
  const { school } = useSchool();
  const cafeteriaId = route?.params?.cafeteriaId || '';
  const orderingUrl = route?.params?.orderingUrl || '';
  const tagged = isHttpsOrderingUrl(orderingUrl)
    ? buildShowcaseOrderingUrl(orderingUrl, school.id, cafeteriaId || 'shop')
    : '';
  return (
    <Screen title={SHOWCASE_ORDER_BUTTON_TEXT} subtitle="訂單在店家系統，不走我們的結帳。">
      <View style={{ padding: 16, gap: 12 }}>
        <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>{EXTERNAL_ORDER_HONEST_TEXT}</Text>
        {tagged ? (
          <>
            <Button text={SHOWCASE_ORDER_BUTTON_TEXT} onPress={() => void Linking.openURL(tagged)} />
            <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>{SHOWCASE_ORDER_CAPTION}</Text>
          </>
        ) : (
          <Text style={{ color: theme.colors.text }}>這間店還沒有可打開的訂餐連結。</Text>
        )}
        <Button text="返回" onPress={() => navigation?.goBack?.()} />
      </View>
    </Screen>
  );
}
