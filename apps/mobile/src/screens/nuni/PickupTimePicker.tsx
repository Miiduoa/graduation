import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import type { NuniFoodLocationSummary } from '@campus/shared/src/nuniFoodTypes';
import { FoodButton, FoodField, FoodText } from './NuniFoodUi';
import { formatPickupTime, pickupTimeFromMinutes, pickupTimeGuidance } from './foodPickupTime';

export function PickupTimePicker({
  value,
  onChange,
  now,
  location,
  disabled = false,
  pendingPickupAt,
}: {
  value: string;
  onChange(value: string): void;
  now: number;
  location: NuniFoodLocationSummary;
  disabled?: boolean;
  pendingPickupAt?: string;
}) {
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale >= 1.5;
  const requestedPickupAt = pendingPickupAt ?? pickupTimeFromMinutes(value, now);
  const preview = requestedPickupAt ? formatPickupTime(requestedPickupAt) : null;
  const guidance = pickupTimeGuidance(location, requestedPickupAt);
  return (
    <View style={{ gap: 12 }}>
      <FoodText title>預計幾點取餐</FoodText>
      <View
        testID="pickup-time-options"
        style={{ flexDirection: stacked ? 'column' : 'row', flexWrap: 'wrap', gap: 8 }}
      >
        {[15, 30, 60].map((minutes) => (
          <View key={minutes} style={stacked ? undefined : { flex: 1, minWidth: 0 }}>
            <FoodButton
              selected={/^\d+$/.test(value) && Number(value) === minutes}
              disabled={disabled}
              accessibilityLabel={`${minutes} 分鐘後`}
              onPress={() => onChange(String(minutes))}
            >
              {`${minutes} 分鐘後`}
            </FoodButton>
          </View>
        ))}
      </View>
      <FoodField
        label="幾分鐘後取餐"
        numeric
        max={4}
        disabled={disabled}
        value={value}
        onChange={onChange}
      />
      <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>
        {preview ? (
          <FoodText
            status
          >{`${pendingPickupAt ? '這次取餐時間' : '預計取餐'} ${preview}（台灣時間）`}</FoodText>
        ) : (
          <FoodText alert>
            {value === ''
              ? '請選上方的時間，或輸入 1–1,440 分鐘後取餐。'
              : '請輸入 1–1,440 的整數分鐘，或選上方的時間。'}
          </FoodText>
        )}
        {guidance.warning ? <FoodText alert>{guidance.warning}</FoodText> : null}
      </View>
      <FoodText subdued>{guidance.windowText}</FoodText>
      <FoodText subdued>
        快捷選項只幫你填入時間，並非門市保留的時段。確認時會依當下時間換算，能否接單請看報價結果。
      </FoodText>
    </View>
  );
}
