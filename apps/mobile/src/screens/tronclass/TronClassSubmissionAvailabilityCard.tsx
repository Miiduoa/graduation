import React from 'react';
import { Text, View } from 'react-native';
import type { TronClassSubmissionAvailability } from '../../services/tronClassIntegrationTypes';
import {
  TRONCLASS_AVAILABILITY_DESCRIPTION, TRONCLASS_AVAILABILITY_GROUP,
  TRONCLASS_AVAILABILITY_UNAVAILABLE, tronClassSubmissionAvailabilityFacts,
} from '@campus/shared/src/tronClassSubmissionAvailabilityDisplay';
import { AICard, AIButton, aiTokens } from '../../ui/aiFirst';

const body = { color: aiTokens.text, lineHeight: 23, marginBottom: 10 };

export function TronClassSubmissionAvailabilityCard({ availability, onRetry, retryDisabled }: {
  availability: TronClassSubmissionAvailability;
  onRetry(): void;
  retryDisabled: boolean;
}) {
  return (
    <AICard title="你的校方繳交狀態">
      <Text style={body}>更新於 {new Date(availability.fetchedAt).toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei', hour12: false,
      })}</Text>
      {availability.state === 'available' ? (
        <>
          {tronClassSubmissionAvailabilityFacts(availability).map(([label, value]) => (
            <View key={label}><Text style={body}>{label}：{value}</Text></View>
          ))}
          <Text style={body}>{TRONCLASS_AVAILABILITY_DESCRIPTION}</Text>
        </>
      ) : (
        <Text accessibilityLiveRegion="polite" style={body}>
          {availability.state === 'group-unsupported' ? TRONCLASS_AVAILABILITY_GROUP : TRONCLASS_AVAILABILITY_UNAVAILABLE}
        </Text>
      )}
      {availability.state !== 'group-unsupported' ? (
        <AIButton label="重新讀取繳交狀態" variant="ghost" disabled={retryDisabled} onPress={onRetry} />
      ) : null}
    </AICard>
  );
}
